/**
 * Mission objectives (config/objectives.js) on a synthetic site: the objective must change the
 * stops the planner picks; the survey must reproduce the original planner exactly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { site } = await import('../src/terrain/siteData.js');

// 120×120 flat 4 m grid; bedrock A (west) / B (east); a CRISM "Olivine" block near home,
// an "Olivine + smectite" block far away.
const N = 120, CELL = 4;
Object.assign(site, {
  mode: 'dem', name: 'jezero', gridRes: N, cellM: CELL, sizeM: (N - 1) * CELL,
  heights: new Float32Array(N * N), heightOrigin: 0,
  meta: { center: { lat_deg: 18.44, lon_deg_east: 77.45 }, grid: { n: N, cell_m: CELL, span_m: (N - 1) * CELL },
          projection: { mars_radius_m: 3396190 } },
});
const surface = new Uint8Array(N * N), bedrock = new Uint8Array(N * N);
const code = new Uint8Array(N * N), conf = new Uint8Array(N * N);
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
  const i = r * N + c;
  bedrock[i] = c < 70 ? 1 : 2;
  surface[i] = r < 30 ? 1 : 0;
  if (r >= 55 && r < 62 && c >= 64 && c < 71) { code[i] = 1; conf[i] = 2; }       // Olivine, near the centre
  if (r >= 100 && r < 107 && c >= 20 && c < 27) { code[i] = 2; conf[i] = 1; }      // Olivine + smectite, far
}
site.geology = { n: N, surface, bedrock, surfaceUnits: ['', 'Dunes'], bedrockUnits: ['', 'Floor A', 'Floor B'] };
site.layers = { thermal: null, rock: null,
  minerals: { classes: ['none', 'Olivine', 'Olivine + smectite'], colors: [[0, 0, 0], [1, 1, 1], [2, 2, 2]], code, confidence: conf } };

const T = await import('../src/three/terrainGenerator.js');
const P = await import('../src/utils/pathfinder.js');
const O = await import('../src/config/objectives.js');
const S = await import('../src/utils/science.js');
const { SCIENCE_PARAMS } = await import('../src/config/marswalkProfile.js');

const hm = T.buildHeightMap();
const home = { x: 0, z: 0 };

test('every Jezero and Gale objective is defined with all required fields', () => {
  for (const name of ['jezero', 'gale']) {
    const list = O.objectivesForSite(name);
    assert.equal(list.filter(o => o.site === name).length, 5, `${name}: five objectives`);
    assert.equal(list[list.length - 1].id, 'survey');
    for (const o of list) {
      for (const k of ['label', 'purpose', 'relevance', 'candidates']) assert.ok(typeof o[k] === 'string' && o[k].length > 10, `${o.id}.${k}`);
      for (const k of ['layers', 'criteria', 'uncertainties']) assert.ok(Array.isArray(o[k]) && o[k].length > 0, `${o.id}.${k}`);
      if (o.rules) assert.ok(o.rules.some(r => r[2] === 'primary'), `${o.id} has primary evidence`);
    }
  }
  assert.deepEqual(O.objectivesForSite('moon'), [], 'no objectives in the Moon simulator');
});

test('glob rules: first match wins, unmatched tags score 0, exact names do not prefix-match', () => {
  const w = O.objectiveWeights(O.getObjective('jezero-olivine-pyroxene'), SCIENCE_PARAMS.weights);
  assert.equal(S.tagWeight('M:Olivine', w), 5);
  assert.equal(S.tagWeight('M:Olivine + smectite', w), 1, '"M:Olivine" must not match "Olivine + smectite"');
  assert.equal(S.tagWeight('S:Dunes', w), 0);
  assert.equal(S.tagRole('M:Olivine', w), 'primary');
  assert.equal(S.tagRole('S:Dunes', w), null);
  assert.ok(S.globMatch('C:*Boxwork-bearing layer*', 'C:Boxwork-bearing layer | Sulfate unit above the boxwork'));
  assert.ok(!S.globMatch('C:*Boxwork*', 'B:Boxwork-bearing layer'));
});

test('survey objective = the original planner (same stops, order and score)', () => {
  const a = P.planScience(home, hm, { dwellMin: 20 });
  const b = P.planScience(home, hm, { dwellMin: 20, objective: 'survey' });
  assert.deepEqual(b.stops.map(s => s.idx), a.stops.map(s => s.idx));
  assert.equal(b.score, a.score);
  assert.equal(b.primaryHit, null);
});

test('objective changes the plan: the alteration objective goes to the far smectite block', () => {
  const surv = P.planScience(home, hm, { dwellMin: 20, objective: 'survey' });
  const alt = P.planScience(home, hm, { dwellMin: 20, objective: 'jezero-olivine-smectite' });
  const tagsOf = (r) => r.stops.flatMap(s => s.tags);
  assert.ok(alt.stops.some(s => s.tags.includes('M:Olivine + smectite')), 'smectite stop chosen');
  assert.equal(alt.primaryHit, true);
  assert.notDeepEqual(alt.stops.map(s => s.idx), surv.stops.map(s => s.idx));
  // every stop either carries the objective's evidence or adds context; nothing irrelevant scores
  for (const st of alt.stops) for (const c of st.contrib) assert.ok(c.points > 0 && (c.role === 'primary' || c.role === 'context'));
  // the dunes surface unit is irrelevant to this objective → never contributes
  assert.ok(!alt.stops.some(s => s.contrib.some(c => c.tag === 'S:Dunes')));
  assert.ok(tagsOf(surv).length > 0);
});

test('relevant candidates are ranked before nearer irrelevant ones (not cut off by maxCandidates)', () => {
  const r = P.planScience(home, hm, { dwellMin: 20, objective: 'jezero-olivine-smectite' });
  const first = r.candidates[0];
  assert.ok(first.relevance > 0, 'highest-relevance candidate first');
  for (let i = 1; i < r.candidates.length; i++) {
    const a = r.candidates[i - 1], b = r.candidates[i];
    if (a.kind === b.kind) assert.ok(a.relevance > b.relevance || (a.relevance === b.relevance && a.rtS <= b.rtS));
  }
});

test('contrib records each tag once, at the first stop that samples it, with the objective points', () => {
  const r = P.planScience(home, hm, { dwellMin: 20, objective: 'jezero-mineral-diversity' });
  const seen = r.stops.flatMap(s => s.contrib.map(c => c.tag));
  assert.equal(new Set(seen).size, seen.length);
  const total = r.stops.reduce((a, s) => a + s.contrib.reduce((b, c) => b + c.points, 0), 0);
  assert.equal(total, r.score, 'contributions add up to the tour score');
});

test('data support: present evidence → supported / partial; absent → unsupported (planning refused)', () => {
  const s = { ...site, chemAnomalyCount: 0, chemAnomalyTags: [], chemTargetCount: 0 };
  assert.equal(O.objectiveSupport(O.getObjective('jezero-olivine-pyroxene'), s).status, 'supported');
  assert.equal(O.objectiveSupport(O.getObjective('jezero-lake-delta'), s).status, 'partial', 'delta outside the site');
  const noMin = { ...s, layers: { minerals: null } };
  const u = O.objectiveSupport(O.getObjective('jezero-olivine-smectite'), noMin);
  assert.equal(u.status, 'unsupported');
  assert.match(u.note, /disabled/);
  assert.equal(O.objectiveSupport(O.getObjective('gale-boxwork'), s).status, 'unsupported', 'objective of another site');
  assert.equal(O.objectiveSupport(null, s).status, 'unsupported');
});

test('composite U: tags only exist when the objective asks for them', () => {
  const g = site.geology;
  const homeMaps = P.getHomeMaps(0, 0, hm);
  const o = { cellM: CELL, wall: P.getWallMap(), budgetS: 8 * 3600, dwellS: 600, maxRadialM: 2000, maxCandidates: 14 };
  assert.ok(!S.candidateStops(g, homeMaps, o).some(c => c.tags.some(t => t.startsWith('U:'))));
  assert.ok(S.candidateStops(g, homeMaps, { ...o, compositeTags: true }).some(c => c.tags.includes('U:Dunes | Floor A')));
});

test('share link keeps the objective and the rock buffer; bad values are dropped', async () => {
  const { encodePlan, decodePlan } = await import('../src/utils/shareLink.js');
  const q = '?plan=' + encodePlan({ waypoints: [{ x: 1, z: 2 }], science: true, objective: 'gale-boxwork',
    mission: { suit: 'mars', equipmentKg: 10, rover: false, limits: 'mars', obstacleBufferM: 4 } });
  const d = decodePlan(q);
  assert.equal(d.objective, 'gale-boxwork');
  assert.equal(d.mission.obstacleBufferM, 4);
  const bad = decodePlan('?plan=' + encodePlan({ waypoints: [], objective: '<script>' }));
  assert.equal(bad.objective, null);
});
