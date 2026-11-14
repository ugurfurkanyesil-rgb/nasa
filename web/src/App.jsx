/**
 * App — Martian Map (DEM mode) / Moon Rover simulator (procedural mode).
 * Multi-waypoint planning, science EVA, EVA playback with a two-person crew,
 * toast notifications.
 */

import { DEFAULT_MISSION, ROVER } from './config/mission';
import { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense } from 'react';
import RightPanel from './components/RightPanel';
import EvaHud from './components/EvaHud';
import { clearPathCache, getHazardAtPoint, isWallAt, fastestReturnPath, toHomeTimeAt } from './utils/pathfinder';
import { getTerrainHeight, buildHeightMap, buildSlopeMap, buildCraterMask, IS_DEM, SITE } from './three/terrainGenerator';
import { param, placeholderParams, assumptionParams, MARSWALK_PROFILE, MARS_CAVEAT, SCIENCE_PARAMS, EVA_CREW, paramEntry, getEvaProfile, setEvaProfile, EVA_PROFILES, MARS_SUIT_COST_RATIO, setObstacleBufferM } from './config/marswalkProfile';
import { objectivesForSite, objectiveSupport, getObjective } from './config/objectives';
import { chemAnomalies } from './utils/chemistry';
import { setHazardContext } from './utils/siteHazards';
import { LearningModel } from './utils/learningModel';
import { DUST_STATES, DUST_HAZARD_CONFIG, DEFAULT_HOME, createDustHazard } from './utils/dustHazardModel';
import { evaluateDustInterference } from './utils/sensorInterferenceEvaluator';
import { buildReturnToHomePath } from './utils/returnToHomeController';
import { planRoutes, planScience, warmPlanner, plannerUsesWorker } from './utils/plannerClient';
import { sunPosition, msAtLtst } from './utils/marsTime';
import { airTempAt } from './utils/climate';
import { EvaPlayback } from './utils/evaPlayback';
import { fmtClock, fmtHM } from './utils/format';
import { radiationIsLocal } from './utils/radiation';
import SiteSwitcher from './components/SiteSwitcher';
import { PANEL_W, SHEET_VH, useNarrow, useCompact, COMPACT_QUERY } from './ui/layout';
import { decodePlan } from './utils/shareLink';
import { SUITS } from './config/mission';

const MoonScene = lazy(() => import('./components/MoonScene'));

function ts() { return new Date().toLocaleTimeString('en-US', { hour12: false }); }

const WALL_REJECT_MSG = IS_DEM
  ? `⛔ WAYPOINT REJECTED — steeper than the ${param('maxWalkableSlopeDeg')}° walkable limit. Pick flatter ground.`
  : '⛔ WAYPOINT REJECTED — inside a crater! The rover never enters crater zones. Pick flat ground.';

// ---- Toast System ----
let _toastId = 0;

function ToastContainer({ toasts, onDismiss }) {
  return (
    <div style={{
      position:'fixed', top:14, left:'50%', transform:'translateX(-50%)',
      zIndex:9999, display:'flex', flexDirection:'column', gap:6,
      alignItems:'center', pointerEvents:'none',
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          padding:'8px 18px', borderRadius:5, fontFamily:'monospace', fontSize:IS_DEM ? 12 : 10,
          fontWeight:'bold', letterSpacing:0.5, pointerEvents:'all',
          cursor:'pointer', maxWidth:440, textAlign:'center',
          animation:'slideDown 0.25s ease',
          ...(t.type === 'warning' ? {
            background:'rgba(80,40,0,0.95)', border:'1px solid #ff8800',
            color:'#ffcc44', boxShadow:'0 0 12px rgba(255,120,0,0.4)',
          } : t.type === 'error' ? {
            background:'rgba(60,0,0,0.95)', border:'1px solid #ff3333',
            color:'#ff7766', boxShadow:'0 0 12px rgba(255,40,40,0.4)',
          } : {
            background:'rgba(0,40,0,0.95)', border:'1px solid #44ff66',
            color:'#88ffaa', boxShadow:'0 0 12px rgba(40,180,60,0.3)',
          }),
        }} onClick={() => onDismiss(t.id)}>
          {t.type === 'warning' ? '⚠ ' : t.type === 'error' ? '✖ ' : '✓ '}
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ---- Data provenance / fallback badge (bottom-left, collapsible) ----
const LINK = { color:'#ffb080' };
function SiteBadge({ collapsed, onToggle, narrow = false }) {
  const base = {
    position:'absolute', left: narrow ? 6 : 12, bottom: narrow ? `calc(${SHEET_VH}vh + 6px)` : 10, zIndex:15,
    maxWidth: narrow ? 'calc(100vw - 12px)' : 560, maxHeight: narrow ? `calc(${100 - SHEET_VH}vh - 80px)` : undefined, overflowY: narrow ? 'auto' : undefined,
    fontFamily:'monospace', fontSize:IS_DEM ? 10.5 : 9, lineHeight:1.5, padding:'6px 9px',
    borderRadius:4, pointerEvents:'auto',
  };
  if (!IS_DEM) {
    if (!SITE.loadError) return null; // ?site=moon — deliberate procedural mode
    return (
      <div style={{ ...base, background:'rgba(70,35,0,0.92)', border:'1px solid #ff8800', color:'#ffcc88' }}>
        ⚠ DEM could not be loaded → showing the procedural Moon terrain.<br/>
        {SITE.loadError}<br/>
        Fix: run <code>python pipeline/build_site.py</code> and reload the page.
      </div>
    );
  }
  if (collapsed) {
    return (
      <div onClick={onToggle} title="Show data sources" style={{ ...base, cursor:'pointer',
        background:'rgba(20,10,6,0.82)', border:'1px solid rgba(232,168,120,0.35)', color:'#e8c4a8' }}>
        ⓘ DATA SOURCES & LIMITS ▸
      </div>
    );
  }
  const m = SITE.meta;
  const ph = placeholderParams();
  const as = assumptionParams().map(k => paramEntry(k).label || k);
  const mars = getEvaProfile() === 'mars';
  return (
    <div style={{ ...base, background:'rgba(20,10,6,0.85)', border:'1px solid rgba(232,168,120,0.35)', color:'#e8c4a8' }}>
      <span onClick={onToggle} title="Hide" style={{ float:'right', cursor:'pointer', marginLeft:8, color:'#ffb080' }}>▾ hide</span>
      TERRAIN: {m.source?.title || 'DTM'} · {m.grid.cell_m} m grid · {Math.round(m.grid.span_m)} m site{' '}
      {m.source?.doi && <a href={m.source.doi} target="_blank" rel="noreferrer" style={LINK}>DOI</a>}<br/>
      CENTER: {m.center.lat_deg.toFixed(4)}°N {m.center.lon_deg_east.toFixed(4)}°E ·
      {' '}elevation {m.elevation_m.min.toFixed(0)}…{m.elevation_m.max.toFixed(0)} m<br/>
      EVA LIMITS ({EVA_PROFILES[getEvaProfile()].label}): slope ≤{param('maxWalkableSlopeDeg')}° · level walk {param('levelWalkSpeedKmh')} km/h ·
      {' '}≤{param('evaDurationH')} h · ≤{param('maxRadialDistanceKm')} km —{' '}
      <a href={MARSWALK_PROFILE.maxWalkableSlopeDeg.url} target="_blank" rel="noreferrer" style={LINK}>NASA xEVA ConOps</a>
      {mars && <>{' '}· Mars suited cost ×{MARS_SUIT_COST_RATIO.value.toFixed(2)}{' '}
        <a href={MARS_SUIT_COST_RATIO.url} target="_blank" rel="noreferrer" style={LINK}>Norcross 2009</a>
        {' '}· 30-min reserve{' '}<a href={paramEntry('evaDurationH').url} target="_blank" rel="noreferrer" style={LINK}>Apollo 17</a></>}
      {' '}· crew EV1+EV2 —{' '}
      <a href={EVA_CREW.url} target="_blank" rel="noreferrer" style={LINK}>NASA lunar EVA ConOps</a>
      {as.length > 0 && <div>ASSUMED: {as.join(', ')}</div>}
      {SITE.climate && (SITE.climate.instrument === 'REMS ATS' ? <div>
        AIR: Curiosity REMS ambient air temperature (MODRDR, PDS Atmospheres Node), sols {SITE.climate.solRange.join('–')} — one Mars year,{' '}
        <a href={SITE.climate.source.url} target="_blank" rel="noreferrer" style={LINK}>PDS</a>
      </div> : <div>
        AIR: MEDA ATS derived temperatures — Hueso et al. 2024,{' '}
        <a href={SITE.climate.source.doi} target="_blank" rel="noreferrer" style={LINK}>Zenodo</a>, CC BY 4.0
      </div>)}
      {SITE.geology && <div>
        {SITE.geology.source?.kind === 'derived' ? 'LANDFORMS' : 'GEOLOGY'}: {SITE.geology.source?.short || SITE.geology.source?.title}
        {SITE.geology.source?.doi && <>,{' '}<a href={SITE.geology.source.doi} target="_blank" rel="noreferrer" style={LINK}>DOI</a></>}
        {SITE.geology.source?.license ? `, ${SITE.geology.source.license.replace(/-/g, ' ')}` : ''}
      </div>}
      <div>SUN: Mars24 algorithm (NASA GISS; Allison &amp; McEwen 2000)</div>
      {SITE.layers?.thermal && <div>THERMAL: THEMIS thermal inertia (Mars Odyssey) — Edwards &amp; Buz 2021,{' '}
        <a href={SITE.layers.thermal.source.doi} target="_blank" rel="noreferrer" style={LINK}>Zenodo</a>, CC BY 4.0</div>}
      {SITE.layers?.minerals && <div>MINERALS: CRISM dominant mineralogy (MRO) — Parente et al. 2021,{' '}
        <a href={SITE.layers.minerals.source.doi} target="_blank" rel="noreferrer" style={LINK}>Zenodo</a>, CC BY 4.0</div>}
      {SITE.layers?.rock && <div>ROCKS: relief within each 4 m cell of the 1 m HiRISE DTM (proxy for boulders / outcrops)</div>}
      <div>RADIATION: Curiosity RAD surface dose (Hassler et al. 2014){radiationIsLocal() ? ', measured in this crater (on its floor, ≈0.9 km below this site)' : ' — TRANSFERRED from Gale crater as a reference, not measured here'} · space weather: NASA CCMC DONKI (catalogue, not a forecast)</div>
      {SITE.pov && <div>GROUND VIEW: {SITE.pov.rover || 'Perseverance'} {SITE.pov.rover === 'Curiosity' ? 'Navcam / Mastcam' : 'Navcam / Mastcam-Z'} frames from {SITE.pov.stations.length} rover positions in this site, {SITE.pov.credit?.split(' (')[0] || 'NASA/JPL-Caltech'}</div>}
      {SITE.ortho && <div>ORBITAL IMAGE: {SITE.ortho.source?.title}, {SITE.ortho.source?.creators} ({SITE.ortho.source?.year}){SITE.ortho.source?.doi && <>,{' '}<a href={SITE.ortho.source.doi} target="_blank" rel="noreferrer" style={LINK}>DOI</a></>} · shown at {SITE.ortho.pixel_m} m/px</div>}
      {SITE.chemistry && <div>CHEMISTRY: {SITE.chemistry.source?.title}, {SITE.chemistry.stats?.targets} targets in this site (sols {SITE.chemistry.stats?.sols?.join('–')}), {SITE.chemistry.source?.publisher}</div>}
      {!SITE.climate && <div style={{color:'#bb9977'}}>AIR TEMPERATURE: no climatology for this site yet — the plan uses sun and shadow only.</div>}
      <div>SUIT &amp; ROVER: Ogilvie et al., ICES 2026 (NASA) — suit masses, carry limit, 30-min rover walkback</div>
      <div style={{color: mars ? '#99cc99' : '#ffaa55', marginTop:3}}>
        {mars ? '✓ Mars-conservative EVA limits: slower walk, 30-min reserve, shorter radius (Mission setup).'
              : '⚠ These EVA limits were written for the Moon — optimistic for Mars. Try Mars conservative in Mission setup.'}{' '}
        <a href={MARS_CAVEAT.url} target="_blank" rel="noreferrer" style={{color:'#ffcc88'}} title={MARS_CAVEAT.note}>Why?</a>
      </div>
      {ph.length > 0 && (
        <div style={{color:'#ffaa55', marginTop:3}}>
          ⚠ Unsourced parameter: {ph.join(', ')} (temporary value)
        </div>
      )}
    </div>
  );
}

// A shared link (?plan=…, utils/shareLink.js) restores site settings and re-plans on load
const SHARED = typeof window !== 'undefined' ? decodePlan(window.location.search) : null;

export default function App() {
  const [roverState, setRoverState] = useState(() => ({
    x: DEFAULT_HOME.x, y: getTerrainHeight(DEFAULT_HOME.x, DEFAULT_HOME.z) + 0.45, z: DEFAULT_HOME.z,
    speed: 0, heading: 0, autoMode: false,
  }));
  // waypoints: ordered array of {x, z} — first = start, last = end, middle = intermediate
  const [waypoints, setWaypoints]   = useState([]);
  const [routes, setRoutes]         = useState(null); // { SAFE:{path,stats}, ECO:{path,stats}, ... }
  const [activeRoute, setActiveRoute] = useState(SHARED?.route || (IS_DEM ? 'SAFE' : 'AUTO'));
  const [sunAngleState, setSunAngleDeg] = useState(45);
  // DEM: EVA start time drives the sun (Mars24). Default: today, 09:00 LTST at the site.
  const siteCenter = SITE.meta?.center;
  const [evaStartMs, setEvaStartMs] = useState(() =>
    IS_DEM && siteCenter ? (SHARED?.startMs ?? msAtLtst(Date.now(), 9, siteCenter.lon_deg_east)) : null);
  const sun = useMemo(() => (IS_DEM && siteCenter && evaStartMs != null)
    ? sunPosition(evaStartMs, siteCenter.lat_deg, siteCenter.lon_deg_east) : null,
  [evaStartMs, siteCenter]);
  // Existing consumers (scene light, illumination) use an azimuth in degrees
  const sunAngleDeg = sun ? Math.round(sun.azimuthDeg * 10) / 10 : sunAngleState;
  const sunElevationDeg = sun ? sun.elevationDeg : undefined;
  const [wireframe, setWireframe]   = useState(false);
  const [orthoOn, setOrthoOn]       = useState(!!SITE.ortho);   // HiRISE image on the terrain
  const [cameraMode, setCameraMode] = useState('follow');
  const [routeLog, setRouteLog]     = useState([`[${ts()}] Ready. ${IS_DEM ? 'Choose a mission objective, then press PLAN SCIENCE EVA — or add waypoints and press PLAN PATH.' : 'Add waypoints and press PLAN PATH.'}`]);
  const [isRoving, setIsRoving]     = useState(false);
  const [resetKey, setResetKey]     = useState(0);
  const [toasts, setToasts]         = useState([]);
  const [isPlanning, setIsPlanning] = useState(false);
  const planSeqRef = useRef(0);   // stale-result guard for async planning
  // Stage 6 — science EVA (geology stops). null = none planned
  const [science, setScience] = useState(null);
  const [scienceDwellMin, setScienceDwellMin] = useState(SHARED?.dwellMin ?? SCIENCE_PARAMS.dwellMin);
  // Suit, equipment and rover safe haven (config/mission.js)
  const [mission, setMission] = useState(() => {
    const m = { ...DEFAULT_MISSION, ...(SHARED?.mission || {}) };
    if (!SUITS[m.suit]) m.suit = DEFAULT_MISSION.suit;
    return m;
  });
  // The active EVA limit set follows Mission setup; set before any planning in this render
  setEvaProfile(mission.limits || 'lunar');
  setObstacleBufferM(mission.obstacleBufferM || 0);
  setHazardContext({ bufferM: mission.obstacleBufferM || 0, rover: mission.rover });
  // Mission objective (config/objectives.js): must be chosen before the science-stop planner runs.
  // Old shared links with a science plan but no objective re-plan as the original survey.
  const objectives = useMemo(() => (IS_DEM ? objectivesForSite(SITE.name) : []), []);
  const objectiveSupportMap = useMemo(() => {
    const an = SITE.chemistry ? chemAnomalies(SITE.chemistry) : [];
    const tags = [...new Set(an.map(a => a.tag))];
    const s = { ...SITE, chemAnomalyCount: tags.length, chemAnomalyTags: tags, chemTargetCount: SITE.chemistry?.targets?.length || 0 };
    return Object.fromEntries(objectives.map(o => [o.id, objectiveSupport(o, s)]));
  }, [objectives]);
  const [objectiveId, setObjectiveId] = useState(() => {
    const id = SHARED?.objective;
    if (id && objectives.some(o => o.id === id)) return id;
    return SHARED?.science ? 'survey' : null;
  });
  const [isPlanningScience, setIsPlanningScience] = useState(false);
  const autoPlanRef = useRef(false);   // plan as soon as the science waypoints are committed
  const [badgeCollapsed, setBadgeCollapsed] = useState(() => !!window.matchMedia?.(COMPACT_QUERY).matches);   // phones: start collapsed
  const narrow = useNarrow();
  const compact = useCompact();   // narrow, or a phone held sideways
  // DEM: map layer draped on the 3D terrain (null = off)
  const [drapeLayer, setDrapeLayer] = useState(null);
  const [drapeOpacity, setDrapeOpacity] = useState(0.6);
  // DEM: the rover's own route and named places, on the map and in 3D
  const [showTrack, setShowTrack] = useState(true);

  // Stage 7 — EVA playback (DEM): controller + the bits of its state React needs
  const playback = useMemo(() => new EvaPlayback(), []);
  const [evaStatus, setEvaStatus] = useState('idle');
  const [evaTick, setEvaTick] = useState(0);            // bumps on EVA events (flags, return path)
  const [trailKey, setTrailKey] = useState(0);          // wipes boot prints on a new / restarted EVA
  const loadedRouteRef = useRef(null);                  // the routes[mode] object that is loaded
  const sceneApiRef = useRef(null);                     // camera / controls (scripted demo capture)

  // Warm up the planner worker at start (DEM): the first PLAN PATH waits less
  useEffect(() => { warmPlanner(); }, []);

  // ---- Dust Hazard State Machine ----
  // 'normal' | 'dust_placement_mode' | 'dust_present' | 'dust_interference_detected' | 'signal_lost' | 'stopped' | 'return_to_home'
  const [dustMode, setDustMode]     = useState(DUST_STATES.NORMAL);
  const [dustHazard, setDustHazard] = useState(null); // null | { x, z, radius }
  const [cameraSignalLost, setCameraSignalLost] = useState(false);
  const [cameraSignalQuality, setCameraSignalQuality] = useState(1);
  const homeWaypointRef    = useRef({ ...DEFAULT_HOME }); // updated by first waypoint if present
  const prevActiveRouteRef = useRef(null); // restored after return trip
  const interferenceLatchedRef = useRef(false);
  const interferenceTicksRef = useRef(0);

  const pathRef      = useRef({ _roverTrail: [] });
  const learningModel = useMemo(() => new LearningModel(), []);

  // ---- Terrain maps (built once) ----
  const mapsRef = useRef(null);
  const getMaps = useCallback(() => {
    if (!mapsRef.current) {
      const hm = buildHeightMap();
      const sm = buildSlopeMap(hm);
      const cm = buildCraterMask();
      mapsRef.current = { hm, sm, cm };
    }
    return mapsRef.current;
  }, []);

  const { hm, sm, cm } = useMemo(() => {
    const m = getMaps(); return { hm: m.hm, sm: m.sm, cm: m.cm };
  }, [getMaps]);

  // ---- Toast helpers ----
  const showToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = ++_toastId;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ---- Logging ----
  const addLog = useCallback((msg) => {
    setRouteLog(prev => [...prev, `[${ts()}] ${msg}`].slice(-30));
  }, []);

  // ---- EVA playback events → React state, log and toasts ----
  const dustHazardRef = useRef(null);
  useEffect(() => { dustHazardRef.current = dustHazard; }, [dustHazard]);
  useEffect(() => playback.subscribe((kind, pb) => {
    setEvaStatus(pb.status);
    if (kind === 'load' || (kind === 'status' && pb.t === 0)) setTrailKey(k => k + 1);
    if (kind !== 'event') { if (kind === 'status' || kind === 'load' || kind === 'seek') setEvaTick(v => v + 1); return; }
    const e = pb.events[pb.events.length - 1];
    if (!e) return;
    setEvaTick(v => v + 1);
    addLog(`EVA ${fmtClock(e.t)} · ${e.text}`);
    if (e.kind === 'abort') {
      showToast(e.text, 'warning', 6500);
      if (/dust/.test(e.reason || '')) setDustMode(DUST_STATES.RETURN_HOME);
    } else if (e.kind === 'ponr') showToast('⛔ Point of no return passed — this plan is NO-GO', 'error', 6500);
    else if (e.kind === 'abort-failed' || e.kind === 'nopath') showToast(e.text, 'error', 6500);
    else if (e.kind === 'done') {
      showToast(e.text, 'info', 5500);
      if (pb.aborted && /dust/.test(pb.aborted.reason)) setDustMode(dustHazardRef.current ? DUST_STATES.PRESENT : DUST_STATES.NORMAL);
    }
  }), [playback, addLog, showToast]);

  // Space = play/pause the EVA (DEM)
  useEffect(() => {
    if (!IS_DEM) return;
    const onKey = (e) => {
      if (e.code !== 'Space' || !playback.loaded) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'button') return;
      e.preventDefault();
      playback.toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playback]);

  // A plan change invalidates the loaded EVA
  useEffect(() => {
    if (!IS_DEM || !playback.loaded) return;
    if (loadedRouteRef.current !== routes?.[activeRoute]) {
      playback.stop();
      loadedRouteRef.current = null;
    }
  }, [routes, activeRoute, playback]);

  const buildEvaEnv = useCallback(() => {
    const { hm: hmap } = getMaps();
    const c = SITE.meta?.center;
    return {
      toHomeAt: toHomeTimeAt,
      returnPath: (x, z) => fastestReturnPath(x, z, hmap),
      heightAt: getTerrainHeight,
      sunAt: c ? (ms) => sunPosition(ms, c.lat_deg, c.lon_deg_east) : null,
      airAt: c && SITE.climate ? (ms) => airTempAt(SITE.climate, ms, c.lon_deg_east) : null,
    };
  }, [getMaps]);

  // ---- Waypoint management ----
  const addWaypoint = useCallback((pos) => {
    const { sm: sm2, cm: cm2 } = getMaps();

    // Hard wall check — same impassable map the router uses
    // (procedural: crater bowl+rim / debris; DEM: steeper than the slope limit)
    if (isWallAt(pos.x, pos.z)) {
      showToast(WALL_REJECT_MSG, 'error', 7000);
      return;
    }

    const hazard = getHazardAtPoint(pos.x, pos.z, cm2, sm2);
    if (hazard > 0.45) {
      showToast(
        `⛔ WAYPOINT REJECTED — hazardous ground (hazard ${(hazard*100).toFixed(0)}%). Pick safer terrain.`,
        'error', 6000
      );
      return;
    }
    if (hazard > 0.25) {
      showToast(`⚠ Waypoint near hazard zone (danger: ${(hazard*100).toFixed(0)}%). Path will detour around obstacles.`, 'warning');
    }

    setWaypoints(prev => {
      const next = [...prev, pos];
      // Teleport rover / crew to the first waypoint
      if (prev.length === 0) {
        homeWaypointRef.current = pos; // pin home
        const y = getTerrainHeight(pos.x, pos.z);
        setRoverState(s => ({ ...s, x: pos.x, y: y + 0.45, z: pos.z }));
        setResetKey(k => k + 1);
        addLog(`Start set: (${pos.x.toFixed(0)}, ${pos.z.toFixed(0)}) — ${IS_DEM ? 'crew moved to the habitat' : 'rover teleported'}.`);
      } else {
        addLog(`Waypoint ${next.length} added: (${pos.x.toFixed(0)}, ${pos.z.toFixed(0)})`);
      }
      return next;
    });
    setRoutes(null);
    setScience(null);
  }, [getMaps, showToast, addLog]);

  // Override first waypoint → always teleport rover / crew
  const setStartWaypoint = useCallback((pos) => {
    const { sm: sm2, cm: cm2 } = getMaps();
    if (isWallAt(pos.x, pos.z)) {
      showToast(WALL_REJECT_MSG.replace('WAYPOINT', 'START POINT'), 'error', 7000);
      return;
    }
    const hazard = getHazardAtPoint(pos.x, pos.z, cm2, sm2);
    if (hazard > 0.45) {
      showToast('⛔ START POINT REJECTED — hazardous ground. Pick safer terrain.', 'error', 6000);
      return;
    }
    const y = getTerrainHeight(pos.x, pos.z);
    setRoverState(s => ({ ...s, x: pos.x, y: y+0.45, z: pos.z }));
    setResetKey(k => k + 1);
    homeWaypointRef.current = pos; // update home when start is overridden
    setWaypoints(prev => {
      const next = [...prev]; next[0] = pos; return next;
    });
    setRoutes(null);
    setScience(null);
    addLog(`Start moved to (${pos.x.toFixed(0)}, ${pos.z.toFixed(0)}) — ${IS_DEM ? 'crew moved' : 'rover teleported'}.`);
  }, [getMaps, showToast, addLog]);

  // Any waypoint edit invalidates an in-flight plan
  useEffect(() => { planSeqRef.current++; setIsPlanning(false); }, [waypoints]);

  const removeLastWaypoint = useCallback(() => {
    setWaypoints(prev => prev.length > 0 ? prev.slice(0, -1) : prev);
    setRoutes(null);
    setScience(null);
  }, []);

  const clearWaypoints = useCallback(() => {
    setWaypoints([]);
    setRoutes(null);
    setScience(null);
    playback.stop();
    loadedRouteRef.current = null;
    pathRef.current = { _roverTrail: pathRef.current._roverTrail || [] };
    pathRef.current._waypointIdx = undefined;
    clearPathCache();
    homeWaypointRef.current = { ...DEFAULT_HOME };
    setDustHazard(null);
    playback.setHazard(null);
    setDustMode(DUST_STATES.NORMAL);
    setCameraSignalLost(false);
    setCameraSignalQuality(1);
    interferenceLatchedRef.current = false;
    setIsRoving(false);
    if (prevActiveRouteRef.current) {
      setActiveRoute(prevActiveRouteRef.current);
      prevActiveRouteRef.current = null;
    }
    addLog('All waypoints cleared.');
  }, [addLog, setActiveRoute, playback]);

  // ---- Path planning ----
  const handlePlanPath = useCallback(() => {
    if (waypoints.length < 2) {
      showToast('Need at least 2 waypoints to plan a route.', 'warning');
      return;
    }
    addLog(`Planning 4 routes through ${waypoints.length} waypoints${plannerUsesWorker() ? ' (background)' : ''}...`);
    setRoutes(null);
    setIsPlanning(true);
    const mySeq = ++planSeqRef.current;
    const t0 = performance.now();

    setTimeout(async () => {
      try {
        const planned = await planRoutes(waypoints, getMaps(), sunAngleDeg, learningModel.getExperienceMap(),
          { ...(evaStartMs != null ? { startMs: evaStartMs } : {}), mission });
        // Waypoints changed / re-planned meanwhile → drop this stale result
        if (mySeq !== planSeqRef.current) return;
        setRoutes(planned);
        pathRef.current = {
          ...pathRef.current,
          SAFE: planned.SAFE.path,
          ECO:  planned.ECO.path,
          FAST: planned.FAST.path,
          AUTO: planned.AUTO.path,
        };
        for (const [mode, r] of Object.entries(planned)) {
          const s = r.stats;
          if (s?.walkTimeS !== undefined) {
            addLog(`${mode}: ${(s.distance / 1000).toFixed(2)} km, walk ${fmtHM(s.walkTimeS)}, total ${fmtHM(s.roundTripS)}, max ${s.maxSlopeDeg.toFixed(1)}° → ${s.go ? 'GO' : 'NO-GO'}`);
          } else {
            addLog(`${mode}: ${r.path.length} pts, ${s?.distance.toFixed(1)}m, risk ${s?.riskPercent.toFixed(0)}%`);
          }
        }
        addLog(`Planned in ${((performance.now() - t0) / 1000).toFixed(1)} s. Select a route and press ${IS_DEM ? 'START EVA' : 'START ROVER'}.`);
      } catch (err) {
        if (mySeq !== planSeqRef.current) return;
        addLog(`[ERR] ${err.message}`);
        showToast(`Path planning failed: ${err.message}`, 'error');
      } finally {
        if (mySeq === planSeqRef.current) setIsPlanning(false);
      }
    }, 30);
  }, [waypoints, getMaps, sunAngleDeg, showToast, addLog, learningModel, evaStartMs, mission]);

  // Science waypoints committed → plan them (runs after the invalidation effect above)
  useEffect(() => {
    if (autoPlanRef.current && waypoints.length >= 2) { autoPlanRef.current = false; handlePlanPath(); }
  }, [waypoints, handlePlanPath]);

  // ---- Science EVA (Stage 6) ----
  // Picks the best set + order of geology stops from home within the EVA budget
  // (worker), then turns them into waypoints home → stops → home with dwell.
  const handlePlanScience = useCallback(async () => {
    if (!IS_DEM || !SITE.geology) return;
    const obj = getObjective(objectiveId);
    if (!obj) { showToast('Select a mission objective first.', 'warning'); return; }
    if (objectiveSupportMap[obj.id]?.status === 'unsupported') {
      showToast(`No data in this site supports "${obj.label}".`, 'warning'); return;
    }
    const home = waypoints[0] || homeWaypointRef.current || { ...DEFAULT_HOME };
    setIsPlanningScience(true);
    addLog(`Science EVA (${obj.short}): choosing stops (dwell ${scienceDwellMin} min/stop)...`);
    try {
      const t0 = performance.now();
      const res = await planScience(home, getMaps(), { dwellMin: scienceDwellMin, objective: obj.id,
        ...(mission.rover ? { maxReturnS: ROVER.walkbackMin.value * 60 } : {}) });
      if (!res || res.stops.length === 0) {
        showToast('No geology stop fits the EVA budget from this start.', 'warning');
        addLog('Science EVA: no feasible stop.');
        return;
      }
      addLog(`Science EVA: ${res.stops.length}/${res.candidates.length} stops, score ${res.score}/${res.maxScore}, `
        + `${fmtHM(res.totalS)} planned (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
      const homeWp = { x: home.x, z: home.z };
      const stopsWp = res.stops.map(st => ({ x: st.x, z: st.z, dwellS: res.dwellS, label: st.label }));
      if (waypoints.length === 0) {
        homeWaypointRef.current = homeWp;
        setRoverState(s => ({ ...s, x: home.x, y: getTerrainHeight(home.x, home.z) + 0.45, z: home.z }));
        setResetKey(k => k + 1);
      }
      setScience(res);
      autoPlanRef.current = true;
      setWaypoints([homeWp, ...stopsWp, homeWp]);
    } catch (err) {
      addLog(`[ERR] science: ${err.message}`);
      showToast(`Science planning failed: ${err.message}`, 'error');
    } finally {
      setIsPlanningScience(false);
    }
  }, [waypoints, getMaps, scienceDwellMin, addLog, showToast, mission, objectiveId, objectiveSupportMap]);

  // Changing the objective invalidates a science plan made for another one (stops + routes)
  const handleSelectObjective = useCallback((id) => {
    if (id === objectiveId) return;
    setObjectiveId(id);
    if (science) {
      const home = waypoints[0] || homeWaypointRef.current;
      setScience(null);
      setRoutes(null);
      setWaypoints(home ? [{ x: home.x, z: home.z }] : []);
      addLog(`Objective changed to "${getObjective(id)?.label}" — science plan cleared; press PLAN SCIENCE EVA.`);
    } else {
      addLog(`Objective: ${getObjective(id)?.label}.`);
    }
  }, [objectiveId, science, waypoints, addLog]);

  // Shared link: rebuild the plan once on load (same start, same settings → same stops and routes)
  const sharedDoneRef = useRef(false);
  useEffect(() => {
    if (sharedDoneRef.current || !SHARED || SHARED.waypoints.length === 0) return;
    sharedDoneRef.current = true;
    const home = SHARED.waypoints[0];
    homeWaypointRef.current = { x: home.x, z: home.z };
    setRoverState(s => ({ ...s, x: home.x, y: getTerrainHeight(home.x, home.z) + 0.45, z: home.z }));
    setResetKey(k => k + 1);
    if (SHARED.science && IS_DEM && SITE.geology) {
      handlePlanScience();
    } else if (SHARED.waypoints.length >= 2) {
      autoPlanRef.current = true;
      setWaypoints(SHARED.waypoints);
    }
    addLog(`Plan restored from a shared link${SHARED.science ? ' (science EVA re-planned)' : ''}.`);
  }, [handlePlanScience, addLog]);

  // ---- Rover / EVA control ----
  const handleStartRover = useCallback(() => {
    if (!activeRoute || !routes?.[activeRoute]) return;
    if (IS_DEM) {
      const r = routes[activeRoute];
      if (!r?.stats?.elapsedS) return;
      try {
        if (!playback.loaded || loadedRouteRef.current !== r) {
          playback.load(r.path, r.stats, {
            mode: activeRoute, budgetS: r.stats.budgetS, startMs: evaStartMs,
            ponrIdx: r.stats.ponrIdx, go: r.stats.go,
          }, buildEvaEnv());
          loadedRouteRef.current = r;
        }
        playback.setHazard(dustHazard);
        playback.play();
        setCameraMode('follow');
        setBadgeCollapsed(true);
        addLog(`EVA started on the ${activeRoute} route (${r.stats.go ? 'GO' : 'NO-GO'} plan, ${fmtHM(r.stats.roundTripS)}).`);
      } catch (err) {
        addLog(`[ERR] EVA playback: ${err.message}`);
        showToast(`EVA playback failed: ${err.message}`, 'error');
      }
      return;
    }
    const route = routes[activeRoute].path;
    if (route?.length > 0) {
      const first = route[0];
      // Use _teleportTo so the controller snaps the rover to route start on next frame
      // (NO setResetKey — remounting destroys roverRef and resets position to [0,0,0])
      pathRef.current._roverTrail  = [[first[0], first[1], first[2]]];
      pathRef.current._waypointIdx = 0;
      pathRef.current._teleportTo  = { x: first[0], y: first[1], z: first[2] };
      setIsRoving(true);
      if (dustHazard) setDustMode(DUST_STATES.PRESENT);
      addLog(`Rover started on ${activeRoute} (${route.length} pts).`);
    }
  }, [activeRoute, routes, addLog, dustHazard, playback, evaStartMs, buildEvaEnv, showToast]);

  const handleStopRover = useCallback(() => {
    if (IS_DEM) {
      playback.stop();
      loadedRouteRef.current = null;
      addLog('EVA playback closed — crew back at the habitat.');
      return;
    }
    pathRef.current._waypointIdx = undefined;
    setRoverState(s => ({ ...s, autoMode: false }));
    setIsRoving(false);
    if (dustHazard) setDustMode(DUST_STATES.STOPPED);
    addLog('Rover stopped.');
  }, [addLog, dustHazard, playback]);

  useEffect(() => {
    if (IS_DEM) return;
    if (roverState.autoMode === false && isRoving) setIsRoving(false);
  }, [roverState.autoMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAbortEva = useCallback(() => {
    if (!playback.abort('manual abort')) showToast('Nothing to abort — start the EVA first.', 'warning');
  }, [playback, showToast]);

  // ---- Dust Hazard: delayed Return To Home ----
  // This only arms/cancels dust-hazard PLACEMENT mode — it never drives the
  // rover home itself. The actual return-to-home drive is startReturnToHome()
  // below, auto-triggered once a placed hazard causes sensor interference.
  // DEM: a dust devil on the route ahead aborts the EVA inside the playback.
  const handleTriggerDustHazard = useCallback(() => {
    if (dustMode === DUST_STATES.PLACEMENT) {
      setDustMode(dustHazard ? DUST_STATES.PRESENT : DUST_STATES.NORMAL);
      addLog('Dust placement cancelled.');
      return;
    }
    setDustMode(DUST_STATES.PLACEMENT);
    addLog(`Dust placement mode active: click the map to place a ${IS_DEM ? 'dust devil' : 'dust hazard'}.`);
  }, [dustMode, dustHazard, addLog]);

  const handleDustPlaced = useCallback((pos) => {
    const hazard = createDustHazard(pos.x, pos.z, DUST_HAZARD_CONFIG);
    setDustHazard(hazard);
    setDustMode(DUST_STATES.PRESENT);
    setCameraSignalLost(false);
    setCameraSignalQuality(1);
    interferenceLatchedRef.current = false;
    interferenceTicksRef.current = 0;
    if (IS_DEM) {
      playback.setHazard(hazard);
      showToast('Dust devil placed. If it sits on the route ahead, the crew aborts and walks home.', 'info', 5500);
      addLog(`Dust devil placed at (${pos.x.toFixed(0)}, ${pos.z.toFixed(0)}), r=${hazard.radius} m. Route look-ahead active.`);
      return;
    }
    showToast('ℹ Dust hazard placed. Rover remains active; interference monitoring enabled.', 'info', 5000);
    addLog(`Dust hazard placed at (${pos.x.toFixed(0)}, ${pos.z.toFixed(0)}). Monitoring active.`);
  }, [showToast, addLog, playback]);

  const startReturnToHome = useCallback((triggerReason) => {
    if (interferenceLatchedRef.current) return;
    interferenceLatchedRef.current = true;

    setDustMode(DUST_STATES.INTERFERENCE);
    showToast('⚠ DUST INTERFERENCE DETECTED — optical sensor instability.', 'warning', 6000);
    addLog(`Dust interference detected (${triggerReason}).`);

    // Stage 1: signal alarm + hard stop
    setTimeout(() => {
      setDustMode(DUST_STATES.SIGNAL_LOST);
      setCameraSignalLost(true);
      setCameraSignalQuality(0.06);
      interferenceTicksRef.current = 0;
      pathRef.current._waypointIdx = undefined;
      setRoverState(s => ({ ...s, autoMode: false }));
      setIsRoving(false);

      setDustMode(DUST_STATES.STOPPED);

      // Stage 2: plan and launch return route
      const home = homeWaypointRef.current || { ...DEFAULT_HOME };
      const roverPos = { x: roverState.x, z: roverState.z };
      (async () => { try {
        const maps = getMaps();
        const returnPath = plannerUsesWorker()
          ? (await planRoutes([roverPos, home], maps, sunAngleDeg, null, { home, modes: ['SAFE'] }))?.SAFE?.path
          : buildReturnToHomePath(roverPos, home, maps, sunAngleDeg, learningModel.getExperienceMap());
        if (!returnPath || returnPath.length < 2) {
          throw new Error('No valid return path available');
        }

        pathRef.current.HOME_RETURN = returnPath;
        prevActiveRouteRef.current = activeRoute;
        setRoutes(prev => ({ ...(prev || {}), HOME_RETURN: { path: returnPath, stats: null } }));
        setActiveRoute('HOME_RETURN');
        pathRef.current._roverTrail = [[roverState.x, roverState.y, roverState.z]];
        pathRef.current._waypointIdx = 0;
        pathRef.current._teleportTo = null;
        setIsRoving(true);
        setDustMode(DUST_STATES.RETURN_HOME);
        addLog(`Return To Home started (${returnPath.length} pts).`);
      } catch (err) {
        addLog(`[ERR] Return To Home planning failed: ${err.message}`);
        showToast('Return To Home path unavailable. Rover remains in safe STOPPED state.', 'error', 7000);
      } })();
    }, 260);
  }, [addLog, showToast, roverState.x, roverState.y, roverState.z, getMaps, sunAngleDeg, activeRoute, learningModel]);

  // Continuous hazard monitoring: evaluated every navigation update via roverState changes.
  useEffect(() => {
    if (!dustHazard || !dustHazard.active) return;

    const activePath =
      routes?.[activeRoute]?.path
      || (activeRoute === 'HOME_RETURN' ? pathRef.current.HOME_RETURN : null)
      || null;

    const evalResult = evaluateDustInterference(
      roverState,
      dustHazard,
      activePath,
      DUST_HAZARD_CONFIG
    );

    if (IS_DEM) {
      // Helmet-cam / comms degradation near the dust devil (visual); the abort
      // decision itself is the playback's route look-ahead.
      setCameraSignalQuality(evalResult.distanceToHazard <= dustHazard.interferenceRadius * 1.6 ? evalResult.signalQuality : 1);
      return;
    }

    if (evalResult.interferenceDetected) {
      interferenceTicksRef.current = Math.min(100, interferenceTicksRef.current + 1);
    } else {
      interferenceTicksRef.current = Math.max(0, interferenceTicksRef.current - 2);
    }

    // Start showing camera distortion later (close to signal-loss confirmation), not immediately.
    if (!cameraSignalLost) {
      const triggerTicks = DUST_HAZARD_CONFIG.triggerPersistenceTicks || 6;
      const degradeStartTicks = Math.max(1, triggerTicks - 2);
      if (interferenceTicksRef.current >= degradeStartTicks) {
        setCameraSignalQuality(evalResult.signalQuality);
      } else {
        setCameraSignalQuality(1);
      }
    }

    const sustainedInterference =
      interferenceTicksRef.current >= (DUST_HAZARD_CONFIG.triggerPersistenceTicks || 6);

    if (
      sustainedInterference
      && dustMode !== DUST_STATES.PLACEMENT
      && dustMode !== DUST_STATES.RETURN_HOME
      && dustMode !== DUST_STATES.SIGNAL_LOST
      && dustMode !== DUST_STATES.STOPPED
    ) {
      startReturnToHome(evalResult.reason);
    }
  }, [
    dustHazard,
    routes,
    activeRoute,
    roverState,
    dustMode,
    cameraSignalLost,
    startReturnToHome,
  ]);

  const handleClearDustHazard = useCallback(() => {
    setDustHazard(null);
    playback.setHazard(null);
    setDustMode(DUST_STATES.NORMAL);
    setCameraSignalLost(false);
    setCameraSignalQuality(1);
    interferenceLatchedRef.current = false;
    interferenceTicksRef.current = 0;
    setRoutes(prev => {
      if (!prev) return prev;
      // eslint-disable-next-line no-unused-vars
      const { HOME_RETURN: _unused, ...rest } = prev;
      return Object.keys(rest).length ? rest : null;
    });
    if (prevActiveRouteRef.current && activeRoute === 'HOME_RETURN') {
      setActiveRoute(prevActiveRouteRef.current);
    }
    prevActiveRouteRef.current = null;
    addLog(`${IS_DEM ? 'Dust devil' : 'Dust hazard'} cleared and monitoring reset.`);
  }, [addLog, setActiveRoute, activeRoute, playback]);

  useEffect(() => {
    if (IS_DEM) return;
    if (dustMode === DUST_STATES.RETURN_HOME && !isRoving) {
      setDustMode(DUST_STATES.STOPPED);
      setCameraSignalLost(false);
      setCameraSignalQuality(1);
      interferenceLatchedRef.current = false;
      showToast('✓ Rover returned home after dust interference event.', 'info', 5500);
      addLog('Rover reached home waypoint. Return sequence completed.');
      if (prevActiveRouteRef.current) {
        setActiveRoute(prevActiveRouteRef.current);
      }
      prevActiveRouteRef.current = null;
    }
  }, [dustMode, isRoving, showToast, addLog, setActiveRoute]);

  // DEM: EVA start changed → refresh lighting stats by re-planning in the background
  const lastStartRef = useRef(evaStartMs);
  useEffect(() => {
    if (!IS_DEM || evaStartMs === lastStartRef.current) return;
    lastStartRef.current = evaStartMs;
    if (!routes || waypoints.length < 2) return;
    const id = setTimeout(() => handlePlanPath(), 400);   // debounce slider drags
    return () => clearTimeout(id);
  }, [evaStartMs]); // eslint-disable-line react-hooks/exhaustive-deps

  // DEM: suit / equipment / rover changed → re-plan so the GO checks follow
  const lastMissionRef = useRef(mission);
  useEffect(() => {
    if (!IS_DEM || mission === lastMissionRef.current) return;
    lastMissionRef.current = mission;
    if (!routes || waypoints.length < 2) return;
    const id = setTimeout(() => handlePlanPath(), 300);
    return () => clearTimeout(id);
  }, [mission]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-plan when sun angle changes significantly (10° threshold)
  const lastSunRef = useRef(sunAngleDeg);
  useEffect(() => {
    if (routes && Math.abs(sunAngleDeg - lastSunRef.current) >= 10) {
      lastSunRef.current = sunAngleDeg;
      clearPathCache();
    }
  }, [sunAngleDeg, routes]);

  // Crew pose from the 3D scene (~10 Hz) → minimap arrow, telemetry, dust monitor
  const onCrewPose = useCallback((p) => setRoverState(p), []);

  // Abort return path (dashed line) while the crew walks home
  const returnPath = useMemo(() => {
    if (!IS_DEM || !playback.aborted || !playback.active) return null;
    const tl = playback.active;
    return Array.from({ length: tl.n }, (_, i) => [tl.xs[i], 0, tl.zs[i]]);
  }, [playback, evaTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const evaActive = IS_DEM && evaStatus !== 'idle';
  const roving = IS_DEM ? (evaStatus === 'playing' || evaStatus === 'paused') : isRoving;

  // Dev-only hook (Playwright reads state / drives the demo capture); stripped from prod builds
  if (import.meta.env.DEV) {
    window.__mm = {
      roverState, routes, activeRoute, isRoving: roving, playback, science, waypoints,
      sceneApi: sceneApiRef, setCameraMode, setActiveRoute, setBadgeCollapsed, setEvaStartMs, evaStartMs,
      planScience: handlePlanScience, startEva: handleStartRover, abortEva: handleAbortEva,
      setDrapeLayer, setDrapeOpacity,
      placeDust: handleDustPlaced, clearDust: handleClearDustHazard,
    };
  }

  // Extract just paths for MoonScene (which draws lines)
  const routePaths = useMemo(() => {
    if (!routes) return null;
    return Object.fromEntries(Object.entries(routes).map(([m, r]) => [m, r.path]));
  }, [routes]);

  const crewIdlePos = waypoints[0] || homeWaypointRef.current || DEFAULT_HOME;

  return (
    <div style={{ width:'100vw', height:'100vh', overflow:'hidden', position:'relative', background: IS_DEM ? '#2a1a12' : '#000008' }}>
      <style>{`
        @keyframes slideDown { from { opacity:0; transform:translateY(-12px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      {/* 3D Scene */}
      <div style={narrow
        ? { position:'absolute', top:0, left:0, right:0, bottom:`${SHEET_VH}vh` }
        : { position:'absolute', inset:0, right:PANEL_W }}>
        <Suspense fallback={
          <div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',
            color:'#44ff88',fontSize:13,fontFamily:'monospace',letterSpacing:'0.18em'}}>
            {IS_DEM ? 'LOADING MARTIAN SURFACE...' : 'LOADING LUNAR SURFACE...'}
          </div>
        }>
          <MoonScene
            key={resetKey}
            roverState={roverState}
            setRoverState={setRoverState}
            pathRef={pathRef}
            routes={routePaths}
            activeRoute={activeRoute}
            waypoints={waypoints}
            cameraMode={cameraMode}
            wireframe={wireframe}
            orthoOn={orthoOn}
            sunAngleDeg={sunAngleDeg}
            sunElevationDeg={sunElevationDeg}
            learningModel={learningModel}
            dustHazard={dustHazard}
            ponrPoint={routes?.[activeRoute]?.stats?.ponrPoint || null}
            playback={IS_DEM ? playback : null}
            crewIdlePos={crewIdlePos}
            onCrewPose={IS_DEM ? onCrewPose : null}
            trailKey={trailKey}
            returnPath={returnPath}
            sceneApiRef={sceneApiRef}
            showTrack={showTrack}
            overlay={IS_DEM && drapeLayer ? { layer: drapeLayer, opacity: drapeOpacity, refreshKey: routes } : null}
          />
        </Suspense>
      </div>

      {/* HUD */}
      <div style={{
        position:'absolute', top: compact ? 6 : 10, left: compact ? 8 : 12, right: narrow ? 8 : (compact ? PANEL_W + 8 : undefined),
        color: IS_DEM ? 'rgba(255,214,170,0.92)' : 'rgba(110,190,110,0.8)', fontFamily:'monospace',
        fontSize: compact ? 10.5 : (IS_DEM ? 13 : 11),
        letterSpacing: compact ? '0.08em' : '0.2em', zIndex:15, pointerEvents:'none',
        textShadow: IS_DEM ? '0 0 8px rgba(0,0,0,0.7)' : '0 0 8px rgba(40,180,40,0.4)',
      }}>
        {IS_DEM ? `MARTIAN MAP · ${(SITE.meta?.label || SITE.name).toUpperCase()}` : 'MOON ROVER SIMULATOR'}
        {IS_DEM && <SiteSwitcher current={SITE.name} />}
        <div style={{fontSize: IS_DEM ? 9.5 : 8, color: IS_DEM ? 'rgba(255,214,170,0.65)' : 'rgba(70,130,70,0.6)', marginTop:2}}>
          {compact ? 'DRAG=ROTATE · TWO FINGERS=PAN / ZOOM'
            : <>LEFT DRAG=PAN · RIGHT DRAG=ROTATE · SCROLL=ZOOM{IS_DEM ? ' · SPACE=PLAY/PAUSE EVA' : ''}</>}
        </div>
      </div>
      <SiteBadge collapsed={badgeCollapsed} onToggle={() => setBadgeCollapsed(c => !c)} narrow={narrow} />

      {evaActive && (
        <EvaHud playback={playback} right={narrow ? 6 : PANEL_W + 12} narrow={narrow} compact={compact} onAbort={handleAbortEva} onStop={handleStopRover} />
      )}

      {/* Toasts */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Right Panel */}
      <RightPanel
        roverState={roverState}
        pathRef={pathRef}
        routes={routes}
        activeRoute={activeRoute}
        setActiveRoute={setActiveRoute}
        waypoints={waypoints}
        onAddWaypoint={addWaypoint}
        onSetStartWaypoint={setStartWaypoint}
        onRemoveLastWaypoint={removeLastWaypoint}
        onClearWaypoints={clearWaypoints}
        onPlanPath={handlePlanPath}
        isPlanning={isPlanning}
        hasGeology={IS_DEM && !!SITE.geology}
        science={science}
        onPlanScience={handlePlanScience}
        isPlanningScience={isPlanningScience}
        scienceDwellMin={scienceDwellMin} setScienceDwellMin={setScienceDwellMin}
        objectives={objectives} objectiveId={objectiveId} onSelectObjective={handleSelectObjective} objectiveSupport={objectiveSupportMap}
        mission={mission} setMission={setMission}
        sunAngleDeg={sunAngleDeg}   setSunAngleDeg={setSunAngleDeg}
        sun={sun} evaStartMs={evaStartMs} setEvaStartMs={setEvaStartMs}
        cameraMode={cameraMode}     setCameraMode={setCameraMode}
        wireframe={wireframe}       setWireframe={setWireframe}
        orthoOn={orthoOn}           setOrthoOn={setOrthoOn}
        onStartRover={handleStartRover}
        onStopRover={handleStopRover}
        isRoving={roving}
        evaStatus={evaStatus}
        onAbortEva={handleAbortEva}
        onPauseEva={() => playback.pause()}
        showTrack={showTrack} setShowTrack={setShowTrack}
        drapeLayer={drapeLayer} setDrapeLayer={setDrapeLayer}
        drapeOpacity={drapeOpacity} setDrapeOpacity={setDrapeOpacity}
        slopeMap={sm}
        craterMask={cm}
        hMap={hm}
        learningModel={learningModel}
        routeLog={routeLog}
        showToast={showToast}
        dustMode={dustMode}
        dustHazard={dustHazard}
        cameraSignalLost={cameraSignalLost}
        cameraSignalQuality={cameraSignalQuality}
        onTriggerDustHazard={handleTriggerDustHazard}
        onDustPlaced={handleDustPlaced}
        onClearDustHazard={handleClearDustHazard}
      />
    </div>
  );
}
