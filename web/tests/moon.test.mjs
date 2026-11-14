/**
 * Moon rover simulator (?site=moon, procedural terrain) must keep working unchanged and must
 * never receive Mars objectives, Mars provenance or Mars hazard data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { site, loadSite } = await import('../src/terrain/siteData.js');
await loadSite('moon');
const T = await import('../src/three/terrainGenerator.js');
const P = await import('../src/utils/pathfinder.js');
const O = await import('../src/config/objectives.js');
const V = await import('../src/config/provenance.js');

test('moon: procedural mode, 100 m area, craters present', () => {
  assert.equal(site.mode, 'procedural');
  assert.equal(site.name, 'moon');
  assert.equal(T.IS_DEM, false);
  assert.ok(T.CRATERS.length > 0);
});

test('moon: all four routes plan with the original risk / cost stats (no Marswalk fields)', () => {
  const hm = T.buildHeightMap(), sm = T.buildSlopeMap(hm), cm = T.buildCraterMask();
  // open (non-wall, low-hazard) cells near two opposite corners
  const open = (x0, z0, dx, dz) => {
    for (let k = 0; k < 60; k++) for (let j = 0; j < 60; j++) {
      const x = x0 + dx * k, z = z0 + dz * j;
      if (!P.isWallAt(x, z) && P.getHazardAtPoint(x, z, cm, sm) < 0.2) return { x, z };
    }
    return null;
  };
  const a = open(-40, -40, 1, 1), b = open(40, 40, -1, -1);
  assert.ok(a && b);
  const r = P.planAllRoutes([a, b], sm, cm, hm, 45);
  for (const m of ['SAFE', 'ECO', 'FAST', 'AUTO']) {
    assert.ok(r[m].path.length > 1, m);
    assert.ok(Number.isFinite(r[m].stats.riskPercent), m);
    assert.equal(r[m].stats.walkTimeS, undefined, `${m}: Moon stats are not Marswalk stats`);
    for (const p of r[m].path) assert.ok(!P.isWallAt(p[0], p[2]), 'never through a crater');
  }
});

test('moon: no objectives, no science planner, provenance says simulated', () => {
  assert.deepEqual(O.objectivesForSite(site.name), []);
  assert.equal(P.planScience({ x: 0, z: 0 }, T.buildHeightMap(), { objective: 'jezero-olivine-pyroxene' }), null);
  const recs = V.siteProvenance(site);
  assert.ok(recs.length > 0 && recs.every(r => r.categories.includes('simulated')));
});
