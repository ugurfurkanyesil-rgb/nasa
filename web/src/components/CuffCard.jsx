/**
 * EVA cuff card — one printable page (A4 portrait) for the planned Marswalk, in the spirit of
 * the Apollo 15–17 wrist checklists and traverse maps: a grayscale photo map of the route with
 * numbered stations, and a station table with arrival times, stay, legs, walk-back time and the
 * latest time to leave each station. Rows come from utils/cuffCard.js (unit tested).
 *
 * Printing: the card is portalled next to the app root; a print stylesheet hides everything
 * else, so the browser's Print → Save as PDF gives exactly this page.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SITE, TERRAIN_SIZE } from '../three/terrainGenerator';
import { getTerrainCanvas } from '../utils/terrainRenderer';
import { loadOrthoImage } from '../utils/orthoImage';
import { buildCuffCard, fmtMET, compass } from '../utils/cuffCard';
import ElevationProfile from './ElevationProfile';
import { sunPosition, j2000tt, ltst } from '../utils/marsTime';
import { airTempAt, K_TO_C, climateInstrument } from '../utils/climate';
import { fmtHourMin } from '../utils/format';
import { param, getEvaProfile, EVA_PROFILES } from '../config/marswalkProfile';
import { SUITS, ROVER } from '../config/mission';

const HALF = TERRAIN_SIZE / 2;
const MAP_W_MM = 190;
const mapHeightMm = (nStops) => (nStops <= 6 ? 113 : nStops <= 8 ? 99 : 85);     // + 19 mm elevation profile   // fill the page, keep one page
const PX_PER_MM = 12;                          // ≈ 300 dpi
const INK = '#111', ROUTE = '#e4572e';

const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 0; }
  html, body { background: #fff !important; }
  body::before, body::after { display: none !important; content: none !important; }
  body > *:not(.cuff-print-root) { display: none !important; }
  .cuff-print-root { position: static !important; background: none !important; padding: 0 !important; overflow: visible !important; }
  .cuff-noprint { display: none !important; }
  .cuff-sheet { box-shadow: none !important; margin: 0 !important; transform: none !important; }
}`;

/** Crop box [x0,z0,x1,z1] around the route with the map's aspect ratio. */
function cropBox(path, MAP_H_MM) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of path) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
  let w = Math.max(300, (x1 - x0) * 1.22), h = Math.max(300 * MAP_H_MM / MAP_W_MM, (z1 - z0) * 1.22);
  const aspect = MAP_W_MM / MAP_H_MM;
  if (w / h > aspect) h = w / aspect; else w = h * aspect;
  // wider than the site? shrink to the site width as long as the route still fits with a small border
  if (w > 2 * HALF && (2 * HALF / aspect) >= (z1 - z0) * 1.06 && 2 * HALF >= (x1 - x0) * 1.06) { w = 2 * HALF; h = w / aspect; }
  // centre on the route, then slide the box back inside the site (no blank strip) where it fits
  const fit = (c, span) => (span >= 2 * HALF ? 0 : Math.min(HALF - span / 2, Math.max(-HALF + span / 2, c)));
  const cx = fit((x0 + x1) / 2, w), cz = fit((z0 + z1) / 2, h);
  return [cx - w / 2, cz - h / 2, cx + w / 2, cz + h / 2];
}

function niceStep(m) {
  for (const s of [50, 100, 200, 250, 500, 1000]) if (m <= s) return s;
  return 1000;
}

function drawMap(cv, base, isOrtho, path, card, mapHmm) {
  const W = cv.width, H = cv.height;
  const ctx = cv.getContext('2d');
  const [bx0, bz0, bx1, bz1] = cropBox(path, mapHmm);
  const sx = W / (bx1 - bx0), sz = H / (bz1 - bz0);
  const P = (x, z) => [(x - bx0) * sx, (z - bz0) * sz];
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

  // base image: same layout as the terrain (u = (x + HALF) / TERRAIN_SIZE, row 0 = north)
  if (base) {
    const bw = base.width, bh = base.height;
    const u0 = (bx0 + HALF) / TERRAIN_SIZE, v0 = (bz0 + HALF) / TERRAIN_SIZE;
    const u1 = (bx1 + HALF) / TERRAIN_SIZE, v1 = (bz1 + HALF) / TERRAIN_SIZE;
    // clip the source rectangle to the image, and place it accordingly
    const cu0 = Math.max(0, u0), cv0 = Math.max(0, v0), cu1 = Math.min(1, u1), cv1 = Math.min(1, v1);
    if (cu1 > cu0 && cv1 > cv0) {
      ctx.save();
      ctx.filter = isOrtho ? 'grayscale(1) contrast(1.15) brightness(1.08)' : 'grayscale(1)';
      ctx.drawImage(base, cu0 * bw, cv0 * bh, (cu1 - cu0) * bw, (cv1 - cv0) * bh,
        (cu0 - u0) / (u1 - u0) * W, (cv0 - v0) / (v1 - v0) * H, (cu1 - cu0) / (u1 - u0) * W, (cv1 - cv0) / (v1 - v0) * H);
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(0, 0, W, H);   // lighten for ink on top
    }
  }

  // grid every `g` m, measured from home; labels E/W and N/S of home
  const [hx, , hz] = path[0];
  const g = niceStep((bx1 - bx0) / 7);
  ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = Math.max(1, W / 1600);
  ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.font = `${Math.round(H / 48)}px "Courier New", monospace`;
  for (let k = Math.ceil((bx0 - hx) / g); hx + k * g <= bx1; k++) {
    const [x] = P(hx + k * g, 0);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    if (k && x > W / 14 && x < W - W / 9) ctx.fillText(`${k > 0 ? 'E' : 'W'}${Math.abs(k * g)}`, x + 4, H / 34);
  }
  for (let k = Math.ceil((bz0 - hz) / g); hz + k * g <= bz1; k++) {
    const [, y] = P(0, hz + k * g);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    if (k && y > H / 12 && y < H - H / 8) ctx.fillText(`${k > 0 ? 'S' : 'N'}${Math.abs(k * g)}`, 6, y - 5);
  }

  // route: white halo, then orange line, then direction chevrons
  const lw = W / 260;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const [col, w] of [['#fff', lw * 2.6], [ROUTE, lw]]) {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
    path.forEach((p, i) => { const [x, y] = P(p[0], p[2]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
  }
  const every = (bx1 - bx0) / 9;
  let acc = 0;
  ctx.fillStyle = INK;
  for (let i = 1; i < path.length; i++) {
    const [ax, , az] = path[i - 1], [bx, , bz] = path[i];
    acc += Math.hypot(bx - ax, bz - az);
    if (acc < every) continue;
    acc = 0;
    const [x, y] = P(bx, bz), a = Math.atan2((bz - az) * sz, (bx - ax) * sx), s = lw * 2.4;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(-s, s * 0.8); ctx.lineTo(-s * 0.4, 0); ctx.lineTo(-s, -s * 0.8); ctx.closePath();
    ctx.fill(); ctx.restore();
  }

  // home
  const [Hx, Hy] = P(hx, hz), hs = W / 70;
  ctx.fillStyle = INK; ctx.fillRect(Hx - hs, Hy - hs, hs * 2, hs * 2);
  ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(hs * 1.3)}px "Courier New", monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('H', Hx, Hy + 1);

  // stations: a marker that would cover H or another marker is moved out along the route's
  // outward direction and tied to its spot with a leader line
  const r = W / 75;
  const placed = [[Hx, Hy, hs * 1.5]];
  for (const row of card.rows) {
    const [px, py] = P(row.x, row.z);
    let x = px, y = py;
    for (let k = 0; k < 24 && placed.some(([qx, qy, qr]) => Math.hypot(x - qx, y - qy) < qr + r * 1.15); k++) {
      const a = (k * 137.5 * Math.PI) / 180, d = r * (2.3 + 0.25 * k);
      x = px + d * Math.cos(a); y = py + d * Math.sin(a);
    }
    placed.push([x, y, r]);
    if (x !== px || y !== py) {
      ctx.strokeStyle = INK; ctx.lineWidth = lw * 0.6;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(px, py, lw * 0.9, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = lw * 0.9; ctx.strokeStyle = INK; ctx.stroke();
    ctx.fillStyle = INK; ctx.font = `bold ${Math.round(r * 1.25)}px "Courier New", monospace`;
    ctx.fillText(String(row.n), x, y + 1);
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

  // north arrow
  const nx = W - W / 22, ny = H / 9, na = H / 14;
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(nx, ny, na * 0.95, 0, 2 * Math.PI); ctx.fill();
  ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(nx, ny - na * 0.7); ctx.lineTo(nx + na * 0.3, ny + na * 0.45);
  ctx.lineTo(nx, ny + na * 0.2); ctx.lineTo(nx - na * 0.3, ny + na * 0.45); ctx.closePath(); ctx.fill();
  ctx.font = `bold ${Math.round(na * 0.5)}px "Courier New", monospace`; ctx.textAlign = 'center';
  ctx.fillText('N', nx, ny - na * 0.75 - 2); ctx.textAlign = 'left';

  // scale bar
  const sbM = niceStep((bx1 - bx0) / 5), sbPx = sbM * sx, x0 = W / 40, y0 = H - H / 14;
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x0 - 10, y0 - H / 22, sbPx + 140, H / 22 + 16);
  ctx.fillStyle = INK; ctx.fillRect(x0, y0, sbPx / 2, 8); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, sbPx, 8);
  ctx.font = `${Math.round(H / 40)}px "Courier New", monospace`;
  ctx.fillText(`0`, x0 - 4, y0 - 6); ctx.fillText(`${sbM} m`, x0 + sbPx - 20, y0 - 6);
  return { gridM: g };
}

const cell = { padding: '1.1mm 1.3mm', borderBottom: '0.2mm solid #999', verticalAlign: 'top' };
const head = { ...cell, borderBottom: '0.4mm solid #111', fontWeight: 'bold', textAlign: 'left', whiteSpace: 'nowrap' };
const num = { ...cell, textAlign: 'right', whiteSpace: 'nowrap' };

export default function CuffCard({ mode, route, startMs, mission, onClose, evaluation = null }) {
  const mapRef = useRef(null);
  const [grid, setGrid] = useState(null);
  const mapH = mapHeightMm(route.stats?.stops?.length || 0);
  const c = SITE.meta?.center;
  const card = useMemo(() => buildCuffCard(route.path, route.stats, c && {
    startMs,
    sunAt: (ms) => sunPosition(ms, c.lat_deg, c.lon_deg_east),
    airAt: SITE.climate ? (ms) => airTempAt(SITE.climate, ms, c.lon_deg_east) : null,
    ltstAt: (ms) => ltst(j2000tt(ms), c.lon_deg_east),
  }), [route, startMs, c]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    const cv = mapRef.current;
    cv.width = MAP_W_MM * PX_PER_MM; cv.height = mapH * PX_PER_MM;
    const draw = (img, ortho) => { if (alive) setGrid(drawMap(cv, img, ortho, route.path, card, mapH).gridM); };
    draw(null, false);
    (SITE.ortho ? loadOrthoImage() : Promise.resolve(null)).then(img => draw(img || getTerrainCanvas(2048), !!img));
    return () => { alive = false; };
  }, [route, card, mapH]);

  const t = card.totals;
  const suit = SUITS[mission?.suit] || SUITS.mars;
  const startLtst = c ? ltst(j2000tt(startMs), c.lon_deg_east) : null;
  const sunsetLtst = c && t.sunsetMs ? ltst(j2000tt(t.sunsetMs), c.lon_deg_east) : null;
  const tight = card.rows.find(r => r.n === t.tightestStop);
  const fmtT = (k) => (k == null ? '—' : `${K_TO_C(k).toFixed(0)}°`);
  const dateUtc = new Date(startMs).toISOString().slice(0, 16).replace('T', ' ');

  return createPortal(
    <div className="cuff-print-root" style={{ position: 'fixed', inset: 0, zIndex: 10001, background: 'rgba(0,0,0,0.78)', overflow: 'auto', padding: '16px 0' }}>
      <style>{PRINT_CSS}</style>
      <div className="cuff-noprint" style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 10, fontFamily: 'monospace' }}>
        <button onClick={() => window.print()} style={btn('#f4a261', '#1c0f0b')}>PRINT / SAVE AS PDF</button>
        <button onClick={onClose} style={btn('transparent', '#ddd', '#777')}>CLOSE</button>
      </div>
      <div className="cuff-sheet" style={{
        width: '210mm', height: '297mm', margin: '0 auto', background: '#fff', color: INK, boxSizing: 'border-box',
        padding: '9mm 10mm', fontFamily: '"Courier New", Courier, monospace', fontSize: '2.75mm', lineHeight: 1.3,
        boxShadow: '0 4px 30px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', gap: '2.2mm',
      }}>
        {/* header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '0.6mm solid #111', paddingBottom: '1.5mm' }}>
          <div>
            <div style={{ fontSize: '5mm', fontWeight: 'bold', letterSpacing: '0.4mm' }}>EVA CUFF CARD</div>
            <div>{(SITE.meta?.label || SITE.name).toUpperCase()} · {SITE.pov?.rover || 'Perseverance'} site</div>
            <div>CREW EV1 + EV2 · {suit.label} · {mode} route{mission?.rover ? ' · pressurized rover as safe haven' : ''}</div>
            <div>EVA LIMITS: {EVA_PROFILES[getEvaProfile()].label} — walk {param('levelWalkSpeedKmh')} km/h · budget {param('evaDurationH')} h · ≤{param('maxRadialDistanceKm')} km</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ display: 'inline-block', border: '0.6mm solid #111', padding: '0.8mm 2.5mm', fontSize: '4.5mm', fontWeight: 'bold',
              background: t.go ? '#fff' : '#111', color: t.go ? '#111' : '#fff' }}>{evaluation?.status || (t.go ? 'GO' : 'NO-GO')}</div>
            {evaluation && evaluation.status !== 'GO' && (
              <div style={{ marginTop: '0.8mm', maxWidth: '62mm', fontSize: '2.4mm' }}>
                {[...evaluation.hard.filter(h => h.state !== 'pass').map(h => `${h.state === 'fail' ? 'FAIL' : 'NOT CHECKED'}: ${h.label}`),
                  ...evaluation.warnings.map(w => `CLEAR FIRST: ${w.label}`)].join(' · ')}
              </div>
            )}
            <div style={{ marginTop: '1mm' }}>START {dateUtc} UTC</div>
            <div>{startLtst != null ? `${fmtHourMin(startLtst)} LTST` : ''}{sunsetLtst != null ? ` · SUNSET ${fmtHourMin(sunsetLtst)}` : ''}</div>
          </div>
        </div>

        {/* map */}
        <div style={{ position: 'relative', border: '0.4mm solid #111' }}>
          <canvas ref={mapRef} style={{ width: `${MAP_W_MM - 0.8}mm`, height: `${mapH}mm`, display: 'block' }} />
        </div>
        <div style={{ fontSize: '2.3mm', color: '#444', marginTop: '-1.2mm' }}>
          H = habitat (start/finish) · 1–{card.rows.length} stations (a dot and a line when a number is moved off its spot) · orange = planned route, chevrons show direction · grid {grid ?? '—'} m from H ·
          base: {SITE.ortho ? `HiRISE orthomosaic (${SITE.ortho.source?.creators?.split(',')[0] || 'USGS'})` : 'shaded relief'}
        </div>

        {/* elevation profile */}
        <div style={{ border: '0.4mm solid #111', padding: '0.6mm 1mm 0', marginTop: '-0.8mm' }}>
          <ElevationProfile path={route.path} stats={route.stats} originM={SITE.heightOrigin || 0} print width={640} height={62} />
        </div>

        {/* station table */}
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '2.6mm' }}>
          <thead><tr>
            <th style={head}>#</th><th style={head}>STATION / TASK</th>
            <th style={{ ...head, textAlign: 'right' }}>ARR</th><th style={{ ...head, textAlign: 'right' }}>STAY</th>
            <th style={{ ...head, textAlign: 'right' }}>LEG</th><th style={{ ...head, textAlign: 'right' }}>LTST</th>
            <th style={{ ...head, textAlign: 'right' }}>AIR</th><th style={{ ...head, textAlign: 'right' }}>BACK</th>
            <th style={{ ...head, textAlign: 'right' }}>LEAVE BY</th><th style={{ ...head, textAlign: 'right' }}>MARGIN</th>
          </tr></thead>
          <tbody>
            <tr>
              <td style={cell}>H</td><td style={cell}>Depart habitat — suit check, comms check, tools stowed</td>
              <td style={num}>0+00</td><td style={num}></td><td style={num}></td>
              <td style={num}>{startLtst != null ? fmtHourMin(startLtst) : ''}</td>
              <td style={num}>{c && SITE.climate ? fmtT(airTempAt(SITE.climate, startMs, c.lon_deg_east)?.median) : ''}</td>
              <td style={num}>0+00</td><td style={num}></td><td style={num}></td>
            </tr>
            {card.rows.map(r => (
              <tr key={r.n} style={{ background: r.n === t.tightestStop ? '#f1f1f1' : undefined }}>
                <td style={{ ...cell, fontWeight: 'bold' }}>{r.n}</td>
                <td style={cell}>{r.label}</td>
                <td style={{ ...num, fontWeight: 'bold' }}>{fmtMET(r.arriveS)}</td>
                <td style={num}>{fmtMET(r.stayS)}</td>
                <td style={num}>{Math.round(r.legM)} m {compass(r.bearingDeg)}</td>
                <td style={num}>{r.ltstH != null ? fmtHourMin(r.ltstH) : ''}</td>
                <td style={num}>{fmtT(r.airK)}</td>
                <td style={num}>{fmtMET(r.backS)}</td>
                <td style={{ ...num, fontWeight: 'bold' }}>{fmtMET(r.leaveByS)}</td>
                <td style={num}>{fmtMET(r.marginS)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...cell, fontWeight: 'bold' }}>H</td><td style={cell}>Arrive habitat — {fmtMET(card.home.reserveS)} left of the {param('evaDurationH')} h budget</td>
              <td style={{ ...num, fontWeight: 'bold' }}>{fmtMET(card.home.arriveS)}</td><td style={num}></td>
              <td style={num}>{Math.round(card.home.legM)} m {compass(card.home.bearingDeg)}</td>
              <td style={num}>{card.home.ltstH != null ? fmtHourMin(card.home.ltstH) : ''}</td>
              <td style={num}>{fmtT(card.home.airK)}</td><td style={num}></td><td style={num}></td><td style={num}></td>
            </tr>
          </tbody>
        </table>

        {/* rules + summary */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: '4mm', fontSize: '2.55mm' }}>
          <div>
            <div style={{ fontWeight: 'bold', borderBottom: '0.4mm solid #111', marginBottom: '1mm' }}>TURN-BACK RULES</div>
            <div>1. LEAVE each station by its LEAVE BY time. Late → skip the next station, walk home.</div>
            <div>2. ABORT: walk the fastest way home. From any station that takes its BACK time, always less than the time left.</div>
            <div>3. Tightest margin at station {t.tightestStop ?? '—'}{tight ? ` (${fmtMET(tight.marginS)})` : ''} — do not extend the stay there.</div>
            <div>4. Never on ground over {param('maxWalkableSlopeDeg')}°, never more than {param('maxRadialDistanceKm')} km from H{mission?.rover ? `, never more than ${ROVER.walkbackMin.value} min walk from the rover` : ''}.</div>
            <div>5. {t.homeBySunset === null ? 'No sunset on this sol.' : t.homeBySunset ? 'Home before sunset as planned — a late start eats the daylight too: be home by SUNSET.' : 'NOT home before sunset — this plan is NO-GO. Start earlier.'}</div>
          </div>
          <div>
            <div style={{ fontWeight: 'bold', borderBottom: '0.4mm solid #111', marginBottom: '1mm' }}>EVA SUMMARY</div>
            <div>Walk {(t.distanceM / 1000).toFixed(2)} km · climb {Math.round(t.climbM ?? 0)} m · descent {Math.round(t.descentM ?? 0)} m</div>
            <div>EVA {fmtMET(t.roundTripS)} of {fmtMET(t.budgetS)} · at stations {fmtMET(t.stayS)}</div>
            <div>Min walk-back margin {fmtMET(t.minMarginS)} · {t.ponr ? 'POINT OF NO RETURN ON ROUTE' : 'home reachable from every point'}</div>
            <div>Farthest from H {((t.maxRadialM ?? 0) / 1000).toFixed(2)} km · GCR dose ≈ {t.doseMSv != null ? t.doseMSv.toFixed(2) : '—'} mSv</div>
            {t.air && <div>Air {fmtT(t.air.minMedian)}…{fmtT(t.air.maxMedian)} C (extremes {fmtT(t.air.minP10)}…{fmtT(t.air.maxP90)}) · {climateInstrument(SITE.climate)}</div>}
          </div>
        </div>

        <div style={{ marginTop: 'auto', borderTop: '0.3mm solid #999', paddingTop: '1mm', fontSize: '2.15mm', color: '#444', lineHeight: 1.35 }}>
          ARR / STAY / BACK / LEAVE BY / MARGIN: mission elapsed time h+mm, as on the Apollo 15–17 cuff checklists. BACK = fastest walk home from the station
          (walking model on the 4 m terrain); LEAVE BY = {param('evaDurationH')} h budget − BACK; MARGIN = LEAVE BY − planned departure. LTST = local true solar time;
          AIR = {SITE.climate ? `${climateInstrument(SITE.climate)} median for the season and hour` : 'no climatology'}. Planning aid, not flight-certified.
          Martian Map · NASA Space Apps Challenge 2026 · Team PERIAPSIS
        </div>
      </div>
    </div>,
    document.body,
  );
}

function btn(bg, fg, border) {
  return { background: bg, color: fg, border: `1px solid ${border || bg}`, padding: '6px 14px', borderRadius: 3,
    fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.1em', cursor: 'pointer', fontWeight: 'bold' };
}
