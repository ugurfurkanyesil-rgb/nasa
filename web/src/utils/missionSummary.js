/**
 * Mission summary — one object for the panel and the export file. Every number is copied from
 * an existing result (route stats, science plan, mission status); nothing is recomputed, so the
 * summary can never disagree with the route card, the cuff card or the EVA playback.
 * Pure module.
 */

export function missionSummary({ objective, siteName, siteLabel, science, mode, stats, evaluation, routeHazards, radiationRecord, mission, startMs }) {
  if (!stats) return null;
  const major = (routeHazards || []).filter(h => h.share > 0)
    .sort((a, b) => b.share - a.share).slice(0, 4)
    .map(h => ({ label: h.label, share: h.share, hard: h.hard }));
  return {
    objective: objective ? { id: objective.id, label: objective.label } : null,
    site: { id: siteName, label: siteLabel },
    startUtc: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    route: mode,
    stops: stats.stopCount ?? (science?.stops?.length || 0),
    distanceM: stats.distance,
    evaDurationS: stats.roundTripS,
    budgetS: stats.budgetS,
    minReturnMarginS: stats.minMarginS,
    pointOfNoReturn: stats.ponrIdx >= 0,
    maxSlopeDeg: stats.maxSlopeDeg,
    maxRadialM: stats.maxRadialM,
    majorHazards: major,
    radiation: stats.radiation ? {
      doseMSv: stats.radiation.doseMSv, careerFrac: stats.radiation.careerFrac,
      basis: radiationRecord ? `${radiationRecord.name} — ${radiationRecord.categories.join(', ')}` : null,
    } : null,
    mission: mission ? { suit: mission.suit, equipmentKg: mission.equipmentKg, rover: !!mission.rover, limits: mission.limits, obstacleBufferM: mission.obstacleBufferM ?? 0 } : null,
    status: evaluation?.status ?? null,
    statusHeadline: evaluation?.headline ?? null,
  };
}
