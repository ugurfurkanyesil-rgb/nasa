/**
 * Real Jezero data (public/sites/jezero): objectives, provenance, hazards. Skipped if the site
 * files are missing (python pipeline/build_site.py etc.).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadRealSite, siteDir } from './helpers/realSite.mjs';

const HAVE = existsSync(join(siteDir('jezero'), 'grid.bin'));
const skip = !HAVE && 'public/sites/jezero missing';
const site = HAVE ? await loadRealSite('jezero') : null;
const T = HAVE ? await import('../src/three/terrainGenerator.js') : null;
const P = HAVE ? await import('../src/utils/pathfinder.js') : null;
const O = await import('../src/config/objectives.js');
const V = await import('../src/config/provenance.js');
const H = await import('../src/utils/hazardMap.js');
const hm = HAVE ? T.buildHeightMap() : null;

test('Jezero: every objective plans, primary evidence reached, stop sets differ by objective', { skip }, () => {
  const s = { ...site, chemAnomalyCount: 0, chemAnomalyTags: [], chemTargetCount: 0 };
  const sets = {};
  for (const o of O.objectivesForSite('jezero')) {
    const sup = O.objectiveSupport(o, s);
    assert.notEqual(sup.status, 'unsupported', o.id);
    const r = P.planScience({ x: 0, z: 0 }, hm, { dwellMin: 20, objective: o.id });
    assert.ok(r.stops.length > 0, o.id);
    assert.ok(r.totalS <= r.budgetS, `${o.id} within budget`);
    if (o.rules) assert.equal(r.primaryHit, true, `${o.id} reaches primary evidence`);
    sets[o.id] = r.stops.map(st => st.idx).join(',');
  }
  assert.ok(new Set(Object.values(sets)).size >= 4, 'objectives lead to different stop sets');
});

test('Jezero: survey reproduces the validated README plan (8 stops, score 18)', { skip }, () => {
  const r = P.planScience({ x: 0, z: 0 }, hm, { dwellMin: 20, objective: 'survey' });
  assert.equal(r.stops.length, 8);
  assert.equal(r.score, 18);
});

test('Jezero: lake/delta objective is PARTIAL — no delta unit in the site', { skip }, () => {
  const sup = O.objectiveSupport(O.getObjective('jezero-lake-delta'), site);
  assert.equal(sup.status, 'partial');
  const units = [...site.geology.bedrockUnits, ...site.geology.surfaceUnits].join(' ').toLowerCase();
  assert.ok(!/delta|lacustrine|fan/.test(units), 'no delta / lake unit in the rasterised map');
  const r = P.planScience({ x: 0, z: 0 }, hm, { dwellMin: 20, objective: 'jezero-lake-delta' });
  assert.ok(r.stops.some(st => st.tags.includes('M:Olivine + smectite')));
});

test('Jezero provenance: RAD is TRANSFERRED, CRISM / THEMIS orbital, MEDA direct, SuperCam/PIXL unavailable', { skip }, () => {
  const recs = V.siteProvenance(site);
  const r = (id) => V.findRecord(recs, id);
  assert.deepEqual(r('rad').categories, ['transferred']);
  assert.match(r('rad').limitations.join(' '), /NOT a Jezero measurement/);
  assert.deepEqual(r('minerals').categories, ['orbital']);
  assert.deepEqual(r('thermal').categories, ['orbital']);
  assert.deepEqual(r('climate').categories, ['direct']);
  assert.equal(r('geology').categories[0], 'derived');
  assert.equal(r('chemistry').status, 'unavailable');
  assert.match(r('chemistry').investigation, /supercam_libs_moc\.csv|MOC/);
  assert.ok(r('donki').categories.includes('modelled') && !r('donki').categories.includes('direct'));
  for (const x of recs) {
    for (const k of ['name', 'mission', 'instrument', 'observation', 'resolution', 'coverage', 'dataType', 'processing', 'status', 'uncertainty']) assert.ok(x[k] != null, `${x.id}.${k}`);
    assert.ok(x.categories.every(c => V.CATEGORIES[c]), x.id);
    assert.ok(Array.isArray(x.limitations) && x.limitations.length, `${x.id} limitations`);
  }
});

test('Jezero hazards: from the data only — few rock walls, depressions found, ground truth near the track', { skip }, () => {
  const sm = T.buildSlopeMap(hm);
  const pts = site.track.segments.flat().map(p => ({ x: p[0], z: p[1] }));
  const hz = H.buildHazardFlags({ n: site.gridRes, cellM: site.cellM, slope: sm, slopeLimitDeg: 20,
    rock: site.layers.rock.values, rockLimitM: 0.5, heights: hm, groundPoints: pts });
  const sum = H.hazardSummary(hz.flags);
  assert.ok(sum[H.HAZ.ROCK_WALL] < 0.001, 'smooth landing area: almost no rock walls');
  assert.ok(sum[H.HAZ.DEPRESSION] > 0, 'craters on the crater floor show as depressions');
  assert.ok(sum[H.HAZ.NO_GROUND_TRUTH] < 1, 'cells along the rover track have ground truth');
  assert.deepEqual(hz.missing, []);
});
