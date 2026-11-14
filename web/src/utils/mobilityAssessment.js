/**
 * Terrain & Mobility Assessment — the walking side of the EVA, independent of dust and payload.
 *
 * Everything here is READ from the planner's existing results; nothing is recomputed:
 *   route        A* on walking time (pathfinder), Tobler slope shape scaled to the active limit set
 *   return       Dijkstra walk-home times → walk-back margin and point of no return (walkback.js)
 *   terrain      slope, steep share, rock relief and rough share (computeDemStats / computeLayerStats),
 *                closed depressions / craters and the rock buffer zone along the route (hazardMap)
 *   pass / fail  the SAME hard checks the mission status uses (missionStatus.evaluateMission)
 *
 * Suit and payload: the only validated suit-level speed adjustment in the project is the
 * Mars-conservative limit set (level speed ÷ 1.65, Norcross et al. TP-2009-214796, suited MKIII);
 * it is applied inside the one walking-time model, so outbound (A*) and return (Dijkstra) times use
 * the same speed. No payload-dependent or dust-dependent speed change is applied: no validated model
 * exists. A "difficulty" label is a display summary by a written rule, never a constraint.
 * Pure module.
 */

import { HAZ } from './hazardMap.js';

export const DIFFICULTY_RULE = {
  status: 'design',
  text: 'DEMANDING if ≥ 20 % of the route is steep (> 75 % of the slope limit) or ≥ 20 % is rough ground or in depressions; '
      + 'MODERATE if any of those occur; EASY otherwise. A display summary only — the hard checks decide GO / NO-GO.',
};

const TERRAIN_CHECKS = ['slope', 'rock', 'budget', 'radial', 'rover'];

/**
 * @param {object} s     route stats (computeDemStats)
 * @param {object} ctx   { evaluation (missionStatus), profileLabel, levelSpeedKmh, slopeLimitDeg, speedSource,
 *                         routeHazards (hazardMap.routeHazards) }
 */
export function assessMobility(s, ctx = {}) {
  if (!s || s.walkTimeS === undefined) {
    return { result: 'NOT CHECKED', headline: 'No route planned — terrain & mobility not assessed.', checks: [], terrain: null };
  }
  const hz = ctx.routeHazards || [];
  const share = (flag) => hz.find(h => h.flag === flag)?.share ?? 0;
  const depressionShare = share(HAZ.DEPRESSION);
  const roughShare = s.layers?.rock?.roughShare ?? share(HAZ.ROUGH);
  const checks = (ctx.evaluation?.hard || []).filter(h => TERRAIN_CHECKS.includes(h.id));
  const failed = checks.filter(c => c.state === 'fail'), unknown = checks.filter(c => c.state === 'unknown');
  const result = failed.length ? 'FAIL' : unknown.length ? 'NOT CHECKED' : checks.length ? 'PASS' : 'NOT CHECKED';
  const demanding = s.steepFrac >= 0.2 || roughShare >= 0.2 || depressionShare >= 0.2;
  const some = s.steepFrac > 0 || roughShare > 0 || depressionShare > 0;
  return {
    result,
    headline: failed.length ? `Terrain / return safety fails: ${failed.map(c => c.label.toLowerCase()).join('; ')}.`
      : unknown.length ? `Not fully checked: ${unknown.map(c => c.label.toLowerCase()).join('; ')}.`
      : 'Route within the slope, rock, radius and walk-back limits.',
    checks,
    terrain: {
      difficulty: demanding ? 'demanding' : some ? 'moderate' : 'easy',
      maxSlopeDeg: s.maxSlopeDeg, steepShare: s.steepFrac, steepDeg: s.steepDeg,
      maxRockReliefM: s.layers?.rock?.maxReliefM ?? null, rockLimitM: s.layers?.rock?.limitM ?? null, roughShare,
      depressionShare, bufferShare: share(HAZ.ROCK_BUFFER),
      noGroundTruthShare: share(HAZ.NO_GROUND_TRUTH),
      craters: depressionShare > 0
        ? `Route crosses closed depressions (≥ 0.5 m deep) on ${(depressionShare * 100).toFixed(0)} % of its points.`
        : 'No closed depression ≥ 0.5 m on the route (smaller craters are below the DTM\'s resolution).',
    },
    walking: { distanceM: s.distance, walkTimeS: s.walkTimeS, roundTripS: s.roundTripS, budgetS: s.budgetS,
      climbM: s.climbM, descentM: s.descentM, maxRadialM: s.maxRadialM },
    returnSafety: { minMarginS: s.minMarginS, ponr: s.ponrIdx >= 0, returnTimeS: s.returnTimeS },
    suit: {
      limitSet: ctx.profileLabel || null, levelSpeedKmh: ctx.levelSpeedKmh ?? null, slopeLimitDeg: ctx.slopeLimitDeg ?? null,
      speedSource: ctx.speedSource || null,
      slopeModel: 'Tobler hiking-function shape (Earth, unsuited) scaled to the level speed — an assumption.',
      consistency: 'Outbound (A*) and return (Dijkstra) times use the same walking-time model and speed.',
    },
    payloadPenalty: { applied: false,
      reason: 'No validated model of suited walking speed vs carried mass on Mars; payload is checked as a mass limit instead.' },
    dustPenalty: { applied: false, reason: 'No evidence that dust exposure changes walking speed over one EVA; dust is assessed separately.' },
    difficultyRule: DIFFICULTY_RULE.text,
  };
}
