/**
 * Payload & Mass Assessment (utils/payloadAssessment.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
const P = await import('../src/utils/payloadAssessment.js');
const M = await import('../src/config/mission.js');

const G = M.MARS_G / M.EARTH_G;

test('total mass = suit + every declared category, once', () => {
  const a = P.assessPayload({ suit: 'mars', equipmentKg: 4, payload: { instruments: 2, comms: 1, sampling: 3, emergency: 0.5 } });
  assert.equal(a.status, 'ok');
  assert.equal(a.equipmentKg, 10.5);
  assert.equal(a.massKg, 104 + 10.5);
  assert.ok(Math.abs(a.earthEqKg - 114.5 * G) < 1e-9);
});

test('no double counting: suit components are listed as included, not added; equipmentKg is the "other" category', () => {
  const a = P.assessPayload({ suit: 'mars', equipmentKg: 0 });
  const inSuit = a.components.reduce((s, c) => s + c.kg, 0);
  assert.equal(inSuit, 104, 'PGS 42 + PLSS 62 = the suit mass itself');
  assert.equal(a.massKg, 104, 'components not added on top of the suit mass');
  assert.equal(a.items.filter(i => i.id === 'other').length, 1);
  const b = P.assessPayload({ suit: 'mars', equipmentKg: 5, payload: { other: 99 } });
  assert.equal(b.equipmentKg, 5, 'payload.other is ignored; equipmentKg is the one field');
});

test('limit unchanged: 45 kg Earth-equivalent; exactly at / just over the limit', () => {
  const a = P.assessPayload({ suit: 'mars', equipmentKg: 0 });
  assert.equal(a.limitKg, 45);
  const max = a.maxEquipmentKg;
  assert.ok(P.assessPayload({ suit: 'mars', equipmentKg: max - 1e-6 }).ok);
  const over = P.assessPayload({ suit: 'mars', equipmentKg: max / 2, payload: { sampling: max / 2 + 0.5 } });
  assert.equal(over.ok, false);
  assert.equal(over.status, 'over');
  assert.ok(over.remainingKg < 0);
  assert.equal(P.assessPayload({ suit: 'xemu', equipmentKg: 0 }).ok, false, 'xEMU alone is too heavy on Mars');
});

test('missing category = not carried (0); invalid values are reported, never treated as zero', () => {
  assert.equal(P.assessPayload({ suit: 'mars' }).equipmentKg, 0);
  for (const bad of [-1, NaN, Infinity, '5', null]) {
    const a = P.assessPayload({ suit: 'mars', equipmentKg: 1, payload: { instruments: bad } });
    assert.equal(a.status, 'invalid', String(bad));
    assert.equal(a.ok, null);
    assert.equal(a.massKg, null);
    assert.ok(a.errors.length === 1);
  }
  const s = P.assessPayload({ suit: 'apollo' });
  assert.equal(s.status, 'invalid');
  assert.match(s.errors[0], /Unknown suit/);
});

test('carryCheck (used by the planner) is the same calculation: invalid → ok null, not true', () => {
  const m = { suit: 'mars', equipmentKg: 3, payload: { sampling: 2 } };
  const c = M.carryCheck(m), a = P.assessPayload(m);
  assert.equal(c.earthEqKg, a.earthEqKg);
  assert.equal(c.ok, a.ok);
  assert.equal(M.carryCheck({ suit: 'mars', payload: { comms: -2 } }).ok, null);
});

test('Ogilvie et al. Eq. 7 reproduces the paper\'s 104 kg (229 lbm) reference suit mass', () => {
  const r = P.ogilvieEq7();
  assert.ok(Math.abs(r.maxSuitKg - 104) < 0.5, r.maxSuitKg.toFixed(2));
  // the project's 45 kg rule is the stricter one for the paper's reference crew
  assert.ok(P.assessPayload({ suit: 'mars' }).limitMassKg < r.suitPlusCarryKg);
});
