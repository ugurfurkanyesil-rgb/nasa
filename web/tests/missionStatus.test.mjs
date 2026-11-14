/**
 * Mission status (utils/missionStatus.js): missing information never becomes GO.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { evaluateMission, STATUS } = await import('../src/utils/missionStatus.js');
const { spaceWeatherAt } = await import('../src/utils/radiation.js');

const base = () => ({
  checks: { budget: true, carry: true, radial: true, slope: true, daylight: true },
  minMarginS: 3 * 3600, ponrIdx: -1, maxSlopeDeg: 9, maxRadialM: 900,
  carry: { earthEqKg: 43, limitKg: 45 }, light: { homeBySunset: true, shadowFrac: 0 },
  layers: { rock: { maxReliefM: 0.2, limitM: 0.5 } }, radiation: { doseMSv: 0.1, careerFrac: 0.0002 },
});
const clear = { advisory: 'clear', sep: [], near: [], coverage: ['2024-01-01', '2024-01-05'] };
const ctx = (o = {}) => ({ profile: 'mars', spaceWeather: clear, swState: 'live', rockLayer: true, radiationCategory: 'direct', ...o });

test('all hard checks pass, space weather verified clear → GO', () => {
  const e = evaluateMission(base(), ctx());
  assert.equal(e.status, STATUS.GO);
  assert.ok(e.hard.every(h => h.state === 'pass'));
});

test('a failed hard check → NO-GO, even if other information is missing', () => {
  const s = base(); s.checks.slope = false; delete s.checks.daylight;
  const e = evaluateMission(s, ctx({ spaceWeather: null, swState: 'failed' }));
  assert.equal(e.status, STATUS.NOGO);
  assert.match(e.headline, /steeper/i);
});

test('daylight not checkable (no start time) → INSUFFICIENT DATA, never GO', () => {
  const s = base(); delete s.checks.daylight; s.light = null;
  const e = evaluateMission(s, ctx());
  assert.equal(e.status, STATUS.INSUFFICIENT);
  assert.equal(e.hard.find(h => h.id === 'daylight').state, 'unknown');
});

test('no rock-relief layer → rock obstacle check NOT CHECKED → INSUFFICIENT DATA', () => {
  const s = base(); s.layers = null;
  assert.equal(evaluateMission(s, ctx({ rockLayer: false })).status, STATUS.INSUFFICIENT);
});

test('no path home → walk-back check fails (not unknown)', () => {
  const s = base(); s.minMarginS = -Infinity; s.checks.budget = false;
  const e = evaluateMission(s, ctx());
  assert.equal(e.status, STATUS.NOGO);
});

test('space weather unknown (future date / failed lookup / loading) → CONDITIONAL, not GO', () => {
  for (const [sw, st] of [[spaceWeatherAt(null, Date.now()), 'future'], [null, 'failed'], [null, 'loading']]) {
    const e = evaluateMission(base(), ctx({ spaceWeather: sw, swState: st }));
    assert.equal(e.status, STATUS.CONDITIONAL, st);
    assert.ok(e.warnings.some(w => w.id === 'sw'), st);
  }
});

test('SEP near the date → CONDITIONAL with a postpone warning', () => {
  const sw = { advisory: 'postpone', sep: [{ type: 'SEP' }], near: [{ type: 'SEP' }] };
  const e = evaluateMission(base(), ctx({ spaceWeather: sw }));
  assert.equal(e.status, STATUS.CONDITIONAL);
  assert.match(e.warnings[0].text, /postpone/);
});

test('lunar limits: a margin under the Apollo 17 30-min reserve → CONDITIONAL; Mars set already holds the reserve', () => {
  const s = base(); s.minMarginS = 20 * 60;
  assert.equal(evaluateMission(s, ctx({ profile: 'lunar' })).status, STATUS.CONDITIONAL);
  assert.equal(evaluateMission(s, ctx({ profile: 'mars' })).status, STATUS.GO);
});

test('transferred radiation is flagged as context; advisory hazards never change the status', () => {
  const e = evaluateMission(base(), ctx({ radiationCategory: 'transferred',
    routeHazards: [{ flag: 16, label: 'Steep ground', hard: false, share: 0.2 }] }));
  assert.equal(e.status, STATUS.GO);
  assert.ok(e.info.some(i => i.id === 'rad'));
  assert.ok(e.info.some(i => i.id === 'haz16'));
});

test('spaceWeatherAt says WHY there is no data', () => {
  assert.equal(spaceWeatherAt(null, 0).reason, 'no-source');
  const wx = { coverage: ['2024-01-01', '2024-01-10'], events: [] };
  assert.equal(spaceWeatherAt(wx, Date.parse('2025-01-01')).reason, 'not-covered');
  assert.equal(spaceWeatherAt(wx, Date.parse('2024-01-05')).reason, null);
  assert.equal(spaceWeatherAt(wx, Date.parse('2024-01-05')).advisory, 'clear');
});
