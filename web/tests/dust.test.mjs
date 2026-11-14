/**
 * Dust Exposure & Equipment Reliability (config/dust.js, utils/dustAssessment.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
const D = await import('../src/config/dust.js');
const A = await import('../src/utils/dustAssessment.js');

const stats = (o = {}) => ({ roundTripS: 3 * 3600, stopCount: 3, ...o });

test('components have different base sensitivities and every one is sourced', () => {
  const bases = new Set(D.DUST_COMPONENTS.map(c => c.base));
  assert.ok(bases.size >= 2, 'not all components share one level');
  for (const c of D.DUST_COMPONENTS) {
    assert.ok(D.VULNERABILITY_LEVELS.includes(c.base), c.id);
    for (const k of ['mechanism', 'rationale', 'confidence']) assert.ok(c[k]?.length > 10, `${c.id}.${k}`);
    assert.ok(c.precautions.length > 0 && c.sources.length > 0, c.id);
    for (const s of c.sources) assert.ok(D.dustSource(s), `${c.id} → ${s}`);
  }
  for (const id of ['joints', 'bearings', 'connectors', 'sampling', 'optics', 'rover', 'mechanisms']) {
    assert.ok(D.DUST_COMPONENTS.some(c => c.id === id), id);
  }
});

test('source classification: lunar ≠ Mars; analog ≠ Mars; xEMU sources are lunar analogies', () => {
  for (const s of D.DUST_SOURCES) {
    assert.ok(D.APPLICABILITY[s.applicability], s.id);
    for (const k of ['title', 'program', 'date', 'context', 'relevance', 'limitations']) assert.ok(s[k], `${s.id}.${k}`);
  }
  const app = (id) => D.dustSource(id).applicability;
  for (const id of ['gaier2005', 'christoffersen2008', 'ross2017', 'mcfarland2023', 'asm2025', 'eds2025']) assert.equal(app(id), 'lunar-analogy', id);
  for (const id of ['sherloc2025', 'vanbommel2026', 'carousel2022', 'insight2022']) assert.equal(app(id), 'mars-direct', id);
  assert.equal(app('marsv2025'), 'mars-analog');
  assert.match(D.dustSource('marsv2025').limitations, /Not Mars evidence/);
  // nothing claims xEMU is Mars-certified
  const all = JSON.stringify(D.DUST_SOURCES) + JSON.stringify(D.DUST_COMPONENTS);
  assert.ok(!/xEMU[^.]*Mars-certified(?! suit\.| suit,)/i.test(all.replace(/not (a )?Mars-certified/gi, '')));
});

test('vulnerability classification: protection lowers one step, never below moderate; unknown keeps base and is a gap', () => {
  const bearings = D.DUST_COMPONENTS.find(c => c.id === 'bearings');
  assert.equal(A.componentVulnerability(bearings, { joints: 'unknown' }).level, 'high');
  assert.ok(A.componentVulnerability(bearings, { joints: 'unknown' }).gaps.length === 1);
  assert.equal(A.componentVulnerability(bearings, { joints: 'none' }).level, 'high');
  assert.equal(A.componentVulnerability(bearings, { joints: 'sealed' }).level, 'moderate');
  const optics = D.DUST_COMPONENTS.find(c => c.id === 'optics');
  const o = A.componentVulnerability(optics, { covers: 'available' });
  assert.equal(o.level, 'moderate', 'floor: never below moderate');
  assert.match(o.note, /kept at moderate/);
});

test('missing data: unknown settings and no surface layer are reported as gaps → INSUFFICIENT DATA, not "low"', () => {
  const r = A.assessDust({ dust: {}, stats: stats(), surface: { looseShare: null, basis: 'none' } });
  assert.equal(r.result, 'INSUFFICIENT DATA');
  assert.equal(r.indicators.looseShare, null);
  assert.ok(r.gaps.some(g => /Loose fine material/.test(g)));
  assert.equal(A.exposureLevel({ looseShare: null, stops: 0 }), 'unknown');
  assert.equal(A.assessDust({ dust: {} }).exposure, 'unknown', 'no route → unknown, not low');
  const full = { outerLayer: 'heritage', joints: 'covered', equipment: 'protected', covers: 'available' };
  const ok = A.assessDust({ dust: full, stats: stats(), surface: { looseShare: 0.1, basis: 'x' } });
  assert.equal(ok.result, 'CAUTION');
  assert.equal(ok.exposure, 'moderate');
  const bad = A.assessDust({ dust: { ...full, joints: 'magic' }, stats: stats(), surface: { looseShare: 0, basis: 'x' } });
  assert.equal(bad.result, 'INSUFFICIENT DATA');
});

test('exposure rule thresholds', () => {
  assert.equal(A.exposureLevel({ looseShare: 0.3, stops: 0 }), 'high');
  assert.equal(A.exposureLevel({ looseShare: 0, stops: 5 }), 'high');
  assert.equal(A.exposureLevel({ looseShare: 0, stops: 1 }), 'moderate');
  assert.equal(A.exposureLevel({ looseShare: 0, stops: 0 }), 'low');
});

test('no fabricated numbers: no failure probability, rate, protection % or mass / speed change', () => {
  const r = A.assessDust({ dust: { joints: 'sealed' }, rover: true, stats: stats({ stopCount: 9 }), surface: { looseShare: 0.5, basis: 'x' } });
  assert.deepEqual(r.quantified, { failureProbability: null, degradationRate: null, protectionPercent: null, massChangeKg: 0, speedChange: 0 });
  const txt = JSON.stringify(r.components.map(({ sources, ...c }) => c));   // URLs contain %20
  assert.ok(!/\d+(\.\d+)?\s?%/.test(txt), 'no percentages in the component assessment');
  assert.ok(!/probabilit/i.test(txt.replace(/no failure probability/gi, '')));
  assert.ok(r.warnings.some(w => /insufficient to quantify degradation/.test(w.text)));
});

test('rover interface only applies when a rover is used', () => {
  assert.equal(A.assessDust({}).components.find(c => c.id === 'rover').applicable, false);
  assert.equal(A.assessDust({ rover: true }).components.find(c => c.id === 'rover').applicable, true);
});
