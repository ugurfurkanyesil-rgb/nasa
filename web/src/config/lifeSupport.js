/**
 * Life support — primary-oxygen (O₂) planning values for a Mars EVA.
 *
 * O₂ use depends on the PLSS architecture far more than on anything else: a closed-loop pack
 * loses only metabolic O₂ + leakage, a swing-bed vents some O₂ with the CO₂ it dumps into the
 * Martian atmosphere, and open-loop / cryogenic-scrubber packs vent O₂ by design. So the app does
 * not pick "one Mars O₂ rate": the crew chooses an architecture, and each one carries its own
 * sourced rate and, where a source gives one, a sourced planning capacity.
 *
 * Sources (latest found, Nov 2026 — no BVAD revision newer than REV2 exists):
 *   BVAD      NASA/TP-2015-218570/REV2 (Feb 2022), Life Support Baseline Values and Assumptions
 *             Document, §4.6 EVA — O₂ use by PLSS type, per 4-h sortie
 *   ICES-158  Oliver et al., ICES-2026-158, Mars Exploration PLSS Schematic Study: Architecture Down-Selection
 *   ICES-090  Lobmeyer et al., ICES-2025-90, Martian Exploration PLSS Schematic Study (presentation, slide 9)
 *
 * Capacities are PLANNING VALUES from design studies, not the tank size of any flight hardware.
 * There is no Mars-certified PLSS. The secondary (emergency) O₂ is never counted in the budget.
 */

const LB = 0.45359237;   // kg per lb (exact)

export const LS_SOURCES = {
  bvad: {
    title: 'Ewert, Chen & Powell — Life Support Baseline Values and Assumptions Document (BVAD), NASA/TP-2015-218570/REV2',
    date: 'February 2022', url: 'https://ntrs.nasa.gov/api/citations/20210024855/downloads/BVAD_2.15.22-final.pdf',
    note: '§4.6 EVA. Metabolic basis 1.06 MJ/CM-h (295 W), RQ 0.90; typical EVA O₂ consumption 0.086 kg/CM-h (Table 4-70).',
  },
  ices158: {
    title: 'Oliver et al. — Mars Exploration Portable Life Support System Schematic Study: Architecture Down-Selection, ICES-2026-158',
    date: 'July 2026', url: 'https://ntrs.nasa.gov/api/citations/20260002884/downloads/ICES2026_Mars_Schematic_Study_FINAL.pdf',
    note: 'Mars nominal environment (212 K surface, 0.124 psia). Consumables sized at 350 W average metabolic rate (530 W max). Steady-state models; no stored-O₂ masses given.',
  },
  ices090: {
    title: 'Lobmeyer et al. — Martian Exploration Portable Life Support System Schematic Study, ICES-2025-90 (presentation)',
    date: 'July 2025', url: 'https://ntrs.nasa.gov/api/citations/20250006266/downloads/ICES_Mars_Presentation.pdf',
    note: 'Slide 9: schematics sized "for an 8-hr EVA in the Mars nominal environment using GUS". The slide does not state the O₂ flow rate.',
  },
  norcross: {
    title: 'Norcross et al. — Feasibility of Performing a Suited 10-km Ambulation on the Moon, NASA/TP-2009-214796, Table 5',
    date: '2009', url: 'https://www.lpi.usra.edu/lunar/artemis/NorcrossEtAl_NASA-TP-2009-214796_EVA%20Walkback%20Test.pdf',
    note: 'Suited VO₂ at the same speed: 27.6 ml/min/kg (Mars g) vs 16.7 ml/min/kg (lunar g), ratio 1.65.',
  },
};

/**
 * PLSS architectures. rateKgH: primary O₂ used per crew member per hour.
 * capacity: { kg, sizedForH } planning value from the same family of sources, or null if none exists.
 * metabolic: true → O₂ use follows the crew's metabolic load (the walking-load option may scale it);
 *            false → O₂ flow is set by the hardware (purge / scrubber), not by the metabolic load.
 */
export const PLSS_ARCHS = {
  'bvad-swingbed': {
    label: 'Swing-bed, CO₂ vented to Mars air',
    short: 'SWING-BED',
    rateKgH: 0.15, metabolic: true,
    rateSource: 'bvad', rateRef: 'BVAD REV2 §4.6: swing-bed rejecting CO₂ to the Mars environment, 0.6 kg per 4-h sortie (0.15 kg/h)',
    capacity: { kg: 0.6, sizedForH: 4, source: 'bvad', ref: 'BVAD REV2 §4.6: 0.6 kg per 4-h sortie' },
    note: 'BVAD\'s Mars planning case. O₂ lost with the vented CO₂ is included.',
  },
  'bvad-closed': {
    label: 'Closed loop (metabolic O₂ + leakage)',
    short: 'CLOSED LOOP',
    rateKgH: 0.076, metabolic: true,
    rateSource: 'bvad', rateRef: 'BVAD REV2 §4.6: closed-loop PLSS, 0.3 kg per 4-h sortie (0.076 kg/h)',
    capacity: { kg: 0.3, sizedForH: 4, source: 'bvad', ref: 'BVAD REV2 §4.6: 0.3 kg per 4-h sortie' },
    note: 'Lower bound: only the O₂ the crew member breathes plus suit leakage.',
  },
  'ices-cryo': {
    label: 'Semi-open, dual cryogenic scrubber (LOX)',
    short: 'CRYO SCRUBBER',
    rateKgH: Math.round(2.4 * LB * 1000) / 1000, metabolic: false,
    rateSource: 'ices158', rateRef: 'ICES-2026-158 §IV.C: ~2.4 lb O₂/h from the LOX tank (more than the helmet needs; the rest is lost to the environment)',
    capacity: { kg: 8.6, sizedForH: 8, source: 'ices090', ref: 'ICES-2025-090 slide 9, schematics 1–2 (LOX): 8.6 kg O₂ consumables, 8-hr Mars nominal EVA' },
    note: 'Rate and capacity come from two studies of this architecture family; 8.6 kg / 8 h = 1.075 kg/h agrees with the 1.089 kg/h flow within 1.5 %.',
  },
  'ices-openloop': {
    label: 'Open loop, O₂ purge (LOX)',
    short: 'OPEN LOOP',
    rateKgH: Math.round(2.2 * LB * 1000) / 1000, metabolic: false,
    rateSource: 'ices158', rateRef: 'ICES-2026-158 §II.B: open-loop purge O₂, primary subsystem, 2.2 lb/h',
    capacity: null,
    note: 'ICES-2026-158 gives no stored-O₂ mass, so no O₂ margin can be computed for this pack.',
  },
};

export const DEFAULT_LIFE_SUPPORT = { arch: 'bvad-swingbed', walkLoad: 'baseline' };

/** Walking metabolic load. Only 'norcross' is an assumption; both apply to metabolic packs only. */
export const WALK_LOADS = {
  baseline: { label: 'BVAD baseline', factor: 1, status: 'sourced',
    note: 'The architecture\'s planning rate is used for walking and for stops alike.' },
  norcross: { label: 'Mars-gravity walking ×1.65', factor: 27.6 / 16.7, status: 'assumption',
    note: 'Assumption: walking O₂ at lunar ConOps speed in Mars gravity scales with the suited VO₂ ratio (Norcross Table 5). Applied to walking time only, never to stops. Not valid for the Mars-conservative limit set, which already slowed the walk to keep the lunar metabolic load.' },
};

/** Secondary (emergency) O₂ sizing — shown for context, never added to the primary budget. */
export const SECONDARY_O2 = { hoursFor4to8hEVA: 1, hoursFor2hEVA: 0.5, source: 'ices158',
  ref: 'ICES-2026-158: secondary subsystem sized for 1 h (4–8-h EVAs) or 0.5 h (2-h EVA), open loop' };

/** BVAD REV2 notes that a standard Mars EVA may be shortened to 4 h (two half-day sorties per day). */
export const BVAD_MARS_EVA_H = { value: 4, source: 'bvad', ref: 'BVAD REV2 §4.6: Mars standard EVA may be reduced to 4 h' };

/** Resolve a mission's life-support choice (unknown ids fall back to the default). */
export function lifeSupportOf(mission) {
  const ls = { ...DEFAULT_LIFE_SUPPORT, ...(mission?.lifeSupport || {}) };
  if (!PLSS_ARCHS[ls.arch]) ls.arch = DEFAULT_LIFE_SUPPORT.arch;
  if (!WALK_LOADS[ls.walkLoad]) ls.walkLoad = DEFAULT_LIFE_SUPPORT.walkLoad;
  return ls;
}

/**
 * Effective walking factor: 1 unless the pack is metabolic, the 'norcross' load is chosen and the
 * lunar limit set is active (the Mars set already holds the metabolic load at the lunar level).
 */
export function walkFactor(ls, profile) {
  const a = PLSS_ARCHS[ls.arch];
  return a.metabolic && ls.walkLoad === 'norcross' && profile !== 'mars' ? WALK_LOADS.norcross.factor : 1;
}

/** O₂ [kg] for a given time spent at stops and walking. */
export function oxygenKg(ls, profile, dwellS, walkS) {
  const a = PLSS_ARCHS[ls.arch];
  return a.rateKgH / 3600 * (Math.max(0, dwellS) + walkFactor(ls, profile) * Math.max(0, walkS));
}

// Module-level selection for the EVA HUD (App sets it each render, like setEvaProfile).
let _ls = { ...DEFAULT_LIFE_SUPPORT };
export function setLifeSupport(ls) { _ls = lifeSupportOf({ lifeSupport: ls }); }
export function getLifeSupport() { return _ls; }
