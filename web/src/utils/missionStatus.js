/**
 * Mission status — turns the planner's route checks into an explained decision:
 *
 *   NO-GO              a hard constraint fails (the planner's own checks: walk-back margin,
 *                      carry weight, rover reach, radius, slope, daylight, rock obstacles)
 *   INSUFFICIENT DATA  no hard constraint fails, but at least one could not be checked —
 *                      missing information is never counted as a pass
 *   CONDITIONAL        all hard constraints pass, but an environmental WARNING stands
 *                      (space weather unknown or an SEP near the date, thin margin vs the
 *                      Apollo 17 30-minute reserve, primary O₂ above the PLSS planning
 *                      capacity) — go only after the condition is cleared
 *   GO                 all hard constraints pass and no warning stands
 *
 * Hard constraints decide; warnings condition; "info" items are context that never changes
 * the status (shadow, air temperature, dose size). Nothing is recalculated here: every value
 * comes from the route stats the planner produced (pathfinder.computeDemStats), the space-
 * weather lookup (radiation.spaceWeatherAt) and the provenance record of the radiation value.
 *
 * `stats.go` (hard checks only) is kept unchanged for the cuff card and the EVA playback.
 * Pure module.
 */

import { fmtHM, fmtSignedHM } from './format.js';

export const STATUS = { GO: 'GO', CONDITIONAL: 'CONDITIONAL', NOGO: 'NO-GO', INSUFFICIENT: 'INSUFFICIENT DATA' };
export const STATUS_COLOR = { GO: '#44dd66', CONDITIONAL: '#ffb347', 'NO-GO': '#cc3322', 'INSUFFICIENT DATA': '#8899aa' };

// Apollo 17 traverse planning kept a 30-minute life-support reserve on every walk-back.
export const APOLLO_RESERVE_S = { value: 30 * 60, status: 'sourced',
  source: 'NASA MSC (1972), Apollo 17 Traverse Planning Data — 30-minute PLSS consumables reserve' };

const pass = (b) => (b === true ? 'pass' : b === false ? 'fail' : 'unknown');

/**
 * @param {object} s     route stats (computeDemStats) — required
 * @param {object} ctx   {
 *   limits: { slopeDeg, radialKm, budgetH, rockM }   active limit values (for the explanation text)
 *   profile: 'lunar' | 'mars'
 *   spaceWeather: { advisory: 'postpone'|'clear'|'no-data', reason?, sep:[], near:[] } | null
 *   swState: 'bundled'|'live'|'loading'|'failed'|'future'|'none'
 *   radiationCategory: 'direct' | 'transferred'           provenance of the dose rate
 *   rockLayer: boolean                                    rock-relief layer loaded
 *   routeHazards: [{ flag, label, hard, share }]           hazardMap.routeHazards
 *   dust: dustAssessment result (warnings → cautions, never status-changing)
 *   oxygen: oxygenBudget.assessOxygen result (shortfall → warning; notes → info)
 * }
 */
export function evaluateMission(s, ctx = {}) {
  if (!s) return { status: STATUS.INSUFFICIENT, headline: 'No route planned.', hard: [], warnings: [], info: [] };
  const L = ctx.limits || {};
  const c = s.checks || {};
  const hard = [];
  const add = (id, label, state, value, why) => hard.push({ id, label, state, value, why });

  // No path home is a FAIL, not "unknown": the planner looked and found none.
  add('budget', 'Walk-back margin ≥ 0 everywhere', pass(Number.isFinite(s.minMarginS) ? c.budget : false),
    Number.isFinite(s.minMarginS) ? `min margin ${fmtSignedHM(s.minMarginS)}` : 'no path home',
    s.ponrIdx >= 0 ? 'A point of no return lies on the route: past it the crew cannot get home inside the EVA budget.'
      : Number.isFinite(s.minMarginS) ? 'At every point the fastest walk home fits in the remaining budget.' : 'The planner found no walkable path home.');
  add('slope', `No cell steeper than ${L.slopeDeg ?? 20}°`, pass(c.slope), `max ${s.maxSlopeDeg?.toFixed(1)}°`,
    c.slope ? 'Steepest route cell is within the walkable slope limit (NASA xEVA ConOps, lunar value).' : 'The route crosses ground steeper than the walkable limit.');
  const rockState = !ctx.rockLayer ? 'unknown' : !s.layers?.rock ? 'unknown' : pass(s.layers.rock.maxReliefM <= s.layers.rock.limitM);
  add('rock', `No rock obstacle above ${s.layers?.rock?.limitM ?? L.rockM ?? 0.5} m`, rockState,
    s.layers?.rock ? `largest relief ${s.layers.rock.maxReliefM.toFixed(2)} m` : 'no rock layer',
    rockState === 'unknown' ? 'No rock-relief layer: boulders cannot be checked, so the route is not cleared.'
      : rockState === 'pass' ? 'Route avoids every cell the 1 m DTM shows as a boulder / outcrop (smaller rocks are not resolved).'
      : 'The route touches a rock-relief wall cell (endpoint inside an obstacle).');
  add('radial', `Within ${L.radialKm ?? 2} km of the start`, pass(c.radial), `max ${(s.maxRadialM / 1000).toFixed(2)} km`,
    c.radial ? 'Never farther from the habitat than the radius limit.' : 'Goes beyond the radius limit.');
  add('carry', 'Carried weight within the limit', pass(c.carry),
    Number.isFinite(s.carry?.earthEqKg) ? `${s.carry.earthEqKg.toFixed(1)} / ${s.carry.limitKg} kg Earth-eq.` : 'invalid payload input',
    c.carry === true ? 'Suit + equipment weight on Mars is within what a crew member can carry (Ogilvie et al. 2026).'
      : c.carry === false ? 'Suit + equipment is too heavy to walk with (Payload & Mass).'
      : 'A payload value is missing or invalid, so the carried weight could not be checked (Payload & Mass).');
  if ('rover' in c) {
    add('rover', 'Never more than a 30-min walk from the rover', pass(c.rover), s.rover ? `farthest ${fmtHM(s.rover.maxReturnS)}` : '—',
      c.rover ? 'The pressurized rover stays within walk-back reach.' : 'The crew would be out of the rover\'s 30-minute reach.');
  }
  const dayKnown = 'daylight' in c;
  add('daylight', 'Start after sunrise, home before sunset', pass(dayKnown ? c.daylight : null),
    !s.light ? 'no EVA start time' : s.light.homeBySunset === null ? 'no sunrise / sunset' : c.daylight ? 'home before sunset' : 'not completed in daylight',
    !dayKnown ? 'The daylight rule could not be checked (no start time or no sunrise / sunset), so it is not counted as a pass.'
      : c.daylight ? 'Every Apollo surface EVA was flown in sunlight (design rule).' : 'The EVA starts before sunrise or ends after sunset.');

  const warnings = [], info = [];
  // Space weather — environmental WARNING; unknown is not "clear"
  const sw = ctx.spaceWeather;
  if (ctx.swState === 'loading') {
    warnings.push({ id: 'sw', level: 'warning', label: 'Space weather: lookup in progress', text: 'Waiting for DONKI; until then the date is not cleared.' });
  } else if (!sw || sw.advisory === 'no-data') {
    const why = ctx.swState === 'future' ? 'the date is in the future and DONKI has no forecast'
      : ctx.swState === 'failed' ? 'the DONKI lookup failed (offline or rate-limited)'
      : 'no DONKI data covers this date';
    warnings.push({ id: 'sw', level: 'warning', label: 'Space weather: UNKNOWN', text: `Not verified — ${why}. Unknown is not zero risk: check solar particle events before the EVA.` });
  } else if (sw.advisory === 'postpone') {
    warnings.push({ id: 'sw', level: 'warning', label: 'Solar particle event near the date', text: `${sw.sep.length} SEP event(s) within ±2 days (DONKI, detected near Earth): postpone advisory.` });
  } else {
    info.push({ id: 'sw', level: 'info', label: 'No SEP within ±2 days (DONKI)', text: 'Catalogued events only — this is not a forecast.' });
  }
  // Margin vs Apollo 17 reserve (only the lunar set: the Mars set already removed the reserve)
  if ((ctx.profile || 'lunar') === 'lunar' && Number.isFinite(s.minMarginS) && s.minMarginS >= 0 && s.minMarginS < APOLLO_RESERVE_S.value) {
    warnings.push({ id: 'reserve', level: 'warning', label: 'Margin below the 30-min reserve',
      text: `Tightest walk-back margin ${fmtHM(s.minMarginS)} is under the Apollo 17 30-minute life-support reserve.` });
  }
  if ((ctx.profile || 'lunar') === 'lunar') {
    info.push({ id: 'limits', level: 'caution', label: 'Lunar EVA limits', text: 'NASA\'s lunar values are optimistic for Mars gravity (Norcross et al. 2009); try the Mars-conservative set.' });
  }
  if (ctx.radiationCategory === 'transferred') {
    info.push({ id: 'rad', level: 'caution', label: 'Dose is a transferred reference', text: 'RAD measured at Gale, not here; the local dose is likely somewhat higher.' });
  }
  if (s.radiation) info.push({ id: 'dose', level: 'info', label: `GCR dose ${s.radiation.doseMSv.toFixed(2)} mSv`, text: `${(s.radiation.careerFrac * 100).toFixed(3)} % of the 600 mSv career limit (galactic cosmic rays only).` });
  if (s.light?.shadowFrac > 0.05) info.push({ id: 'shadow', level: 'caution', label: `Terrain shadow ${(s.light.shadowFrac * 100).toFixed(0)} % of the walk`, text: 'Walking in shadow: colder, harder to see the ground.' });
  // Dust (utils/dustAssessment.js): CAUTIONS only — dust never turns a plan NO-GO or CONDITIONAL by itself
  for (const w of ctx.dust?.warnings || []) info.push({ id: w.id, level: 'caution', label: 'Dust', text: w.text });
  // Life support (utils/oxygenBudget.js): an O₂ shortfall vs a design-study planning capacity is a
  // WARNING (CONDITIONAL), not a hard fail — the capacity is not the tank of flight hardware.
  for (const w of ctx.oxygen?.warnings || []) warnings.push(w);
  for (const w of ctx.oxygen?.info || []) if (w.id === 'o2-4h' || w.id === 'o2-sized') info.push({ id: w.id, level: 'caution', label: 'Life support', text: w.text });
  for (const h of ctx.routeHazards || []) {
    if (h.hard || h.share < 0.005) continue;
    info.push({ id: 'haz' + h.flag, level: 'caution', label: `${h.label}: ${(h.share * 100).toFixed(0)} % of the route`, text: 'From the hazard map (advisory, not a wall).' });
  }

  const failed = hard.filter(h => h.state === 'fail'), unknown = hard.filter(h => h.state === 'unknown');
  const status = failed.length ? STATUS.NOGO : unknown.length ? STATUS.INSUFFICIENT
    : warnings.length ? STATUS.CONDITIONAL : STATUS.GO;
  const headline = failed.length ? `NO-GO: ${failed.map(f => f.label.toLowerCase()).join('; ')} failed.`
    : unknown.length ? `INSUFFICIENT DATA: could not check ${unknown.map(f => f.label.toLowerCase()).join('; ')}.`
    : warnings.length ? `CONDITIONAL: all hard constraints pass; clear first — ${warnings.map(w => w.label.toLowerCase()).join('; ')}.`
    : 'GO: all hard constraints pass and no warning stands.';
  return { status, headline, hard, warnings, info };
}
