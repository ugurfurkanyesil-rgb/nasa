/**
 * Payload & Mass Assessment — what one crew member carries, against the carry limit.
 *
 * Mass model (no double counting):
 *   carried mass = suit mass (pressure garment + life-support backpack, ONE number)
 *                + the declared equipment categories below
 * The suit mass already contains the Portable Life Support System (PLSS): for the Mars suit
 * NASA's study gives 104 kg = ~42 kg pressure garment + ~62 kg PLSS (a starting 40/60
 * allocation, Ogilvie et al. 2026). Those components are shown as INCLUDED, never added again.
 * Communications: the study's PLSS budget lists avionics but does not say whether the suit
 * radio / informatics is inside the 104 kg; the "communication equipment" field is therefore
 * only for equipment carried IN ADDITION to the suit's own radio.
 *
 * Limit (unchanged from the existing project): the carried mass, as Earth-equivalent weight
 * on Mars, must not exceed NIOSH lifting limit 23 kg + suit-pressure offload 22 kg = 45 kg.
 * This is the project's simplified reading of Ogilvie et al. (2026). Their Eq. 7 also counts
 * the crew member's own body weight and a restricted-mobility factor; for their reference crew
 * (49 kg, VO2max 36 ml/min/kg) it allows ~126.6 kg of suit + carry mass at Mars gravity,
 * while the project rule allows ~118.9 kg — the project rule is the stricter of the two, and
 * is kept. `ogilvieEq7` reproduces the paper's own equation for reference only.
 *
 * Mobility: no payload-dependent walking-speed penalty is applied. NASA suited tests (e.g.
 * IST-1, Norcross et al. 2010) measured metabolic cost vs suit weight in simulated LUNAR
 * gravity on one suit (MKIII); no validated speed-vs-carried-mass model for Mars was found.
 * Payload is a constraint, not a speed change.
 *
 * Invalid input (negative, non-numeric, infinite) is never treated as zero: the assessment
 * reports it and the carry check becomes "not checked" (→ INSUFFICIENT DATA, not GO).
 * Pure module.
 */

import { SUITS, CARRY, MARS_G, EARTH_G } from '../config/mission.js';

const ICES = 'Ogilvie et al. (2026), Mars Spacesuit Mass Requirements, ICES-2026-127, NASA NTRS 20260003038 / 20260005410';
export const OGILVIE_URL = 'https://ntrs.nasa.gov/citations/20260003038';

/** Equipment categories a crew member declares. `other` is the existing `equipmentKg` field. */
export const PAYLOAD_ITEMS = [
  { id: 'instruments', label: 'Scientific instruments', note: 'Hand-held instruments, cameras, hand lens — carried in addition to the suit.' },
  { id: 'comms', label: 'Communication equipment (extra)', note: 'Only equipment carried IN ADDITION to the suit\'s own radio / informatics (whether those are inside the suit mass is not stated in the NASA study).' },
  { id: 'sampling', label: 'Sampling equipment & samples', note: 'Tools, bags, containers and the samples collected.' },
  { id: 'emergency', label: 'Emergency supplies', note: 'Contingency items carried by this crew member.' },
  { id: 'other', label: 'Additional carried payload (general)', note: 'The general equipment field of Mission setup (equipmentKg).' },
];

/** Components already inside the suit mass — shown, never added. */
export function suitComponents(suitId) {
  if (suitId === 'mars') {
    return [
      { label: 'Pressure garment (PGS)', kg: 42, note: '40 % starting allocation of the 104 kg (Ogilvie et al. 2026, historical PGS/PLSS split)' },
      { label: 'Portable life support (PLSS)', kg: 62, note: '60 % starting allocation; includes avionics in the study\'s budget' },
    ];
  }
  if (suitId === 'xemu') {
    return [{ label: 'Complete lunar xEMU (PGS + PLSS)', kg: SUITS.xemu.massKg, note: 'Split between garment and PLSS not modelled here.' }];
  }
  return [];
}

const valid = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * @param {object} m  mission: { suit, equipmentKg, payload: { instruments, comms, sampling, emergency } }
 *                    Missing category (undefined) = not carried (0 kg). Invalid → reported.
 */
export function assessPayload(m) {
  const errors = [];
  let suit = null;
  if (m?.suit === undefined) suit = SUITS.mars;
  else if (SUITS[m.suit]) suit = SUITS[m.suit];
  else errors.push(`Unknown suit "${String(m.suit)}".`);
  const items = PAYLOAD_ITEMS.map(it => {
    const raw = it.id === 'other' ? m?.equipmentKg : m?.payload?.[it.id];
    if (raw === undefined) return { ...it, kg: 0, declared: false, valid: true };
    if (!valid(raw)) { errors.push(`${it.label}: "${String(raw)}" is not a valid mass.`); return { ...it, kg: null, declared: true, valid: false }; }
    return { ...it, kg: raw, declared: true, valid: true };
  });
  const limitKg = CARRY.liftLimitKg.value + CARRY.pressureOffsetKg.value;   // Earth-equivalent
  const g = MARS_G / EARTH_G;
  const limitMassKg = limitKg / g;                                           // carried mass at Mars gravity
  if (errors.length || !suit) {
    return { status: 'invalid', ok: null, suit, components: suit ? suitComponents(m?.suit ?? 'mars') : [], items, errors,
      equipmentKg: null, massKg: null, earthEqKg: null, limitKg, limitMassKg, remainingKg: null, remainingEarthEqKg: null,
      maxEquipmentKg: suit ? Math.max(0, limitMassKg - suit.massKg) : null };
  }
  const equipmentKg = items.reduce((a, it) => a + it.kg, 0);
  const massKg = suit.massKg + equipmentKg;
  const earthEqKg = massKg * g;
  const ok = earthEqKg <= limitKg;
  return {
    status: ok ? 'ok' : 'over', ok, suit, components: suitComponents(m?.suit ?? 'mars'), items, errors,
    equipmentKg, massKg, earthEqKg, limitKg, limitMassKg,
    remainingKg: limitMassKg - massKg,              // at Mars gravity; negative = over the limit
    remainingEarthEqKg: limitKg - earthEqKg,
    maxEquipmentKg: Math.max(0, limitMassKg - suit.massKg),
  };
}

/**
 * Ogilvie et al. (2026) Eq. 7, for reference only (not the app's constraint):
 *   max suit mass = [(crew + NIOSH) · (1 − 14 / VO2max) + pressure offload] / g_Mars − crew − carry
 * In the paper's units (lbm / lbf, g_Mars = 3/8): crew 108, NIOSH 51, offload 48, carry 50, VO2max 36
 * → 229 lbm ≈ 104 kg. kg in, kg out.
 */
export const OGILVIE_REF = {
  crewKg: { value: 49, source: `${ICES}: 5th-percentile female, 108 lbm` },
  vo2max: { value: 36, source: `${ICES}: VO2max 36 ml/min/kg` },
  nioshKg: { value: 51 * 0.45359237, source: `${ICES}: NIOSH max carry 51 lbf` },
  offloadKg: { value: 48 * 0.45359237, source: `${ICES}: pressure offload 48 lbf (walking)` },
  carryKg: { value: 50 * 0.45359237, source: `${ICES}: 50 lbm reserved for tools / samples / equipment` },
  gRatio: { value: 3 / 8, source: `${ICES}: Mars gravity 3/8 g` },
};
export function ogilvieEq7({ crewKg = OGILVIE_REF.crewKg.value, vo2max = OGILVIE_REF.vo2max.value, carryKg = OGILVIE_REF.carryKg.value } = {}) {
  const R = OGILVIE_REF;
  const mobility = 1 - 14 / vo2max;
  const systemKg = ((crewKg + R.nioshKg.value) * mobility + R.offloadKg.value) / R.gRatio.value;   // crew + suit + carry
  return { maxSuitKg: systemKg - crewKg - carryKg, suitPlusCarryKg: systemKg - crewKg, mobility };
}
