/**
 * EvaHud — live EVA playback overlay (DEM mode, Stage 7).
 *
 * Mission clock, timeline with science stops / point of no return, current
 * activity, live walk-back margin, distance home, sun and expected air
 * temperature at the mission time, playback controls and ABORT.
 * Reads the EvaPlayback controller at 10 Hz (no per-frame React renders).
 */

import { SHEET_VH } from '../ui/layout';
import { useEffect, useState, useCallback } from 'react';
import { evaSnapshot, SPEEDS } from '../utils/evaPlayback';
import { fmtClock, fmtHM, fmtSignedHM, fmtHourMin, fmtDist } from '../utils/format';
import { K_TO_C, climateInstrument } from '../utils/climate';
import { SITE } from '../three/terrainGenerator';
import { param, getEvaProfile } from '../config/marswalkProfile';
import { getLifeSupport, PLSS_ARCHS, oxygenKg } from '../config/lifeSupport';
import { fmtKg } from '../utils/oxygenBudget';
import { evaDoseMSv } from '../utils/radiation';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function marginColor(m) {
  if (!Number.isFinite(m) || m < 0) return '#ff5a4a';
  if (m < 900) return '#ff5a4a';
  if (m < 3600) return '#ffb347';
  return '#5be37a';
}

const STATUS_STYLE = {
  ready:   { label: 'READY',    color: '#9fd4ff' },
  playing: { label: 'LIVE',     color: '#5be37a' },
  paused:  { label: 'PAUSED',   color: '#ffd166' },
  done:    { label: 'COMPLETE', color: '#9fd4ff' },
};

function Tile({ label, children, sub, color = '#e8e0c8', wide = false, compact = false }) {
  return (
    <div style={{ flex: wide ? 1.3 : 1, background: 'rgba(0,0,0,0.32)', border: '1px solid rgba(232,168,120,0.18)',
      borderRadius: 4, padding: '4px 7px', minWidth: 0 }}>
      <div style={{ fontSize: 9, letterSpacing: 1, color: 'rgba(232,196,168,0.65)' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 'bold', color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</div>
      {sub && !compact && <div style={{ fontSize: 10, color: 'rgba(232,196,168,0.62)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
    </div>
  );
}

function HudButton({ children, onClick, color = '#e8c4a8', title, active = false, disabled = false }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled} style={{
      fontFamily: MONO, fontSize: 11, fontWeight: 'bold', letterSpacing: 0.5,
      padding: '4px 8px', borderRadius: 3, cursor: disabled ? 'not-allowed' : 'pointer',
      color: disabled ? '#6a5a50' : color,
      background: active ? 'rgba(255,170,90,0.22)' : 'rgba(30,14,6,0.7)',
      border: `1px solid ${active ? color : 'rgba(232,168,120,0.35)'}`,
    }}>{children}</button>
  );
}

function Timeline({ snap, onSeek }) {
  const { marks, progress } = snap;
  const click = (e) => {
    if (!onSeek) return;
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
  };
  return (
    <div onClick={click} title={onSeek ? 'Click to jump' : undefined}
      style={{ position: 'relative', height: 12, margin: '5px 0 3px', cursor: onSeek ? 'pointer' : 'default',
        background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress * 100}%`,
        background: snap.aborted ? 'rgba(255,136,0,0.45)' : 'rgba(91,227,122,0.35)' }} />
      {marks.stops.map(m => (
        <div key={m.n} title={`Stop ${m.n}`} style={{ position: 'absolute', top: 2, bottom: 2,
          left: `${m.f0 * 100}%`, width: `${Math.max(0.6, (m.f1 - m.f0) * 100)}%`,
          background: '#ffb347', opacity: 0.85, borderRadius: 1 }} />
      ))}
      {marks.ponrF != null && (
        <div title="Point of no return" style={{ position: 'absolute', top: 0, bottom: 0, left: `${marks.ponrF * 100}%`,
          width: 2, background: '#ff3b2f' }} />
      )}
      {marks.abortF != null && (
        <div title="Abort" style={{ position: 'absolute', top: 0, bottom: 0, left: `${marks.abortF * 100}%`,
          width: 2, background: '#ff8800' }} />
      )}
      <div style={{ position: 'absolute', top: -1, bottom: -1, left: `calc(${progress * 100}% - 1px)`,
        width: 2, background: '#fff' }} />
    </div>
  );
}

function Activity({ snap }) {
  const a = snap.activity;
  const name = (st) => `Stop ${st.n}${st.label ? ` — ${st.label}` : ''}`;
  let icon = '•', text = '', color = '#e8e0c8';
  switch (a.kind) {
    case 'ready':
      icon = '▶'; text = a.next ? `Ready at the habitat · first: ${name(a.next)}` : 'Ready at the habitat'; break;
    case 'walk':
      icon = '🚶'; text = `Walking to ${name(a.next)} · ${fmtDist(a.distM)} · ETA ${fmtHM(a.etaS)}`; break;
    case 'walk-home':
      icon = '🏠'; text = `Walking back to the habitat · ${fmtDist(a.distM)} · ETA ${fmtHM(a.etaS)}`; break;
    case 'sample':
      icon = '⛏'; color = '#ffcf8a'; text = `Sampling at ${name(a.stop)} · ${fmtClock(a.dwellLeftS).slice(3)} left`; break;
    case 'return':
      icon = '↩'; color = '#ffa040'; text = `ABORT (${snap.aborted?.reason}) — returning home · ETA ${fmtHM(a.etaS)}`; break;
    case 'done':
      icon = '✓'; color = '#9fd4ff';
      text = snap.aborted
        ? `Back at the habitat after the abort · ${fmtHM(snap.t)}`
        : `EVA complete · ${fmtHM(snap.t)} · ${snap.stopsDone}/${snap.stopsTotal} stops sampled`;
      break;
    default: text = '';
  }
  return (
    <div title={text} style={{ fontSize: 12, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: '2px 0 5px' }}>
      <span style={{ marginRight: 6 }}>{icon}</span>{text}
    </div>
  );
}

/**
 * @param {EvaPlayback} playback
 * @param {number} right  px from the right edge of the window (panel width + gap)
 */
export default function EvaHud({ playback, right = 12, narrow = false, compact = narrow, onAbort, onStop }) {
  const [snap, setSnap] = useState(() => evaSnapshot(playback));
  useEffect(() => {
    const id = setInterval(() => setSnap(evaSnapshot(playback)), 100);
    const off = playback.subscribe(() => setSnap(evaSnapshot(playback)));
    return () => { clearInterval(id); off(); };
  }, [playback]);

  const seek = useCallback((f) => playback.seek(f * playback.nominal.totalS), [playback]);
  if (!snap || snap.status === 'idle') return null;

  const st = STATUS_STYLE[snap.status] || STATUS_STYLE.ready;
  const m = snap.margin;
  const radialKm = param('maxRadialDistanceKm');
  const sun = snap.sun, air = snap.air;
  const lastEvent = snap.events[snap.events.length - 1];
  const canAbort = !snap.aborted && (snap.status === 'playing' || snap.status === 'paused');
  // Primary O₂ used so far (config/lifeSupport.js planning rate; stops vs walking split)
  const ls = getLifeSupport(), arch = PLSS_ARCHS[ls.arch];
  const dwellS = snap.dwellDoneS || 0;
  const o2 = oxygenKg(ls, getEvaProfile(), dwellS, snap.t - dwellS);
  const o2Cap = arch.capacity?.kg ?? null;

  return (
    <div id="eva-hud" style={{
      position: 'absolute', right, zIndex: 16,
      ...(narrow ? { left: 6, bottom: `calc(${SHEET_VH}vh + 6px)`, fontSize: 11 } : { bottom: 12, width: `min(540px, calc(100vw - ${right + 12}px))` }),
      fontFamily: MONO, color: '#e8c4a8', background: 'rgba(22,10,4,0.86)',
      border: `1px solid ${snap.ponrPassed ? '#ff5a4a' : 'rgba(232,168,120,0.4)'}`,
      borderRadius: 6, padding: '8px 10px', boxShadow: '0 4px 18px rgba(0,0,0,0.45)',
      backdropFilter: 'blur(3px)',
    }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 4 : 8, flexWrap: compact ? 'wrap' : 'nowrap' }}>
        <span style={{ fontSize: 10, fontWeight: 'bold', color: '#140800',
          background: snap.aborted && snap.status !== 'done' ? '#ff8800' : st.color,
          borderRadius: 3, padding: '1px 6px', letterSpacing: 1 }}>{snap.aborted && snap.status !== 'done' ? 'ABORT' : st.label}</span>
        <span style={{ fontSize: 11, letterSpacing: 1.2, color: '#f0d0b0', whiteSpace: 'nowrap' }}>{snap.mode}{compact ? '' : ' ROUTE · EV1 + EV2'}</span>
        <span style={{ flex: 1 }} />
        {!compact && <span style={{ fontSize: 9, color: 'rgba(232,196,168,0.6)' }}>SPEED</span>}
        {SPEEDS.map(x => (
          <HudButton key={x} active={snap.speed === x} onClick={() => playback.setSpeed(x)} title={`${x}× mission time`}>
            ×{x}
          </HudButton>
        ))}
      </div>

      {/* clock */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
        <span style={{ fontSize: 9, letterSpacing: 1, color: 'rgba(232,196,168,0.65)' }}>MET</span>
        <span style={{ fontSize: compact ? 17 : 22, fontWeight: 'bold', color: '#fff2e0', letterSpacing: 1 }}>{fmtClock(snap.t)}</span>
        <span style={{ fontSize: 12, color: 'rgba(232,196,168,0.7)' }}>/ {fmtClock(snap.totalS)}</span>
        <span style={{ flex: 1 }} />
        {sun && <span style={{ fontSize: compact ? 10 : 11, color: '#ffd166' }}>LTST {fmtHourMin(sun.ltst)} · Sol {Math.floor(sun.msd)}</span>}
      </div>

      <Timeline snap={snap} onSeek={snap.aborted ? null : seek} />
      <Activity snap={snap} />

      {/* safety + conditions */}
      <div style={compact ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 } : { display: 'flex', gap: 6 }}>
        <Tile compact={compact} label="WALK-BACK MARGIN" color={marginColor(m)} wide
          sub={m === -Infinity ? 'home unreachable' : `fastest walk home: ${fmtHM(snap.backS)}`}>
          {snap.ponrPassed && m < 0 ? '⛔ ' : ''}{m === -Infinity ? 'NO PATH HOME' : fmtSignedHM(m)}
        </Tile>
        <Tile compact={compact} label="FROM HABITAT" color={snap.distHomeM > radialKm * 1000 ? '#ff5a4a' : '#e8e0c8'}
          sub={`limit ${radialKm} km`}>
          {fmtDist(snap.distHomeM)}
        </Tile>
        <Tile compact={compact} label="SUN ELEV. · AIR" color={sun && sun.elevationDeg <= 0 ? '#8899cc' : '#ffd166'}
          sub={air && air.p10 != null && air.p90 != null
            ? `${climateInstrument(SITE.climate)} p10–p90: ${K_TO_C(air.p10).toFixed(0)}…${K_TO_C(air.p90).toFixed(0)} °C` : air ? `${climateInstrument(SITE.climate)} climatology` : 'no climate data'}>
          {sun ? (sun.elevationDeg > 0 ? `${sun.elevationDeg.toFixed(0)}°` : 'night') : '—'}
          {air ? <span style={{ color: '#ffcc88' }}> · {K_TO_C(air.median).toFixed(0)} °C</span> : null}
        </Tile>
        <Tile compact={compact} label="O₂ USED (PLAN)" color={o2Cap != null && o2 > o2Cap ? '#ff5a4a' : '#e8e0c8'}
          sub={o2Cap != null ? `of ${fmtKg(o2Cap)} · ${arch.short}` : `${arch.rateKgH} kg/h · no capacity`}>
          {fmtKg(o2)}
        </Tile>
        <Tile compact={compact} label="DOSE (GCR)" sub="Curiosity RAD rate">
          {evaDoseMSv(snap.t).toFixed(3)} mSv
        </Tile>
      </div>

      {/* controls (phones: the bottom sheet has PAUSE / ABORT / CLOSE) */}
      {!compact && <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7 }}>
        <HudButton onClick={() => playback.toggle()} color="#5be37a" title="Play / pause (Space)">
          {snap.status === 'playing' ? '❚❚ PAUSE' : snap.status === 'done' ? '↻ REPLAY' : '▶ PLAY'}
        </HudButton>
        <HudButton onClick={() => playback.restart(false)} title="Back to the start of the EVA">⏮ RESTART</HudButton>
        <HudButton onClick={() => (onAbort ? onAbort() : playback.abort('manual abort'))} color="#ff8a3a" disabled={!canAbort}
          title="Abort: walk home now on the fastest path">⏏ ABORT EVA</HudButton>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: '#ffcf8a' }}>STOPS {snap.stopsDone}/{snap.stopsTotal}</span>
        {onStop && <HudButton onClick={onStop} title="Close the EVA playback">✕</HudButton>}
      </div>}

      {lastEvent && !compact && (
        <div style={{ fontSize: 10, color: lastEvent.kind === 'ponr' || lastEvent.kind === 'abort' ? '#ff9a6a' : 'rgba(232,196,168,0.7)',
          marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {fmtClock(lastEvent.t)} · {lastEvent.text}
        </div>
      )}
    </div>
  );
}
