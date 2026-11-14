/**
 * Dust Exposure & Equipment Reliability Assessment — qualitative, evidence-linked, separate from
 * payload and from terrain mobility.
 *
 * What it does:
 *   1. Each component (config/dust.js) gets a vulnerability level: its evidence-based base level,
 *      lowered by ONE step if a protective feature the crew states is credited for it, never below
 *      "moderate" (no source quantifies any protection on Mars). A setting left 'unknown' is a data
 *      gap: the base level stands and the gap is reported.
 *   2. Exposure indicators come from data, not assumption: time outside, number of science stops
 *      (regolith handling), and the share of the route over loose fine material where a layer can
 *      tell it (Jezero: THEMIS "dust / fine sand" class + aeolian bedform units). Where no layer can
 *      tell it (Gale), the share is reported as unknown — never as zero.
 *   3. Exposure level (low / moderate / high / unknown) from those indicators by a written design
 *      rule (EXPOSURE_RULE).
 *
 * What it never does: compute a failure probability, a degradation rate, a protection percentage,
 * a mass increase or a walking-speed change. Its result can add CAUTIONS to the mission status;
 * it never turns a plan into NO-GO by itself (missionStatus.js).
 * Pure module.
 */

import { DUST_COMPONENTS, DUST_CONFIG, DEFAULT_DUST, VULNERABILITY_LEVELS as LEVELS, dustSource } from '../config/dust.js';

export const EXPOSURE_RULE = {
  status: 'design',
  text: 'HIGH if ≥ 25 % of the route crosses loose fine material, or ≥ 5 science stops (regolith handling); '
      + 'MODERATE if any loose fine material or any science stop; LOW otherwise; UNKNOWN when no layer can tell '
      + 'loose material and there are no stops. Thresholds are planning choices: no source links an exposure '
      + 'amount to a degradation rate.',
  highLooseShare: 0.25, highStops: 5,
};

const step = (lvl, d) => LEVELS[Math.max(0, Math.min(LEVELS.length - 1, LEVELS.indexOf(lvl) + d))];

/** Vulnerability of one component under a protection configuration. */
export function componentVulnerability(comp, cfg) {
  const c = { ...DEFAULT_DUST, ...(cfg || {}) };
  const keys = Object.keys(comp.protectedBy || {});
  const credited = [], gaps = [], absent = [];
  for (const k of keys) {
    const v = c[k];
    if (!DUST_CONFIG[k]?.options?.[v] || v === 'unknown') gaps.push(DUST_CONFIG[k]?.label || k);
    else if (comp.protectedBy[k].includes(v)) credited.push(`${DUST_CONFIG[k].label}: ${DUST_CONFIG[k].options[v]}`);
    else absent.push(`${DUST_CONFIG[k].label}: ${DUST_CONFIG[k].options[v]}`);
  }
  let level = comp.base;
  if (credited.length) level = step(comp.base, -1);
  if (LEVELS.indexOf(level) < LEVELS.indexOf('moderate') && LEVELS.indexOf(comp.base) >= LEVELS.indexOf('moderate')) level = 'moderate';
  return {
    level, base: comp.base, credited, gaps, absent,
    note: credited.length && level !== comp.base
      ? `Lowered from ${comp.base} by the stated protection (one step at most; effectiveness on Mars not quantified).`
      : credited.length
      ? `Protection stated, level kept at ${level}: protection never lowers a level below moderate (effectiveness on Mars not quantified).`
      : gaps.length ? `Protection not stated (${gaps.join('; ')}) — base level kept.` : 'No credited protection — base level.',
  };
}

/** Exposure level from indicators (EXPOSURE_RULE). looseShare null = unknown. */
export function exposureLevel({ looseShare, stops }) {
  const n = Number.isFinite(stops) ? stops : 0;
  if (looseShare == null && n === 0) return 'unknown';
  if ((looseShare ?? 0) >= EXPOSURE_RULE.highLooseShare || n >= EXPOSURE_RULE.highStops) return 'high';
  if ((looseShare ?? 0) > 0 || n > 0) return 'moderate';
  return 'low';
}

/**
 * @param {object} a
 *   dust        crew protection configuration (DUST_CONFIG keys)
 *   rover       pressurized rover in use (rover-interface component applies)
 *   stats       route stats (roundTripS, stopCount) — optional (no route yet → exposure from config only)
 *   surface     { looseShare: number|null, basis: string } route indicator (siteHazards.routeSurface)
 */
export function assessDust({ dust, rover = false, stats = null, surface = null } = {}) {
  const cfg = { ...DEFAULT_DUST, ...(dust || {}) };
  const invalid = Object.entries(cfg).filter(([k, v]) => DUST_CONFIG[k] && !DUST_CONFIG[k].options[v]).map(([k]) => k);
  const components = DUST_COMPONENTS.map(comp => {
    if (comp.needsRover && !rover) {
      return { id: comp.id, label: comp.label, applicable: false, level: null, note: 'Not applicable — no pressurized rover in this mission.' };
    }
    const v = componentVulnerability(comp, cfg);
    const sources = comp.sources.map(dustSource).filter(Boolean);
    return {
      id: comp.id, label: comp.label, applicable: true, level: v.level, base: v.base, note: v.note,
      credited: v.credited, gaps: v.gaps, mechanism: comp.mechanism, rationale: comp.rationale,
      precautions: comp.precautions, confidence: comp.confidence,
      sources: sources.map(s => ({ id: s.id, title: s.title, applicability: s.applicability, url: s.url })),
      evidence: [...new Set(sources.map(s => s.applicability))],
    };
  });
  const looseShare = surface ? surface.looseShare : null;
  const indicators = {
    timeOutsideS: stats?.roundTripS ?? null,
    stops: stats?.stopCount ?? null,
    looseShare, looseBasis: surface?.basis || 'no route planned',
    atmosphere: 'Dust storms / dust-devil activity for the EVA date: not available in this app (no forecast) — unknown, not "none".',
  };
  const exposure = stats ? exposureLevel({ looseShare, stops: stats.stopCount }) : 'unknown';
  const gaps = [...new Set(components.flatMap(c => c.gaps || []))];
  if (invalid.length) gaps.push(...invalid.map(k => `${DUST_CONFIG[k].label}: invalid value`));
  if (looseShare == null) gaps.push('Loose fine material along the route: no surface-material layer for this site');
  const high = components.filter(c => c.applicable && c.level === 'high');

  // Warnings — cautions for the safety panel; none of them is a hard constraint
  const warnings = [];
  if (high.some(c => c.id === 'bearings' || c.id === 'connectors')) {
    warnings.push({ id: 'dust-interfaces', text: 'Exposed mechanical interfaces / connectors may be vulnerable to regolith intrusion — keep covers closed, inspect seals and check suit leak rate.' });
  }
  if (components.some(c => c.id === 'joints' && c.level === 'high')) {
    warnings.push({ id: 'dust-joints', text: 'Unprotected suit joints may need inspection or maintenance after the EVA.' });
  }
  if (components.some(c => c.id === 'optics' && c.applicable && (c.level === 'high' || (c.gaps || []).length))) {
    warnings.push({ id: 'dust-optics', text: 'Optical surfaces (visor, camera lenses) may need additional protection — no covers stated.' });
  }
  if (exposure === 'high') warnings.push({ id: 'dust-exposure', text: 'High dust exposure on this plan (see indicators) — schedule post-EVA cleaning and inspection.' });
  warnings.push({ id: 'dust-quant', text: 'Dust exposure information is insufficient to quantify degradation — no validated Mars rate exists.' });

  return {
    result: gaps.length ? 'INSUFFICIENT DATA' : 'CAUTION',
    headline: gaps.length
      ? `Dust: ${high.length} component(s) at high vulnerability; ${gaps.length} data gap(s). Degradation cannot be quantified.`
      : `Dust: ${high.length} component(s) at high vulnerability. Precautions apply; degradation cannot be quantified.`,
    config: cfg, components, indicators, exposure, exposureRule: EXPOSURE_RULE.text, gaps, warnings,
    // explicit: what this assessment does NOT produce
    quantified: { failureProbability: null, degradationRate: null, protectionPercent: null, massChangeKg: 0, speedChange: 0 },
  };
}
