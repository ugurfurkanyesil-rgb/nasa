/**
 * Surface radiation for a Marswalk.
 *
 * Galactic cosmic rays: the only long, direct measurement on the Martian surface is
 * Curiosity's RAD at Gale crater. Jezero sits ~1.8 km higher (thinner atmosphere above
 * it), so the true dose there is likely a little higher; the app says so.
 *
 * Solar particle events (SEP) can raise the surface dose quickly; the space-weather
 * card lists DONKI events around the EVA date and recommends postponing during one.
 */

import { site as SITE_DATA } from '../terrain/siteData.js';

/** Gale crater outline (approx., planetocentric): RAD measured here, so no transfer to another site. */
const GALE = { lat: -5.4, lon: 137.8, radiusDeg: 1.3 };

/** True when the loaded site lies in Gale crater, where Curiosity's RAD measured the dose. */
export function radiationIsLocal(meta = SITE_DATA.meta) {
  const c = meta?.center;
  if (!c) return false;
  return Math.hypot(c.lat_deg - GALE.lat, c.lon_deg_east - GALE.lon) < GALE.radiusDeg;
}

export const RADIATION = {
  gcrDoseEquivalentMSvPerDay: {
    value: 0.64,
    uncertainty: 0.12,
    status: 'sourced',
    source: 'Hassler et al. (2014), Mars\' surface radiation environment measured with the MSL Curiosity rover, Science 343, 1244797',
    url: 'https://doi.org/10.1126/science.1244797',
    note: 'Measured at Gale crater (−4.4 km) between Aug 2012 and Jun 2013. Applied to other sites without an altitude correction.',
  },
  gcrAbsorbedMGyPerDay: {
    value: 0.21,
    uncertainty: 0.04,
    status: 'sourced',
    source: 'Hassler et al. (2014), Science 343, 1244797',
    url: 'https://doi.org/10.1126/science.1244797',
  },
  careerLimitMSv: {
    value: 600,
    status: 'sourced',
    source: 'NASA-STD-3001 Volume 1, Rev B (2022): career effective dose limit',
    url: 'https://www.nasa.gov/wp-content/uploads/2023/03/nasa-std-3001-vol-1-rev-b-with-errata.pdf',
  },
  sepWindowDays: {
    value: 2,
    status: 'design',
    note: 'An SEP event within ± this many days of the EVA start triggers a postpone advisory. Design choice.',
  },
};

/**
 * Daily dose equivalent in four places — the challenge points out that the radiation
 * environment on Mars differs from those of Earth, Earth orbit and the Moon. All values are
 * measured, but in different years of the solar cycle: the Moon value (2019) is from solar
 * minimum, when galactic cosmic rays are strongest; the Mars value (2012–13) is near solar
 * maximum. Part of the Moon–Mars gap is that timing.
 */
const ZHANG = 'Zhang, S. et al. (2020), First measurements of the radiation dose on the lunar surface, Science Advances 6, eaaz1334';
const ZHANG_URL = 'https://doi.org/10.1126/sciadv.aaz1334';
export const DOSE_COMPARISON = [
  { key: 'earth', label: 'Earth', mSvPerDay: 2.4 / 365.25,
    why: 'magnetic field + a thick atmosphere',
    source: 'UNSCEAR (2000): worldwide average 2.4 mSv/year from natural radiation (all sources, not only cosmic rays)',
    url: 'https://press.un.org/en/2000/20000606.ga9718.doc.html' },
  { key: 'iss', label: 'ISS', mSvPerDay: 0.731,
    why: 'inside Earth\'s magnetic field, no air; station hull',
    source: `${ZHANG} — ISS dose equivalent they compare with (731 µSv/day)`, url: ZHANG_URL },
  { key: 'moon', label: 'Moon', mSvPerDay: 1.369,
    why: 'no field, no air; the Moon blocks half the sky',
    source: `${ZHANG} — Chang\'e 4 LND, 1369 µSv/day (2019, solar minimum)`, url: ZHANG_URL },
  { key: 'mars', label: 'Mars', mSvPerDay: RADIATION.gcrDoseEquivalentMSvPerDay.value,
    why: 'no global field; thin CO₂ air; the planet blocks half the sky',
    source: `${RADIATION.gcrDoseEquivalentMSvPerDay.source} — Curiosity RAD at Gale (2012–13)`,
    url: RADIATION.gcrDoseEquivalentMSvPerDay.url },
];

/** How many days in each place give the same dose as `mSv`. */
export function daysEquivalent(mSv) {
  return Object.fromEntries(DOSE_COMPARISON.map(d => [d.key, mSv / d.mSvPerDay]));
}

/** Dose equivalent [mSv] from galactic cosmic rays for `seconds` spent outside. */
export function evaDoseMSv(seconds) {
  return RADIATION.gcrDoseEquivalentMSvPerDay.value * Math.max(0, seconds) / 86400;
}

/** Share of the career limit, 0..1. */
export function careerFraction(mSv) {
  return mSv / RADIATION.careerLimitMSv.value;
}

/**
 * Space-weather events near an EVA.
 * @param {object|null} wx  space_weather.json: { events: [{type, time, ...}] }
 * @param {number} startMs  EVA start (UTC ms)
 * @returns {{ near: object[], sep: object[], advisory: 'postpone'|'clear'|'no-data', coverage: [string,string]|null,
 *            reason: null|'no-source'|'not-covered' }}  reason says WHY there is no data (never "no events")
 */
export function spaceWeatherAt(wx, startMs) {
  if (!wx || !Array.isArray(wx.events)) return { near: [], sep: [], advisory: 'no-data', coverage: null, reason: 'no-source' };
  const day = 86400e3;
  const w = RADIATION.sepWindowDays.value * day;
  const near = wx.events
    .filter(e => Math.abs(Date.parse(e.time) - startMs) <= w)
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const sep = near.filter(e => e.type === 'SEP');
  const [from, to] = wx.coverage || [];
  const covered = from && to && startMs >= Date.parse(from) && startMs <= Date.parse(to) + day;
  return {
    near,
    sep,
    advisory: !covered ? 'no-data' : sep.length ? 'postpone' : 'clear',
    coverage: from && to ? [from, to] : null,
    reason: covered ? null : 'not-covered',
  };
}

/**
 * Live DONKI lookup for one EVA date (browser), used when the bundled snapshot does not
 * cover it. api.nasa.gov with the public DEMO_KEY (rate-limited per visitor IP).
 * Resolves to a space_weather.json-like object, or null on any failure.
 */
const _live = new Map();
export function fetchSpaceWeatherLive(startMs, apiKey = 'DEMO_KEY') {
  const day = 86400e3, w = RADIATION.sepWindowDays.value * day;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const from = iso(startMs - w), to = iso(startMs + w);
  const key = from + to;
  if (_live.has(key)) return _live.get(key);
  // CMEs take days to reach Mars: look for launches up to a week before the window
  const q = (kind) => fetch(`https://api.nasa.gov/DONKI/${kind}?startDate=${kind === 'CME' ? iso(startMs - w - 7 * day) : from}&endDate=${to}&api_key=${apiKey}`)
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
  const p = Promise.all([q('SEP'), q('CME'), q('FLR')]).then(([sep, cme, flr]) => {
    const events = [];
    for (const e of sep || []) events.push({ type: 'SEP', time: e.eventTime, id: e.sepID, link: e.link });
    for (const e of cme || []) {
      for (const a of e.cmeAnalyses || []) for (const run of a.enlilList || []) for (const imp of run.impactList || []) {
        if (String(imp.location).toLowerCase() === 'mars' && imp.arrivalTime && Math.abs(Date.parse(imp.arrivalTime.replace('Z', '') + 'Z') - startMs) <= w) {
          events.push({ type: 'CME', time: imp.arrivalTime, id: e.activityID, speedKmS: a.speed, link: e.link });
        }
      }
    }
    for (const e of flr || []) if (String(e.classType || '').startsWith('X')) events.push({ type: 'FLR', time: e.peakTime || e.beginTime, class: e.classType, link: e.link });
    for (const e of events) e.time = e.time.replace('Z', '') + 'Z';
    return { format: 'martian-map-space-weather/1', coverage: [from, to], events, live: true };
  }).catch(() => null);
  _live.set(key, p);
  return p;
}
