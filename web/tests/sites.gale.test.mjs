/**
 * Real Gale / Mount Sharp data (public/sites/gale): objectives, provenance, obstacle buffer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadRealSite, siteDir } from './helpers/realSite.mjs';

const HAVE = existsSync(join(siteDir('gale'), 'grid.bin'));
const skip = !HAVE && 'public/sites/gale missing';
const site = HAVE ? await loadRealSite('gale') : null;
const T = HAVE ? await import('../src/three/terrainGenerator.js') : null;
const P = HAVE ? await import('../src/utils/pathfinder.js') : null;
const CFG = await import('../src/config/marswalkProfile.js');
const O = await import('../src/config/objectives.js');
const V = await import('../src/config/provenance.js');
const C = await import('../src/utils/chemistry.js');
const hm = HAVE ? T.buildHeightMap() : null;

function supportSite() {
  const an = C.chemAnomalies(site.chemistry);
  const tags = [...new Set(an.map(a => a.tag))];
  return { ...site, chemAnomalyCount: tags.length, chemAnomalyTags: tags, chemTargetCount: site.chemistry.targets.length };
}

test('Gale: every objective plans and reaches its primary evidence', { skip }, () => {
  const s = supportSite();
  for (const o of O.objectivesForSite('gale')) {
    assert.notEqual(O.objectiveSupport(o, s).status, 'unsupported', o.id);
    const r = P.planScience({ x: 0, z: 0 }, hm, { dwellMin: 20, objective: o.id });
    assert.ok(r.stops.length > 0 && r.totalS <= r.budgetS, o.id);
    if (o.rules) assert.equal(r.primaryHit, true, o.id);
  }
});

test('Gale: boxwork objective samples a ridge and a hollow INSIDE the boxwork layer, no chemistry labels', { skip }, () => {
  const r = P.planScience({ x: 0, z: 0 }, hm, { dwellMin: 20, objective: 'gale-boxwork' });
  const tags = r.stops.flatMap(st => st.tags);
  assert.ok(tags.includes('U:Ridge or butte crest | Boxwork-bearing layer'));
  assert.ok(tags.includes('U:Hollow or trough | Boxwork-bearing layer'));
  assert.ok(!r.candidates.some(c => c.kind === 'chemistry'), 'objective without X: rules gets no re-sample candidates');
});

test('Gale: chemical-anomaly objective picks more ChemCam standouts than the survey', { skip }, () => {
  const count = (r) => new Set(r.stops.flatMap(st => st.tags.filter(t => t.startsWith('X:')))).size;
  const surv = P.planScience({ x: 0, z: 0 }, hm, { dwellMin: 20, objective: 'survey' });
  const chem = P.planScience({ x: 0, z: 0 }, hm, { dwellMin: 20, objective: 'gale-chem-anomaly' });
  assert.ok(count(chem) > count(surv), `${count(chem)} > ${count(surv)}`);
});

test('Gale: ChemCam re-visit stops are measured targets, each a distinct named rock', { skip }, () => {
  const r = P.planScience({ x: 0, z: 0 }, hm, { dwellMin: 20, objective: 'gale-chemcam-revisit' });
  const names = new Set(site.chemistry.targets.map(t => t.name));
  const visited = r.stops.filter(st => st.kind === 'target');
  assert.ok(visited.length >= 3);
  for (const st of visited) assert.ok(names.has(st.target.name));
  assert.equal(new Set(visited.map(st => st.target.name)).size, visited.length);
});

test('Gale: survey reproduces the validated README plan (6 stops, score 19)', { skip }, () => {
  const r = P.planScience({ x: 0, z: 0 }, hm, { dwellMin: 20, objective: 'survey' });
  assert.equal(r.stops.length, 6);
  assert.equal(r.score, 19);
});

test('Gale provenance: ChemCam / REMS / RAD direct; geology derived, not official; CRISM / THEMIS unavailable', { skip }, () => {
  const recs = V.siteProvenance(site);
  const r = (id) => V.findRecord(recs, id);
  assert.deepEqual(r('chemistry').categories, ['direct']);
  assert.deepEqual(r('climate').categories, ['direct']);
  assert.deepEqual(r('rad').categories, ['direct']);
  assert.match(r('rad').limitations.join(' '), /higher/, 'states the elevation offset to the RAD measurement');
  assert.deepEqual(r('geology').categories, ['derived']);
  assert.match(r('geology').subtype, /NOT an official published GIS geologic map/);
  assert.equal(r('minerals').status, 'unavailable');
  assert.equal(r('thermal').status, 'unavailable');
  assert.ok(r('minerals').investigation.length > 50 && r('thermal').investigation.length > 50);
});

test('Gale: rock keep-out buffer grows the walls, re-keys the cached maps, plan stays feasible', { skip }, () => {
  CFG.setObstacleBufferM(0);
  const w0 = P.getWallMap().reduce((a, v) => a + v, 0);
  const h0 = P.getHomeMaps(0, 0, hm);
  CFG.setObstacleBufferM(4);
  const w4 = P.getWallMap().reduce((a, v) => a + v, 0);
  const h4 = P.getHomeMaps(0, 0, hm);
  assert.ok(w4 > w0, 'buffer adds walls');
  assert.notEqual(h4, h0, 'home maps recomputed for the new walls');
  assert.equal(h4.bufferM, 4);
  const r = P.planScience({ x: 0, z: 0 }, hm, { dwellMin: 20, objective: 'survey' });
  assert.ok(r.stops.length > 0);
  CFG.setObstacleBufferM(0);
  assert.equal(P.getWallMap().reduce((a, v) => a + v, 0), w0, 'back to the validated walls');
});
