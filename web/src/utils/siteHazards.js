/**
 * The loaded site's hazard map (utils/hazardMap.js), built once per setting and cached.
 * Inputs come from the site: DTM heights + slope (terrainGenerator), the 1 m rock-relief layer,
 * the rover's own positions (track + ground-view stations), and — when the pressurized rover is
 * used — the planner's walking-time map to it. App sets the mission context every render.
 */
import { GRID_RES, IS_DEM, SITE, buildHeightMap, buildSlopeMap } from '../three/terrainGenerator.js';
import { buildHazardFlags, hazardSummary, routeHazards } from './hazardMap.js';
import { param } from '../config/marswalkProfile.js';
import { ROVER } from '../config/mission.js';
import { peekHomeMaps, worldToGrid } from './pathfinder.js';

let _ctx = { bufferM: 0, rover: false };
let _cache = null;

/** Mission settings the hazard map depends on (obstacle buffer, rover safe haven). */
export function setHazardContext(c) {
  _ctx = { bufferM: c?.bufferM || 0, rover: !!c?.rover };
}

function groundPoints() {
  const pts = [];
  for (const seg of SITE.track?.segments || []) for (const p of seg) pts.push({ x: p[0], z: p[1] });
  for (const st of SITE.pov?.stations || []) pts.push({ x: st.x, z: st.z });
  return pts;
}

/** { flags, depth, missing, summary } or null outside DEM mode. */
export function getSiteHazards() {
  if (!IS_DEM) return null;
  const hm = peekHomeMaps();
  const roverKey = _ctx.rover && hm ? `${hm.homeIdx}|${hm.profile}|${hm.bufferM ?? 0}` : 'none';
  const key = `${_ctx.bufferM}|${roverKey}|${param('maxWalkableSlopeDeg')}|${param('maxRockReliefM')}`;
  if (_cache?.key === key) return _cache.value;
  const h = buildHeightMap();
  const r = buildHazardFlags({
    n: GRID_RES, cellM: SITE.cellM, slope: buildSlopeMap(h), slopeLimitDeg: param('maxWalkableSlopeDeg'),
    rock: SITE.layers?.rock?.values || null, rockLimitM: param('maxRockReliefM'), heights: h,
    groundPoints: groundPoints(), bufferM: _ctx.bufferM,
    roverToHome: _ctx.rover && hm ? hm.toHome : null, roverLimitS: ROVER.walkbackMin.value * 60,
  });
  const value = { ...r, summary: hazardSummary(r.flags) };
  _cache = { key, value };
  return value;
}

const cellIndexAt = (x, z) => { const { col, row } = worldToGrid(x, z); return row * GRID_RES + col; };

/** Hazards along a route path ([[x,y,z],…]) — see hazardMap.routeHazards. */
export function routeHazardsFor(path) {
  const hz = getSiteHazards();
  return hz ? routeHazards(path, hz.flags, cellIndexAt) : [];
}
