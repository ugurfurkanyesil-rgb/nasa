/**
 * Share link — the plan in the URL, so a link opens the same site with the same EVA.
 *
 *   ?site=gale&plan=<base64url JSON>
 *
 * The JSON holds what is needed to rebuild the plan, not the plan itself:
 *   v  format version
 *   w  waypoints [[x, z], …] (m, 0.1 m) — for a hand-made route
 *   sci true → re-run the science-stop planner from w[0] (the stops are deterministic)
 *   r  active route (SAFE / ECO / FAST / AUTO)
 *   t  EVA start, ms since 1970 (UTC) — drives sun, temperature, DONKI
 *   m  mission setup { suit, equipmentKg, rover, limits }
 *   d  time per science stop, min
 *   o  mission objective id (config/objectives.js); old links without it re-plan as the survey
 *
 * Pure (no React): tested in Node (tests/shareLink.test.mjs).
 */

const VERSION = 1;
const ROUTES = ['SAFE', 'ECO', 'FAST', 'AUTO'];

const b64urlEncode = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlDecode = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};
const r1 = (v) => Math.round(v * 10) / 10;

/** @returns {string} the `plan` query value */
export function encodePlan({ waypoints = [], science = false, route, startMs, mission, dwellMin, objective }) {
  const st = {
    v: VERSION,
    w: (science ? waypoints.slice(0, 1) : waypoints).map((p) => [r1(p.x), r1(p.z)]),
  };
  if (science) st.sci = true;
  if (ROUTES.includes(route)) st.r = route;
  if (Number.isFinite(startMs)) st.t = Math.round(startMs);
  if (mission) {
    st.m = { suit: mission.suit, equipmentKg: mission.equipmentKg, rover: !!mission.rover, limits: mission.limits };
    if (mission.obstacleBufferM > 0) st.m.b = mission.obstacleBufferM;
    const p = mission.payload || {};
    const pk = ['instruments', 'comms', 'sampling', 'emergency'].map(k => (Number.isFinite(p[k]) && p[k] >= 0 ? p[k] : 0));
    if (pk.some(v => v > 0)) st.m.p = pk;
    const d = mission.dust || {};
    const dk = ['outerLayer', 'joints', 'equipment', 'covers'].map(k => d[k] || 'unknown');
    if (dk.some(v => v !== 'unknown')) st.m.u = dk;
  }
  if (Number.isFinite(dwellMin)) st.d = dwellMin;
  if (typeof objective === 'string' && /^[a-z0-9-]{1,40}$/.test(objective)) st.o = objective;
  return b64urlEncode(JSON.stringify(st));
}

/** Full share URL for the current page and site. */
export function buildShareURL(base, siteName, state) {
  const q = new URLSearchParams();
  if (siteName) q.set('site', siteName);
  q.set('plan', encodePlan(state));
  return `${base.split(/[?#]/)[0]}?${q}`;
}

/**
 * Reads ?plan= — returns null if absent or unreadable (a bad link must not break the app).
 * Values are checked and clamped; unknown fields are ignored.
 */
export function decodePlan(search) {
  let raw;
  try { raw = new URLSearchParams(search).get('plan'); } catch { return null; }
  if (!raw) return null;
  let st;
  try { st = JSON.parse(b64urlDecode(raw)); } catch { return null; }
  if (!st || typeof st !== 'object' || st.v !== VERSION) return null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const waypoints = Array.isArray(st.w)
    ? st.w.filter((p) => Array.isArray(p) && num(p[0]) != null && num(p[1]) != null)
      .slice(0, 64).map(([x, z]) => ({ x, z }))
    : [];
  const out = {
    waypoints,
    science: st.sci === true,
    route: ROUTES.includes(st.r) ? st.r : null,
    startMs: num(st.t),
    dwellMin: num(st.d) != null ? Math.min(120, Math.max(1, st.d)) : null,
    mission: null,
    objective: typeof st.o === 'string' && /^[a-z0-9-]{1,40}$/.test(st.o) ? st.o : null,
  };
  if (st.m && typeof st.m === 'object') {
    out.mission = {
      ...(typeof st.m.suit === 'string' ? { suit: st.m.suit } : {}),
      ...(num(st.m.equipmentKg) != null ? { equipmentKg: Math.min(100, Math.max(0, st.m.equipmentKg)) } : {}),
      rover: st.m.rover === true,
      ...(st.m.limits === 'mars' || st.m.limits === 'lunar' ? { limits: st.m.limits } : {}),
      ...([4, 8].includes(st.m.b) ? { obstacleBufferM: st.m.b } : {}),
      ...(Array.isArray(st.m.p) && st.m.p.length === 4 && st.m.p.every(v => num(v) != null && v >= 0 && v <= 100)
        ? { payload: { instruments: st.m.p[0], comms: st.m.p[1], sampling: st.m.p[2], emergency: st.m.p[3] } } : {}),
      ...(Array.isArray(st.m.u) && st.m.u.length === 4 && st.m.u.every(v => typeof v === 'string' && /^[a-z]{1,16}$/.test(v))
        ? { dust: { outerLayer: st.m.u[0], joints: st.m.u[1], equipment: st.m.u[2], covers: st.m.u[3] } } : {}),
    };
  }
  return out;
}
