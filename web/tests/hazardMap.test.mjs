/**
 * Hazard map (utils/hazardMap.js) on hand-made grids.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
const H = await import('../src/utils/hazardMap.js');

test('priority-flood: a closed bowl is filled to its rim; an open slope is not a depression', () => {
  const n = 21, h = new Float32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) h[r * n + c] = 10;
  // bowl: centre 2 m below the 10 m plain
  for (let r = 8; r <= 12; r++) for (let c = 8; c <= 12; c++) h[r * n + c] = 8 + 0.2 * Math.max(Math.abs(r - 10), Math.abs(c - 10));
  const d = H.depressionDepth(h, n);
  assert.ok(Math.abs(d[10 * n + 10] - 2) < 1e-5, 'centre depth 2 m');
  assert.equal(d[0], 0);
  // a plane tilted toward the edge drains: no depression anywhere
  const t = new Float32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) t[r * n + c] = c * 0.5;
  assert.ok(H.depressionDepth(t, n).every(v => v === 0));
});

test('inflate: Euclidean disk of the given radius; 0 copies', () => {
  const n = 11, m = new Uint8Array(n * n);
  m[5 * n + 5] = 1;
  assert.equal(H.inflate(m, n, 0).reduce((a, v) => a + v, 0), 1);
  const g = H.inflate(m, n, 2);
  assert.equal(g[5 * n + 7], 1);
  assert.equal(g[7 * n + 7], 0, '(2,2) is 2.83 cells away');
  assert.equal(g.reduce((a, v) => a + v, 0), 13);
});

test('flags follow the documented thresholds; missing layers are reported, never assumed safe', () => {
  const n = 12, N = n * n, cellM = 4;
  const slope = new Float32Array(N), rock = new Float32Array(N);
  const tan = (d) => Math.tan(d * Math.PI / 180);
  slope[3 * n + 3] = tan(25);   // > 20 → wall
  slope[3 * n + 5] = tan(16);   // > 15 (75 %) → steep
  slope[3 * n + 7] = tan(14);   // below → nothing
  rock[8 * n + 8] = 0.6;        // > 0.5 → rock wall
  rock[8 * n + 3] = 0.3;        // > 0.25 → rough
  const hz = H.buildHazardFlags({ n, cellM, slope, slopeLimitDeg: 20, rock, rockLimitM: 0.5, heights: new Float32Array(N),
    groundPoints: [{ x: 0, z: 0 }] });
  const f = (r, c) => hz.flags[r * n + c];
  assert.ok(f(3, 3) & H.HAZ.SLOPE_WALL);
  assert.ok(f(3, 5) & H.HAZ.STEEP);
  assert.equal(f(3, 7) & (H.HAZ.STEEP | H.HAZ.SLOPE_WALL), 0);
  assert.ok(f(8, 8) & H.HAZ.ROCK_WALL);
  assert.ok(f(8, 9) & H.HAZ.ROCK_BUFFER, 'a cell next to the rock is in the shown buffer');
  assert.ok(f(8, 3) & H.HAZ.ROUGH);
  assert.ok(f(0, 0) & H.HAZ.EDGE);
  assert.deepEqual(hz.missing, []);
  // no rock layer, no heights, no rover positions → reported missing; every cell lacks ground truth
  const bare = H.buildHazardFlags({ n, cellM, slope, slopeLimitDeg: 20, rock: null, rockLimitM: 0.5, heights: null, groundPoints: [] });
  assert.equal(bare.missing.length, 3);
  assert.ok(bare.flags.every(v => v & H.HAZ.NO_GROUND_TRUTH));
});

test('ground truth: only cells within the radius of a rover position', () => {
  const n = 51, cellM = 4;   // 200 m wide, centre (0,0) at cell 25,25
  const near = H.nearPoints([{ x: 0, z: 0 }], n, cellM, 100);
  assert.equal(near[25 * n + 25], 1);
  assert.equal(near[25 * n + 50], 1, '100 m east');
  assert.equal(near[0], 0, 'corner is 141 m away');
});

test('rover reach: cells beyond the walking-time limit are flagged', () => {
  const n = 5, N = n * n;
  const toHome = new Float32Array(N).fill(100); toHome[12] = 5000; toHome[13] = Infinity;
  const hz = H.buildHazardFlags({ n, cellM: 4, slope: new Float32Array(N), slopeLimitDeg: 20, rock: new Float32Array(N), rockLimitM: 0.5,
    heights: new Float32Array(N), groundPoints: [{ x: 0, z: 0 }], roverToHome: toHome, roverLimitS: 1800 });
  assert.ok(hz.flags[12] & H.HAZ.ROVER_OUT);
  assert.ok(hz.flags[13] & H.HAZ.ROVER_OUT, 'unreachable counts as out of reach');
  assert.equal(hz.flags[11] & H.HAZ.ROVER_OUT, 0);
});

test('routeHazards: share of route points per flag, first index', () => {
  const flags = new Uint16Array([0, H.HAZ.STEEP, H.HAZ.STEEP | H.HAZ.DEPRESSION, 0]);
  const path = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]];
  const r = H.routeHazards(path, flags, (x) => x);
  const steep = r.find(e => e.flag === H.HAZ.STEEP);
  assert.equal(steep.share, 0.5);
  assert.equal(steep.firstIdx, 1);
  assert.equal(r.find(e => e.flag === H.HAZ.DEPRESSION).share, 0.25);
});
