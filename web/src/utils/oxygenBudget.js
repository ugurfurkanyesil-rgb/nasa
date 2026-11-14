/**
 * D. Life support — primary O₂ budget along a planned route.
 *
 * Uses only what the planner already produced (pathfinder.computeDemStats): the departure time at
 * every path point (elapsedS, stop dwell included), the walk-back margin at every point (marginS)
 * and the stops. From those, for every point i:
 *
 *   walk-home time  h_i = budgetS − elapsedS_i − marginS_i        (Dijkstra toHome time)
 *   O₂ needed       N_i = rate × (dwell_i + k × (walk_i + h_i))    if the crew turns home at i
 *   O₂ margin       M_i = capacity − N_i
 *
 * k is 1 unless the optional Norcross walking load applies (config/lifeSupport.walkFactor).
 * The first point with M_i < 0 is the O₂ point of no return. A shortfall is a WARNING
 * (status CONDITIONAL), never a hard NO-GO: the capacity is a design-study planning value, not
 * the tank of flight hardware. The secondary (emergency) O₂ is never counted.
 * Pure module.
 */
import { PLSS_ARCHS, WALK_LOADS, LS_SOURCES, SECONDARY_O2, BVAD_MARS_EVA_H, lifeSupportOf, walkFactor, oxygenKg } from '../config/lifeSupport.js';

const H = 3600;

/**
 * @param {object|null} stats  route stats (computeDemStats) or null
 * @param {object} ctx  { mission, profile: 'lunar'|'mars' }
 */
export function assessOxygen(stats, ctx = {}) {
  const ls = lifeSupportOf(ctx.mission);
  const profile = ctx.profile || 'lunar';
  const arch = PLSS_ARCHS[ls.arch];
  const k = walkFactor(ls, profile);
  const base = {
    arch: ls.arch, archLabel: arch.label, walkLoad: ls.walkLoad, walkFactor: k,
    rateKgH: arch.rateKgH, rateRef: arch.rateRef, metabolic: arch.metabolic,
    capacityKg: arch.capacity?.kg ?? null, sizedForH: arch.capacity?.sizedForH ?? null, capacityRef: arch.capacity?.ref ?? null,
    enduranceH: arch.capacity ? arch.capacity.kg / arch.rateKgH : null,   // O₂-limited time at the base rate
    secondary: SECONDARY_O2.ref,
    sources: [...new Set([arch.rateSource, arch.capacity?.source, k !== 1 ? 'norcross' : null].filter(Boolean))].map(id => ({ id, ...LS_SOURCES[id] })),
    warnings: [], info: [],
  };
  base.info.push({ id: 'o2-planning', text: 'O₂ capacity is a design-study planning value, not the tank of a flight suit; no Mars-certified PLSS exists.' });
  base.info.push({ id: 'o2-secondary', text: `Secondary (emergency) O₂ not counted — ${SECONDARY_O2.ref}.` });
  if (ls.walkLoad === 'norcross' && !arch.metabolic) base.info.push({ id: 'o2-load', text: 'Walking load ignored: this pack\'s O₂ flow is set by the hardware, not by the metabolic load.' });
  if (ls.walkLoad === 'norcross' && arch.metabolic && profile === 'mars') base.info.push({ id: 'o2-load', text: 'Walking load ignored: the Mars-conservative limits already slow the walk to keep the lunar metabolic load.' });

  if (!stats || !stats.elapsedS || !stats.marginS || !(stats.elapsedS.length > 0)) {
    return { ...base, result: 'NOT CHECKED', headline: 'Plan a route to compute the O₂ budget.' };
  }
  const n = stats.elapsedS.length, budgetS = stats.budgetS;
  const dwellAtIdx = new Map();
  for (const st of stats.stops || []) if (Number.isInteger(st.idx)) dwellAtIdx.set(st.idx, (dwellAtIdx.get(st.idx) || 0) + (st.dwellS || 0));
  const needKg = new Float64Array(n), usedKg = new Float64Array(n);
  let dwell = 0;
  for (let i = 0; i < n; i++) {
    dwell += dwellAtIdx.get(i) || 0;
    const walk = stats.elapsedS[i] - dwell;
    const home = budgetS - stats.elapsedS[i] - stats.marginS[i];     // Infinity when home is unreachable
    usedKg[i] = oxygenKg(ls, profile, dwell, walk);
    needKg[i] = Number.isFinite(home) ? oxygenKg(ls, profile, dwell, walk + home) : Infinity;
  }
  const last = n - 1;
  const totalKg = Number.isFinite(stats.returnTimeS) ? oxygenKg(ls, profile, dwell, stats.elapsedS[last] - dwell + stats.returnTimeS) : Infinity;
  const roundTripH = stats.roundTripS / H;
  const out = { ...base, usedKg, needKg, totalKg, roundTripH, dwellTotalS: dwell };

  if (roundTripH > BVAD_MARS_EVA_H.value) {
    out.info.push({ id: 'o2-4h', text: `EVA ${roundTripH.toFixed(1)} h is longer than the 4-h Mars EVA BVAD REV2 allows for (two half-day sorties per day).` });
  }
  if (base.sizedForH != null && roundTripH > base.sizedForH) {
    out.info.push({ id: 'o2-sized', text: `EVA ${roundTripH.toFixed(1)} h is longer than the ${base.sizedForH}-h EVA this pack was sized for.` });
  }
  if (base.capacityKg == null) {
    return { ...out, result: 'NO CAPACITY', minMarginKg: null, minMarginIdx: null, o2PonrIdx: -1, remainingKg: null,
      headline: `O₂ used ${fmtKg(totalKg)} at ${arch.rateKgH} kg/h. No sourced capacity for this pack — no O₂ margin.` };
  }
  const cap = base.capacityKg;
  let minM = Infinity, minIdx = 0, ponr = -1;
  for (let i = 0; i < n; i++) {
    const m = cap - needKg[i];
    if (m < minM) { minM = m; minIdx = i; }
    if (ponr < 0 && m < 0) ponr = i;
  }
  const remainingKg = cap - totalKg;
  const short = !(minM >= 0);
  if (short) {
    out.warnings.push({ id: 'o2', level: 'warning', label: 'O₂ planning capacity exceeded',
      text: Number.isFinite(minM)
        ? `The walk home from the tightest point needs ${fmtKg(needKg[minIdx])} of the ${fmtKg(cap)} planning capacity (${arch.short}); shorten the EVA or pick another pack.`
        : 'No path home from part of the route, so the O₂ needed to return cannot be met.' });
  }
  return { ...out, result: short ? 'SHORTFALL' : 'OK', minMarginKg: minM, minMarginIdx: minIdx, o2PonrIdx: ponr, remainingKg,
    headline: short
      ? `O₂ short: tightest return needs ${Number.isFinite(minM) ? fmtKg(needKg[minIdx]) : '∞'} of ${fmtKg(cap)}.`
      : `O₂ ${fmtKg(totalKg)} of ${fmtKg(cap)} used for the whole EVA; ${fmtKg(minM)} margin at the tightest point.` };
}

export function fmtKg(kg) {
  if (!Number.isFinite(kg)) return '∞ kg';
  return kg < 1 ? `${(kg * 1000).toFixed(0)} g` : `${kg.toFixed(2)} kg`;
}

export { WALK_LOADS };
