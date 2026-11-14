/**
 * Heatmap Generator
 * Generates 2D canvas heatmaps for different terrain parameters.
 */

import { GRID_RES, TERRAIN_SIZE, buildHeightMap, buildSlopeMap, buildCraterMask, CRATERS, SITE } from '../three/terrainGenerator.js';
import { buildIlluminationMap, hazardScore, getWallMap, peekHomeMaps } from './pathfinder.js';
import { param } from '../config/marswalkProfile.js';
import { getSiteHazards } from './siteHazards.js';
import { HAZARD_LEGEND, HAZ } from './hazardMap.js';

/** Hazard map layer name (DEM): slope / rock walls, rock buffer, depressions, steep / rough, ground truth. */
export const HAZARD_LAYER = 'Hazard Map';

// Thermal color scale: blue→cyan→green→yellow→red
function thermalColor(t) {
  t = Math.max(0, Math.min(1, t));
  let r, g, b;
  if (t < 0.25) {
    r = 0; g = t * 4 * 255; b = 255;
  } else if (t < 0.5) {
    r = 0; g = 255; b = (1 - (t - 0.25) * 4) * 255;
  } else if (t < 0.75) {
    r = (t - 0.5) * 4 * 255; g = 255; b = 0;
  } else {
    r = 255; g = (1 - (t - 0.75) * 4) * 255; b = 0;
  }
  return [Math.round(r), Math.round(g), Math.round(b)];
}

// Grayscale
function grayColor(t) {
  const v = Math.round(t * 255);
  return [v, v, v];
}

// Cold to warm (blue → white → red)
function divergingColor(t) {
  if (t < 0.5) {
    const s = t * 2;
    return [Math.round(s * 255), Math.round(s * 255), 255];
  } else {
    const s = (t - 0.5) * 2;
    return [255, Math.round((1 - s) * 255), Math.round((1 - s) * 255)];
  }
}

// Categorical geology palette (Stage 6). Code 0 = unmapped / no surface unit.
const GEO_PALETTE = [[60, 55, 50], [214, 120, 64], [86, 140, 214], [120, 200, 110], [230, 200, 80],
  [190, 110, 200], [90, 200, 200], [240, 140, 160], [160, 160, 90]];
const GEO_LAYER = { 'Geology: Bedrock': 'bedrock', 'Geology: Surface': 'surface' };
// Only offer a geology layer that has at least one mapped unit on this site.
export const GEOLOGY_LAYERS = Object.keys(GEO_LAYER)
  .filter(k => (SITE.geology?.[GEO_LAYER[k] + 'Units'] || []).some(Boolean));

/** Legend for a categorical geology layer: [{ name, color, pct }] (null if not geology). */
export function geologyLegend(type) {
  const layer = GEO_LAYER[type], g = SITE.geology;
  if (!layer || !g) return null;
  const grid = g[layer], units = layer === 'bedrock' ? g.bedrockUnits : g.surfaceUnits;
  const cnt = new Array(units.length).fill(0);
  for (const v of grid) cnt[v]++;
  return units.map((u, k) => ({ name: u || (layer === 'surface' ? 'no surface unit' : 'unmapped'),
    color: `rgb(${GEO_PALETTE[k % GEO_PALETTE.length].join(',')})`, pct: 100 * cnt[k] / grid.length }))
    .filter(e => e.pct > 0);
}

// Extra data layers (layers.json): heatmap name → site.layers key
const DATA_LAYER = {
  'Thermal Inertia (THEMIS)': 'thermal',
  'Minerals (CRISM)': 'minerals',
  'Rock Relief (HiRISE)': 'rock',
};
/** Data-layer heatmaps available for this site (only those whose data loaded). */
export function dataLayerOptions() {
  const L = SITE.layers;
  const opts = L ? Object.keys(DATA_LAYER).filter(k => L[DATA_LAYER[k]]) : [];
  return SITE.mode === 'dem' ? [HAZARD_LAYER, ...opts] : opts;
}
// Fixed display ranges so the colours mean the same thing on every site.
const DATA_RANGE = { thermal: [150, 450], rock: [0, 0.6] };

/**
 * Legend for a data layer:
 *   categorical → { kind: 'classes', entries: [{ name, color, pct }], source }
 *   continuous  → { kind: 'range', lo, hi, unit, source, note }
 * null if `type` is not a data layer.
 */
export function dataLayerLegend(type) {
  if (type === HAZARD_LAYER) {
    const hz = getSiteHazards();
    if (!hz) return null;
    const entries = HAZARD_LEGEND.map(e => ({ name: e.label, color: `rgb(${e.color.join(',')})`, pct: 100 * (hz.summary[e.flag] || 0) }))
      .filter(e => e.pct > 0);
    return { kind: 'classes', entries, source: 'Derived: DTM slope, 1 m rock relief, rover positions (this project)',
      note: 'Each cell shows its most severe flag. A 1 m DTM resolves rocks of a few metres only: smaller rocks, loose sand and soft ground are NOT detected — no colour is not proof of safe ground.'
        + (hz.missing.length ? ` Missing: ${hz.missing.join('; ')}.` : '') };
  }
  const key = DATA_LAYER[type], L = SITE.layers?.[key];
  if (!L) return null;
  const src = L.source ? `${L.source.creators?.split(',')[0] ?? ''} ${L.source.year ?? ''} · ${L.source.mission ?? ''} · ${L.source.license ?? ''}`.trim() : '';
  if (key === 'minerals') {
    const cnt = new Array(L.classes.length).fill(0);
    for (const v of L.code) cnt[v]++;
    const entries = L.classes.map((name, k) => ({ name: k === 0 ? 'no detection' : name,
      color: `rgb(${L.colors[k].join(',')})`, pct: 100 * cnt[k] / L.code.length })).filter(e => e.pct > 0);
    return { kind: 'classes', entries, source: src, note: 'Darker shade = medium confidence' };
  }
  const [lo, hi] = DATA_RANGE[key];
  return { kind: 'range', lo, hi, unit: L.unit, source: src, note: L.note };
}

let _heightMap = null;
let _slopeMap = null;
let _craterMask = null;

function ensureMaps() {
  if (!_heightMap) {
    _heightMap = buildHeightMap();
    _slopeMap = buildSlopeMap(_heightMap);
    _craterMask = buildCraterMask();
  }
}

export function getHeightMap() { ensureMaps(); return _heightMap; }
export function getSlopeMap() { ensureMaps(); return _slopeMap; }
export function getCraterMask() { ensureMaps(); return _craterMask; }

/** Draw a heatmap to a canvas element (also exported as generateHeatmapCanvas for compatibility) */
export function generateHeatmapCanvas(canvas, type, sunAngle, experienceMap, sunElevation) {
  return drawHeatmap(canvas, type, experienceMap, sunAngle, sunElevation);
}

// sunElevation (optional, DEM): real Mars24 sun elevation → lambert + cast shadows
export function drawHeatmap(canvas, type, experienceMap, sunAngle = 45, sunElevation) {
  ensureMaps();
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const imgData = ctx.createImageData(W, H);
  const px = imgData.data;

  // Build the parameter map
  let paramMap;
  let maxVal = 1;

  if (type === HAZARD_LAYER) {
    const hz = getSiteHazards();
    for (let py = 0; py < H; py++) for (let px2 = 0; px2 < W; px2++) {
      const k = Math.floor((py / H) * GRID_RES) * GRID_RES + Math.floor((px2 / W) * GRID_RES);
      const f = hz ? hz.flags[k] : 0;
      const e = HAZARD_LEGEND.find(x => f & x.flag);    // most severe first
      const i = (py * W + px2) * 4;
      const c = e ? e.color : [30, 60, 30];
      // "orbital data only" is context, not danger: drawn faint so real hazards stay readable
      const a = !e ? 50 : e.flag === HAZ.NO_GROUND_TRUTH ? 70 : 225;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = a;
    }
    ctx.putImageData(imgData, 0, 0);
    return;
  }

  const dataKey = DATA_LAYER[type];
  if (dataKey) {
    const L = SITE.layers?.[dataKey];
    for (let py = 0; py < H; py++) for (let px2 = 0; px2 < W; px2++) {
      const k = Math.floor((py / H) * GRID_RES) * GRID_RES + Math.floor((px2 / W) * GRID_RES);
      const i = (py * W + px2) * 4;
      let c = [40, 40, 40], a = 120;
      if (L && dataKey === 'minerals') {
        const code = L.code[k];
        if (code) {
          c = L.colors[code];
          if (L.confidence[k] === 1) c = c.map(v => Math.round(v * 0.6)); // medium confidence = darker, as in the source key
          a = 225;
        }
      } else if (L) {
        const v = L.values[k];
        if (Number.isFinite(v)) {
          const [lo, hi] = DATA_RANGE[dataKey];
          c = thermalColor((v - lo) / (hi - lo));
          a = 210;
        }
      }
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = a;
    }
    ctx.putImageData(imgData, 0, 0);
    return;
  }

  const geoLayer = GEO_LAYER[type];
  if (geoLayer) {
    const grid = SITE.geology?.[geoLayer];
    for (let py = 0; py < H; py++) for (let px2 = 0; px2 < W; px2++) {
      const row = Math.floor((py / H) * GRID_RES), col = Math.floor((px2 / W) * GRID_RES);
      const c = GEO_PALETTE[(grid ? grid[row * GRID_RES + col] : 0) % GEO_PALETTE.length];
      const i = (py * W + px2) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 220;
    }
    ctx.putImageData(imgData, 0, 0);
    return;
  }

  switch (type) {
    case 'Slope': {
      paramMap = _slopeMap;
      maxVal = 0.8;
      break;
    }
    case 'Slope Angle': {
      // Convert slope to degrees
      paramMap = new Float32Array(_slopeMap.length);
      for (let i = 0; i < _slopeMap.length; i++) {
        paramMap[i] = Math.atan(_slopeMap[i]) * (180 / Math.PI);
      }
      maxVal = 35;
      break;
    }
    case 'Roughness': {
      // Local height variance
      paramMap = new Float32Array(GRID_RES * GRID_RES);
      for (let row = 1; row < GRID_RES - 1; row++) {
        for (let col = 1; col < GRID_RES - 1; col++) {
          const c = _heightMap[row * GRID_RES + col];
          let sum = 0;
          for (let dr = -1; dr <= 1; dr++)
            for (let dc = -1; dc <= 1; dc++)
              sum += Math.abs(_heightMap[(row+dr)*GRID_RES+(col+dc)] - c);
          paramMap[row * GRID_RES + col] = sum / 8;
        }
      }
      maxVal = 1.5;
      break;
    }
    case 'Slip Risk': {
      paramMap = new Float32Array(GRID_RES * GRID_RES);
      for (let i = 0; i < GRID_RES * GRID_RES; i++) {
        paramMap[i] = Math.min(1, _slopeMap[i] * 1.5 + _craterMask[i] * 0.3);
      }
      maxVal = 1;
      break;
    }
    case 'Illumination': {
      // Same sun-direction model used for route illumination costing (pathfinder.js),
      // so this view reflects the actual sun angle set via the sun dial.
      paramMap = buildIlluminationMap(sunAngle, _heightMap, sunElevation);
      maxVal = 1;
      break;
    }
    case 'Hazard Score': {
      // Uses the same hazardScore() as getHazardAtPoint / route stats, so this
      // heatmap matches what actually gates waypoint placement and routing.
      paramMap = new Float32Array(GRID_RES * GRID_RES);
      for (let i = 0; i < GRID_RES * GRID_RES; i++) {
        paramMap[i] = hazardScore(_craterMask[i], _slopeMap[i]);
      }
      maxVal = 1;
      break;
    }
    case 'Traversability': {
      paramMap = new Float32Array(GRID_RES * GRID_RES);
      for (let i = 0; i < GRID_RES * GRID_RES; i++) {
        paramMap[i] = 1 - hazardScore(_craterMask[i], _slopeMap[i]);
      }
      maxVal = 1;
      break;
    }
    case 'Elevation': {
      // Height normalised to the site's own min–max (DEM range can be 100s of m)
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < _heightMap.length; i++) {
        if (_heightMap[i] < lo) lo = _heightMap[i];
        if (_heightMap[i] > hi) hi = _heightMap[i];
      }
      const span = Math.max(1e-6, hi - lo);
      paramMap = new Float32Array(_heightMap.length);
      for (let i = 0; i < _heightMap.length; i++) paramMap[i] = (_heightMap[i] - lo) / span;
      maxVal = 1;
      break;
    }
    case 'No-Go': {
      // Exactly the impassable cells A* refuses to enter
      const wall = getWallMap();
      paramMap = new Float32Array(wall.length);
      for (let i = 0; i < wall.length; i++) paramMap[i] = wall[i];
      maxVal = 1;
      break;
    }
    case 'EVA Range': {
      // (home→cell + cell→home) / EVA budget. < 1 → out-and-back feasible.
      // Needs a home: computed when a route is planned (first waypoint).
      const hmaps = peekHomeMaps();
      paramMap = new Float32Array(GRID_RES * GRID_RES).fill(1);
      if (hmaps) {
        const budget = param('evaDurationH') * 3600;
        for (let i = 0; i < paramMap.length; i++) {
          const t = (hmaps.fromHome[i] + hmaps.toHome[i]) / budget;
          paramMap[i] = Number.isFinite(t) ? Math.min(1, t) : 1;
        }
      }
      maxVal = 1;
      break;
    }
    case 'Experience': {
      paramMap = experienceMap || new Float32Array(GRID_RES * GRID_RES);
      maxVal = 0.5;
      break;
    }
    default:
      paramMap = _heightMap;
      maxVal = 6;
  }

  // Sample down to canvas size
  for (let py = 0; py < H; py++) {
    for (let px2 = 0; px2 < W; px2++) {
      const row = Math.floor((py / H) * GRID_RES);
      const col = Math.floor((px2 / W) * GRID_RES);
      const val = paramMap[row * GRID_RES + col];
      const t = Math.max(0, Math.min(1, val / maxVal));

      let [r, g, b] = type === 'Illumination' ? grayColor(t)
        : type === 'Traversability' ? divergingColor(t)
        : thermalColor(t);

      const i = (py * W + px2) * 4;
      px[i]   = r;
      px[i+1] = g;
      px[i+2] = b;
      px[i+3] = 200;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}
