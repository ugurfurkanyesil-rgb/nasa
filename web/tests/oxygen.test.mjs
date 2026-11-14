/**
 * D. Life support — primary O₂ budget (config/lifeSupport.js + utils/oxygenBudget.js).
 * Values must match their sources; O₂ follows the planner's own timeline; a shortfall is a
 * warning (CONDITIONAL), never a NO-GO; the walking-load assumption is off by default.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
const LS = await import('../src/config/lifeSupport.js');
const { assessOxygen } = await import('../src/utils/oxygenBudget.js');
const { evaluateMission, STATUS } = await import('../src/utils/missionStatus.js');
const { encodePlan, decodePlan } = await import('../src/utils/shareLink.js');
const { DEFAULT_MISSION } = await import('../src/config/mission.js');

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('architecture values match their sources and every value carries a source', () => {
  const A = LS.PLSS_ARCHS;
  close(A['bvad-swingbed'].rateKgH, 0.15);
  close(A['bvad-swingbed'].capacity.kg, A['bvad-swingbed'].rateKgH * A['bvad-swingbed'].capacity.sizedForH);   // 0.6 kg / 4 h
  close(A['bvad-closed'].rateKgH, 0.076);
  close(A['bvad-closed'].capacity.kg, 0.3);
  close(A['ices-cryo'].rateKgH, 1.089, 5e-4);          // 2.4 lb/h
  close(A['ices-cryo'].capacity.kg, 8.6);
  close(A['ices-openloop'].rateKgH, 0.998, 5e-4);      // 2.2 lb/h
  assert.equal(A['ices-openloop'].capacity, null, 'no stored-O₂ mass in the source → none invented');
  for (const [id, a] of Object.entries(A)) {
    assert.ok(LS.LS_SOURCES[a.rateSource]?.url, `${id} rate source`);
    assert.ok(a.rateRef.length > 20, `${id} rate reference`);
    if (a.capacity) assert.ok(LS.LS_SOURCES[a.capacity.source]?.url, `${id} capacity source`);
  }
  assert.deepEqual(DEFAULT_MISSION.lifeSupport, LS.DEFAULT_LIFE_SUPPORT);
  assert.equal(LS.DEFAULT_LIFE_SUPPORT.walkLoad, 'baseline', 'assumption off by default');
});

// Hand-built route stats: walk 30 min out, 10-min stop at point 1, walk 30 min back (8-h budget)
const stats = (scale = 1) => {
  const budgetS = 8 * 3600;
  const elapsedS = Float64Array.from([0, 2400 * scale, 4200 * scale]);
  const home = [0, 1800 * scale, 0];
  return { budgetS, elapsedS, marginS: Float64Array.from(elapsedS.map((e, i) => budgetS - e - home[i])),
    stops: [{ idx: 1, dwellS: 600 * scale }], returnTimeS: 0, roundTripS: 4200 * scale };
};
const m = (arch, walkLoad = 'baseline') => ({ ...DEFAULT_MISSION, lifeSupport: { arch, walkLoad } });

test('no route → NOT CHECKED', () => {
  assert.equal(assessOxygen(null, { mission: DEFAULT_MISSION }).result, 'NOT CHECKED');
});

test('O₂ = rate × time on the planner timeline (swing-bed default)', () => {
  const o = assessOxygen(stats(), { mission: DEFAULT_MISSION, profile: 'lunar' });
  assert.equal(o.result, 'OK');
  close(o.totalKg, 0.15 * 4200 / 3600);
  close(o.needKg[1], 0.15 * (2400 + 1800) / 3600);    // turn home at the stop
  close(o.minMarginKg, 0.6 - o.needKg[1]);
  assert.equal(o.o2PonrIdx, -1);
  assert.equal(o.warnings.length, 0);
});

test('Norcross walking load scales walking only, only with lunar limits, only for metabolic packs', () => {
  const lunar = assessOxygen(stats(), { mission: m('bvad-swingbed', 'norcross'), profile: 'lunar' });
  close(lunar.totalKg, 0.15 / 3600 * (600 + (27.6 / 16.7) * 3600));
  const mars = assessOxygen(stats(), { mission: m('bvad-swingbed', 'norcross'), profile: 'mars' });
  close(mars.totalKg, 0.15 * 4200 / 3600);
  assert.ok(mars.info.some(i => i.id === 'o2-load'));
  const cryo = assessOxygen(stats(), { mission: m('ices-cryo', 'norcross'), profile: 'lunar' });
  assert.equal(cryo.walkFactor, 1);
});

test('open-loop pack: no sourced capacity → O₂ used shown, no margin', () => {
  const o = assessOxygen(stats(), { mission: m('ices-openloop') });
  assert.equal(o.result, 'NO CAPACITY');
  assert.equal(o.minMarginKg, null);
  assert.ok(o.totalKg > 0);
});

test('EVA longer than the pack can supply → SHORTFALL warning, O₂ point of no return, 4-h BVAD note', () => {
  const o = assessOxygen(stats(5), { mission: DEFAULT_MISSION, profile: 'lunar' });   // 5.8 h EVA, 0.6 kg capacity
  assert.equal(o.result, 'SHORTFALL');
  assert.ok(o.o2PonrIdx >= 0);
  assert.ok(o.warnings.some(w => w.id === 'o2'));
  assert.ok(o.info.some(w => w.id === 'o2-4h'));
});

test('an O₂ shortfall makes an otherwise GO plan CONDITIONAL, never NO-GO', () => {
  const s = { checks: { budget: true, carry: true, radial: true, slope: true, daylight: true },
    minMarginS: 3 * 3600, ponrIdx: -1, maxSlopeDeg: 9, maxRadialM: 900, carry: { earthEqKg: 43, limitKg: 45 },
    light: { homeBySunset: true, shadowFrac: 0 }, layers: { rock: { maxReliefM: 0.2, limitM: 0.5 } }, radiation: { doseMSv: 0.1, careerFrac: 0.0002 } };
  const ctx = { profile: 'mars', spaceWeather: { advisory: 'clear', sep: [], near: [] }, swState: 'live', rockLayer: true, radiationCategory: 'direct' };
  assert.equal(evaluateMission(s, ctx).status, STATUS.GO);
  const short = assessOxygen(stats(5), { mission: DEFAULT_MISSION, profile: 'mars' });
  const e = evaluateMission(s, { ...ctx, oxygen: short });
  assert.equal(e.status, STATUS.CONDITIONAL);
  assert.ok(e.hard.every(h => h.state === 'pass'));
  const ok = assessOxygen(stats(), { mission: DEFAULT_MISSION, profile: 'mars' });
  assert.equal(evaluateMission(s, { ...ctx, oxygen: ok }).status, STATUS.GO);
});

test('life-support choice survives the share link; default is not encoded', () => {
  const p = decodePlan(`?plan=${encodePlan({ waypoints: [{ x: 0, z: 0 }], mission: m('ices-cryo', 'norcross') })}`);
  assert.deepEqual(p.mission.lifeSupport, { arch: 'ices-cryo', walkLoad: 'norcross' });
  const d = decodePlan(`?plan=${encodePlan({ waypoints: [{ x: 0, z: 0 }], mission: DEFAULT_MISSION })}`);
  assert.equal(d.mission.lifeSupport, undefined);
  assert.equal(LS.lifeSupportOf({ lifeSupport: { arch: 'bogus', walkLoad: 'x' } }).arch, 'bvad-swingbed');
});
