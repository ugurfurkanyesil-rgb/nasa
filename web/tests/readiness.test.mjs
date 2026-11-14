/**
 * Terrain & Mobility + integration of the three EVA-readiness assessments on a synthetic DEM site.
 * Payload and dust must not change any route or walking time; the validated Mars speed set must be
 * applied identically outbound (A*) and on the way home (Dijkstra).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { site } = await import('../src/terrain/siteData.js');
const N = 100, CELL = 4;
const heights = new Float32Array(N * N);
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) heights[r * N + c] = 0.02 * c;   // gentle, uniform slope
Object.assign(site, {
  mode: 'dem', name: 'test', gridRes: N, cellM: CELL, sizeM: (N - 1) * CELL, heights, heightOrigin: 0,
  meta: { center: { lat_deg: 0, lon_deg_east: 0 }, grid: { n: N, cell_m: CELL, span_m: (N - 1) * CELL }, projection: { mars_radius_m: 3396190 } },
  layers: { thermal: null, minerals: null, rock: { values: new Float32Array(N * N).fill(0.1) } },
});

const T = await import('../src/three/terrainGenerator.js');
const P = await import('../src/utils/pathfinder.js');
const CFG = await import('../src/config/marswalkProfile.js');
const { evaluateMission, STATUS } = await import('../src/utils/missionStatus.js');
const { assessMobility } = await import('../src/utils/mobilityAssessment.js');
const { assessDust } = await import('../src/utils/dustAssessment.js');
const { assessPayload } = await import('../src/utils/payloadAssessment.js');

const hm = T.buildHeightMap(), sm = T.buildSlopeMap(hm), cm = T.buildCraterMask();
const wps = [{ x: -60, z: -40 }, { x: 70, z: 30, dwellS: 600 }, { x: -60, z: -40 }];
const plan = (mission) => P.planAllRoutes(wps, sm, cm, hm, 45, null, { modes: ['SAFE'], mission }).SAFE;
const base = { suit: 'mars', equipmentKg: 2, rover: false, limits: 'lunar' };

test('payload and dust do not change routes or walking times (no unsupported penalties)', () => {
  CFG.setEvaProfile('lunar');
  const a = plan(base);
  const b = plan({ ...base, equipmentKg: 10, payload: { instruments: 2, sampling: 2 }, dust: { joints: 'none', covers: 'none' } });
  assert.deepEqual(b.path, a.path);
  for (const k of ['walkTimeS', 'returnTimeS', 'roundTripS', 'minMarginS', 'distance']) assert.equal(b.stats[k], a.stats[k], k);
  assert.ok(b.stats.carry.earthEqKg > a.stats.carry.earthEqKg, 'only the carried weight changes');
});

test('validated Mars speed set scales outbound and return the same way', () => {
  const stop = P.worldToGrid(70, 30), k = stop.row * N + stop.col;
  CFG.setEvaProfile('lunar');
  const l = plan(base).stats, hl = P.getHomeMaps(-60, -40, hm);
  const lTo = hl.toHome[k], lFrom = hl.fromHome[k];
  CFG.setEvaProfile('mars');
  const m = plan({ ...base, limits: 'mars' }).stats, hmars = P.getHomeMaps(-60, -40, hm);
  const speedRatio = 2.0 / CFG.param('levelWalkSpeedKmh');
  CFG.setEvaProfile('lunar');
  // Dijkstra: walk home (return) and walk out from home scale by exactly the speed ratio
  assert.ok(Math.abs(hmars.toHome[k] / lTo - speedRatio) / speedRatio < 0.005, 'return (to home)');
  assert.ok(Math.abs(hmars.fromHome[k] / lFrom - speedRatio) / speedRatio < 0.005, 'outbound (from home)');
  // A* route time scales the same way (small difference: A* grid path vs Dijkstra)
  assert.ok(Math.abs(m.walkTimeS / l.walkTimeS - speedRatio) / speedRatio < 0.02, 'A* outbound route');
});

test('payload violation → carry check fails → NO-GO; invalid payload → INSUFFICIENT DATA', () => {
  const over = plan({ ...base, equipmentKg: 40 });
  assert.equal(over.stats.checks.carry, false);
  const ctx = { profile: 'lunar', spaceWeather: { advisory: 'clear', sep: [], near: [] }, swState: 'live', rockLayer: true };
  assert.equal(evaluateMission(over.stats, ctx).status, STATUS.NOGO);
  const inv = plan({ ...base, payload: { emergency: -1 } });
  assert.equal(inv.stats.checks.carry, null);
  const e = evaluateMission(inv.stats, ctx);
  assert.notEqual(e.status, STATUS.GO);
  assert.equal(e.hard.find(h => h.id === 'carry').state, 'unknown');
});

test('dust warnings are cautions only: they never override or create a hard-constraint result', () => {
  const r = plan(base);
  const ctx = { profile: 'lunar', spaceWeather: { advisory: 'clear', sep: [], near: [] }, swState: 'live', rockLayer: true };
  const dust = assessDust({ dust: { joints: 'none', covers: 'none' }, stats: r.stats, surface: { looseShare: 0.9, basis: 'x' } });
  const without = evaluateMission(r.stats, ctx), withDust = evaluateMission(r.stats, { ...ctx, dust });
  assert.equal(withDust.status, without.status, 'same status with or without dust');
  assert.deepEqual(withDust.hard, without.hard);
  assert.ok(withDust.info.some(i => i.label === 'Dust'));
  assert.ok(!withDust.warnings.some(w => /dust/i.test(w.id)));
  // and a failing hard check is not hidden by dust either
  const bad = { ...r.stats, checks: { ...r.stats.checks, slope: false } };
  assert.equal(evaluateMission(bad, { ...ctx, dust }).status, STATUS.NOGO);
});

test('three assessments are independent results; terrain rules unchanged', () => {
  const r = plan(base);
  const ctx = { profile: 'lunar', spaceWeather: { advisory: 'clear', sep: [], near: [] }, swState: 'live', rockLayer: true };
  const ev = evaluateMission(r.stats, ctx);
  const pay = assessPayload(base), dust = assessDust({ stats: r.stats }), mob = assessMobility(r.stats, { evaluation: ev });
  assert.equal(pay.status, 'ok');
  assert.equal(dust.result, 'INSUFFICIENT DATA', 'protection not stated → explicit gap');
  assert.equal(mob.result, 'PASS');
  assert.equal(mob.payloadPenalty.applied, false);
  assert.equal(mob.dustPenalty.applied, false);
  assert.ok(mob.checks.every(c => ['slope', 'rock', 'budget', 'radial', 'rover'].includes(c.id)), 'mobility reads the same hard checks');
  assert.equal(mob.walking.walkTimeS, r.stats.walkTimeS, 'copied, not recomputed');
  assert.equal(assessMobility(null).result, 'NOT CHECKED');
  assert.equal(P.getWallMap().length, N * N);
});
