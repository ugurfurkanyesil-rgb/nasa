/**
 * EVA readiness — three separate assessments, each with its own result and explanation
 * (no combined score):
 *   A. Payload & Mass                       utils/payloadAssessment.js
 *   B. Dust Exposure & Equipment Reliability utils/dustAssessment.js + config/dust.js
 *   C. Terrain & Mobility                   utils/mobilityAssessment.js
 * Presentational; values arrive computed.
 */
import { useState } from 'react';
import { fs } from '../ui/layout';
import { fmtHM, fmtSignedHM, fmtDist } from '../utils/format';
import { PAYLOAD_ITEMS, ogilvieEq7, OGILVIE_URL } from '../utils/payloadAssessment';
import { DUST_CONFIG, APPLICABILITY, DUST_SOURCES } from '../config/dust';
import { Btn } from './MissionPanels';

const T = { muted: '#7a8a7a', text: '#b8c8b0', bright: '#e8e0c8', warn: '#ffb347', bad: '#ff6655', good: '#88dd99', head: '#ffcc88' };
const small = (px = 7) => ({ fontSize: fs(px), lineHeight: 1.5 });
const RESULT_COL = { ok: T.good, PASS: T.good, over: T.bad, FAIL: T.bad, invalid: T.warn, 'NOT CHECKED': T.warn,
  'INSUFFICIENT DATA': '#8899aa', CAUTION: T.warn };
const LVL_COL = { low: T.good, moderate: T.warn, high: T.bad };

function Head({ letter, title, result, text }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, ...small(7.6), marginTop: 6 }}>
      <b style={{ color: T.head }}>{letter}. {title}</b>
      <span style={{ marginLeft: 'auto', fontWeight: 'bold', color: RESULT_COL[result] || T.muted }}>{text || result}</span>
    </div>
  );
}

function Row({ k, v, c }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, ...small(7.2), color: 'rgba(160,200,160,0.8)' }}>
      <span>{k}</span><span style={{ color: c || T.bright, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

export function ApplicabilityChip({ a }) {
  const c = APPLICABILITY[a];
  if (!c) return null;
  return <span title={c.label} style={{ fontSize: fs(6), padding: '0 3px', borderRadius: 2, border: `1px solid ${c.color}`, color: c.color, marginLeft: 3, whiteSpace: 'nowrap' }}>{c.short}</span>;
}

// ───────────────────────── A. Payload & Mass ─────────────────────────
export function PayloadPanel({ mission, setMission, payload, disabled }) {
  const ref = ogilvieEq7();
  const setItem = (id, raw) => {
    const v = raw === '' ? 0 : Number(raw);
    if (id === 'other') setMission({ ...mission, equipmentKg: v });
    else setMission({ ...mission, payload: { ...(mission.payload || {}), [id]: v } });
  };
  const resultText = payload.status === 'ok' ? 'WITHIN LIMIT' : payload.status === 'over' ? 'OVER LIMIT → NO-GO' : 'INVALID INPUT → NOT CHECKED';
  return (
    <div style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <Head letter="A" title="Payload & Mass" result={payload.status} text={resultText} />
      <div style={{ ...small(6.8), color: T.muted }}>Suit (one mass — components below are already inside it, not added again):</div>
      {payload.components.map((c, i) => <Row key={i} k={<span title={c.note}>· {c.label} <i>(included)</i></span>} v={`${c.kg} kg`} c={T.muted} />)}
      <Row k={<b>{payload.suit?.label || 'Suit'}</b>} v={payload.suit ? `${payload.suit.massKg} kg` : '—'} />
      <div style={{ ...small(6.8), color: T.muted, marginTop: 3 }}>Carried in addition (kg):</div>
      {PAYLOAD_ITEMS.map(it => {
        const item = payload.items.find(x => x.id === it.id);
        const val = (it.id === 'other' ? mission.equipmentKg : mission.payload?.[it.id]) ?? 0;
        return (
          <div key={it.id} title={it.note} style={{ display: 'flex', alignItems: 'center', gap: 5, ...small(7.2), color: '#9ab89a' }}>
            <span style={{ flex: 1 }}>{it.label}</span>
            <input type="number" min={0} step={0.5} value={val} onChange={e => setItem(it.id, e.target.value)}
              style={{ width: 54, fontSize: fs(7.5), background: 'rgba(0,20,0,0.6)', color: item?.valid === false ? T.bad : T.bright,
                border: `1px solid ${item?.valid === false ? T.bad : 'rgba(60,120,60,0.5)'}`, borderRadius: 2, padding: '1px 3px' }} />
          </div>
        );
      })}
      {payload.errors.map((e, i) => <div key={i} style={{ ...small(6.8), color: T.bad }}>✕ {e}</div>)}
      {payload.status !== 'invalid' && (
        <div style={{ marginTop: 3 }}>
          <Row k="Total carried mass" v={`${payload.massKg.toFixed(1)} kg (equipment ${payload.equipmentKg.toFixed(1)} kg)`} />
          <Row k="Weight on Mars" v={`${payload.earthEqKg.toFixed(1)} kg Earth-equivalent`} />
          <Row k="Configured limit" v={`${payload.limitKg} kg Earth-eq. (= ${payload.limitMassKg.toFixed(1)} kg carried on Mars)`} />
          <Row k="Remaining capacity" v={`${payload.remainingKg >= 0 ? '' : '−'}${Math.abs(payload.remainingKg).toFixed(1)} kg`} c={payload.remainingKg >= 0 ? T.good : T.bad} />
          <div style={{ height: 5, background: 'rgba(60,90,60,0.3)', borderRadius: 2, marginTop: 2 }}>
            <div style={{ width: `${Math.min(100, (payload.earthEqKg / payload.limitKg) * 100)}%`, height: '100%', borderRadius: 2,
              background: payload.ok ? '#55aa66' : '#cc4433' }} />
          </div>
        </div>
      )}
      <div style={{ ...small(6.4), color: '#7a6a4a', marginTop: 3 }}>
        Limit = NIOSH lift 23 kg + suit-pressure offload 22 kg (project rule, unchanged). For reference, Ogilvie et al.'s full Eq. 7
        (with the crew's own weight and a mobility factor, 49 kg crew, VO₂max 36) gives {ref.suitPlusCarryKg.toFixed(1)} kg suit + carry —
        the project rule ({payload.limitMassKg.toFixed(1)} kg) is stricter. No walking-speed penalty for payload: no validated model.
        {' '}<a href={OGILVIE_URL} target="_blank" rel="noreferrer" style={{ color: '#9ab' }}>Ogilvie et al. 2026</a>
      </div>
    </div>
  );
}

// ───────────────────────── B. Dust ─────────────────────────
export function DustPanel({ mission, setMission, dust, disabled }) {
  const [open, setOpen] = useState(null);
  const [showSrc, setShowSrc] = useState(false);
  const cfg = dust.config;
  const set = (k, v) => setMission({ ...mission, dust: { ...(mission.dust || {}), [k]: v } });
  const ind = dust.indicators;
  return (
    <div>
      <Head letter="B" title="Dust Exposure & Equipment Reliability" result={dust.result} />
      <div style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
        {Object.entries(DUST_CONFIG).map(([k, d]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, ...small(7), color: '#9ab89a' }}>
            <span style={{ flex: 1 }}>{d.label}</span>
            <select value={cfg[k]} onChange={e => set(k, e.target.value)}
              style={{ fontSize: fs(7), background: 'rgba(0,20,0,0.6)', color: cfg[k] === 'unknown' ? T.warn : T.bright, border: '1px solid rgba(60,120,60,0.5)', maxWidth: 170 }}>
              {Object.entries(d.options).map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
            </select>
          </div>
        ))}
      </div>
      <div style={{ ...small(6.8), color: T.muted, marginTop: 3 }}>Exposure indicators (from the data; no rate is computed):</div>
      <Row k="Time outside" v={ind.timeOutsideS != null ? fmtHM(ind.timeOutsideS) : '— (no route)'} />
      <Row k="Science stops (regolith handling)" v={ind.stops ?? '—'} />
      <Row k="Loose fine material on route" v={ind.looseShare == null ? 'UNKNOWN' : `${(ind.looseShare * 100).toFixed(0)} %`} c={ind.looseShare == null ? T.warn : undefined} />
      <div style={{ ...small(6.3), color: T.muted }}>{ind.looseBasis} {ind.atmosphere}</div>
      <Row k="Exposure level (design rule)" v={dust.exposure.toUpperCase()} c={LVL_COL[dust.exposure] || T.warn} />
      <div style={{ ...small(6.8), color: T.muted, marginTop: 3 }}>Components (vulnerability is qualitative — no failure probability exists):</div>
      {dust.components.map(c => (
        <div key={c.id} style={{ ...small(7), color: T.text }}>
          <div onClick={() => setOpen(open === c.id ? null : c.id)} style={{ cursor: 'pointer', display: 'flex', gap: 4 }}>
            <span style={{ flex: 1 }}>{open === c.id ? '▾' : '▸'} {c.label}</span>
            {c.applicable ? <b style={{ color: LVL_COL[c.level] }}>{c.level.toUpperCase()}</b> : <span style={{ color: T.muted }}>n/a</span>}
          </div>
          {open === c.id && (
            <div style={{ marginLeft: 10, color: T.muted }}>
              {!c.applicable ? <div>{c.note}</div> : <>
                <div><b>Failure mechanism:</b> {c.mechanism}</div>
                <div><b>Why {c.level}:</b> {c.rationale} <i>{c.note}</i></div>
                <div><b>Protection:</b> {c.credited.length ? c.credited.join('; ') : c.gaps.length ? `not stated (${c.gaps.join('; ')})` : 'none credited'}</div>
                <div><b>Precautions:</b> {c.precautions.join(' ')}</div>
                <div><b>Evidence:</b> {c.sources.map((s, i) => <span key={s.id}>{i ? '; ' : ''}{s.url ? <a href={s.url} target="_blank" rel="noreferrer" style={{ color: '#9ab' }}>{s.title.split(' — ')[0]}</a> : s.title}<ApplicabilityChip a={s.applicability} /></span>)}</div>
                <div><b>Confidence:</b> {c.confidence}</div>
              </>}
            </div>
          )}
        </div>
      ))}
      {dust.gaps.length > 0 && <div style={{ ...small(6.6), color: T.warn, marginTop: 2 }}>Data gaps: {dust.gaps.join(' · ')}</div>}
      {dust.warnings.map(w => <div key={w.id} style={{ ...small(6.8), color: '#e8c890' }}>⚠ {w.text}</div>)}
      <div style={{ ...small(6.4), color: '#7a6a4a', marginTop: 2 }}>
        Dust never blocks a route here and never changes mass or walking speed. The xEMU is a lunar-focused NASA suit development, not a Mars-certified suit;
        lunar and analog results are used as analogies only.
        {' '}<span onClick={() => setShowSrc(!showSrc)} style={{ color: '#9ab', cursor: 'pointer', textDecoration: 'underline' }}>{showSrc ? 'hide' : 'show'} all {DUST_SOURCES.length} sources</span>
      </div>
      {showSrc && DUST_SOURCES.map(s => (
        <div key={s.id} style={{ ...small(6.4), color: T.muted, marginLeft: 6, marginTop: 2 }}>
          <div style={{ color: T.text }}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer" style={{ color: '#9ab' }}>{s.title}</a> : s.title}<ApplicabilityChip a={s.applicability} /></div>
          <div>{s.program} · {s.date}</div>
          <div><b>Context:</b> {s.context}</div>
          <div><b>Engineering relevance:</b> {s.relevance}</div>
          <div><b>Limitations:</b> {s.limitations}</div>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────── C. Terrain & Mobility ─────────────────────────
export function MobilityPanel({ mobility }) {
  if (!mobility?.terrain) {
    return <><Head letter="C" title="Terrain & Mobility" result="NOT CHECKED" /><div style={{ ...small(7), color: '#3a5a3a' }}>{mobility?.headline || 'Plan a route to assess terrain & mobility.'}</div></>;
  }
  const t = mobility.terrain, w = mobility.walking, r = mobility.returnSafety, s = mobility.suit;
  return (
    <div>
      <Head letter="C" title="Terrain & Mobility" result={mobility.result} />
      <div style={{ ...small(6.8), color: T.text }}>{mobility.headline}</div>
      <Row k="Terrain difficulty (display rule)" v={t.difficulty.toUpperCase()} c={t.difficulty === 'easy' ? T.good : t.difficulty === 'moderate' ? T.warn : T.bad} />
      <Row k="Max slope / steep share" v={`${t.maxSlopeDeg.toFixed(1)}° · ${(t.steepShare * 100).toFixed(0)} % > ${t.steepDeg?.toFixed(0)}°`} />
      <Row k="Rock relief (max / rough share)" v={t.maxRockReliefM != null ? `${t.maxRockReliefM.toFixed(2)} / ${t.rockLimitM} m · ${(t.roughShare * 100).toFixed(0)} % rough` : 'no rock layer'} />
      <Row k="Rock buffer zone on route" v={`${(t.bufferShare * 100).toFixed(0)} %`} />
      <div style={{ ...small(6.6), color: T.muted }}>{t.craters}</div>
      <Row k="Walking distance / time" v={`${fmtDist(w.distanceM)} · ${fmtHM(w.walkTimeS)}`} />
      <Row k="EVA total (with stops)" v={`${fmtHM(w.roundTripS)} of ${fmtHM(w.budgetS)}`} />
      <Row k="Climb / descent" v={`${w.climbM.toFixed(0)} m / ${w.descentM.toFixed(0)} m`} />
      <Row k="Return safety" v={`min margin ${fmtSignedHM(r.minMarginS)}${r.ponr ? ' · POINT OF NO RETURN' : ''}`} c={r.ponr || r.minMarginS < 0 ? T.bad : T.good} />
      {mobility.checks.map(c => (
        <Row key={c.id} k={c.label} v={c.state === 'pass' ? 'PASS' : c.state === 'fail' ? 'FAIL' : 'NOT CHECKED'}
          c={c.state === 'pass' ? T.good : c.state === 'fail' ? T.bad : T.warn} />
      ))}
      <div style={{ ...small(6.5), color: T.muted, marginTop: 2 }}>
        Suit: {s.limitSet} — level walk {s.levelSpeedKmh} km/h, slope limit {s.slopeLimitDeg}° ({s.speedSource}). {s.slopeModel} {s.consistency}
      </div>
      <div style={{ ...small(6.4), color: '#7a6a4a' }}>
        Payload penalty: none — {mobility.payloadPenalty.reason} Dust penalty: none — {mobility.dustPenalty.reason}
      </div>
    </div>
  );
}
