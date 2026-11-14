/**
 * Pathfinder - A* with crater walls, debris avoidance, illumination-aware costs.
 * Craters are IMPASSABLE walls — rover path can never enter them.
 * Debris objects have exclusion zones added to the cost map.
 */

import {
  TERRAIN_SIZE, GRID_RES, getTerrainHeight, CRATERS, IS_DEM, SITE,
  buildHeightMap, buildSlopeMap,
} from '../three/terrainGenerator.js';
import { sunPosition, sunriseSunset } from './marsTime.js';
import { shadowMask, isShadowedAt, heightMax } from './shadows.js';
import { evaWindowTemps } from './climate.js';
import { param, MODE_WEIGHTS, SCIENCE_PARAMS, getEvaProfile, getObstacleBufferM } from '../config/marswalkProfile.js';
import { inflate } from './hazardMap.js';
import { walkTimeS, maxSpeedMs, pathWalkStats } from './walkModel.js';
import { homeTimeMaps, walkbackProfile, descendToHome } from './walkback.js';
import { planScienceEva, tagScore, tagWeight, tagRole } from './science.js';
import { getObjective, objectiveWeights, primaryRelevance } from '../config/objectives.js';
import { chemAnomalies } from './chemistry.js';
import { evaDoseMSv, careerFraction } from './radiation.js';
import { carryCheck, ROVER } from '../config/mission.js';
import { thermalClass } from '../terrain/layers.js';

const HALF = TERRAIN_SIZE / 2;

// How far (in grid cells) to search for the nearest open cell when a route
// endpoint lands inside a wall. Procedural: must cover the largest crater's
// wall radius, or the search comes back empty, the endpoint stays a wall cell,
// and A* can never reach it (walls are never enterable) — guaranteeing a
// fallback. DEM: walls are steep-slope cells (no crater list), which form thin
// bands/patches; 48 cells (~190 m at 4 m/cell) comfortably covers them.
const CELL_SIZE = TERRAIN_SIZE / (GRID_RES - 1);
const MAX_WALL_RADIUS_CELLS = CRATERS.length
  ? Math.ceil((Math.max(...CRATERS.map(c => c.radius)) * 1.05) / CELL_SIZE) + 2
  : 48;

// Debris positions (x, z, radius) — match generateDebrisPositions() in terrainGenerator.js
// Only exists in the procedural Moon scenario.
const DEBRIS_ZONES = IS_DEM ? [] : [
  { x: -32, z:  14, r: 3.5 },
  { x:  28, z: -42, r: 2.5 },
  { x: -14, z: -30, r: 3.0 },
  { x:  44, z:  20, r: 2.0 },
  { x:  -4, z:  30, r: 3.5 },
  { x:  18, z:  48, r: 2.5 },
  { x: -46, z:  -4, r: 2.5 },
  { x:  38, z: -44, r: 3.0 },
  { x: -24, z:  46, r: 2.0 },
  { x:   8, z: -44, r: 2.5 },
];

export function worldToGrid(wx, wz) {
  const col = Math.round(((wx + HALF) / TERRAIN_SIZE) * (GRID_RES - 1));
  const row = Math.round(((wz + HALF) / TERRAIN_SIZE) * (GRID_RES - 1));
  return { col: Math.max(0, Math.min(GRID_RES - 1, col)), row: Math.max(0, Math.min(GRID_RES - 1, row)) };
}
export function gridToWorld(col, row) {
  return { wx: -HALF + (col / (GRID_RES - 1)) * TERRAIN_SIZE, wz: -HALF + (row / (GRID_RES - 1)) * TERRAIN_SIZE };
}

// ---- Binary Min-Heap ----
class MinHeap {
  constructor() { this.data = []; }
  push(item) { this.data.push(item); this._up(this.data.length - 1); }
  pop() {
    const top = this.data[0]; const last = this.data.pop();
    if (this.data.length) { this.data[0] = last; this._down(0); }
    return top;
  }
  get size() { return this.data.length; }
  _up(i) {
    while (i > 0) { const p=(i-1)>>1; if (this.data[p].f<=this.data[i].f) break; [this.data[p],this.data[i]]=[this.data[i],this.data[p]]; i=p; }
  }
  _down(i) {
    const n=this.data.length;
    while(true){ let m=i,l=2*i+1,r=2*i+2; if(l<n&&this.data[l].f<this.data[m].f)m=l; if(r<n&&this.data[r].f<this.data[m].f)m=r; if(m===i)break; [this.data[m],this.data[i]]=[this.data[i],this.data[m]]; i=m; }
  }
}

// ---- Illumination Map ----
let _illumCache = {};

// elevationDeg (optional, DEM/Mars24): real sun elevation + cast shadows.
// Without it the original fixed-elevation (ly = 0.8) model is used unchanged.
export function buildIlluminationMap(sunAngleDeg, hMap, elevationDeg) {
  const real = Number.isFinite(elevationDeg);
  const key = real ? `${sunAngleDeg.toFixed(1)}_${elevationDeg.toFixed(1)}` : Math.round(sunAngleDeg);
  if (_illumCache[key]) return _illumCache[key];

  const illum = new Float32Array(GRID_RES * GRID_RES);
  if (real && elevationDeg <= 0) { _illumCache[key] = illum; return illum; }   // night
  const sunRad = (sunAngleDeg * Math.PI) / 180;
  const elRad = real ? elevationDeg * Math.PI / 180 : 0;
  const lx = real ? Math.sin(sunRad) * Math.cos(elRad) : Math.sin(sunRad);
  const lz = real ? -Math.cos(sunRad) * Math.cos(elRad) : -Math.cos(sunRad);
  const ly = real ? Math.sin(elRad) : 0.80;
  const lLen = Math.sqrt(lx*lx + ly*ly + lz*lz);
  const nlx = lx/lLen, nly = ly/lLen, nlz = lz/lLen;
  const cellSize = TERRAIN_SIZE / (GRID_RES - 1);

  for (let row = 1; row < GRID_RES-1; row++) {
    for (let col = 1; col < GRID_RES-1; col++) {
      const dX = (hMap[row*GRID_RES+col+1] - hMap[row*GRID_RES+col-1]) / (2*cellSize);
      const dZ = (hMap[(row+1)*GRID_RES+col] - hMap[(row-1)*GRID_RES+col]) / (2*cellSize);
      const nx=-dX, ny=1.0, nz=-dZ;
      const nLen = Math.sqrt(nx*nx+ny*ny+nz*nz);
      illum[row*GRID_RES+col] = Math.max(0, (nx/nLen)*nlx + (ny/nLen)*nly + (nz/nLen)*nlz);
    }
  }
  if (real) {
    const sh = shadowMask(hMap, GRID_RES, CELL_SIZE, sunAngleDeg, elevationDeg);
    for (let i = 0; i < illum.length; i++) if (sh[i]) illum[i] = 0;
  }
  _illumCache[key] = illum;
  return illum;
}

// ---- Impassable map ----
// Procedural: craters = walls, debris = obstacles.
// DEM: cells steeper than the Marswalk slope limit (config/marswalkProfile.js).
// Built once and reused. Cells with value 1 are completely blocked.
let _wallMap = null;
let _wallBufferM = 0;
export function getWallMap() {
  // The rock keep-out buffer (Mission setup) changes the walls: rebuild when it changes
  if (_wallMap && _wallBufferM === getObstacleBufferM()) return _wallMap;
  _wallBufferM = getObstacleBufferM();
  _costCache = {};
  _wallMap = new Uint8Array(GRID_RES * GRID_RES);
  if (IS_DEM) {
    const slope = buildSlopeMap(buildHeightMap());       // rise/run
    const limit = Math.tan((param('maxWalkableSlopeDeg') * Math.PI) / 180);
    for (let i = 0; i < slope.length; i++) if (slope[i] > limit) _wallMap[i] = 1;
    // Rock outcrops / large boulders from the 1 m DTM (layers.json), when available
    const rock = SITE.layers?.rock?.values;
    if (rock && rock.length === _wallMap.length) {
      const lim = param('maxRockReliefM');
      const rockWall = new Uint8Array(rock.length);
      for (let i = 0; i < rock.length; i++) if (rock[i] > lim) rockWall[i] = 1;
      // Optional keep-out buffer around each rock obstacle (0 = off, the default)
      const grown = _wallBufferM > 0 ? inflate(rockWall, GRID_RES, _wallBufferM / CELL_SIZE) : rockWall;
      for (let i = 0; i < rock.length; i++) if (grown[i]) _wallMap[i] = 1;
    }
    // buildSlopeMap leaves the 1-cell border at 0; block it so routes never
    // run along the unverifiable grid edge.
    for (let k = 0; k < GRID_RES; k++) {
      _wallMap[k] = _wallMap[(GRID_RES - 1) * GRID_RES + k] = 1;
      _wallMap[k * GRID_RES] = _wallMap[k * GRID_RES + GRID_RES - 1] = 1;
    }
    return _wallMap;
  }
  for (let row = 0; row < GRID_RES; row++) {
    for (let col = 0; col < GRID_RES; col++) {
      const wx = -HALF + (col / (GRID_RES - 1)) * TERRAIN_SIZE;
      const wz = -HALF + (row / (GRID_RES - 1)) * TERRAIN_SIZE;

      // Crater interior + rim = impassable wall (full bowl + steep rim walls)
      for (const c of CRATERS) {
        const d = Math.sqrt((wx - c.x) ** 2 + (wz - c.z) ** 2);
        if (d < c.radius * 1.05) { _wallMap[row * GRID_RES + col] = 1; break; }
      }

      // Debris exclusion zones
      if (!_wallMap[row * GRID_RES + col]) {
        for (const dz of DEBRIS_ZONES) {
          const d = Math.sqrt((wx - dz.x) ** 2 + (wz - dz.z) ** 2);
          if (d < dz.r) { _wallMap[row * GRID_RES + col] = 1; break; }
        }
      }
    }
  }
  return _wallMap;
}

// ---- Cost Maps ----
let _costCache = {};

// expC follows the same ~0.7-0.75× ratio to slopeC in every mode (SAFE
// weighs learned-bad cells almost as heavily as slope, FAST barely at all),
// so adding the experience term doesn't shift the existing SAFE/ECO/FAST/AUTO
// balance — it scales with it.
// Hoisted to module scope (not just local to buildCostMap) so
// computeRouteStats/planAllRoutes can look up the same per-mode expC when
// reporting how much of a route's cost came from learned experience —
// single source of truth, no duplicated coefficients.
const COST_PARAMS = {
  SAFE: { slopeC: 900, slopeThr: 0.12, illumC: 120, expC: 700 },
  ECO:  { slopeC: 650, slopeThr: 0.18, illumC: 80,  expC: 450 },
  FAST: { slopeC: 200, slopeThr: 0.28, illumC: 20,  expC: 150 },
  AUTO: { slopeC: 550, slopeThr: 0.18, illumC: 100, expC: 400 },
};

function buildCostMap(mode, slopeMap, craterMask, illumMap, experienceMap) {
  const p = COST_PARAMS[mode] || COST_PARAMS.AUTO;
  const wall = getWallMap();
  const cost = new Float32Array(GRID_RES * GRID_RES);

  for (let i = 0; i < GRID_RES * GRID_RES; i++) {
    // Walls are completely impassable — assign near-infinite cost
    if (wall[i]) { cost[i] = 1e9; continue; }

    const slope  = slopeMap  ? slopeMap[i]  : 0;
    const crater = craterMask? craterMask[i] : 0;
    const illum  = illumMap  ? illumMap[i]   : 0.5;
    const exp    = experienceMap ? experienceMap[i] : 0;

    let c = 1.0;
    // Crater rim / near-crater still expensive
    if (crater > 0.05) c += crater * crater * 3500;
    if (slope > p.slopeThr) { const ex = (slope-p.slopeThr)/p.slopeThr; c += ex*ex*p.slopeC; }
    c += (1.0 - illum) * p.illumC;
    // Learned-experience penalty — additive term on top of the terrain-only
    // cost above, never replacing it. `exp` is the EMA'd difficulty from
    // LearningModel.recordTraversal() (learningModel.js), 0 = never
    // traversed / always easy, up to 1 = consistently rough. Squared like
    // the slope-excess term so mildly-bad cells get a small nudge and
    // consistently-bad cells are strongly steered around. Zero when no
    // experienceMap is passed (or a cell has none), so callers that don't
    // pass one see byte-identical costs to before this term existed.
    if (exp > 0) c += exp * exp * p.expC;
    cost[i] = c;
  }
  return cost;
}

// ---- A* Core ----
// Returns null if goal is a wall (no path possible).
// `edge` (DEM only): { hMap, climbPenaltyS } → step cost = walking time [s]
// of the edge (direction-dependent, walkModel.js) × costMap[nk] multiplier
// (+ climb penalty). Heuristic = straight-line distance / max model speed,
// a lower bound on every step (multipliers ≥ 1), so A* stays optimal.
// Without `edge` the original unitless cell-cost behaviour is unchanged.
function aStar(sr, sc, er, ec, costMap, edge = null) {
  const N = GRID_RES;
  const ek = er*N+ec;

  // If goal is a wall, find nearest non-wall grid cell
  const wall = getWallMap();
  let actualEr = er, actualEc = ec;
  if (wall[ek]) {
    let best = Infinity, br = er, bc = ec;
    for (let dr = -MAX_WALL_RADIUS_CELLS; dr <= MAX_WALL_RADIUS_CELLS; dr++) {
      for (let dc = -MAX_WALL_RADIUS_CELLS; dc <= MAX_WALL_RADIUS_CELLS; dc++) {
        const nr = er+dr, nc = ec+dc;
        if (nr<0||nr>=N||nc<0||nc>=N) continue;
        if (wall[nr*N+nc]) continue;
        const d = Math.sqrt(dr*dr+dc*dc);
        if (d < best) { best=d; br=nr; bc=nc; }
      }
    }
    actualEr = br; actualEc = bc;
  }

  const invVmax = edge ? CELL_SIZE / maxSpeedMs() : 1;
  const h = (r,c) => Math.sqrt((r-actualEr)**2+(c-actualEc)**2) * invVmax;
  const gScore = new Float32Array(N*N).fill(Infinity);
  const cameFrom = new Int32Array(N*N).fill(-1);
  const visited = new Uint8Array(N*N);
  const sk = sr*N+sc;
  gScore[sk] = 0;
  const open = new MinHeap();
  open.push({ f: h(sr,sc), row:sr, col:sc });
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];

  while (open.size > 0) {
    const { row, col } = open.pop();
    const k = row*N+col;
    if (visited[k]) continue;
    visited[k] = 1;
    if (row===actualEr && col===actualEc) {
      const path = [];
      let cur = k;
      while (cur !== -1) {
        const r=Math.floor(cur/N), c=cur%N;
        const { wx, wz } = gridToWorld(c, r);
        path.unshift([wx, getTerrainHeight(wx,wz)+0.18, wz]);
        cur = cameFrom[cur];
      }
      return path;
    }
    for (const [dr,dc] of DIRS) {
      const nr=row+dr, nc=col+dc;
      if (nr<0||nr>=N||nc<0||nc>=N) continue;
      const nk=nr*N+nc;
      if (visited[nk]) continue;
      if (wall[nk]) continue; // Skip walls entirely
      const diag = dr!==0&&dc!==0;
      let step;
      if (edge) {
        const dh = edge.hMap[nk] - edge.hMap[k];
        step = walkTimeS(diag ? CELL_SIZE * Math.SQRT2 : CELL_SIZE, dh) * costMap[nk];
        if (dh > 0 && edge.climbPenaltyS) step += edge.climbPenaltyS * dh;
      } else {
        step = (diag?1.414:1.0)*costMap[nk];
      }
      const tg = gScore[k] + step;
      if (tg < gScore[nk]) {
        gScore[nk]=tg; cameFrom[nk]=k;
        open.push({ f:tg+h(nr,nc), row:nr, col:nc });
      }
    }
  }
  return _fallback(sr,sc,actualEr,actualEc);
}

// Wall-safe fallback: only reached when A* exhausts its open set without
// hitting the goal (e.g. the start is boxed in by overlapping crater walls
// with no open neighbor at all). Does an unweighted BFS over non-wall cells
// so the emergency path — like the real A* path — never crosses a crater or
// debris wall. If the goal itself is unreachable from the start (disjoint
// pocket), walks to the closest reachable open cell instead of lying about
// having found a route. Ignores costMap/mode, same as before, since this is
// a last-resort escape path, not a mode-optimized one.
function _fallback(sr,sc,er,ec) {
  const N = GRID_RES;
  const wall = getWallMap();
  const sk = sr*N+sc, ek = er*N+ec;
  const cameFrom = new Int32Array(N*N).fill(-1);
  const visited = new Uint8Array(N*N);
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];

  const queue = [sk];
  visited[sk] = 1;
  let closest = sk, closestDist = Math.hypot(sr-er, sc-ec);
  for (let qi = 0; qi < queue.length; qi++) {
    const k = queue[qi];
    const r = Math.floor(k / N), c = k % N;
    const d = Math.hypot(r-er, c-ec);
    if (d < closestDist) { closestDist = d; closest = k; }
    if (k === ek) break;
    for (const [dr,dc] of DIRS) {
      const nr=r+dr, nc=c+dc;
      if (nr<0||nr>=N||nc<0||nc>=N) continue;
      const nk = nr*N+nc;
      if (visited[nk] || wall[nk]) continue;
      visited[nk] = 1;
      cameFrom[nk] = k;
      queue.push(nk);
    }
  }

  const target = visited[ek] ? ek : closest;
  const path = [];
  for (let cur = target; cur !== -1; cur = cameFrom[cur]) {
    const r = Math.floor(cur / N), c = cur % N;
    const { wx, wz } = gridToWorld(c, r);
    path.unshift([wx, getTerrainHeight(wx,wz)+0.18, wz]);
  }
  return path;
}

function smoothPath(path, passes=3) {
  if (path.length < 4) return path;
  const wall = getWallMap();
  let pts = [...path];
  for (let p=0; p<passes; p++) {
    const out = [pts[0]];
    for (let i=1; i<pts.length-1; i++) {
      const px=(pts[i-1][0]+pts[i][0]*2+pts[i+1][0])/4;
      const pz=(pts[i-1][2]+pts[i][2]*2+pts[i+1][2])/4;
      // Don't smooth into a wall
      const { col, row } = worldToGrid(px, pz);
      if (wall[row*GRID_RES+col]) { out.push(pts[i]); continue; }
      out.push([px, getTerrainHeight(px,pz)+0.18, pz]);
    }
    out.push(pts[pts.length-1]);
    pts = out;
  }
  const step = Math.max(1, Math.floor(pts.length/200));
  const result = [];
  for (let i=0; i<pts.length; i+=step) result.push(pts[i]);
  if (result[result.length-1] !== pts[pts.length-1]) result.push(pts[pts.length-1]);
  return result;
}

// ---- Route Stats ----
// costMap is the same per-mode cost grid the A* search actually used (see
// buildCostMap), so totalCost reflects the real routing cost instead of a
// separately-hardcoded approximation of it.
//
// experienceMap/expC (both optional) let this also report how much of that
// totalCost came specifically from the learned-experience term — recomputed
// per path cell with the exact same `exp*exp*expC` formula buildCostMap
// used, so expCost/expCostPercent are a real breakdown of totalCost, not a
// separate estimate. Omit either arg to skip the breakdown (expCost stays 0).
function computeRouteStats(path, slopeMap, craterMask, illumMap, costMap, experienceMap, expC) {
  if (!path || path.length < 2) return null;
  let dist=0, sumHazard=0, sumSlip=0, sumSlope=0, sumIllum=0, totalCost=0, expCost=0, n=0;
  for (let i=1; i<path.length; i++) {
    const dx=path[i][0]-path[i-1][0], dz=path[i][2]-path[i-1][2];
    dist += Math.sqrt(dx*dx+dz*dz);
    const { col, row } = worldToGrid(path[i][0], path[i][2]);
    const k = row*GRID_RES+col;
    const slope  = slopeMap?.[k]  ?? 0;
    const crater = craterMask?.[k] ?? 0;
    const illum  = illumMap?.[k]  ?? 0.5;
    const exp    = experienceMap?.[k] ?? 0;
    sumHazard += hazardScore(crater, slope);
    sumSlip   += Math.min(1, slope*1.5 + crater*0.3);
    sumSlope  += Math.atan(slope)*180/Math.PI;
    sumIllum  += illum;
    totalCost += costMap ? costMap[k] : 1;
    if (exp > 0 && expC) expCost += exp * exp * expC;
    n++;
  }
  const avg = x => n ? x/n : 0;
  return {
    distance:          dist,
    avgHazard:         avg(sumHazard),
    avgSlip:           avg(sumSlip),
    avgSlopeAngle:     avg(sumSlope),
    avgIllumination:   avg(sumIllum),
    avgTraversability: 1 - avg(sumHazard),
    totalCost:         totalCost,
    expCost:           expCost,
    expCostPercent:    totalCost > 0 ? (expCost / totalCost) * 100 : 0,
    riskPercent:       (avg(sumHazard) + avg(sumSlip)) / 2 * 100,
  };
}

// ---- Chain Pathfinding ----
function chainAStar(waypoints, costMap, edge = null, segEnds = null) {
  const fullPath = [];
  for (let i=0; i<waypoints.length-1; i++) {
    const { col:sc, row:sr } = worldToGrid(waypoints[i].x, waypoints[i].z);
    const { col:ec, row:er } = worldToGrid(waypoints[i+1].x, waypoints[i+1].z);
    const seg = aStar(sr,sc,er,ec, costMap, edge);
    if (i===0) fullPath.push(...seg);
    else fullPath.push(...seg.slice(1));
    if (segEnds) segEnds.push(fullPath.length - 1);
  }
  return fullPath;
}

// ---- Main Export ----
// experienceMap: optional Float32Array (GRID_RES×GRID_RES, same layout as
// slopeMap/craterMask) from LearningModel.getExperienceMap() — see
// buildCostMap()'s experience-penalty term. Omit/pass null to plan without it
// (existing callers keep their old behaviour unchanged).
// ---- DEM (Marswalk) planning ----
// Per-cell multiplier for a mode's slope aversion: 1 + k·(slopeDeg/limit)².
// Walls stay 1e9 (never entered anyway — aStar skips wall cells).
function buildDemMultMap(mode, slopeMap) {
  const w = MODE_WEIGHTS[mode] || MODE_WEIGHTS.AUTO;
  const wall = getWallMap();
  const limit = param('maxWalkableSlopeDeg');
  const mult = new Float32Array(GRID_RES * GRID_RES);
  for (let i = 0; i < mult.length; i++) {
    if (wall[i]) { mult[i] = 1e9; continue; }
    const deg = Math.atan(slopeMap ? slopeMap[i] : 0) * 180 / Math.PI;
    const r = deg / limit;
    mult[i] = 1 + w.slopeAversion * r * r;
  }
  return mult;
}

// ---- Home time maps (walk-back) ----
// Terrain is static, so these are cached per home cell and deliberately NOT
// cleared by clearPathCache() (which LearningModel/sun changes call often).
let _homeMaps = null;
export function getHomeMaps(homeX, homeZ, hMap) {
  const { col, row } = worldToGrid(homeX, homeZ);
  const homeIdx = row * GRID_RES + col;
  // walk-back times depend on the walking speed, i.e. on the active EVA limit profile
  // (and on the walls, i.e. on the rock keep-out buffer)
  const wall = getWallMap();
  if (_homeMaps?.homeIdx === homeIdx && _homeMaps.profile === getEvaProfile() && (_homeMaps.bufferM ?? 0) === getObstacleBufferM()) return _homeMaps;
  _homeMaps = { ...homeTimeMaps(homeIdx, hMap, wall, GRID_RES, CELL_SIZE), profile: getEvaProfile(), bufferM: getObstacleBufferM() };
  return _homeMaps;
}
/** Last computed home maps (for the EVA Range heatmap), or null. */
export function peekHomeMaps() { return _homeMaps; }
/** Install home maps computed elsewhere (planner Web Worker → main thread). */
export function setHomeMaps(maps) { _homeMaps = maps; }

const cellIndexAt = (x, z) => { const { col, row } = worldToGrid(x, z); return row * GRID_RES + col; };

/**
 * Physical route stats for a Marswalk. All times use the same walk model in
 * every mode, so modes are directly comparable. Return = FASTEST walk home
 * from the end (not necessarily the same path). GO requires: at every point
 * of the route the crew can still get home within the EVA budget (walk-back
 * margin ≥ 0), never farther than the radial limit from the start, and no
 * terrain cell on the path steeper than the walkable limit.
 */
/**
 * Lighting along the route for an EVA starting at startMs (Mars24 sun at the
 * time each point is actually walked) + whether the crew is home by sunset.
 * GO requires the EVA to start after sunrise and end before sunset (checks.daylight).
 * Design choice, not a sourced Mars rule: every Apollo surface EVA was flown in
 * sunlight, and the walk-back budget assumes the crew can see the ground.
 */
function computeLightStats(path, elapsedS, returnS, startMs, hMap) {
  const c = SITE.meta?.center;
  if (!c || !Number.isFinite(startMs)) return null;
  const hmax = heightMax(hMap);
  const half = TERRAIN_SIZE / 2;
  let shadowT = 0, darkT = 0;
  for (let i = 1; i < path.length; i++) {
    const dt = elapsedS[i] - elapsedS[i - 1];
    const t = startMs + elapsedS[i] * 1000;
    const sp = sunPosition(t, c.lat_deg, c.lon_deg_east);
    if (sp.elevationDeg <= 0) { darkT += dt; continue; }
    if (isShadowedAt(hMap, GRID_RES, CELL_SIZE, half, path[i][0], path[i][2], sp.azimuthDeg, sp.elevationDeg, hmax)) shadowT += dt;
  }
  const total = elapsedS[elapsedS.length - 1] || 1;
  const homeMs = startMs + (elapsedS[elapsedS.length - 1] + returnS) * 1000;
  const ss = sunriseSunset(startMs, c.lat_deg, c.lon_deg_east);
  const startSun = sunPosition(startMs, c.lat_deg, c.lon_deg_east);
  return {
    startMs, homeMs,
    startElevationDeg: startSun.elevationDeg,
    shadowFrac: shadowT / total,          // outbound walking time in terrain shadow
    darkFrac: darkT / total,              // outbound walking time with the sun below the horizon
    sunriseMs: ss?.riseMs ?? null,
    sunsetMs: ss?.setMs ?? null,
    startsInDaylight: startSun.elevationDeg > 0,
    homeBySunset: ss ? (startMs >= ss.riseMs && homeMs <= ss.setMs) : null,
    // Expected air temperature (MEDA ATS climatology, 1.45 m) over the whole EVA
    air: SITE.climate ? evaWindowTemps(SITE.climate, startMs, homeMs, c.lon_deg_east) : null,
  };
}

// Science-stop dwell: waypoint w (w ≥ 1) ends A* segment w−1 at raw index
// segEnds[w−1]. smoothPath keeps the point count, then keeps every `step`-th
// point (+ the last), so raw index r ↦ smoothed index round(r/step).
// Returns { map: Map(pathIdx → dwell s), list: [{ idx, dwellS, wp, label }] }.
function dwellIndexMap(path, waypoints, segEnds, rawLen) {
  const m = new Map();
  const list = [];
  const step = Math.max(1, Math.floor(rawLen / 200));
  for (let w = 1; w < waypoints.length; w++) {
    if (!(waypoints[w].dwellS > 0)) continue;
    const r = segEnds[w - 1];
    const i = r >= rawLen - 1 ? path.length - 1 : Math.min(path.length - 1, Math.round(r / step));
    m.set(i, (m.get(i) || 0) + waypoints[w].dwellS);
    list.push({ idx: i, dwellS: waypoints[w].dwellS, wp: w, label: waypoints[w].label || null });
  }
  return { map: m, list };
}

/** What the extra data layers say along a route (null fields when a layer is missing). */
export function computeLayerStats(path) {
  const L = SITE.layers;
  if (!L || !path?.length) return null;
  const ti = [], minerals = new Map();
  let rockMax = 0, rockN = 0, n = 0;
  const rockLim = param('maxRockReliefM');
  for (const p of path) {
    const { col, row } = worldToGrid(p[0], p[2]);
    const k = row * GRID_RES + col;
    n++;
    if (L.thermal) { const v = L.thermal.values[k]; if (Number.isFinite(v)) ti.push(v); }
    if (L.rock) { const v = L.rock.values[k]; if (Number.isFinite(v)) { rockMax = Math.max(rockMax, v); if (v > 0.5 * rockLim) rockN++; } }
    if (L.minerals && L.minerals.code[k]) {
      const name = L.minerals.classes[L.minerals.code[k]];
      minerals.set(name, (minerals.get(name) || 0) + 1);
    }
  }
  ti.sort((a, b) => a - b);
  const tiMedian = ti.length ? ti[ti.length >> 1] : null;
  return {
    thermal: L.thermal && ti.length ? { median: tiMedian, min: ti[0], max: ti[ti.length - 1], cls: thermalClass(L.thermal, tiMedian) } : null,
    rock: L.rock ? { maxReliefM: rockMax, roughShare: n ? rockN / n : 0, limitM: rockLim } : null,
    minerals: L.minerals ? [...minerals.entries()].map(([name, c]) => ({ name, share: c / n })).sort((a, b) => b.share - a.share) : null,
  };
}

function computeDemStats(path, slopeMap, craterMask, illumMap, costMap, homeMaps, startMs, hMap, dwell = null, mission = null) {
  const dwellAt = dwell ? dwell.map : null;
  const base = computeRouteStats(path, slopeMap, craterMask, illumMap, costMap, null, 0);
  if (!base) return null;
  const out = pathWalkStats(path, getTerrainHeight);
  // Max slope alone is dominated by unavoidable spots (e.g. a steep endpoint),
  // so also report the share of path length on "steep" ground (> 75% of the
  // walkable limit — a display threshold, not a sourced value).
  const steepDeg = 0.75 * param('maxWalkableSlopeDeg');
  let maxSlopeDeg = 0, maxRadialM = 0, steepLen = 0, totLen = 0;
  const [sx, , sz] = path[0];
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const { col, row } = worldToGrid(p[0], p[2]);
    const deg = Math.atan(slopeMap?.[row * GRID_RES + col] ?? 0) * 180 / Math.PI;
    if (deg > maxSlopeDeg) maxSlopeDeg = deg;
    const r = Math.hypot(p[0] - sx, p[2] - sz);
    if (r > maxRadialM) maxRadialM = r;
    if (i > 0) {
      const seg = Math.hypot(p[0] - path[i - 1][0], p[2] - path[i - 1][2]);
      totLen += seg;
      if (deg > steepDeg) steepLen += seg;
    }
  }
  const budgetS = param('evaDurationH') * 3600;
  const wb = walkbackProfile(path, getTerrainHeight, cellIndexAt, homeMaps.toHome, budgetS, dwellAt);
  const dwellTotalS = dwellAt ? [...dwellAt.values()].reduce((a, b) => a + b, 0) : 0;
  const backS = wb.returnFromEndS;
  const roundTripS = wb.roundTripS;
  // Farthest the crew ever is from home (= the rover, in rover mode), as walking time
  let maxReturnS = 0;
  for (const p of path) { const t = homeMaps.toHome[cellIndexAt(p[0], p[2])]; if (Number.isFinite(t) && t > maxReturnS) maxReturnS = t; }
  const carry = carryCheck(mission);
  const roverLimitS = ROVER.walkbackMin.value * 60;
  const checks = {
    budget: wb.ponrIdx < 0,                 // walk-back margin ≥ 0 everywhere
    carry: carry.ok,                        // suit + equipment weight within what a crew member can carry
    ...(mission?.rover ? { rover: maxReturnS <= roverLimitS } : {}),
    radial: maxRadialM <= param('maxRadialDistanceKm') * 1000,
    slope: maxSlopeDeg <= param('maxWalkableSlopeDeg'),
  };
  // Daylight: start after sunrise, home before sunset (needs an EVA start time; null = polar day/night → no rule)
  const light = computeLightStats(path, wb.elapsed, backS, startMs, hMap);
  if (light && light.homeBySunset !== null) checks.daylight = light.homeBySunset;
  return {
    ...base,
    distance: out.horizM,
    walkTimeS: out.timeS,
    dwellTotalS,
    stopCount: dwellAt ? dwellAt.size : 0,
    stops: dwell ? dwell.list : [],          // [{ idx, dwellS, wp, label }] — EVA playback
    elapsedS: wb.elapsed,                     // departure time at each path point (dwell incl.)
    returnTimeS: backS,
    roundTripS,
    budgetS,
    budgetFrac: roundTripS / budgetS,
    climbM: out.climbM,
    descentM: out.descentM,
    maxSlopeDeg,
    steepDeg,
    steepFrac: totLen > 0 ? steepLen / totLen : 0,
    maxRadialM,
    minMarginS: wb.minMarginS,
    minMarginIdx: wb.minMarginIdx,
    ponrIdx: wb.ponrIdx,
    ponrPoint: wb.ponrIdx >= 0 ? path[wb.ponrIdx] : null,
    marginS: wb.margin,
    light,
    layers: computeLayerStats(path),
    carry,
    rover: mission?.rover ? { maxReturnS, limitS: roverLimitS } : null,
    // Whole EVA is spent outside the habitat/rover: GCR dose for the round trip incl. stops
    radiation: { doseMSv: evaDoseMSv(roundTripS), careerFrac: careerFraction(evaDoseMSv(roundTripS)) },
    checks,
    go: Object.values(checks).every(Boolean),
  };
}

// opts.home: {x,z} the walk-back "home" (habitat). Defaults to waypoints[0];
// return-to-home planning passes the real home so the cached maps stay valid.
// opts.modes: subset of modes to plan (DEM only), e.g. ['SAFE'] for return-to-home.
// opts.startMs: EVA start (UTC ms) for the Mars24 lighting analysis (DEM only).
export function planAllRoutes(waypoints, slopeMap, craterMask, hMap, sunAngleDeg = 45, experienceMap = null, opts = {}) {
  if (!waypoints || waypoints.length < 2) throw new Error('Need at least 2 waypoints');

  if (IS_DEM) {
    // Sun angle / learned experience don't enter the DEM cost (yet) — the
    // cost is physical walking time. Cache key is mode-only.
    const home = opts.home || waypoints[0];
    const homeMaps = getHomeMaps(home.x, home.z, hMap);
    const result = {};
    for (const mode of (opts.modes || ['SAFE','ECO','FAST','AUTO'])) {
      getWallMap();   // rebuilds walls (and clears this cache) if the rock buffer changed
      const cacheKey = `DEM_${mode}`;
      if (!_costCache[cacheKey]) _costCache[cacheKey] = buildDemMultMap(mode, slopeMap);
      const w = MODE_WEIGHTS[mode] || MODE_WEIGHTS.AUTO;
      const edge = { hMap, climbPenaltyS: w.climbPenaltyS };
      const segEnds = [];
      const rawPath = chainAStar(waypoints, _costCache[cacheKey], edge, segEnds);
      const path = smoothPath(rawPath);
      const dwell = waypoints.some(w => w.dwellS > 0) ? dwellIndexMap(path, waypoints, segEnds, rawPath.length) : null;
      result[mode] = { path, stats: computeDemStats(path, slopeMap, craterMask, null, _costCache[cacheKey], homeMaps, opts.startMs, hMap, dwell, opts.mission || null) };
    }
    return result;
  }

  const illumMap = hMap ? buildIlluminationMap(sunAngleDeg, hMap) : null;

  const result = {};
  for (const mode of ['SAFE','ECO','FAST','AUTO']) {
    const cacheKey = `${mode}_${Math.round(sunAngleDeg)}`;
    if (!_costCache[cacheKey]) {
      // Not keyed on experienceMap — the cache is invalidated wholesale by
      // clearPathCache(), which LearningModel.recordTraversal() already
      // calls every 50 traversals, so cost maps get periodically rebuilt
      // with the latest learned experience without recomputing on every
      // single traversal.
      _costCache[cacheKey] = buildCostMap(mode, slopeMap, craterMask, illumMap, experienceMap);
    }
    const rawPath = chainAStar(waypoints, _costCache[cacheKey]);
    const path    = smoothPath(rawPath);
    const expC    = (COST_PARAMS[mode] || COST_PARAMS.AUTO).expC;
    const stats   = computeRouteStats(path, slopeMap, craterMask, illumMap, _costCache[cacheKey], experienceMap, expC);
    result[mode]  = { path, stats };

    // Debug visibility into the experience-map integration: how much of
    // this route's total A* cost came from previously-learned-bad cells.
    // Only logs when an experienceMap was actually passed in, so callers
    // that don't use learning stay silent. See buildCostMap()'s expC term
    // and decisions/2026-08-08-deneyim-haritasi-maliyet-entegrasyonu.md.
    if (experienceMap && stats) {
      console.log(
        `[LearningModel] ${mode}: totalCost=${stats.totalCost.toFixed(1)}, ` +
        `experience contribution=${stats.expCost.toFixed(1)} ` +
        `(${stats.expCostPercent.toFixed(1)}% of route cost)`
      );
    }
  }
  return result;
}

/** Grid cell → chemical standouts of the ChemCam targets in it (null without chemistry.json). */
function chemCellMap() {
  if (!SITE.chemistry) return null;
  const m = new Map();
  for (const a of chemAnomalies(SITE.chemistry)) {
    const i = cellIndexAt(a.target.x, a.target.z);
    if (!m.has(i)) m.set(i, []);
    m.get(i).push({ tag: a.tag, name: a.target.name, sol: a.target.sol, diff: a.diff });
  }
  return m;
}

/** Grid cell → ChemCam targets in it, each with its standout tags (objective "re-visit"). */
function chemTargetMap() {
  if (!SITE.chemistry) return null;
  const anom = new Map();
  for (const a of chemAnomalies(SITE.chemistry)) {
    if (!anom.has(a.target.name)) anom.set(a.target.name, []);
    anom.get(a.target.name).push(a.tag);
  }
  const m = new Map();
  for (const t of SITE.chemistry.targets || []) {
    const i = cellIndexAt(t.x, t.z);
    if (!m.has(i)) m.set(i, []);
    m.get(i).push({ name: t.name, sol: t.sol, anomalies: anom.get(t.name) || [] });
  }
  return m;
}

/**
 * Science EVA (Stage 6): best set + order of geology stops from `home` within the
 * EVA budget (see utils/science.js). Serializable result (worker → main thread).
 * opts: { dwellMin, budgetS } override SCIENCE_PARAMS / the EVA duration;
 *       objective: id from config/objectives.js — changes candidate ranking and scoring.
 *       No objective (or 'survey') = the original unit-diversity planner, unchanged.
 */
export function planScience(home, hMap, opts = {}) {
  const geo = SITE.geology;
  if (!IS_DEM || !geo) return null;
  const obj = opts.objective ? getObjective(opts.objective) : null;
  const objO = obj?.options || {};
  const weights = objectiveWeights(obj, SCIENCE_PARAMS.weights);
  const homeMaps = getHomeMaps(home.x, home.z, hMap);
  const dwellS = (opts.dwellMin ?? SCIENCE_PARAMS.dwellMin) * 60;
  const budgetS = opts.budgetS ?? param('evaDurationH') * 3600;
  const r = planScienceEva(geo, homeMaps, hMap, getWallMap(), {
    cellM: CELL_SIZE, budgetS, dwellS, maxRadialM: param('maxRadialDistanceKm') * 1000,
    weights, interiorR: SCIENCE_PARAMS.interiorR,
    minHomeDistM: SCIENCE_PARAMS.minHomeDistM, maxCandidates: objO.maxCandidates ?? SCIENCE_PARAMS.maxCandidates,
    minerals: SITE.layers?.minerals || null,
    chemCells: chemCellMap(),
    // An objective whose rules never score ChemCam standouts gets no "re-sample" candidates:
    // such a stop could only be chosen for its unit, under a misleading chemistry label.
    maxChemCandidates: objO.maxChemCandidates
      ?? (obj?.rules && !obj.rules.some(rr => rr[0].startsWith('X:')) ? 0 : SCIENCE_PARAMS.maxChemCandidates),
    chemTargets: objO.chemTargets ? chemTargetMap() : null,
    maxTargetCandidates: objO.maxTargetCandidates ?? 0,
    compositeTags: !!objO.compositeTags,
    relevance: obj?.rules ? (tags) => primaryRelevance(obj, tags) : null,
    maxReturnS: opts.maxReturnS ?? null,
  });
  const toWorld = (c) => { const { wx, wz } = gridToWorld(c.col, c.row); return { ...c, x: wx, z: wz }; };
  // What each stop adds, in walking order: the tags it is the FIRST stop to sample, with their points
  // and role under the objective — the "why was this stop selected" of the stop card.
  const seen = new Set();
  const stops = r.stops.map((st) => {
    const contrib = [];
    for (const t of new Set(st.tags)) {
      const w = tagWeight(t, weights);
      if (w > 0 && !seen.has(t)) { seen.add(t); contrib.push({ tag: t, points: w, role: tagRole(t, weights) }); }
    }
    return { ...toWorld(st), contrib };
  });
  const primaryHit = obj?.rules ? stops.some(st => st.contrib.some(c => c.role === 'primary')) : null;
  return {
    objective: obj ? obj.id : null,
    weights,
    candidates: r.candidates.map(toWorld),
    stops,
    order: r.tour.order,
    score: r.tour.score,
    maxScore: tagScore([...new Set(r.candidates.flatMap(c => c.tags))], weights), // all candidates
    tags: r.tour.tags,
    primaryHit,          // objective chosen: does at least one stop carry its primary evidence?
    totalS: r.tour.totalS, walkS: r.tour.walkS, dwellTotalS: r.tour.dwellTotalS,
    dwellS, budgetS,
  };
}

/**
 * Fastest walk home from (x, z) on the cached home maps — the path the walk-back
 * margin assumes (EVA abort). World polyline [[x,y,z], ...] starting at (x, z),
 * plus its walking time. null if no home maps yet or home is unreachable.
 */
export function fastestReturnPath(x, z, hMap) {
  const hm = _homeMaps;
  if (!hm) return null;
  const r = descendToHome(cellIndexAt(x, z), hm.toHome, hMap, getWallMap(), GRID_RES, CELL_SIZE);
  if (!r) return null;
  const pts = [[x, getTerrainHeight(x, z), z]];
  for (const k of r.cells) {
    const row = (k / GRID_RES) | 0, col = k - row * GRID_RES;
    const { wx, wz } = gridToWorld(col, row);
    pts.push([wx, getTerrainHeight(wx, wz), wz]);
  }
  return { path: pts, gridTimeS: r.timeS };
}

/** Fastest walking time home from (x, z) [s] (Infinity if unreachable / no maps). */
export function toHomeTimeAt(x, z) {
  const hm = _homeMaps;
  return hm ? hm.toHome[cellIndexAt(x, z)] : Infinity;
}

/** Test-only access to internals (tests/marswalk.test.mjs). Not used by the app. */
export const _internals = { aStar, buildDemMultMap, CELL_SIZE, cellIndexAt, dwellIndexMap };

export function clearPathCache() { _costCache = {}; _illumCache = {}; _wallMap = null; }

/**
 * Canonical hazard formula (0=safe, 1=very dangerous).
 * Single source of truth — used by getHazardAtPoint, computeRouteStats
 * (avgHazard/avgTraversability/riskPercent), and the heatmap 'Hazard Score' /
 * 'Traversability' layers, so all three views of "how dangerous is this cell"
 * agree with each other and with the waypoint-acceptance thresholds in App.jsx.
 */
export function hazardScore(crater, slope) {
  return Math.min(1, crater * 1.0 + Math.max(0, slope - 0.25) * 2.0);
}

/** True if the world position falls on an impassable cell (crater/debris or too steep). */
export function isWallAt(wx, wz) {
  const { col, row } = worldToGrid(wx, wz);
  return getWallMap()[row * GRID_RES + col] === 1;
}

/** Check how hazardous a world position is (0=safe, 1=very dangerous) */
export function getHazardAtPoint(wx, wz, craterMask, slopeMap) {
  const { col, row } = worldToGrid(wx, wz);
  const k = row * GRID_RES + col;
  const crater = craterMask?.[k] ?? 0;
  const slope  = slopeMap?.[k]  ?? 0;
  return hazardScore(crater, slope);
}
