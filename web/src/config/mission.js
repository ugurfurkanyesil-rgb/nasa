/**
 * Mission options the crew picks before planning: which suit, how much equipment,
 * and whether a pressurized rover parks at the start point as a safe haven.
 *
 * Sourced numbers come from NASA's Mars suit mass study (Ogilvie et al., ICES 2026,
 * NTRS 20260005410). Their sizing logic: on Mars a suited astronaut carries the suit's
 * weight; what a crew member can carry is the NIOSH lifting limit (~23 kg) plus ~22 kg
 * that suit pressure offsets, i.e. ~45 kg Earth-equivalent.
 */

export const MARS_G = 3.711;      // m/s²
export const EARTH_G = 9.80665;   // m/s²

const ICES = 'Ogilvie et al. (2026), Mars Spacesuit Mass Requirements, ICES-2026, NASA NTRS 20260005410';
const ICES_URL = 'https://ntrs.nasa.gov/citations/20260005410';

export const SUITS = {
  mars: { label: 'Mars suit (target)', massKg: 104, source: ICES, url: ICES_URL,
    note: 'Mass NASA derives for a Mars-capable suit: ~42 kg pressure garment + ~62 kg life-support backpack.' },
  xemu: { label: 'Lunar xEMU', massKg: 170, source: ICES, url: ICES_URL,
    note: 'Current lunar suit mass used as the baseline in the same study.' },
};

export const CARRY = {
  liftLimitKg: { value: 23, source: `${ICES} (NIOSH lifting limit)`, url: ICES_URL },
  pressureOffsetKg: { value: 22, source: `${ICES} (load offset by suit pressure)`, url: ICES_URL },
};

export const ROVER = {
  walkbackMin: { value: 30, status: 'sourced', source: `${ICES}: 30-minute walkback limit for rover excursions`, url: ICES_URL },
  driveSpeedKmh: { value: 10, status: 'design', note: 'Average pressurized-rover driving speed for the drive-time estimate. Planning choice.' },
};

/** Default mission settings (UI state). */
export const DEFAULT_MISSION = { suit: 'mars', equipmentKg: 10, rover: false, limits: 'lunar', obstacleBufferM: 0 };

/**
 * Carried-weight check: suit + equipment weight on Mars, as Earth-equivalent kg,
 * against lift limit + pressure offset.
 */
export function carryCheck(m) {
  const suit = SUITS[m?.suit] || SUITS.mars;
  const massKg = suit.massKg + Math.max(0, m?.equipmentKg || 0);
  const earthEqKg = massKg * MARS_G / EARTH_G;
  const limitKg = CARRY.liftLimitKg.value + CARRY.pressureOffsetKg.value;
  return { suit, massKg, earthEqKg, limitKg, ok: earthEqKg <= limitKg,
    maxEquipmentKg: Math.max(0, limitKg * EARTH_G / MARS_G - suit.massKg) };
}

/** Straight-line drive estimate from the habitat (site centre) to the rover parking point. */
export function roverDrive(x, z) {
  const km = Math.hypot(x, z) / 1000;
  return { km, minutes: km / ROVER.driveSpeedKmh.value * 60 };
}
