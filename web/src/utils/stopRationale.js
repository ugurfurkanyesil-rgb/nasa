/**
 * Science stop cards — for every planned stop: why it was chosen, what to do there, which data
 * support it, what the data say at that spot, and what remains uncertain.
 *
 * Nothing is scored here. "Why" is the planner's own record (pathfinder.planScience → stop.contrib:
 * the distinct pieces of evidence this stop is the FIRST of the tour to sample, with the
 * objective's points). Evidence values are read from the loaded layers at the stop's cell.
 *
 * Two qualitative labels follow written rules, not numbers:
 *   terrain risk     'high'      the cell is a planner wall (should not happen — endpoint snapped)
 *                    'elevated'  steep / rough / depression / rock keep-out buffer at the cell
 *                    'low'       none of those; the 1 m DTM limit still applies
 *   data confidence  the weakest provenance category among the layers that carry the stop's
 *                    PRIMARY evidence (all evidence for the survey): measured in situ >
 *                    orbital (CRISM high > medium-confidence pixel) > derived interpretation.
 *
 * Pure module: the site object and helpers are passed in.
 */

import { HAZ, HAZARD_LEGEND } from './hazardMap.js';
import { investigationFor } from '../config/objectives.js';
import { tagLayer, weakestCategory, findRecord, CATEGORIES } from '../config/provenance.js';

const PREFIX = { B: 'Bedrock unit', S: 'Surface unit', U: 'Surface unit on bedrock', C: 'Bedrock contact',
  M: 'CRISM mineral class', X: 'ChemCam standout', T: 'ChemCam target' };

export function tagText(tag) {
  return `${PREFIX[tag[0]] || 'Tag'}: ${tag.slice(2)}`;
}

/**
 * @param {object} st    stop from planScience (idx, x, z, tags, contrib, chem?, target?, label, kind)
 * @param {number} i     0-based order in the tour
 * @param {object} ctx   { objective, site, records (siteProvenance), slope (rise/run array),
 *                         hazardFlags (Uint16Array|null), dwellS, latLon(x,z)→{lat,lon}|null,
 *                         groundView: { dist } | null, slopeLimitDeg, rockLimitM }
 */
export function stopCard(st, i, ctx) {
  const { site, records = [], objective } = ctx;
  const k = st.idx;
  const ll = ctx.latLon ? ctx.latLon(st.x, st.z) : null;
  const contrib = st.contrib || [];
  const primary = contrib.filter(c => c.role === 'primary');
  const context = contrib.filter(c => c.role !== 'primary');
  const evTags = objective?.rules ? (primary.length ? primary : contrib) : contrib;

  // ---- why ----
  let why;
  if (!contrib.length) why = 'Adds no new evidence (kept by the optimiser only as part of the shortest equal-value tour).';
  else if (objective?.rules) {
    why = primary.length
      ? `Primary evidence for "${objective.label}": ${primary.map(c => `${tagText(c.tag)} (${c.points} pts)`).join('; ')} — the first stop of this EVA to sample it.`
      : `Supporting context only: ${context.map(c => `${tagText(c.tag)} (${c.points} pts)`).join('; ')}.`;
  } else {
    why = `First stop to sample: ${contrib.map(c => `${tagText(c.tag)} (${c.points} pts)`).join('; ')} (unit-diversity survey).`;
  }

  // ---- layers / evidence ----
  const layerIds = [...new Set(evTags.map(c => tagLayer(c.tag)))];
  for (const t of st.tags) { const id = tagLayer(t); if (!layerIds.includes(id)) layerIds.push(id); }
  const layers = layerIds.map(id => findRecord(records, id)).filter(Boolean)
    .map(r => ({ id: r.id, name: r.name, category: r.categories[0], subtype: r.subtype || null }));
  const evidence = [];
  const uncertainty = [];
  const g = site.geology;
  if (g) {
    const b = g.bedrockUnits[g.bedrock[k]], s = g.surfaceUnits[g.surface[k]];
    const derived = site.name === 'gale';
    if (b) evidence.push(`${derived ? 'Stratigraphic level (derived)' : 'Bedrock unit (Stack et al. 2020)'}: ${b}`);
    if (s) evidence.push(`${derived ? 'Terrain class (derived from DEM relief)' : 'Surface unit (Stack et al. 2020)'}: ${s}`);
  }
  if (st.kind === 'contact') evidence.push(`Mapped contact: ${st.label.replace(/^Contact: /, '')} (nearest contact cell)`);
  const M = site.layers?.minerals;
  let crismConf = null;
  if (M && M.code[k]) {
    crismConf = M.confidence?.[k] === 2 ? 'high' : M.confidence?.[k] === 1 ? 'medium' : null;
    evidence.push(`CRISM class at the stop: ${M.classes[M.code[k]]}${crismConf ? ` (${crismConf}-confidence pixel)` : ''}`);
  }
  const TI = site.layers?.thermal;
  if (TI && Number.isFinite(TI.values[k])) evidence.push(`THEMIS thermal inertia: ${Math.round(TI.values[k])} J m⁻² K⁻¹ s⁻½`);
  if (st.chem) {
    const rm = site.chemistry?.rmsep?.[st.chem.tag.split(' ')[0]];
    evidence.push(`ChemCam ${st.chem.name} (sol ${st.chem.sol}): ${st.chem.tag}, ${st.chem.diff > 0 ? '+' : ''}${st.chem.diff.toFixed(1)} wt% vs its level's mean${rm ? ` (accuracy ±${rm} wt%)` : ''}`);
  }
  if (st.target) {
    evidence.push(`ChemCam target ${st.target.name}, analysed sol ${st.target.sol}${st.target.anomalies?.length ? ` — standouts: ${st.target.anomalies.join(', ')}` : ''}`);
  }
  if (ctx.groundView) evidence.push(`Rover ground view from ${Math.round(ctx.groundView.dist)} m away`);
  else uncertainty.push('No rover ground view near this stop: the crew has only orbital data of it.');

  // per-layer limitations of the evidence layers (first one each, the most decision-relevant)
  for (const L of layers) {
    const r = findRecord(records, L.id);
    if (r?.limitations?.[0] && !uncertainty.includes(r.limitations[0])) uncertainty.push(r.limitations[0]);
  }
  if (crismConf === 'medium') uncertainty.push('Medium-confidence CRISM pixel: the class assignment is less certain.');
  if (st.chem || st.target) uncertainty.push('Target position reconstructed from rover pose + pointing (~1 m mast offset ignored).');

  // ---- terrain ----
  const slopeDeg = ctx.slope ? Math.atan(ctx.slope[k] || 0) * 180 / Math.PI : null;
  const rockM = site.layers?.rock?.values?.[k];
  const f = ctx.hazardFlags ? ctx.hazardFlags[k] : 0;
  const hazards = HAZARD_LEGEND.filter(e => e.flag !== HAZ.NO_GROUND_TRUTH && (f & e.flag)).map(e => e.label);
  const risk = (f & (HAZ.SLOPE_WALL | HAZ.ROCK_WALL)) ? 'high'
    : (f & (HAZ.STEEP | HAZ.ROUGH | HAZ.DEPRESSION | HAZ.ROCK_BUFFER)) ? 'elevated' : 'low';

  // ---- confidence ----
  const evRecs = [...new Set(evTags.map(c => tagLayer(c.tag)))].map(id => findRecord(records, id)).filter(Boolean);
  const weakest = weakestCategory(evRecs);
  const confidence = {
    category: weakest,
    label: weakest === 'direct' ? 'Measured in situ'
      : weakest === 'orbital' ? (crismConf === 'medium' ? 'Orbital (medium-confidence pixel)' : 'Orbital observation')
      : weakest === 'derived' ? (evRecs.some(r => r.subtype?.startsWith('this project')) ? 'Derived by this project (proxy)' : 'Published interpretation')
      : weakest ? CATEGORIES[weakest].label : 'No evidence layer',
    basis: 'Weakest data category among the layers carrying this stop\'s primary evidence (rule, not a score).',
  };

  return {
    n: i + 1, name: st.label, x: st.x, z: st.z, lat: ll?.lat ?? null, lon: ll?.lon ?? null,
    objective: objective?.label || 'General site survey',
    importance: { primary: primary.map(c => c.tag), context: context.map(c => c.tag),
      points: contrib.reduce((a, c) => a + c.points, 0) },
    why,
    investigate: objective ? investigationFor(objective, contrib.map(c => c.tag)) : [],
    layers, evidence, uncertainty,
    visitS: ctx.dwellS ?? null,
    terrain: { slopeDeg, rockM: Number.isFinite(rockM) ? rockM : null, hazards, risk,
      groundTruth: !(f & HAZ.NO_GROUND_TRUTH) },
    confidence,
  };
}
