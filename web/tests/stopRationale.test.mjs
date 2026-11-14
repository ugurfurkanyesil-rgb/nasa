/**
 * Science stop cards (utils/stopRationale.js) and the mission summary (utils/missionSummary.js):
 * every field comes from the planner / layers, the qualitative labels follow their written rules.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { stopCard } = await import('../src/utils/stopRationale.js');
const { missionSummary } = await import('../src/utils/missionSummary.js');
const { getObjective } = await import('../src/config/objectives.js');
const { HAZ } = await import('../src/utils/hazardMap.js');

const n = 4;
const site = {
  name: 'gale',
  geology: { n, bedrock: new Uint8Array(16).fill(1), surface: new Uint8Array(16).fill(2),
    bedrockUnits: ['', 'Boxwork-bearing layer'], surfaceUnits: ['', 'Smooth ground', 'Ridge or butte crest'] },
  layers: { rock: { values: new Float32Array(16).fill(0.1) } },
  chemistry: { rmsep: { CaO: 1.3 } },
};
const records = [
  { id: 'geology', name: 'Stratigraphic level + terrain class', categories: ['derived'], subtype: 'this project\'s derivation — NOT an official published GIS geologic map', limitations: ['derived limit'] },
  { id: 'chemistry', name: 'Rock chemistry (ChemCam)', categories: ['direct'], limitations: ['oxides only'] },
];
const obj = getObjective('gale-water-alteration');

test('stop card: why = the planner\'s primary contributions; ChemCam evidence → measured in situ', () => {
  const st = { idx: 5, x: 10, z: -20, kind: 'chemistry', label: 'Re-sample X — ChemCam CaO high',
    tags: ['B:Boxwork-bearing layer', 'S:Ridge or butte crest', 'X:CaO high'],
    contrib: [{ tag: 'X:CaO high', points: 5, role: 'primary' }],
    chem: { name: 'X', sol: 4841, tag: 'CaO high', diff: 6.5 } };
  const c = stopCard(st, 0, { objective: obj, site, records, slope: new Float32Array(16), hazardFlags: new Uint16Array(16), dwellS: 1200 });
  assert.equal(c.n, 1);
  assert.match(c.why, /Primary evidence/);
  assert.match(c.why, /CaO high \(5 pts\)/);
  assert.equal(c.confidence.label, 'Measured in situ');
  assert.ok(c.evidence.some(e => /\+6\.5 wt%.*±1\.3/.test(e)));
  assert.ok(c.investigate.some(t => /calcium sulfate/.test(t)));
  assert.equal(c.visitS, 1200);
  assert.ok(c.uncertainty.some(u => /No rover ground view/.test(u)), 'missing ground view is stated, not hidden');
  assert.equal(c.terrain.risk, 'low');
});

test('stop card: derived-only evidence is labelled as a proxy; hazard at the cell raises the terrain risk', () => {
  const st = { idx: 6, x: 0, z: 0, kind: 'unit', label: 'Ridge', tags: ['U:Ridge or butte crest | Boxwork-bearing layer'],
    contrib: [{ tag: 'U:Ridge or butte crest | Boxwork-bearing layer', points: 5, role: 'primary' }] };
  const flags = new Uint16Array(16); flags[6] = HAZ.ROUGH;
  const c = stopCard(st, 1, { objective: obj, site, records, hazardFlags: flags, groundView: { dist: 12 } });
  assert.equal(c.confidence.label, 'Derived by this project (proxy)');
  assert.equal(c.terrain.risk, 'elevated');
  assert.ok(c.evidence.some(e => /ground view from 12 m/.test(e)));
});

test('mission summary copies the route stats and the status — nothing recomputed', () => {
  const stats = { stopCount: 3, distance: 2860, roundTripS: 9480, budgetS: 28800, minMarginS: 19260, ponrIdx: -1,
    maxSlopeDeg: 16.6, maxRadialM: 680, radiation: { doseMSv: 0.07, careerFrac: 0.00012 } };
  const s = missionSummary({ objective: obj, siteName: 'gale', siteLabel: 'Gale', mode: 'SAFE', stats,
    evaluation: { status: 'CONDITIONAL', headline: 'h' }, routeHazards: [{ label: 'Steep', share: 0.1, hard: false }],
    radiationRecord: { name: 'RAD', categories: ['direct'] }, mission: { suit: 'mars', equipmentKg: 10, rover: false, limits: 'lunar' }, startMs: 0 });
  assert.equal(s.distanceM, 2860);
  assert.equal(s.evaDurationS, 9480);
  assert.equal(s.minReturnMarginS, 19260);
  assert.equal(s.maxSlopeDeg, 16.6);
  assert.equal(s.status, 'CONDITIONAL');
  assert.equal(s.majorHazards[0].label, 'Steep');
  assert.match(s.radiation.basis, /direct/);
  assert.equal(missionSummary({ stats: null }), null);
});
