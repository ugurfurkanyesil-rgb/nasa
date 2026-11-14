/**
 * Mission objectives — what the science EVA is FOR. The crew picks one before the planner runs;
 * the choice changes which candidate stops enter the exact optimiser (utils/science.js) and how
 * each distinct piece of evidence is scored.
 *
 * How an objective acts on the planner (pathfinder.planScience → science.planScienceEva):
 *   rules       [[glob, points, role], …] — the first matching glob scores a tag. Tags:
 *                 B:<bedrock unit>  S:<surface unit>  U:<surface unit> | <bedrock unit>
 *                 C:<unit a> | <unit b> (bedrock contact)  M:<CRISM class>
 *                 X:<oxide high|low> (ChemCam standout)  T:<ChemCam target name>
 *               role 'primary' = the evidence the objective is about; 'context' = supporting.
 *               A tag no rule matches scores 0 — it can never pull a stop into the plan.
 *   options     candidate-generation switches (composite U: tags, how many ChemCam candidates).
 *
 * Every point value is a DESIGN CHOICE (status 'design'), not a measured science value: primary
 * evidence 5, supporting 1–3. No sourced scale of "science value" exists for EVA stops. What the
 * points do is only rank evidence the data actually contain; they never create evidence.
 *
 * Every objective also states its data support honestly: availability() counts, in the loaded
 * site, the cells / targets that carry the objective's primary evidence. 'unsupported' disables
 * planning for that objective (the reason is shown); 'partial' plans but says what is missing.
 *
 * Pure module (no DOM): used by the planner worker, the UI and the Node tests.
 */

import { globMatch } from '../utils/science.js';

export const OBJECTIVE_STATUS = 'design';
export const OBJECTIVE_POINTS_NOTE = 'Points per distinct piece of evidence are a planning choice (primary 5, supporting 1–3), not a measured science value.';

// CRISM classes of the Parente et al. (2021) Jezero product that indicate water–rock interaction
// (clays, carbonates and their mixtures). Only the ones that occur in the loaded site count.
const AQUEOUS_CRISM = ['Olivine + smectite', 'Fe/Mg-smectite', 'Mg-carbonate', 'Olivine/smectite + 2.2 µm',
  'Carbonate + 2.2 µm', 'Kaolinite', 'Mg-smectite 2'];

const BOXWORK = 'Boxwork-bearing layer';
const RIDGE = 'Ridge or butte crest', HOLLOW = 'Hollow or trough';

const NASA_BOXWORK_2025 = { title: 'NASA\'s Curiosity Mars Rover Starts Unpacking Boxwork Formations (JPL news, 23 Jun 2025)',
  url: 'https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-starts-unpacking-boxwork-formations/' };
const NASA_BOXWORK_2026 = { title: 'NASA\'s Curiosity Rover Sees Martian \'Spiderwebs\' Up Close (JPL news, 2026)',
  url: 'https://www.jpl.nasa.gov/news/nasas-curiosity-rover-sees-martian-spiderwebs-up-close/' };
const KODIAK = { title: 'Perseverance View of the Delta in Jezero Crater (PIA24485, NASA 2021): delta remnant ~2.3 km west of the landing site',
  url: 'https://science.nasa.gov/resource/perseverance-view-of-the-delta-in-jezero-crater/' };
const STACK = { title: 'Stack et al. (2020), Photogeologic map of the Perseverance rover field site, Space Sci. Rev. 216, 127',
  url: 'https://doi.org/10.1007/s11214-020-00739-x' };
const PARENTE = { title: 'Parente et al. (2021), Map of the dominant mineralogy over and around the Mars2020 landing ellipse (Zenodo)',
  url: 'https://doi.org/10.5281/zenodo.5575824' };

/**
 * Objective definitions. `investigate`: [[glob, what the crew should do there], …] — first match.
 * `layers`: provenance ids (config/provenance.js) the objective relies on.
 */
export const OBJECTIVES = [
  // ───────────────────────── Jezero ─────────────────────────
  {
    id: 'jezero-lake-delta', site: 'jezero', short: 'LAKE & DELTA',
    label: 'Ancient Lake and Delta Investigation',
    purpose: 'Look for traces of the lake that once filled Jezero: rocks on the former lake floor that interacted with water.',
    relevance: 'Jezero was chosen for Mars 2020 because a river built a delta into a crater lake; water-altered minerals there can preserve a record of habitability.',
    layers: ['minerals', 'geology', 'ortho', 'pov'],
    candidates: 'Cells of CRISM classes that indicate water–rock interaction (clay / carbonate classes) that occur inside the site.',
    criteria: [
      'Primary: each distinct aqueous-alteration CRISM class present in the site (5 points).',
      'Context: bedrock contacts of the crater-floor units (1 point) — where layering relationships can be read.',
      'Inside a 3 × 3-cell block of the same CRISM class (12 m), reachable within the EVA limits.',
    ],
    uncertainties: [
      'The delta itself is NOT inside this 2 km site: its nearest remnant (Kodiak) lies about 2.3 km west of the landing site, and no delta or lake-deposit unit of the Stack et al. (2020) map occurs in the site grid.',
      'Within the site the only water-related evidence is orbital (CRISM, 36 m/px source pixels); a 4 m stop inside a 36 m pixel is not guaranteed to sit on the altered rock.',
      'Rover work after the landing interpreted the crater-floor units as igneous rocks that were later altered by water — not as lake sediments. This objective can test alteration, not lake deposits.',
    ],
    refs: [KODIAK, STACK, PARENTE, { title: 'Farley et al. (2022), Aqueously altered igneous rocks sampled on the floor of Jezero crater, Mars, Science 377',
      url: 'https://doi.org/10.1126/science.abo2196' }],
    rules: [
      ...AQUEOUS_CRISM.map(c => ['M:' + c, 5, 'primary']),
      ['C:*', 1, 'context'],
    ],
    investigate: [
      ['M:*smectite*', 'Look for clay-bearing (altered) rock: colour and texture change, fine-grained alteration rinds; sample fresh and altered faces of the same rock.'],
      ['M:*carbonate*', 'Carbonate signature: look for light-toned, layered or cemented material; sample for possible lake-related precipitates.'],
      ['C:*', 'Document the contact: which unit lies on top, is the boundary sharp or gradual, any alteration along it.'],
    ],
    support: (s) => {
      const present = crismPresent(s, AQUEOUS_CRISM);
      return { primary: present.reduce((a, p) => a + p.cells, 0), detail: present.map(p => `${p.name}: ${p.cells} cells`),
        partial: 'The delta and lake deposits lie outside this site; only orbital alteration evidence is available here.' };
    },
  },
  {
    id: 'jezero-mineral-diversity', site: 'jezero', short: 'MINERAL DIVERSITY',
    label: 'Mineralogical Diversity Exploration',
    purpose: 'Sample as many different minerals detected from orbit as one EVA allows.',
    relevance: 'Each CRISM class is a different rock or alteration product; sampling all of them gives the widest picture of the crater floor\'s history in one traverse.',
    layers: ['minerals', 'geology', 'thermal'],
    candidates: 'One candidate per CRISM class in the site (the nearest 12 m block of it), plus unit and contact candidates.',
    criteria: [
      'Primary: each distinct CRISM mineral class (5 points).',
      'Context: each distinct bedrock unit (1 point).',
    ],
    uncertainties: [
      'CRISM class names are the closest library match of each spectral prototype (dataset README); medium-confidence pixels are kept and flagged.',
      'Source pixels are 36 m; the 4 m grid only resamples them.',
    ],
    refs: [PARENTE],
    rules: [['M:*', 5, 'primary'], ['B:*', 1, 'context']],
    investigate: [
      ['M:Olivine', 'Olivine-bearing rock: look for green-brown grains; sample a fresh surface and note any weathering rind.'],
      ['M:*pyroxene*', 'Pyroxene-bearing rock: record grain size and texture (lava or cumulate?); sample.'],
      ['M:*smectite*', 'Clay-bearing (altered) rock: sample altered and unaltered parts.'],
      ['M:*', 'Sample the rock carrying this orbital mineral signature and photograph its context.'],
    ],
    support: (s) => {
      const present = crismPresent(s, null);
      return { primary: present.length ? present.reduce((a, p) => a + p.cells, 0) : 0, detail: present.map(p => `${p.name}: ${p.cells} cells`) };
    },
  },
  {
    id: 'jezero-bedrock-contacts', site: 'jezero', short: 'BEDROCK & CONTACTS',
    label: 'Bedrock and Geological Contact Analysis',
    purpose: 'Visit each mapped bedrock unit and the contacts between them to read their order and relationship.',
    relevance: 'Contacts record which unit formed first; field geology on Earth and Apollo traverses were planned around them.',
    layers: ['geology', 'ortho', 'pov'],
    candidates: 'The nearest interior point of each bedrock unit and the nearest cell of each bedrock contact.',
    criteria: [
      'Primary: each distinct bedrock contact (5 points) and bedrock unit (3 points).',
      'Context: each CRISM class (1 point).',
    ],
    uncertainties: [
      'Units are a photogeologic interpretation of orbital images (Stack et al. 2020), mapped at HiRISE scale; contacts may be covered by sand or regolith on the ground.',
      'Surface-cover units (aeolian bedforms, cover) are not bedrock and score nothing here.',
    ],
    refs: [STACK],
    rules: [['C:*', 5, 'primary'], ['B:*', 3, 'primary'], ['M:*', 1, 'context']],
    investigate: [
      ['C:*', 'Find the contact on the ground: which unit is on top, sharp or gradual boundary, dip; sample both sides.'],
      ['B:*', 'Sample representative bedrock of this unit away from loose cover; record texture and fractures.'],
    ],
    support: (s) => {
      const u = (s.geology?.bedrockUnits || []).filter(Boolean);
      return { primary: u.length, detail: u.map(x => `bedrock unit: ${x}`) };
    },
  },
  {
    id: 'jezero-olivine-pyroxene', site: 'jezero', short: 'OLIVINE & PYROXENE',
    label: 'Olivine and Pyroxene Investigation',
    purpose: 'Sample the olivine- and pyroxene-bearing rocks detected from orbit.',
    relevance: 'Olivine and pyroxene are primary igneous minerals: they tell how the crater-floor rocks formed and are the starting point of any later water alteration.',
    layers: ['minerals', 'geology'],
    candidates: 'Blocks of the CRISM olivine and pyroxene classes inside the site.',
    criteria: [
      'Primary: CRISM Olivine, High-Ca pyroxene, Low-Ca pyroxene (5 points each, if present).',
      'Context: Olivine + smectite (altered olivine, 1 point); bedrock units (1 point).',
    ],
    uncertainties: [
      'Class names are closest spectral matches; an olivine class may mix with other phases at 36 m/px.',
    ],
    refs: [PARENTE],
    rules: [['M:Olivine', 5, 'primary'], ['M:High-Ca pyroxene', 5, 'primary'], ['M:Low-Ca pyroxene', 5, 'primary'],
      ['M:Olivine + smectite', 1, 'context'], ['B:*', 1, 'context']],
    investigate: [
      ['M:Olivine', 'Olivine-bearing rock: grain size, abundance, any alteration rind; sample fresh rock.'],
      ['M:*pyroxene*', 'Pyroxene-bearing rock: texture (fine lava vs coarse cumulate); sample.'],
    ],
    support: (s) => {
      const present = crismPresent(s, ['Olivine', 'High-Ca pyroxene', 'Low-Ca pyroxene']);
      return { primary: present.reduce((a, p) => a + p.cells, 0), detail: present.map(p => `${p.name}: ${p.cells} cells`) };
    },
  },
  {
    id: 'jezero-olivine-smectite', site: 'jezero', short: 'OLIVINE–SMECTITE',
    label: 'Olivine-Smectite Alteration Analysis',
    purpose: 'Compare olivine that was altered to clay (smectite) with unaltered olivine nearby.',
    relevance: 'Olivine turning into smectite needs liquid water; the pair "altered vs fresh" brackets how much water acted on the rock.',
    layers: ['minerals', 'geology'],
    candidates: 'Blocks of the CRISM "Olivine + smectite" class, with plain "Olivine" as the unaltered reference.',
    criteria: [
      'Primary: Olivine + smectite and other olivine/smectite mixtures (5 points).',
      'Context: unaltered Olivine as the comparison sample (3 points); bedrock contacts (1 point).',
    ],
    uncertainties: [
      'CRISM cannot say whether the clay formed in place or was transported; only ground sampling can.',
      'A 36 m CRISM pixel can mix altered and unaltered rock.',
    ],
    refs: [PARENTE],
    rules: [['M:Olivine + smectite', 5, 'primary'], ['M:Olivine/smectite + 2.2 µm', 5, 'primary'], ['M:Fe/Mg-smectite', 5, 'primary'],
      ['M:Olivine', 3, 'context'], ['C:*', 1, 'context']],
    investigate: [
      ['M:*smectite*', 'Altered olivine: look for clay coatings, softer texture, colour change; sample altered and fresh faces.'],
      ['M:Olivine', 'Unaltered reference: sample fresh olivine-bearing rock for comparison with the altered stop.'],
    ],
    support: (s) => {
      const present = crismPresent(s, ['Olivine + smectite', 'Olivine/smectite + 2.2 µm', 'Fe/Mg-smectite']);
      return { primary: present.reduce((a, p) => a + p.cells, 0), detail: present.map(p => `${p.name}: ${p.cells} cells`) };
    },
  },

  // ───────────────────────── Gale / Mount Sharp ─────────────────────────
  {
    id: 'gale-boxwork', site: 'gale', short: 'BOXWORK RIDGES',
    label: 'Boxwork Ridge and Hollow Investigation',
    purpose: 'Sample boxwork ridges and the hollows between them inside the boxwork-bearing layer.',
    relevance: 'NASA\'s Curiosity team interprets the ridges as fractures hardened by minerals that groundwater left behind; comparing ridge and hollow tests how they hardened.',
    layers: ['geology', 'rock', 'ortho', 'pov', 'chemistry'],
    candidates: '"Ridge or butte crest" and "Hollow or trough" cells inside the boxwork-bearing layer (this project\'s derived units).',
    criteria: [
      'Primary: a ridge and a hollow inside the boxwork-bearing layer (5 points each).',
      'Context: the boxwork-bearing layer itself (2), its contacts (2), smooth ground inside it (1).',
    ],
    uncertainties: [
      'Ridge / hollow are derived from relief against a 15 m background in the 2016 merged DEM; the individual boxwork ridges (1–2 m tall, a few metres wide) are NOT resolved. A "ridge" stop is a local high, not a verified boxwork ridge.',
      'The boxwork-bearing layer is an elevation band from Curiosity\'s track, assuming near-horizontal layers; it is not a published geologic map.',
    ],
    refs: [NASA_BOXWORK_2025, NASA_BOXWORK_2026],
    options: { compositeTags: true },
    rules: [[`U:${RIDGE} | ${BOXWORK}`, 5, 'primary'], [`U:${HOLLOW} | ${BOXWORK}`, 5, 'primary'],
      [`B:${BOXWORK}`, 2, 'context'], [`C:*${BOXWORK}*`, 2, 'context'], [`U:Smooth ground | ${BOXWORK}`, 1, 'context']],
    investigate: [
      [`U:${RIDGE}*`, 'Ridge: look for a central fracture and mineral cement along it; sample the ridge wall and any nodules.'],
      [`U:${HOLLOW}*`, 'Hollow: sample bedrock in the hollow floor (under any sand) for comparison with the ridge.'],
      ['C:*', 'Contact of the boxwork-bearing layer: locate where boxwork begins / ends; sample both sides.'],
    ],
    support: (s) => unitPairSupport(s, [[RIDGE, BOXWORK], [HOLLOW, BOXWORK]]),
  },
  {
    id: 'gale-contacts', site: 'gale', short: 'CONTACTS',
    label: 'Geological Contact Exploration',
    purpose: 'Visit the boundaries between the stratigraphic levels: below, inside and above the boxwork-bearing layer.',
    relevance: 'The contacts bracket the boxwork-bearing layer; what changes across them tells whether the boxwork is tied to one layer.',
    layers: ['geology', 'ortho', 'pov'],
    candidates: 'The nearest cell of each contact between two stratigraphic levels.',
    criteria: ['Primary: each distinct contact (5 points).', 'Context: each stratigraphic level (2 points).'],
    uncertainties: [
      'Levels are elevation bands from Curiosity\'s track (derived, this project), assuming near-horizontal layers; real contacts may be offset by tens of metres or more where layers dip.',
    ],
    refs: [NASA_BOXWORK_2025],
    rules: [['C:*', 5, 'primary'], ['B:*', 2, 'context']],
    investigate: [
      ['C:*', 'Look for the change in rock across the boundary (texture, layering, veins); sample both sides; note that the mapped contact is an elevation proxy.'],
      ['B:*', 'Sample representative bedrock of this level.'],
    ],
    support: (s) => {
      const u = (s.geology?.bedrockUnits || []).filter(Boolean);
      return { primary: Math.max(0, u.length - 1), detail: u.map(x => `level: ${x}`) };
    },
  },
  {
    id: 'gale-chem-anomaly', site: 'gale', short: 'CHEMICAL ANOMALIES',
    label: 'Chemical Anomaly Investigation',
    purpose: 'Re-sample the rocks whose ChemCam chemistry stands out from their layer.',
    relevance: 'A rock whose composition differs strongly from its layer may record a local process (veins, alteration, a different source) worth a hand sample.',
    layers: ['chemistry', 'geology'],
    candidates: 'ChemCam targets with an oxide more than 2× ChemCam\'s accuracy (RMSEP) from their level\'s mean; one candidate per kind of standout, up to 6.',
    criteria: ['Primary: each distinct kind of chemical standout, e.g. "MgO low" (5 points).', 'Context: stratigraphic level (1 point).'],
    uncertainties: [
      'ChemCam samples a spot a few mm wide; one spot may not represent the whole rock.',
      'Target positions are reconstructed from the rover position and laser pointing; the mast offset (~1 m) is ignored.',
      'The 2 × RMSEP threshold is a planning choice.',
    ],
    refs: [],
    options: { maxChemCandidates: 6, maxCandidates: 6 },
    rules: [['X:*', 5, 'primary'], ['B:*', 1, 'context']],
    investigate: [
      ['X:*', 'Find the named ChemCam target; sample the same rock (fresh face) so the anomaly can be checked in the lab.'],
    ],
    support: (s) => ({ primary: s.chemAnomalyCount ?? 0, detail: s.chemAnomalyTags || [] }),
  },
  {
    id: 'gale-water-alteration', site: 'gale', short: 'WATER EVIDENCE',
    label: 'Water-Related Alteration Evidence',
    purpose: 'Sample the features this site\'s data tie to past groundwater: boxwork ridges and calcium-rich rocks.',
    relevance: 'NASA reports that the boxwork ridges likely formed where groundwater left minerals in cracks, and that the bedrock between them has calcium sulfate veins — both are groundwater evidence.',
    layers: ['geology', 'chemistry', 'ortho'],
    candidates: 'Ridges inside the boxwork-bearing layer, and ChemCam targets with high CaO for their layer.',
    criteria: [
      'Primary: a ridge inside the boxwork-bearing layer (5) and a "CaO high" ChemCam standout (5).',
      'Context: a hollow inside the boxwork-bearing layer (2).',
    ],
    uncertainties: [
      'No mineral-mapping layer (CRISM) or hydration measurement is integrated for Gale; water evidence here is indirect.',
      'The ChemCam table used here gives major oxides only (no S, H or Cl): high CaO is CONSISTENT with calcium sulfate veins but does not prove them.',
      'Ridges are derived local highs, not resolved boxwork ridges (see the boxwork objective).',
    ],
    refs: [NASA_BOXWORK_2025, NASA_BOXWORK_2026],
    options: { compositeTags: true, maxChemCandidates: 4 },
    rules: [[`U:${RIDGE} | ${BOXWORK}`, 5, 'primary'], ['X:CaO high', 5, 'primary'], [`U:${HOLLOW} | ${BOXWORK}`, 2, 'context']],
    investigate: [
      [`U:${RIDGE}*`, 'Look for mineral cement along a central fracture and for nodules; sample the cemented ridge wall.'],
      ['X:CaO high', 'Look for white veins (possible calcium sulfate) in or near the target; sample vein and host rock separately.'],
      [`U:${HOLLOW}*`, 'Sample hollow-floor bedrock as the comparison for the ridge.'],
    ],
    support: (s) => {
      const p = unitPairSupport(s, [[RIDGE, BOXWORK]]);
      const ca = (s.chemAnomalyTags || []).find(t => t.startsWith('CaO high'));
      return { primary: p.primary + (ca ? 1 : 0), detail: [...p.detail, ...(ca ? [ca] : [])],
        partial: 'No CRISM or hydration layer for Gale: the water evidence is indirect (landform + major-oxide chemistry).' };
    },
  },
  {
    id: 'gale-chemcam-revisit', site: 'gale', short: 'CHEMCAM RE-VISIT',
    label: 'ChemCam Target Re-investigation',
    purpose: 'Walk to rocks Curiosity already analysed with ChemCam and collect hand samples of the same rocks.',
    relevance: 'A crew sample of a rock with a known ChemCam composition ties rover remote sensing to lab-quality analysis — ground truth for the rover data.',
    layers: ['chemistry', 'track', 'pov'],
    candidates: 'Every ChemCam target in reach; the nearest 8 (standouts first) enter the optimiser.',
    criteria: ['Primary: each distinct ChemCam target (5 points).', 'Context: each kind of chemical standout (2 points).'],
    uncertainties: [
      'Target positions are reconstructed (rover position + pointing; ~1 m mast offset ignored); the crew must recognise the rock from the rover images.',
      'Rocks may have been brushed or abraded by the rover; ChemCam itself only removes dust at the laser spot.',
    ],
    refs: [],
    options: { maxCandidates: 4, maxChemCandidates: 0, maxTargetCandidates: 10, chemTargets: true },
    rules: [['T:*', 5, 'primary'], ['X:*', 2, 'context']],
    investigate: [
      ['T:*', 'Find the target from the rover\'s ground view; sample the same rock near the ChemCam spots.'],
    ],
    support: (s) => ({ primary: s.chemTargetCount ?? 0, detail: [`${s.chemTargetCount ?? 0} ChemCam targets in the site`] }),
  },
];

/** The pre-objective planner, kept as an explicit choice so its validated results stay reproducible. */
export const SURVEY_OBJECTIVE = {
  id: 'survey', site: '*', short: 'SITE SURVEY',
  label: 'General site survey (unit diversity)',
  purpose: 'Sample as many different units, contacts, minerals and chemical standouts as one EVA allows — no single science question.',
  relevance: 'The original Martian Map planner; useful as a reconnaissance EVA before a targeted one.',
  layers: ['geology', 'minerals', 'chemistry'],
  candidates: 'Nearest interior point of each unit pair, each bedrock contact, each CRISM class; up to two ChemCam standouts.',
  criteria: ['Bedrock 2, surface 1, contact 3, mineral 2, ChemCam standout 2 points per distinct tag (SCIENCE_PARAMS.weights).'],
  uncertainties: ['Treats every unit as equally interesting; no scientific question drives the stop choice.'],
  refs: [],
  rules: null,
  investigate: [],
  support: (s) => ({ primary: s.geology ? 1 : 0, detail: [] }),
};

const ALL = [...OBJECTIVES, SURVEY_OBJECTIVE];

/** Objectives offered for a site (its own five, then the survey). Empty for the Moon / procedural mode. */
export function objectivesForSite(siteName) {
  if (!siteName || siteName === 'moon') return [];
  return [...OBJECTIVES.filter(o => o.site === siteName), SURVEY_OBJECTIVE];
}

export function getObjective(id) {
  return ALL.find(o => o.id === id) || null;
}

/** Weights object for science.js: objective rules, every unmatched tag 0; survey → the original weights. */
export function objectiveWeights(obj, baseWeights) {
  if (!obj || !obj.rules) return baseWeights;
  return { bedrock: 0, surface: 0, contact: 0, mineral: 0, chemistry: 0, composite: 0, target: 0, rules: obj.rules };
}

/** Sum of the objective's primary points a candidate's tags carry (candidate ranking). */
export function primaryRelevance(obj, tags) {
  if (!obj?.rules) return 0;
  let s = 0;
  for (const t of new Set(tags)) {
    const r = obj.rules.find(rr => globMatch(rr[0], t));
    if (r && r[2] === 'primary') s += r[1];
  }
  return s;
}

/** What the crew should do at a stop, from the objective's investigate list (first match per tag). */
export function investigationFor(obj, tags) {
  const out = [];
  for (const t of tags) {
    const hit = obj?.investigate?.find(([g]) => globMatch(g, t));
    if (hit && !out.includes(hit[1])) out.push(hit[1]);
  }
  return out;
}

// ---- data support (availability) ----

function crismPresent(s, names) {
  const L = s.layers?.minerals;
  if (!L) return [];
  const cnt = new Array(L.classes.length).fill(0);
  for (const v of L.code) cnt[v]++;
  return L.classes.map((name, k) => ({ name, cells: k ? cnt[k] : 0 }))
    .filter(p => p.cells > 0 && (!names || names.includes(p.name)));
}

function unitPairSupport(s, pairs) {
  const g = s.geology;
  if (!g) return { primary: 0, detail: [] };
  const detail = [];
  let total = 0;
  for (const [sn, bn] of pairs) {
    const sc = g.surfaceUnits.indexOf(sn), bc = g.bedrockUnits.indexOf(bn);
    let c = 0;
    if (sc > 0 && bc > 0) for (let i = 0; i < g.surface.length; i++) if (g.surface[i] === sc && g.bedrock[i] === bc) c++;
    total += c;
    detail.push(`${sn} in ${bn}: ${c} cells`);
  }
  return { primary: total, detail };
}

/**
 * Does the loaded site hold the evidence this objective needs?
 * @param obj   objective
 * @param s     site-like { name, geology, layers, chemistry } (+ optional chemAnomalyCount / Tags / chemTargetCount)
 * @returns {{ status: 'supported'|'partial'|'unsupported', primary: number, detail: string[], note: string|null }}
 */
export function objectiveSupport(obj, s) {
  if (!obj) return { status: 'unsupported', primary: 0, detail: [], note: 'No objective selected.' };
  if (!s?.geology) return { status: 'unsupported', primary: 0, detail: [], note: 'This site has no geology layer to plan stops on.' };
  if (obj.site !== '*' && obj.site !== s.name) return { status: 'unsupported', primary: 0, detail: [], note: `Objective is for ${obj.site}.` };
  const r = obj.support(s);
  if (!(r.primary > 0)) {
    return { status: 'unsupported', primary: 0, detail: r.detail,
      note: 'None of the evidence this objective needs occurs in the site data — planning is disabled rather than inventing targets.' };
  }
  return { status: r.partial ? 'partial' : 'supported', primary: r.primary, detail: r.detail, note: r.partial || null };
}
