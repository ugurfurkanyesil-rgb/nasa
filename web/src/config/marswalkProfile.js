/**
 * Marswalk (astronaut EVA) parameters — single source of truth.
 *
 * Every value: { value, unit, status, label, source, quote?, note? }
 *   status: 'sourced'     → from a NASA document; `source` + `quote` filled in
 *           'assumption'  → a sourced model adapted to this problem;
 *                           `note` states exactly what is assumed
 *           'design'      → a planning preference (not a physical claim)
 *           'placeholder' → TEMPORARY, must not be used in a presentation
 *
 * IMPORTANT LIMITATION: the NASA EVA operations values we could find were
 * written for the MOON (xEVA ConOps). No official Mars-specific slope / speed /
 * distance limit was found. NASA's suited walking test found a walk-back at
 * Mars gravity (3/8 g) not acceptable (TP-2009-214796), so treat these values
 * as OPTIMISTIC for Mars. See MARS_CAVEAT.
 */

const XEVA = 'NASA EVA-EXP-0042 Rev B, Exploration EVA System Concept of Operations (2020)';
const XEVA_URL = 'https://www.nasa.gov/wp-content/uploads/2017/02/eva-exp-0042_xeva_system_con_ops_rev_b_final_dtd_10192020_ref_doc.pdf';

export const MARSWALK_PROFILE = {
  maxWalkableSlopeDeg: {
    value: 20,
    unit: 'deg',
    status: 'sourced',
    label: 'max walkable slope',
    source: `${XEVA} §4.2.1.3`,
    url: XEVA_URL,
    quote: 'Walking up/down/across a slope of up to 20°',
    note: 'Lunar ConOps value. DEM cells steeper than this are impassable walls.',
  },
  levelWalkSpeedKmh: {
    value: 2.0,
    unit: 'km/h',
    status: 'sourced',
    label: 'level walking speed',
    source: `${XEVA} §4.2.1.3.1.1`,
    url: XEVA_URL,
    quote: 'Traverses assume an ~2 km/hr walking pace over relatively level regolith',
    note: 'Marked TBR (to be resolved) in the document.',
  },
  evaDurationH: {
    value: 8,
    unit: 'h',
    status: 'sourced',
    label: 'EVA duration budget',
    source: `${XEVA} §4.1.4`,
    url: XEVA_URL,
    quote: 'The xEVA suit will support EVAs of up to 8 hours in duration (6±2 hours).',
    note: 'Planning budget. The extra hour of secondary O₂ (§4.2.1.1) is for emergencies only and is not planned against.',
  },
  maxRadialDistanceKm: {
    value: 2,
    unit: 'km',
    status: 'sourced',
    label: 'max walking distance from the habitat',
    source: `${XEVA} §4.2.1.3.1`,
    url: XEVA_URL,
    quote: 'a walking traverse of up to 2 km away from the lander on the lunar surface (radial distance)',
  },
  maxRockReliefM: {
    value: 0.5,
    unit: 'm',
    status: 'design',
    source: 'Rock relief from the 1 m HiRISE DTM (pipeline/build_layers.py)',
    note: 'Cells whose relief (after removing the local slope) exceeds this are treated as boulders / outcrops the crew walks around. '
        + 'No sourced suited-EVA obstacle height was found; 0.5 m is a planning choice. The 1 m DTM resolves rocks of a few metres only.',
  },
  slopeSpeedModel: {
    value: 'tobler',
    unit: null,
    status: 'assumption',
    label: 'walking speed vs. slope (Tobler shape)',
    source: 'Tobler, W. (1993). Three presentations on geographical analysis and modeling. NCGIA Technical Report 93-1.',
    note: 'No NASA data on how slope changes suited walking speed was found. Tobler\'s hiking function '
        + '(Earth, unsuited) is used for its SHAPE only: '
        + 'v(g) = v0 · exp(-3.5·|g + 0.05|) / exp(-3.5·0.05), with v0 = levelWalkSpeedKmh on level ground.',
  },
};

/**
 * Crew size: EVAs are planned as a two-person crew (EV1 + EV2). Lunar concept,
 * used here for Mars. Only the visual crew and the HUD use this.
 */
export const EVA_CREW = {
  value: 2,
  status: 'sourced',
  label: 'EVA crew (EV1 + EV2)',
  source: 'NASA, EVA Lunar Surface Concept of Operations (2020) — notional Design Reference EVA with EV1/EV2',
  url: 'https://www.nasa.gov/wp-content/uploads/2020/01/topic_1-_eva_lunar_surface_concept_of_operations.pdf',
};

/**
 * Route-mode preference weights — NOT physical claims, planning preferences.
 * Reported times use the same physical model (Tobler shape + NASA speed) in
 * every mode; these weights only change which path is chosen.
 *   slopeAversion: cell time × (1 + k·(slope/limit)²)  — stay away from steep ground
 *   climbPenaltyS: extra penalty per metre climbed [s]   — climb less
 */
export const MODE_WEIGHTS = {
  FAST: { slopeAversion: 0,   climbPenaltyS: 0,  status: 'design', desc: 'Shortest walking time' },
  SAFE: { slopeAversion: 4,   climbPenaltyS: 0,  status: 'design', desc: 'Stays farthest from the slope limit' },
  ECO:  { slopeAversion: 0.5, climbPenaltyS: 60, status: 'design', desc: 'Least climbing (energy / heat load)' },
  AUTO: { slopeAversion: 1.5, climbPenaltyS: 20, status: 'design', desc: 'Balanced' },
};

/**
 * Science EVA (Stage 6). No sourced stop duration or science-value scale was
 * found — all design choices / assumptions, labelled as such in the UI.
 *   dwellMin     : sampling / observation time per stop [min] (user adjustable)
 *   weights      : points per distinct tag (diversity); contact = boundary of two bedrock units
 *   interiorR    : cells in every direction that must be the same unit to count as "inside" it
 *   minHomeDistM : cells closer than this to the habitat are not stop candidates
 *   maxCandidates: nearest candidates that enter the exact (Held–Karp) optimisation
 *   maxChemCandidates: extra "re-sample" candidates at rocks whose ChemCam chemistry stands out
 *                  (> 2 × RMSEP from their layer's mean); chemistry weight per distinct anomaly
 */
export const SCIENCE_PARAMS = {
  dwellMin: 20,
  weights: { bedrock: 2, surface: 1, contact: 3, mineral: 2, chemistry: 2 },
  interiorR: 2,
  minHomeDistM: 20,
  maxCandidates: 12,
  maxChemCandidates: 2,
  status: 'design',
};

export const MARS_CAVEAT = {
  source: 'Norcross et al., NASA/TP-2009-214796, Feasibility of Performing a Suited 10-km Ambulation on the Moon',
  url: 'https://www.lpi.usra.edu/lunar/artemis/NorcrossEtAl_NASA-TP-2009-214796_EVA%20Walkback%20Test.pdf',
  note: 'A 10 km suited walk-back was found feasible at lunar gravity but not acceptable at Mars gravity (3/8 g): '
      + 'subjects worked near maximum effort to keep the pace. The lunar ConOps limits are optimistic for Mars.',
};

/**
 * MARS-CONSERVATIVE limits — an alternative to the lunar ConOps values above, for the
 * safety-first reading of the challenge. Only the four values below change; everything else
 * (slope limit, rock relief, slope-speed shape) stays as above because no Mars-specific
 * source was found for them.
 *
 *   level speed  2.0 km/h ÷ 1.65. Norcross et al. (TP-2009-214796, Table 5): suited VO₂ at the
 *                slowest test stage was 27.6 ml/min/kg at Mars gravity vs 16.7 at lunar gravity
 *                (stages are set relative to each subject's own transition speed, so the speeds
 *                are comparable; stages 2–3 give 1.77–1.79). Keeping the crew at the lunar
 *                planning metabolic load means walking 1.65× slower — assumption: cost ∝ speed.
 *   EVA budget   8 h − 30 min. The Apollo 17 traverse planning kept a 30-minute life-support
 *                reserve on every station's walk-back; here it is taken off the planning budget.
 *   radial limit 1.2 km: keeps the lunar ConOps walk-back TIME (2 km at 2 km/h = 1 h) at the
 *                slower Mars pace (1.21 km/h × 1 h).
 */
const APOLLO17 = 'NASA MSC (1972), Apollo 17 Traverse Planning Data, 3rd ed. — 30-minute PLSS consumables reserve';
const APOLLO17_URL = 'https://www.nasa.gov/wp-content/uploads/static/history/alsj/a17/A17TraversePlanningData.pdf';
export const MARS_SUIT_COST_RATIO = { value: 27.6 / 16.7, status: 'sourced',
  source: `${'Norcross et al., NASA/TP-2009-214796'}, Table 5 (suited VO₂, stage 1: 27.6 vs 16.7 ml/min/kg)`,
  url: 'https://www.lpi.usra.edu/lunar/artemis/NorcrossEtAl_NASA-TP-2009-214796_EVA%20Walkback%20Test.pdf' };

export const MARS_CONSERVATIVE = {
  levelWalkSpeedKmh: {
    value: Math.round((2.0 / MARS_SUIT_COST_RATIO.value) * 100) / 100,
    unit: 'km/h', status: 'assumption', label: 'level walking speed (Mars, same metabolic load)',
    source: MARS_SUIT_COST_RATIO.source, url: MARS_SUIT_COST_RATIO.url,
    note: 'Lunar ConOps 2 km/h divided by the suited metabolic-cost ratio Mars/Moon (1.65, Norcross Table 5, stage 1). '
        + 'Assumes metabolic cost grows in proportion to speed. Test suit: 120 kg MKIII.',
  },
  evaDurationH: {
    value: 7.5, unit: 'h', status: 'sourced', label: 'EVA planning budget (8 h − 30 min reserve)',
    source: APOLLO17, url: APOLLO17_URL,
    note: '8 h xEVA suit budget minus the Apollo 17 walk-back reserve of 30 minutes.',
  },
  maxRadialDistanceKm: {
    value: 1.2, unit: 'km', status: 'assumption', label: 'max walking distance from the habitat (Mars)',
    source: `${XEVA} §4.2.1.3.1 (2 km at 2 km/h = 1 h walk-back), rescaled`, url: XEVA_URL,
    note: 'Keeps the lunar 1-hour walk-back time at the slower Mars pace: 1.21 km/h × 1 h ≈ 1.2 km.',
  },
};

export const EVA_PROFILES = {
  lunar: { label: 'Lunar ConOps', short: 'NASA xEVA (Moon)', desc: 'NASA lunar EVA values — optimistic for Mars' },
  mars: { label: 'Mars conservative', short: 'Mars-adjusted', desc: 'Slower walk (Mars suited cost ×1.65), 30-min reserve, 1.2 km' },
};

let _profile = 'lunar';
/** Select the active EVA limit set ('lunar' | 'mars'). Planner worker and main thread each call this. */
export function setEvaProfile(name) { _profile = EVA_PROFILES[name] ? name : 'lunar'; }
export function getEvaProfile() { return _profile; }

/**
 * Keep-out buffer around rock obstacles [m] (Mission setup). 0 = the validated planner unchanged;
 * > 0 also walls every cell within this distance of a rock-relief wall (utils/hazardMap.js).
 * Design choice, not a NASA value. Planner worker and main thread each call the setter.
 */
let _bufferM = 0;
export function setObstacleBufferM(m) { _bufferM = Number.isFinite(m) && m > 0 ? Math.min(m, 40) : 0; }
export function getObstacleBufferM() { return _bufferM; }

/** The full entry (value, source, note) of a parameter in the active profile. */
export function paramEntry(key) {
  return (_profile === 'mars' && MARS_CONSERVATIVE[key]) || MARSWALK_PROFILE[key];
}

/** Numeric value of a parameter in the active profile (UI and models use this). */
export function param(key) {
  return paramEntry(key).value;
}

/** Parameters with no source yet (placeholder) — for the HUD warning. */
export function placeholderParams() {
  return Object.entries(MARSWALK_PROFILE)
    .filter(([, p]) => p.status === 'placeholder')
    .map(([k]) => k);
}

/** Parameters marked as assumptions (in the active profile) — shown separately in the HUD. */
export function assumptionParams() {
  return Object.keys(MARSWALK_PROFILE).filter(k => paramEntry(k).status === 'assumption');
}
