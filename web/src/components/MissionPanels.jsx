/**
 * Mission-planning panels for the right-hand panel (DEM mode):
 *   WorkflowSteps     the recommended order of work, with each step's real state
 *   ObjectivePanel    mission objective selector — drives the science-stop planner
 *   ProvenancePanel   every data layer with mission, instrument, source, category, limits
 *   HazardPanel       hazard map summary, thresholds and their basis, obstacle-buffer setting
 *   StopCards         one card per science stop (utils/stopRationale.js)
 *   SafetyPanel       GO / CONDITIONAL / NO-GO / INSUFFICIENT DATA, explained (utils/missionStatus.js)
 *   RadiationPanel    measured radiation and space-weather events, kept apart
 *   MissionSummaryPanel  one-glance summary of the planned EVA (utils/missionSummary.js)
 * Presentational: all values arrive computed.
 */
import { useEffect, useRef, useState } from 'react';
import { fs } from '../ui/layout';
import { fmtHM, fmtSignedHM, fmtDist } from '../utils/format';
import { CATEGORIES } from '../config/provenance';
import { STATUS_COLOR } from '../utils/missionStatus';
import { HAZARD_LEGEND, HAZARD_PARAMS } from '../utils/hazardMap';
import { generateHeatmapCanvas, HAZARD_LAYER } from '../utils/heatmaps';
import { OBJECTIVE_POINTS_NOTE } from '../config/objectives';
import { RADIATION } from '../utils/radiation';

const T = { muted: '#7a8a7a', text: '#b8c8b0', bright: '#e8e0c8', warn: '#ffb347', bad: '#ff6655', good: '#88dd99', head: '#ffcc88' };
const small = (px = 7) => ({ fontSize: fs(px), lineHeight: 1.5 });

export function Btn({ children, active, onClick, disabled, color, title, style = {} }) {
  return (
    <button title={title} onClick={disabled ? undefined : onClick} style={{
      flex: 1, padding: '4px 4px', fontSize: fs(8), fontWeight: 'bold', cursor: disabled ? 'default' : 'pointer', borderRadius: 3,
      border: `1px solid ${active ? (color || 'rgba(60,180,60,0.7)') : 'rgba(35,70,35,0.4)'}`,
      background: active ? 'rgba(0,50,0,0.5)' : 'rgba(6,14,6,0.4)', color: active ? (color || '#77ff77') : '#447744',
      opacity: disabled ? 0.4 : 1, fontFamily: 'monospace', letterSpacing: 0.4, ...style,
    }}>{children}</button>
  );
}

export function CategoryChip({ cat, subtype }) {
  const c = CATEGORIES[cat];
  if (!c) return null;
  return (
    <span title={`${c.label}: ${c.desc}${subtype ? ` (${subtype})` : ''}`} style={{ fontSize: fs(6), padding: '0 3px', borderRadius: 2,
      border: `1px solid ${c.color}`, color: c.color, marginLeft: 3, whiteSpace: 'nowrap' }}>{c.short}</span>
  );
}

export function StatusBadge({ status, style = {} }) {
  const col = STATUS_COLOR[status] || '#8899aa';
  return (
    <span style={{ fontSize: fs(7.5), fontWeight: 'bold', padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap',
      color: status === 'GO' || status === 'CONDITIONAL' ? '#0a1a0a' : '#fff', background: col, ...style }}>{status}</span>
  );
}

// ───────────────────────── workflow ─────────────────────────
const STEP_COL = { done: '#88dd99', current: '#ffcc66', todo: '#4a6a4a', blocked: '#ff6655' };
export function WorkflowSteps({ steps, onGo }) {
  const firstOpen = steps.findIndex(s => s.state !== 'done');
  return (
    <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px 6px' }}>
      {steps.map((s, i) => {
        const st = i === firstOpen && s.state === 'todo' ? 'current' : s.state;
        return (
          <li key={s.id} onClick={() => onGo?.(s.id)} title={s.hint}
            style={{ ...small(6.8), color: STEP_COL[st], cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {st === 'done' ? '✓' : st === 'blocked' ? '✕' : st === 'current' ? '▶' : '○'} {i + 1}. {s.label}
          </li>
        );
      })}
    </ol>
  );
}

// ───────────────────────── objective ─────────────────────────
const SUP_COL = { supported: T.good, partial: T.warn, unsupported: T.bad };
export function ObjectivePanel({ objectives, value, onChange, support, disabled }) {
  const sel = objectives.find(o => o.id === value) || null;
  const sup = sel ? support[sel.id] : null;
  return (
    <div style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {objectives.map(o => {
          const s = support[o.id];
          return (
            <Btn key={o.id} active={o.id === value} color="#ffcc66" onClick={() => onChange(o.id)}
              disabled={s?.status === 'unsupported'} title={s?.note || o.purpose}
              style={{ textAlign: 'left', padding: '3px 6px', display: 'flex', justifyContent: 'space-between' }}>
              <span>{o.label}</span>
              <span style={{ color: SUP_COL[s?.status] || T.muted, fontWeight: 'normal' }}>{s?.status === 'partial' ? 'PARTIAL DATA' : s?.status === 'unsupported' ? 'NO DATA' : ''}</span>
            </Btn>
          );
        })}
      </div>
      {!sel && <div style={{ ...small(7), color: T.warn, marginTop: 4 }}>Choose an objective: the science-stop planner needs one.</div>}
      {sel && (
        <div style={{ ...small(7), color: T.text, marginTop: 5, borderLeft: '2px solid rgba(255,204,102,0.5)', paddingLeft: 6 }}>
          <div><b style={{ color: T.head }}>Purpose.</b> {sel.purpose}</div>
          <div><b style={{ color: T.head }}>Why it matters.</b> {sel.relevance}</div>
          <div><b style={{ color: T.head }}>Data layers.</b> {sel.layers.join(', ')}</div>
          <div><b style={{ color: T.head }}>Candidate locations.</b> {sel.candidates}</div>
          <div><b style={{ color: T.head }}>Selection criteria.</b></div>
          <ul style={{ margin: '0 0 0 12px', padding: 0 }}>{sel.criteria.map((c, i) => <li key={i}>{c}</li>)}</ul>
          <div><b style={{ color: T.head }}>Known uncertainties.</b></div>
          <ul style={{ margin: '0 0 0 12px', padding: 0 }}>{sel.uncertainties.map((c, i) => <li key={i}>{c}</li>)}</ul>
          {sup && (
            <div style={{ color: SUP_COL[sup.status], marginTop: 2 }}>
              Data support in this site: <b>{sup.status.toUpperCase()}</b>
              {sup.detail.length > 0 && <span style={{ color: T.muted }}> — {sup.detail.slice(0, 4).join('; ')}</span>}
              {sup.note && <div style={{ color: SUP_COL[sup.status] }}>{sup.note}</div>}
            </div>
          )}
          {sel.refs?.length > 0 && (
            <div style={{ color: T.muted }}>Sources: {sel.refs.map((r, i) => <span key={i}>{i ? ' · ' : ''}<a href={r.url} target="_blank" rel="noreferrer" style={{ color: '#9ab' }}>{r.title}</a></span>)}</div>
          )}
          <div style={{ color: '#7a6a4a' }}>{OBJECTIVE_POINTS_NOTE}</div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── provenance ─────────────────────────
export function ProvenancePanel({ records, onOpen }) {
  const [open, setOpen] = useState(null);
  const groups = [['integrated', 'Used by this site'], ['missing', 'Expected but not loaded'], ['unavailable', 'Investigated — not available']];
  return (
    <div>
      <div style={{ ...small(6.5), color: T.muted, marginBottom: 3 }}>
        {Object.entries(CATEGORIES).map(([k, c]) => <span key={k} style={{ marginRight: 6 }}><CategoryChip cat={k} /> {c.label.split(' ')[0]}</span>)}
      </div>
      {groups.map(([g, title]) => {
        const rs = records.filter(r => r.status === g);
        if (!rs.length) return null;
        return (
          <div key={g} style={{ marginBottom: 4 }}>
            <div style={{ ...small(6.8), color: g === 'integrated' ? T.good : g === 'missing' ? T.warn : T.bad }}>{title}</div>
            {rs.map(r => (
              <div key={r.id} style={{ ...small(7), color: T.text }}>
                <div onClick={() => { setOpen(open === r.id ? null : r.id); onOpen?.(); }} style={{ cursor: 'pointer' }}>
                  {open === r.id ? '▾' : '▸'} {r.name}
                  {r.categories.map(c => <CategoryChip key={c} cat={c} subtype={r.subtype} />)}
                </div>
                {open === r.id && (
                  <div style={{ marginLeft: 10, color: T.muted }}>
                    <div><b>Mission / instrument:</b> {r.mission} · {r.instrument}</div>
                    <div><b>Source:</b> {r.source?.url ? <a href={r.source.url} target="_blank" rel="noreferrer" style={{ color: '#9ab' }}>{r.source.title || r.source.url}</a> : (r.source?.title || '—')}</div>
                    {r.source?.citation && <div style={{ fontSize: fs(6.5) }}>{r.source.citation}</div>}
                    <div><b>Observation:</b> {r.observation}</div>
                    <div><b>Resolution:</b> {r.resolution} · <b>Coverage:</b> {r.coverage}</div>
                    <div><b>Data type:</b> {r.dataType} · <b>Kind:</b> {r.categories.map(c => CATEGORIES[c].label).join(' + ')}{r.subtype ? ` (${r.subtype})` : ''}</div>
                    <div><b>Processing:</b> {r.processing}</div>
                    <div><b>Status:</b> {r.status}</div>
                    <div><b>Uncertainty:</b> {r.uncertainty}</div>
                    <div><b>Limitations:</b></div>
                    <ul style={{ margin: '0 0 0 12px', padding: 0 }}>{r.limitations.map((x, i) => <li key={i}>{x}</li>)}</ul>
                    {r.investigation && <div style={{ color: '#c9a' }}><b>Investigation:</b> {r.investigation}</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ───────────────────────── hazards ─────────────────────────
export function HazardPanel({ hazards, bufferM, setBufferM, onDrape, draped, disabled, refreshKey }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current && hazards) generateHeatmapCanvas(ref.current, HAZARD_LAYER, 45); }, [hazards, refreshKey]);
  if (!hazards) return null;
  return (
    <div>
      <canvas ref={ref} width={180} height={180} style={{ width: '100%', aspectRatio: '1', imageRendering: 'pixelated',
        border: '1px solid rgba(60,100,60,0.4)', borderRadius: 3, background: '#1a120e' }} />
      <div style={{ ...small(6.8), marginTop: 3 }}>
        {HAZARD_LEGEND.map(e => (
          <div key={e.flag} style={{ display: 'flex', alignItems: 'center', gap: 4, color: T.text }}>
            <span style={{ width: 8, height: 8, background: `rgb(${e.color.join(',')})`, flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{e.label}{e.hard ? ' ★' : ''}</span>
            <span style={{ color: T.muted }}>{((hazards.summary[e.flag] || 0) * 100).toFixed(1)} %</span>
          </div>
        ))}
        <div style={{ color: T.muted }}>★ hard constraint (planner wall). Others are advisories shown on the route card.</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, ...small(7.5), color: '#9ab89a', marginTop: 4,
        opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
        <span title={HAZARD_PARAMS.obstacleBufferM.note}>Rock keep-out</span>
        {HAZARD_PARAMS.obstacleBufferM.options.map(m => (
          <Btn key={m} active={bufferM === m} color="#ff99dd" onClick={() => setBufferM(m)} style={{ padding: '2px 4px' }}>{m ? `${m} m` : 'OFF'}</Btn>
        ))}
      </div>
      <div style={{ ...small(6.5), color: '#7a6a4a' }}>
        {bufferM > 0 ? `Planner walls every cell within ${bufferM} m of a rock obstacle (design choice). Re-plan the science EVA.`
          : 'Buffer shown on the map but not enforced (validated planner unchanged). Design choice.'}
      </div>
      {onDrape && <Btn active={draped} color="#ffcc88" onClick={onDrape} style={{ width: '100%', marginTop: 4 }}>{draped ? '✓ HAZARD MAP ON 3D TERRAIN' : 'DRAPE HAZARD MAP ON 3D TERRAIN'}</Btn>}
      <div style={{ ...small(6.5), color: T.warn, marginTop: 3 }}>
        Limits: the 1 m DTM resolves rocks of a few metres; rocks under ~1–2 m, loose sand, soft ground and small pits are NOT detected.
        No colour is not proof of safe ground. Thresholds: slope wall = NASA xEVA 20° (lunar); rock 0.5 m, steep 75 %, rough 50 %,
        depression ≥ {HAZARD_PARAMS.depressionMinDepthM.value} m, ground truth {HAZARD_PARAMS.groundTruthRadiusM.value} m — design choices.
        {hazards.missing.length > 0 && <> Missing: {hazards.missing.join('; ')}.</>}
      </div>
    </div>
  );
}

// ───────────────────────── stop cards ─────────────────────────
const RISK_COL = { low: T.good, elevated: T.warn, high: T.bad };
export function StopCards({ cards, onGround, onChem, hasGround, hasChem }) {
  const [open, setOpen] = useState(0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
      {cards.map((c, i) => (
        <div key={i} style={{ border: '1px solid rgba(255,179,71,0.3)', borderRadius: 3, padding: '3px 5px', background: 'rgba(30,18,6,0.4)' }}>
          <div onClick={() => setOpen(open === i ? -1 : i)} style={{ cursor: 'pointer', display: 'flex', gap: 4, alignItems: 'baseline', ...small(7.5) }}>
            <b style={{ color: '#ffb347' }}>S{c.n}</b>
            <span style={{ flex: 1, color: '#e0d0b0' }}>{c.name}</span>
            <span style={{ color: RISK_COL[c.terrain.risk], fontSize: fs(6.5) }}>{c.terrain.risk} risk</span>
          </div>
          {open === i && (
            <div style={{ ...small(6.8), color: T.text, marginTop: 2 }}>
              <div style={{ color: T.muted }}>
                {c.lat != null ? `${Math.abs(c.lat).toFixed(5)}°${c.lat >= 0 ? 'N' : 'S'} ${c.lon.toFixed(5)}°E · ` : ''}
                x {c.x.toFixed(0)} m E, z {c.z.toFixed(0)} m S of centre · stay {fmtHM(c.visitS)}
              </div>
              <div><b style={{ color: T.head }}>Objective:</b> {c.objective}</div>
              <div><b style={{ color: T.head }}>Why selected:</b> {c.why}</div>
              {c.investigate.length > 0 && <div><b style={{ color: T.head }}>Investigate:</b> {c.investigate.join(' ')}</div>}
              <div><b style={{ color: T.head }}>Supporting data:</b> {c.layers.map((l, k) => <span key={k}>{k ? ', ' : ''}{l.name}<CategoryChip cat={l.category} subtype={l.subtype} /></span>)}</div>
              <div><b style={{ color: T.head }}>Evidence:</b></div>
              <ul style={{ margin: '0 0 0 12px', padding: 0 }}>{c.evidence.map((e, k) => <li key={k}>{e}</li>)}</ul>
              <div><b style={{ color: T.head }}>Terrain:</b> slope {c.terrain.slopeDeg?.toFixed(1)}°{c.terrain.rockM != null ? ` · rock relief ${c.terrain.rockM.toFixed(2)} m` : ''}
                {c.terrain.hazards.length ? ` · ${c.terrain.hazards.join('; ')}` : ' · no mapped hazard at the stop'}</div>
              <div title={c.confidence.basis}><b style={{ color: T.head }}>Data confidence:</b> {c.confidence.label}</div>
              <div><b style={{ color: T.head }}>Uncertainty:</b></div>
              <ul style={{ margin: '0 0 0 12px', padding: 0, color: T.muted }}>{c.uncertainty.map((e, k) => <li key={k}>{e}</li>)}</ul>
              <div style={{ display: 'flex', gap: 8 }}>
                {hasGround(c) && <span onClick={() => onGround(c)} style={{ color: '#ffcc88', cursor: 'pointer', textDecoration: 'underline' }}>ground view</span>}
                {hasChem(c) && <span onClick={() => onChem(c)} style={{ color: '#88ccff', cursor: 'pointer', textDecoration: 'underline' }}>chemistry</span>}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ───────────────────────── safety ─────────────────────────
const STATE_TXT = { pass: ['PASS', T.good], fail: ['FAIL', T.bad], unknown: ['NOT CHECKED', '#8899aa'] };
const LEVEL_COL = { warning: T.warn, caution: '#e8c890', info: T.muted };
export function SafetyPanel({ evaluation }) {
  if (!evaluation) return null;
  return (
    <div style={{ ...small(7), color: T.text, marginTop: 5, borderTop: '1px solid rgba(60,100,60,0.3)', paddingTop: 3 }}>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}><StatusBadge status={evaluation.status} /><span>{evaluation.headline}</span></div>
      <div style={{ color: T.head, marginTop: 3 }}>Hard constraints (any fail → NO-GO; any not checked → INSUFFICIENT DATA)</div>
      {evaluation.hard.map(h => (
        <div key={h.id} title={h.why} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4 }}>
          <span>{h.label} <span style={{ color: T.muted }}>· {h.value}</span></span>
          <span style={{ color: STATE_TXT[h.state][1], fontWeight: 'bold' }}>{STATE_TXT[h.state][0]}</span>
          {h.state !== 'pass' && <span style={{ gridColumn: '1 / 3', color: STATE_TXT[h.state][1] }}>{h.why}</span>}
        </div>
      ))}
      {evaluation.warnings.length > 0 && <div style={{ color: T.head, marginTop: 3 }}>Environmental warnings (→ CONDITIONAL until cleared)</div>}
      {evaluation.warnings.map(w => <div key={w.id} style={{ color: LEVEL_COL[w.level] }}>⚠ {w.label} — <span style={{ color: T.text }}>{w.text}</span></div>)}
      {evaluation.info.length > 0 && <div style={{ color: T.head, marginTop: 3 }}>Context (does not change the status)</div>}
      {evaluation.info.map(w => <div key={w.id} style={{ color: LEVEL_COL[w.level] }}>· {w.label} — <span style={{ color: T.muted }}>{w.text}</span></div>)}
    </div>
  );
}

// ───────────────────────── radiation / space weather ─────────────────────────
const SW_STATE = {
  bundled: 'bundled DONKI archive', live: 'live DONKI lookup', loading: 'looking up DONKI…',
  failed: 'DONKI lookup failed (offline or rate-limited)', future: 'future date — DONKI is a catalogue, it has no forecast',
};
export function RadiationPanel({ sw, swState, record, doseComparison }) {
  const transferred = record?.categories?.includes('transferred');
  const tag = !sw || sw.advisory === 'no-data' ? { t: 'UNKNOWN — not verified', c: '#8899aa' }
    : sw.advisory === 'postpone' ? { t: '⚠ SEP ±2 d — POSTPONE', c: T.bad } : { t: `no SEP catalogued ±${RADIATION.sepWindowDays.value} d`, c: T.good };
  const row = { display: 'flex', justifyContent: 'space-between', fontSize: fs(7.5), color: 'rgba(160,200,160,0.8)', lineHeight: 1.6 };
  return (
    <div style={{ marginTop: 4, borderTop: '1px solid rgba(60,90,60,0.3)', paddingTop: 3 }}>
      <div style={{ ...small(7), color: T.head }}>Measured radiation (galactic cosmic rays)</div>
      <div style={row}><span>Dose rate {record && <CategoryChip cat={record.categories[0]} />}</span>
        <span style={{ color: T.bright }}>{RADIATION.gcrDoseEquivalentMSvPerDay.value} ± {RADIATION.gcrDoseEquivalentMSvPerDay.uncertainty} mSv/day</span></div>
      <div style={{ ...small(6.5), color: transferred ? '#ff9f5a' : T.muted }}>
        {record?.observation} · {record?.coverage}
        {transferred && <> — <b>reference value transferred from Gale, not a local measurement.</b></>}
      </div>
      {record?.limitations?.map((l, i) => <div key={i} style={{ ...small(6.3), color: T.muted }}>· {l}</div>)}
      {doseComparison}
      <div style={{ ...small(7), color: T.head, marginTop: 3 }}>Space-weather events (DONKI) — separate from the measured dose</div>
      <div style={row}><span>Advisory</span><span style={{ color: tag.c, fontWeight: 'bold' }}>{tag.t}</span></div>
      <div style={{ ...small(6.5), color: T.muted }}>
        Source: {SW_STATE[swState] || '—'}{sw?.coverage ? ` · window ${sw.coverage[0]} … ${sw.coverage[1]}` : ''}
      </div>
      {sw?.near?.slice(0, 4).map((e, i) => (
        <div key={i} style={{ fontSize: fs(6.5), color: e.type === 'SEP' ? '#ff8877' : '#9aa8b8' }}>
          {e.type} · {e.time.slice(0, 16).replace('T', ' ')} UTC{e.class ? ` · ${e.class}` : ''}{e.speedKmS ? ` · ${Math.round(e.speedKmS)} km/s` : ''}
          {e.type === 'CME' ? ' · modelled arrival at Mars (WSA-ENLIL)' : e.type === 'SEP' ? ' · detected near Earth' : ''}
        </div>
      ))}
      <div style={{ ...small(6.3), color: '#9a8a6a' }}>
        DONKI lists events that have happened; it is not a forecast. SEP and flare detections are made near Earth, not at Mars.
        Missing or failed data is shown as UNKNOWN and never counted as zero risk.
      </div>
    </div>
  );
}

// ───────────────────────── summary ─────────────────────────
export function MissionSummaryPanel({ summary }) {
  if (!summary) return <div style={{ ...small(7.5), color: '#3a5a3a', textAlign: 'center', padding: '6px 0' }}>Plan a route to see the mission summary.</div>;
  const row = (k, v, c) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, ...small(7.3), color: 'rgba(160,200,160,0.8)' }}>
      <span>{k}</span><span style={{ color: c || T.bright, textAlign: 'right' }}>{v}</span>
    </div>
  );
  return (
    <div>
      {row('Mission status', <StatusBadge status={summary.status} />)}
      {row('Objective', summary.objective?.label || 'none (hand-made route)')}
      {row('Site', summary.site.label)}
      {row('Route', summary.route)}
      {row('Science stops', summary.stops)}
      {row('Walking distance', fmtDist(summary.distanceM))}
      {row('EVA duration', `${fmtHM(summary.evaDurationS)} of ${fmtHM(summary.budgetS)}`)}
      {row('Tightest return margin', fmtSignedHM(summary.minReturnMarginS), summary.minReturnMarginS < 0 ? T.bad : undefined)}
      {row('Max slope encountered', `${summary.maxSlopeDeg.toFixed(1)}°`)}
      {row('Major hazards', summary.majorHazards.length ? summary.majorHazards.map(h => `${h.label} ${(h.share * 100).toFixed(0)} %`).join(' · ') : 'none mapped on the route')}
      {summary.radiation && row('Radiation', `${summary.radiation.doseMSv.toFixed(2)} mSv GCR (${summary.radiation.basis})`)}
      <div style={{ ...small(6.5), color: T.muted }}>{summary.statusHeadline}</div>
    </div>
  );
}
