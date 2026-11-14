/**
 * Hazard map — what can hurt or stop a walking crew, per 4 m cell, from the data the site has.
 *
 * Flags (bit field, a cell can carry several):
 *   SLOPE_WALL       steeper than the walkable limit (20°, NASA xEVA ConOps)          — planner wall
 *   ROCK_WALL        rock relief above the obstacle limit (0.5 m, design)              — planner wall
 *   ROCK_BUFFER      within the keep-out buffer around a ROCK_WALL cell (design)       — wall only if the
 *                    mission's obstacle buffer is set (> 0); otherwise shown, not enforced
 *   DEPRESSION       inside a closed depression ≥ 0.5 m deep (priority-flood fill)    — advisory
 *   STEEP            slope above 75 % of the limit (same display threshold as the route card)
 *   ROUGH            rock relief above 50 % of the obstacle limit (same as the route card)
 *   NO_GROUND_TRUTH  no rover position within 100 m: only orbital data describe the cell
 *   ROVER_OUT        rover safe haven in use and the cell is more than a 30-min walk from it
 *   EDGE             the 1-cell grid border (unverifiable, already a planner wall)
 *
 * Nothing here invents an obstacle: every flag is a threshold on the DTM, the 1 m rock-relief
 * layer, the rover's own positions, or the planner's walking-time map. Every threshold that is
 * not from a NASA document is a design choice and is labelled so in HAZARD_PARAMS.
 *
 * LIMITATION (shown in the UI): a 1 m DTM resolves rocks of a few metres. Rocks smaller than
 * ~1–2 m, loose sand, soft ground and small pits are NOT detected — absence of a flag is not
 * proof that a cell is safe.
 *
 * Pure module (typed arrays in, typed arrays out): tested in Node.
 */

export const HAZ = {
  SLOPE_WALL: 1, ROCK_WALL: 2, ROCK_BUFFER: 4, DEPRESSION: 8,
  STEEP: 16, ROUGH: 32, NO_GROUND_TRUTH: 64, ROVER_OUT: 128, EDGE: 256,
};

export const HAZARD_PARAMS = {
  steepFrac: { value: 0.75, status: 'design', note: 'Steep = slope above 75 % of the walkable limit — the same display threshold the route card uses.' },
  roughFrac: { value: 0.5, status: 'design', note: 'Rough = rock relief above half the obstacle limit — the same threshold the route card uses.' },
  depressionMinDepthM: { value: 0.5, status: 'design',
    note: 'Closed depressions at least this deep (fill depth of a priority-flood, Barnes et al. 2014). Same height as the rock obstacle limit; shallower ones are within DTM noise.' },
  groundTruthRadiusM: { value: 100, status: 'design', note: 'A cell with no rover position within this distance is described by orbital data only.' },
  obstacleBufferM: { options: [0, 4, 8], value: 0, status: 'design',
    note: 'Keep-out distance around rock obstacles. One 4 m cell covers the DTM-to-image alignment (≤ 1 m) and the size of a cell; 0 keeps the validated planner unchanged.' },
};

export const HAZARD_LEGEND = [
  { flag: HAZ.SLOPE_WALL, label: 'Too steep (> slope limit) — wall', color: [200, 40, 40], hard: true },
  { flag: HAZ.ROCK_WALL, label: 'Rock / boulder (relief > obstacle limit) — wall', color: [255, 90, 200], hard: true },
  { flag: HAZ.ROCK_BUFFER, label: 'Next to a rock obstacle (buffer zone)', color: [255, 170, 230], hard: false },
  { flag: HAZ.DEPRESSION, label: 'Closed depression ≥ 0.5 m', color: [70, 150, 255], hard: false },
  { flag: HAZ.STEEP, label: 'Steep ground (> 75 % of limit)', color: [255, 150, 40], hard: false },
  { flag: HAZ.ROUGH, label: 'Rough ground (relief > 50 % of limit)', color: [240, 220, 70], hard: false },
  { flag: HAZ.ROVER_OUT, label: 'Beyond 30-min walk of the rover', color: [150, 80, 220], hard: false },
  { flag: HAZ.NO_GROUND_TRUTH, label: 'No rover ground view within 100 m (orbital data only)', color: [120, 120, 120], hard: false },
];

// ---- min-heap of (value, index) on typed arrays ----
class Heap {
  constructor(cap) { this.v = new Float64Array(cap); this.i = new Int32Array(cap); this.n = 0; }
  push(v, i) {
    let k = this.n++;
    this.v[k] = v; this.i[k] = i;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.v[p] <= this.v[k]) break;
      this._swap(p, k); k = p;
    }
  }
  pop() {
    const top = this.i[0];
    this.n--;
    if (this.n > 0) {
      this.v[0] = this.v[this.n]; this.i[0] = this.i[this.n];
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < this.n && this.v[l] < this.v[m]) m = l;
        if (r < this.n && this.v[r] < this.v[m]) m = r;
        if (m === k) break;
        this._swap(m, k); k = m;
      }
    }
    return top;
  }
  _swap(a, b) {
    const tv = this.v[a]; this.v[a] = this.v[b]; this.v[b] = tv;
    const ti = this.i[a]; this.i[a] = this.i[b]; this.i[b] = ti;
  }
}

/**
 * Priority-flood depression filling (Barnes, Lehman & Mulla 2014): the lowest surface each cell
 * must be raised to so that water could drain off the grid edge. fill − h = depression depth.
 * The grid border is the outlet. 8-connected.
 */
export function fillDepressions(h, n) {
  const N = n * n;
  const filled = new Float32Array(h);
  const done = new Uint8Array(N);
  const heap = new Heap(N);
  for (let k = 0; k < n; k++) {
    for (const i of [k, (n - 1) * n + k, k * n, k * n + n - 1]) {
      if (!done[i]) { done[i] = 1; heap.push(filled[i], i); }
    }
  }
  while (heap.n > 0) {
    const i = heap.pop();
    const r = (i / n) | 0, c = i - r * n;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      const j = rr * n + cc;
      if (done[j]) continue;
      done[j] = 1;
      if (filled[j] < filled[i]) filled[j] = filled[i];
      heap.push(filled[j], j);
    }
  }
  return filled;
}

/** Depression depth per cell [m] (0 outside closed depressions). */
export function depressionDepth(h, n) {
  const f = fillDepressions(h, n);
  const d = new Float32Array(h.length);
  for (let i = 0; i < d.length; i++) d[i] = Math.max(0, f[i] - h[i]);
  return d;
}

/** Cells within `rCells` (Euclidean) of a set cell. rCells 0 → copy. */
export function inflate(mask, n, rCells) {
  const out = new Uint8Array(mask);
  if (!(rCells > 0)) return out;
  const R = Math.ceil(rCells), R2 = rCells * rCells;
  const offs = [];
  for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) if (dr * dr + dc * dc <= R2 && (dr || dc)) offs.push([dr, dc]);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const r = (i / n) | 0, c = i - r * n;
    for (const [dr, dc] of offs) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < n && cc < n) out[rr * n + cc] = 1;
    }
  }
  return out;
}

/**
 * Cells within radiusM of any point (world x east, z south, metres from the centre).
 * Grid row 0 = north edge (z = −half), col 0 = west edge (x = −half), as in the site grid.
 */
export function nearPoints(points, n, cellM, radiusM) {
  const half = (n - 1) * cellM / 2;
  const seed = new Uint8Array(n * n);
  for (const p of points || []) {
    const c = Math.round((p.x + half) / cellM), r = Math.round((p.z + half) / cellM);
    if (r >= 0 && c >= 0 && r < n && c < n) seed[r * n + c] = 1;
  }
  return inflate(seed, n, radiusM / cellM);
}

/**
 * Hazard flags for every cell.
 * @param {object} a
 *   n, cellM            grid
 *   slope               rise/run per cell (Float32Array)
 *   slopeLimitDeg       walkable limit
 *   rock                rock relief [m] per cell (or null → no rock flags; reported as missing)
 *   rockLimitM          obstacle limit
 *   heights             DTM [m] (or null → no depression flags)
 *   groundPoints        [{x,z}] rover positions (or null → no NO_GROUND_TRUTH flags)
 *   bufferM             keep-out distance around rock walls (default HAZARD_PARAMS value)
 *   roverToHome, roverLimitS  walking-time map to the rover and its limit (optional)
 * @returns {{ flags: Uint16Array, depth: Float32Array|null, missing: string[] }}
 */
export function buildHazardFlags(a) {
  const { n, cellM } = a;
  const N = n * n;
  const flags = new Uint16Array(N);
  const missing = [];
  const lim = Math.tan(a.slopeLimitDeg * Math.PI / 180);
  const steep = Math.tan(HAZARD_PARAMS.steepFrac.value * a.slopeLimitDeg * Math.PI / 180);
  for (let i = 0; i < N; i++) {
    const s = a.slope?.[i] ?? 0;
    if (s > lim) flags[i] |= HAZ.SLOPE_WALL;
    else if (s > steep) flags[i] |= HAZ.STEEP;
  }
  if (a.rock && a.rock.length === N) {
    const rockWall = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const v = a.rock[i];
      if (!Number.isFinite(v)) continue;
      if (v > a.rockLimitM) { flags[i] |= HAZ.ROCK_WALL; rockWall[i] = 1; }
      else if (v > HAZARD_PARAMS.roughFrac.value * a.rockLimitM) flags[i] |= HAZ.ROUGH;
    }
    const bufM = a.bufferM ?? HAZARD_PARAMS.obstacleBufferM.value;
    // Always draw at least one cell of buffer on the map, so the crew sees the keep-out margin
    const shown = inflate(rockWall, n, Math.max(bufM, cellM) / cellM);
    for (let i = 0; i < N; i++) if (shown[i] && !rockWall[i]) flags[i] |= HAZ.ROCK_BUFFER;
  } else {
    missing.push('rock relief layer — boulders / outcrops cannot be detected');
  }
  let depth = null;
  if (a.heights && a.heights.length === N) {
    depth = depressionDepth(a.heights, n);
    const d0 = HAZARD_PARAMS.depressionMinDepthM.value;
    for (let i = 0; i < N; i++) if (depth[i] >= d0) flags[i] |= HAZ.DEPRESSION;
  } else {
    missing.push('terrain heights — depressions cannot be detected');
  }
  if (a.groundPoints?.length) {
    const near = nearPoints(a.groundPoints, n, cellM, HAZARD_PARAMS.groundTruthRadiusM.value);
    for (let i = 0; i < N; i++) if (!near[i]) flags[i] |= HAZ.NO_GROUND_TRUTH;
  } else {
    missing.push('rover positions — ground-truth coverage unknown');
    for (let i = 0; i < N; i++) flags[i] |= HAZ.NO_GROUND_TRUTH;
  }
  if (a.roverToHome && a.roverLimitS > 0) {
    for (let i = 0; i < N; i++) if (!(a.roverToHome[i] <= a.roverLimitS)) flags[i] |= HAZ.ROVER_OUT;
  }
  for (let k = 0; k < n; k++) {
    flags[k] |= HAZ.EDGE; flags[(n - 1) * n + k] |= HAZ.EDGE;
    flags[k * n] |= HAZ.EDGE; flags[k * n + n - 1] |= HAZ.EDGE;
  }
  return { flags, depth, missing };
}

/** Share of the site's cells carrying each legend flag. */
export function hazardSummary(flags) {
  const out = {};
  for (const e of HAZARD_LEGEND) {
    let c = 0;
    for (let i = 0; i < flags.length; i++) if (flags[i] & e.flag) c++;
    out[e.flag] = c / flags.length;
  }
  return out;
}

/**
 * Hazards along a route: for each legend flag, the share of route points on it and the first
 * point index. `cellIndexAt(x, z)` maps a route point to its grid cell.
 */
export function routeHazards(path, flags, cellIndexAt) {
  const out = HAZARD_LEGEND.map(e => ({ ...e, n: 0, first: -1 }));
  if (!path?.length || !flags) return [];
  path.forEach((p, k) => {
    const f = flags[cellIndexAt(p[0], p[2])];
    for (const e of out) if (f & e.flag) { e.n++; if (e.first < 0) e.first = k; }
  });
  return out.filter(e => e.n > 0).map(e => ({ flag: e.flag, label: e.label, hard: e.hard, share: e.n / path.length, firstIdx: e.first }));
}
