/**
 * RightPanel — Mission Control
 * • Multi-waypoint management, science EVA (DEM)
 * • Route analysis (Marswalk GO/NO-GO in DEM mode; risk/cost on the Moon)
 * • Mars time (DEM) / sun dial (Moon)
 * • 2D mini-map with zoom/pan/waypoints
 * • Heatmap viewer, helmet / rover camera, telemetry, exports
 */

import { buildShareURL } from '../utils/shareLink';
import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { TERRAIN_SIZE, CRATERS, IS_DEM } from '../three/terrainGenerator';
import { PANEL_W, MAP_S, fs, UI_SCALE, SHEET_VH, useNarrow } from '../ui/layout';
import { fmtHM, fmtSignedHM, fmtHourMin } from '../utils/format';
import { localToLatLon } from '../terrain/siteData';
import { ROUTE_COLORS } from '../utils/constants';
import { getTerrainCanvas } from '../utils/terrainRenderer';
import { loadOrthoImage } from '../utils/orthoImage';
import { spaceWeatherAt, RADIATION, fetchSpaceWeatherLive, DOSE_COMPARISON, daysEquivalent } from '../utils/radiation';
import { PovViewer, nearestPanorama } from './PovViewer';
import { ChemistryCard, hasChemistry } from './ChemistryCard';
import CuffCard from './CuffCard';
import ElevationProfile from './ElevationProfile';
import { SUITS, DEFAULT_MISSION, carryCheck, roverDrive, ROVER } from '../config/mission';
import { generateHeatmapCanvas, GEOLOGY_LAYERS, geologyLegend, dataLayerOptions, dataLayerLegend } from '../utils/heatmaps';
import { DUST_STATES } from '../utils/dustHazardModel';
import { MODE_WEIGHTS, MARSWALK_PROFILE, SCIENCE_PARAMS, param, EVA_PROFILES, MARS_SUIT_COST_RATIO } from '../config/marswalkProfile';
import { msAtLtst, sunriseSunset, ltst as ltstOf, j2000tt } from '../utils/marsTime';
import { airTemp, diurnalCurve, K_TO_C, climateInstrument, climateHeightM } from '../utils/climate';
import { SITE } from '../three/terrainGenerator';
import { WorkflowSteps, ObjectivePanel, ProvenancePanel, HazardPanel, StopCards, SafetyPanel, RadiationPanel, MissionSummaryPanel, StatusBadge } from './MissionPanels';
import { useSpaceWeather } from './useSpaceWeather';
import { siteProvenance, findRecord } from '../config/provenance';
import { getObjective } from '../config/objectives';
import { evaluateMission } from '../utils/missionStatus';
import { stopCard } from '../utils/stopRationale';
import { missionSummary } from '../utils/missionSummary';
import { getSiteHazards, routeHazardsFor } from '../utils/siteHazards';
import { HAZARD_LAYER } from '../utils/heatmaps';
import { getEvaProfile } from '../config/marswalkProfile';

const HALF = TERRAIN_SIZE / 2;
const PW   = PANEL_W;   // panel width (src/ui/layout.js)

// DEM: Mars layers only (rover-specific layers stay in the Moon mode)
const HEATMAP_OPTIONS = IS_DEM
  ? ['Elevation','Slope Angle','No-Go','EVA Range', ...(SITE.geology ? GEOLOGY_LAYERS : []), ...dataLayerOptions(), 'Illumination','Roughness']
  : ['Elevation','Slope','Slope Angle','No-Go','EVA Range','Roughness','Slip Risk','Illumination','Hazard Score','Traversability','Experience'];
const HEATMAP_DEFAULT = IS_DEM ? (GEOLOGY_LAYERS.includes('Geology: Surface') ? 'Geology: Surface' : GEOLOGY_LAYERS[0] || 'Slope Angle') : 'Hazard Score';
const CANVAS_FONT = (px, bold = false) => `${bold ? 'bold ' : ''}${fs(px)}px monospace`;
const HM_COLORS = {
  'Thermal Inertia (THEMIS)':'#ff9966','Minerals (CRISM)':'#66ffcc','Rock Relief (HiRISE)':'#ddbb88',
  'Elevation':'#e8a878','No-Go':'#ff4466','EVA Range':'#66ddff',
  'Slope':'#aaddaa','Slope Angle':'#88ccff','Roughness':'#ffcc88',
  'Slip Risk':'#ff8844','Illumination':'#ffffaa','Hazard Score':'#ff6655','Traversability':'#44ffaa',
  'Experience':'#cc66ff', 'Geology: Bedrock':'#d6a060', 'Geology: Surface':'#e8c070',
};
const ORTHO_LAYER = 'HiRISE image';   // compare-only layer: the orbital photo itself
const CMP_TAG = { position:'absolute', top:4, maxWidth:'46%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
  font:'bold 9px monospace', color:'#fff', background:'rgba(0,0,0,0.65)', padding:'1px 4px', borderRadius:2, pointerEvents:'none' };
const WP_COLORS_2D = ['#22ff55','#ffcc22','#44ddff','#ff88ff','#ffaa33','#aaffaa'];

// ---- World ↔ Map coordinate helpers ----
function w2m(wx, wz, vx, vy, zoom) {
  return { x: ((wx+HALF)/TERRAIN_SIZE*MAP_S - vx)*zoom, y: ((wz+HALF)/TERRAIN_SIZE*MAP_S - vy)*zoom };
}
function m2w(mx, my, vx, vy, zoom) {
  const cx=mx/zoom+vx, cy=my/zoom+vy;
  return { wx:(cx/MAP_S)*TERRAIN_SIZE-HALF, wz:(cy/MAP_S)*TERRAIN_SIZE-HALF };
}
function clamp(vx,vy,zoom) {
  const span=MAP_S/zoom;
  return { vx:Math.max(0,Math.min(Math.max(0,MAP_S-span),vx)), vy:Math.max(0,Math.min(Math.max(0,MAP_S-span),vy)) };
}

// ---- Mini-map ----
function MiniMap({ waypoints, roverPos, routes, activeRoute, pickMode, onPick, dustHazard, dustPickMode, onDustPlace, ponr, orthoOn, showTrack }) {
  const canvasRef   = useRef(null);
  const terrainRef  = useRef(null);
  const zoomRef     = useRef(1);
  const viewRef     = useRef({ x:0, y:0 });
  const dragRef     = useRef(null);

  const demBaseRef  = useRef(null);
  const orthoImgRef = useRef(null);
  const [baseTick, setBaseTick] = useState(0);
  useEffect(() => { demBaseRef.current = getTerrainCanvas(MAP_S*2); terrainRef.current = demBaseRef.current; }, []);
  // HiRISE image as the map base when it is on the terrain (same row/col layout as the DEM canvas)
  useEffect(() => {
    let alive = true;
    if (orthoOn && SITE.ortho) {
      loadOrthoImage().then(img => {
        if (!alive || !img) return;
        orthoImgRef.current = img; terrainRef.current = img; setBaseTick(t => t + 1);
      });
    } else {
      terrainRef.current = demBaseRef.current; setBaseTick(t => t + 1);
    }
    return () => { alive = false; };
  }, [orthoOn]);

  const draw = useCallback(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    const W=cv.width, H=cv.height;
    const zoom=zoomRef.current, {x:vx,y:vy}=viewRef.current;

    ctx.clearRect(0,0,W,H);

    // Terrain base
    if (terrainRef.current) {
      const src=terrainRef.current, ss=src.width;
      const span=MAP_S/zoom;
      ctx.drawImage(src, vx/MAP_S*ss, vy/MAP_S*ss, span/MAP_S*ss, span/MAP_S*ss, 0,0,W,H);
      if (src === orthoImgRef.current) {   // grayscale HiRISE → same Mars tint as the 3D terrain
        ctx.globalCompositeOperation='multiply'; ctx.fillStyle='#e9b48a'; ctx.fillRect(0,0,W,H);
        ctx.globalCompositeOperation='source-over';
      }
    }

    // Craters
    for (const c of CRATERS) {
      const {x:cx,y:cy}=w2m(c.x,c.z,vx,vy,zoom);
      const r=(c.radius/TERRAIN_SIZE)*MAP_S*zoom;
      const g=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
      g.addColorStop(0,'rgba(90,10,0,0.32)'); g.addColorStop(0.7,'rgba(60,20,0,0.10)'); g.addColorStop(1,'transparent');
      ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();
      ctx.beginPath();ctx.arc(cx,cy,r*1.05,0,Math.PI*2);ctx.strokeStyle='rgba(210,200,175,0.38)';ctx.lineWidth=0.8;ctx.stroke();
    }

    // ChemCam targets (rock chemistry measured by the rover) — small cyan diamonds
    if (SITE.chemistry?.targets) {
      ctx.fillStyle='rgba(120,210,255,0.85)'; ctx.strokeStyle='rgba(0,0,0,0.6)'; ctx.lineWidth=0.6;
      const s=Math.max(1.6, 1.2*Math.sqrt(zoom));
      for (const t of SITE.chemistry.targets) {
        const {x,y}=w2m(t.x,t.z,vx,vy,zoom);
        if (x<-5||y<-5||x>W+5||y>H+5) continue;
        ctx.beginPath(); ctx.moveTo(x,y-s); ctx.lineTo(x+s,y); ctx.lineTo(x,y+s); ctx.lineTo(x-s,y); ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
    }

    // The rover's own route (pale line) and named places — as on NASA's Curiosity route maps
    if (showTrack && SITE.track) {
      ctx.save();
      ctx.strokeStyle='rgba(230,232,255,0.85)'; ctx.lineWidth=1.1; ctx.lineJoin='round';
      for (const seg of SITE.track.segments) {
        ctx.beginPath();
        seg.forEach(([wx,wz],i)=>{ const {x,y}=w2m(wx,wz,vx,vy,zoom); if(i) ctx.lineTo(x,y); else ctx.moveTo(x,y); });
        ctx.stroke();
      }
      ctx.font=CANVAS_FONT(6.5,true); ctx.textBaseline='middle';
      for (const l of SITE.track.labels) {
        const {x,y}=w2m(l.x,l.z,vx,vy,zoom);
        if (x<0||y<0||x>W||y>H) continue;
        const text = l.kind==='sol' ? l.text : l.text;
        const tw=ctx.measureText(text).width, right = x+6+tw > W-2;
        ctx.fillStyle = l.kind==='region' ? '#e0b040' : '#fff';
        ctx.beginPath(); ctx.arc(x,y,1.8,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(right ? x-6-tw-2 : x+4, y-5, tw+4, 10);
        ctx.fillStyle = l.kind==='region' ? '#ffe9a8' : '#fff';
        ctx.fillText(text, right ? x-6-tw : x+6, y);
      }
      ctx.restore();
    }

    // Routes
    if (routes) {
      for (const [mode,pts] of Object.entries(routes)) {
        if (!pts||pts.length<2) continue;
        const active=mode===activeRoute;
        ctx.beginPath();
        for (let i=0;i<pts.length;i++) {
          const {x,y}=w2m(pts[i][0],pts[i][2],vx,vy,zoom);
          i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
        }
        ctx.strokeStyle=ROUTE_COLORS[mode]; ctx.lineWidth=active?3.6:1.35;
        ctx.globalAlpha=active?1:0.35; ctx.stroke(); ctx.globalAlpha=1;
      }
    }

    // Waypoints
    if (waypoints) {
      const total=waypoints.length;
      waypoints.forEach((wp,i) => {
        const {x,y}=w2m(wp.x,wp.z,vx,vy,zoom);
        const isStart=i===0, isEnd=i===total-1;
        const color=isStart?'#22ff55':isEnd?'#ff4422':WP_COLORS_2D[i%WP_COLORS_2D.length];
        const g=ctx.createRadialGradient(x,y,0,x,y,10);
        g.addColorStop(0,color+'99'); g.addColorStop(1,color+'00');
        ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();
        ctx.beginPath();ctx.arc(x,y,4.5,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
        ctx.strokeStyle='#000';ctx.lineWidth=0.7;ctx.stroke();
        ctx.fillStyle='#fff';ctx.font=CANVAS_FONT(6.5,true);
        const label=isStart?'S':isEnd?'E':`${i}`;
        ctx.fillText(label,x-(label.length>1?4:2.5),y+2.5);
      });
    }

    // Point of no return (active route) — red ⛔ diamond
    if (ponr) {
      const {x,y}=w2m(ponr[0],ponr[2],vx,vy,zoom);
      ctx.save(); ctx.translate(x,y); ctx.rotate(Math.PI/4);
      ctx.fillStyle='#ff2a1a'; ctx.strokeStyle='#fff'; ctx.lineWidth=1;
      ctx.fillRect(-4,-4,8,8); ctx.strokeRect(-4,-4,8,8);
      ctx.restore();
    }

    // Rover arrow / crew marker. World heading h: forward = (sin h, cos h) in (x, z);
    // map y grows with z, so the canvas rotation that turns "up" (0,-1) into it is π − h.
    if (roverPos) {
      const {x,y}=w2m(roverPos.x,roverPos.z,vx,vy,zoom);
      ctx.save(); ctx.translate(x,y); ctx.rotate(Math.PI-(roverPos.heading||0));
      ctx.beginPath();ctx.moveTo(0,-6);ctx.lineTo(4,5.5);ctx.lineTo(0,3.5);ctx.lineTo(-4,5.5);ctx.closePath();
      ctx.fillStyle=IS_DEM?'#ffffff':'#FFD700';ctx.fill();ctx.strokeStyle=IS_DEM?'#c62828':'#806000';ctx.lineWidth=IS_DEM?1.2:0.7;ctx.stroke();
      ctx.restore();
    }

    // Pick hint
    if (pickMode) {
      ctx.fillStyle='rgba(0,0,0,0.40)';ctx.fillRect(0,H-18,W,18);
      ctx.fillStyle='#88ffcc';ctx.font=CANVAS_FONT(7.5);
      ctx.fillText(` CLICK → ADD WAYPOINT ${waypoints?.length||0}+1`,4,H-6);
    }

    // Dust pick hint
    if (dustPickMode) {
      ctx.fillStyle='rgba(40,0,0,0.55)';ctx.fillRect(0,H-18,W,18);
      ctx.fillStyle='#ffcc88';ctx.font=CANVAS_FONT(7.5);
      ctx.fillText(IS_DEM ? ' CLICK → PLACE DUST DEVIL' : ' CLICK → PLACE DUST HAZARD',4,H-6);
    }

    // Dust cloud on minimap — soft multi-ring radial gradient
    if (dustHazard) {
      const {x:dcx,y:dcy}=w2m(dustHazard.x,dustHazard.z,vx,vy,zoom);
      const dr=(dustHazard.radius/TERRAIN_SIZE)*MAP_S*zoom;
      // Outer soft haze
      const g2=ctx.createRadialGradient(dcx,dcy,0,dcx,dcy,dr*1.6);
      g2.addColorStop(0,'rgba(180,180,175,0.55)');
      g2.addColorStop(0.45,'rgba(150,150,145,0.38)');
      g2.addColorStop(0.75,'rgba(120,120,115,0.20)');
      g2.addColorStop(1,'rgba(100,100,95,0)');
      ctx.beginPath();ctx.arc(dcx,dcy,dr*1.6,0,Math.PI*2);
      ctx.fillStyle=g2;ctx.fill();
      // Crisp centre puff
      const g3=ctx.createRadialGradient(dcx,dcy,0,dcx,dcy,dr*0.65);
      g3.addColorStop(0,'rgba(200,200,195,0.50)');
      g3.addColorStop(1,'rgba(170,170,165,0)');
      ctx.beginPath();ctx.arc(dcx,dcy,dr*0.65,0,Math.PI*2);
      ctx.fillStyle=g3;ctx.fill();
      // Dashed outline
      ctx.save();ctx.setLineDash([3,3]);
      ctx.beginPath();ctx.arc(dcx,dcy,dr*1.4,0,Math.PI*2);
      ctx.strokeStyle='rgba(220,160,60,0.7)';ctx.lineWidth=1.0;ctx.stroke();
      ctx.restore();
      // ☁ label
      ctx.fillStyle='rgba(255,200,100,0.85)';ctx.font=CANVAS_FONT(7,true);
      ctx.fillText(IS_DEM ? '☁ DUST DEVIL' : '☁ DUST',dcx+dr*1.4+2,dcy+3);
    }

    // Zoom badge
    ctx.fillStyle='rgba(0,0,0,0.55)';ctx.fillRect(W-36,3,33,15);
    ctx.fillStyle='#88cc88';ctx.font=CANVAS_FONT(7);ctx.fillText(`${zoom.toFixed(1)}x`,W-32,14);
  }, [routes, activeRoute, waypoints, roverPos, pickMode, dustHazard, dustPickMode, ponr, baseTick, showTrack]);

  useEffect(() => { draw(); }, [draw]);

  const onWheel = useCallback(e => {
    e.preventDefault();
    const dz=e.deltaY<0?0.4:-0.4;
    const nz=Math.max(1,Math.min(8,zoomRef.current+dz));
    const rect=canvasRef.current.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*(MAP_S/rect.width);
    const my=(e.clientY-rect.top)*(MAP_S/rect.height);
    const wx0=mx/zoomRef.current+viewRef.current.x;
    const wy0=my/zoomRef.current+viewRef.current.y;
    zoomRef.current=nz;
    const {vx,vy}=clamp(wx0-mx/nz,wy0-my/nz,nz);
    viewRef.current={x:vx,y:vy}; draw();
  }, [draw]);

  useEffect(() => {
    const c=canvasRef.current; if(!c) return;
    c.addEventListener('wheel',onWheel,{passive:false});
    return () => c.removeEventListener('wheel',onWheel);
  }, [onWheel]);

  const onMouseDown = useCallback(e => {
    if (pickMode || dustPickMode) return;
    dragRef.current={sx:e.clientX,sy:e.clientY,vx:viewRef.current.x,vy:viewRef.current.y};
  }, [pickMode, dustPickMode]);

  const onMouseMove = useCallback(e => {
    if (!dragRef.current) return;
    const rect=canvasRef.current.getBoundingClientRect();
    const sx=MAP_S/rect.width, sy=MAP_S/rect.height;
    const dx=(e.clientX-dragRef.current.sx)*sx/zoomRef.current;
    const dy=(e.clientY-dragRef.current.sy)*sy/zoomRef.current;
    const {vx,vy}=clamp(dragRef.current.vx-dx,dragRef.current.vy-dy,zoomRef.current);
    viewRef.current={x:vx,y:vy}; draw();
  }, [draw]);

  const onMouseUp = useCallback(() => { dragRef.current=null; }, []);

  const onClick = useCallback(e => {
    if (!pickMode && !dustPickMode) return;
    if (dragRef.current) return;
    const rect=canvasRef.current.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*(MAP_S/rect.width);
    const my=(e.clientY-rect.top)*(MAP_S/rect.height);
    const {wx,wz}=m2w(mx,my,viewRef.current.x,viewRef.current.y,zoomRef.current);
    const pos={ x:Math.max(-HALF+2,Math.min(HALF-2,wx)), z:Math.max(-HALF+2,Math.min(HALF-2,wz)) };
    if (dustPickMode) {
      onDustPlace?.(pos);
    } else {
      onPick(pos);
    }
  }, [pickMode,dustPickMode,onPick,onDustPlace]);

  return (
    <canvas ref={canvasRef} width={MAP_S} height={MAP_S}
      style={{ width:MAP_S,height:MAP_S,display:'block',
        cursor:(pickMode||dustPickMode)?'crosshair':'grab',
        border:'1px solid rgba(80,130,60,0.4)', borderRadius:3 }}
      onClick={onClick} onMouseDown={onMouseDown} onMouseMove={onMouseMove}
      onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
    />
  );
}

// ---- Sun Dial ----
function SunDial({ angle, onChange }) {
  const S=72,cx=36,cy=36,r=26;
  const rad=angle*Math.PI/180;
  const sx=cx+Math.sin(rad)*r, sy=cy-Math.cos(rad)*r;
  const dragging=useRef(false);
  const getA=(e,rect)=>(( Math.atan2(e.clientX-rect.left-cx,-(e.clientY-rect.top-cy))*180/Math.PI)+360)%360;
  return (
    <svg width={S} height={S} style={{cursor:'crosshair',flexShrink:0}}
      onMouseDown={e=>{dragging.current=true;onChange(Math.round(getA(e,e.currentTarget.getBoundingClientRect())))}}
      onMouseMove={e=>{if(!dragging.current)return;onChange(Math.round(getA(e,e.currentTarget.getBoundingClientRect())))}}
      onMouseUp={()=>{dragging.current=false}} onMouseLeave={()=>{dragging.current=false}}
    >
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(80,120,60,0.5)" strokeWidth={1.2}/>
      {[0,45,90,135,180,225,270,315].map(a=>{
        const ar=a*Math.PI/180;
        return <line key={a}
          x1={cx+Math.sin(ar)*(r-4)} y1={cy-Math.cos(ar)*(r-4)}
          x2={cx+Math.sin(ar)*(r+1)} y2={cy-Math.cos(ar)*(r+1)}
          stroke="rgba(100,160,80,0.5)" strokeWidth={a%90===0?1.4:0.6}/>;
      })}
      {['N','E','S','W'].map((l,i)=>{
        const ar=i*Math.PI/2;
        return <text key={l} x={cx+Math.sin(ar)*(r+7)} y={cy-Math.cos(ar)*(r+7)+2.5}
          textAnchor="middle" fontSize={6} fill="rgba(120,180,100,0.65)" fontFamily="monospace">{l}</text>;
      })}
      <line x1={cx} y1={cy} x2={sx} y2={sy} stroke="#FFD700" strokeWidth={1.5} opacity={0.9}/>
      <circle cx={sx} cy={sy} r={5.5} fill="#FFD700" opacity={0.95}/>
      <circle cx={sx} cy={sy} r={9} fill="none" stroke="#FFD700" strokeWidth={0.5} opacity={0.3}/>
      <circle cx={cx} cy={cy} r={2.5} fill="rgba(120,180,100,0.65)"/>
    </svg>
  );
}

// ---- Mars time (DEM): EVA start drives the Mars24 sun ----
const fmtLtst = fmtHourMin;
const SEASONS_N = ['Northern spring', 'Northern summer', 'Northern autumn', 'Northern winter'];
const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

// Diurnal air-temperature curve (site climatology median, p10–p90 band) + EVA start marker
function DiurnalTempChart({ bin, ltstH }) {
  const W = 200, H = 54, padL = 22, padB = 10, padT = 4;
  const n = bin.median.length;
  const vals = [...bin.p10, ...bin.p90].filter(v => v != null).map(K_TO_C);
  if (!vals.length) return null;
  const lo = Math.floor(Math.min(...vals) / 10) * 10, hi = Math.ceil(Math.max(...vals) / 10) * 10;
  const x = (i) => padL + (i / n) * (W - padL);
  const y = (k) => padT + (1 - (K_TO_C(k) - lo) / (hi - lo)) * (H - padT - padB);
  const line = (arr) => arr.map((v, i) => v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean).join(' ');
  const band = [];
  for (let i = 0; i < n; i++) if (bin.p90[i] != null) band.push(`${x(i).toFixed(1)},${y(bin.p90[i]).toFixed(1)}`);
  for (let i = n - 1; i >= 0; i--) if (bin.p10[i] != null) band.push(`${x(i).toFixed(1)},${y(bin.p10[i]).toFixed(1)}`);
  const mx = padL + (((ltstH % 24) + 24) % 24) / 24 * (W - padL);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', marginTop: 3 }}>
      <polygon points={band.join(' ')} fill="rgba(255,170,80,0.18)" />
      <polyline points={line(bin.median)} fill="none" stroke="#ffaa55" strokeWidth="1.2" />
      <line x1={mx} x2={mx} y1={padT} y2={H - padB} stroke="#FFD700" strokeWidth="1" strokeDasharray="2,2" />
      {[lo, hi].map(v => <text key={v} x={padL - 2} y={v === hi ? padT + 6 : H - padB} textAnchor="end" fontSize="6.5" fill="#7a8a7a">{v}°</text>)}
      {[0, 6, 12, 18].map(h => <text key={h} x={padL + h / 24 * (W - padL)} y={H - 1} fontSize="6" fill="#5a6a5a">{String(h).padStart(2, '0')}</text>)}
    </svg>
  );
}

function MarsTimePanel({ sun, evaStartMs, setEvaStartMs, sw = null, swState = 'failed', radRecord = null }) {
  const c = SITE.meta?.center;
  if (!c || !sun || evaStartMs == null) return null;
  const lon = c.lon_deg_east;
  const cur = ltstOf(j2000tt(evaStartMs), lon);
  const ss = sunriseSunset(evaStartMs, c.lat_deg, lon);
  const utcDate = new Date(evaStartMs).toISOString().slice(0, 10);
  const setDate = (iso) => {
    if (!iso) return;
    const noonUtc = Date.parse(`${iso}T12:00:00Z`);
    if (Number.isFinite(noonUtc)) setEvaStartMs(msAtLtst(noonUtc, cur, lon));
  };
  const row = { display: 'flex', justifyContent: 'space-between', fontSize:fs(7.5), color: 'rgba(160,200,160,0.8)', lineHeight: 1.6 };
  const v = { color: '#e8e0c8' };
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
        <input type="date" value={utcDate} onChange={e => setDate(e.target.value)}
          style={{ flex: 1, background: '#0a140a', color: '#aaffaa', border: '1px solid #234423', fontSize:fs(9), fontFamily: 'monospace', padding: '2px 4px' }} />
        <span style={{ color: '#FFD700', fontSize:fs(13), fontWeight: 'bold' }}>{fmtLtst(cur)}</span>
      </div>
      <input type="range" min={0} max={23.75} step={0.25} value={Math.round(cur * 4) / 4}
        onChange={e => setEvaStartMs(msAtLtst(evaStartMs, Number(e.target.value), lon))} style={{ width: '100%' }} />
      <div style={{ color: '#7a6a50', fontSize:fs(7), margin: '1px 0 4px' }}>EVA START — LOCAL TRUE SOLAR TIME (LTST)</div>
      <div style={row}><span>Sol (MSD)</span><span style={v}>{Math.floor(sun.msd)}</span></div>
      <div style={row}><span>Season</span><span style={v}>Ls {sun.ls.toFixed(1)}° · {SEASONS_N[Math.floor(sun.ls / 90) % 4]}</span></div>
      <div style={row}><span>Sun</span><span style={{ color: sun.elevationDeg > 0 ? '#FFD700' : '#8899cc' }}>
        {sun.elevationDeg > 0 ? `${sun.elevationDeg.toFixed(1)}° high` : `${(-sun.elevationDeg).toFixed(1)}° below horizon`}
        {' · '}{COMPASS[Math.round(sun.azimuthDeg / 22.5) % 16]} {sun.azimuthDeg.toFixed(0)}°</span></div>
      {ss && <div style={row}><span>Sunrise / sunset</span><span style={v}>{fmtLtst(ss.riseLtst)} / {fmtLtst(ss.setLtst)} LTST</span></div>}
      <div style={row}><span>UTC</span><span style={v}>{new Date(evaStartMs).toISOString().slice(0, 16).replace('T', ' ')}</span></div>
      {(() => {
        const a = airTemp(SITE.climate, sun.ls, cur);
        const bin = diurnalCurve(SITE.climate, sun.ls);
        if (!a || !bin) return SITE.climate ? null : (
          <div style={{ color: '#4a6a4a', fontSize:fs(6.5), marginTop: 2 }}>Air temperature: no climatology for this site yet (sun and shadow only)</div>
        );
        return (
          <>
            <div style={row}><span>Air ({climateHeightM(SITE.climate)} m)</span><span style={{ color: '#ffcc88' }}>
              {K_TO_C(a.median).toFixed(0)} °C <span style={{ color: '#7a8a7a' }}>({K_TO_C(a.p10).toFixed(0)}…{K_TO_C(a.p90).toFixed(0)})</span></span></div>
            <DiurnalTempChart bin={bin} ltstH={cur} />
            <div style={{ color: '#4a6a4a', fontSize:fs(6.5) }}>{climateInstrument(SITE.climate)}, Ls {bin.ls0}–{bin.ls1}°, {bin.nSols} sols · median, 10–90 %</div>
          </>
        );
      })()}
      <div style={{ color: '#4a6a4a', fontSize:fs(6.5), marginTop: 2 }}>Mars24 (NASA GISS) · Allison &amp; McEwen 2000</div>
      <RadiationPanel sw={sw} swState={swState} record={radRecord} doseComparison={<DoseComparison />} />
    </div>
  );
}

// ---- Mission setup: suit, equipment load, rover safe haven ----
function MissionPanel({ mission, setMission, start, disabled }) {
  const c = carryCheck(mission);
  const set = (k, v) => setMission({ ...mission, [k]: v });
  const drive = mission.rover && start ? roverDrive(start.x, start.z) : null;
  const row = { display: 'flex', alignItems: 'center', gap: 5, fontSize: fs(7.5), color: '#9ab89a', marginBottom: 4 };
  return (
    <div style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <div style={row}>
        <span style={{ width: 54 }}>Suit</span>
        {Object.entries(SUITS).map(([k, s]) => (
          <Btn key={k} active={mission.suit === k} color="#88ccff" onClick={() => set('suit', k)}
            style={{ flex: 1, padding: '2px 4px' }}>{s.label} · {s.massKg} kg</Btn>
        ))}
      </div>
      <div style={row}>
        <span style={{ width: 54 }}>Equipment</span>
        <input type="range" min={0} max={40} step={1} value={mission.equipmentKg}
          onChange={e => set('equipmentKg', Number(e.target.value))} style={{ flex: 1 }} />
        <b style={{ color: '#e8e0c8', width: 40, textAlign: 'right' }}>{mission.equipmentKg} kg</b>
      </div>
      <div style={{ fontSize: fs(7), color: c.ok ? '#88dd99' : '#ff6655', lineHeight: 1.5 }}>
        Carried weight on Mars: {c.earthEqKg.toFixed(1)} kg Earth-equivalent / {c.limitKg} kg limit
        {c.ok ? ` · up to ${c.maxEquipmentKg.toFixed(0)} kg of equipment` : ' · NO-GO: too heavy to walk with'}
      </div>
      <div style={row}>
        <span style={{ width: 54 }}>EVA limits</span>
        {Object.entries(EVA_PROFILES).map(([k, pr]) => (
          <Btn key={k} active={(mission.limits || 'lunar') === k} color={k === 'mars' ? '#99dd99' : '#88ccff'} onClick={() => set('limits', k)}
            title={pr.desc} style={{ flex: 1, padding: '2px 4px' }}>{pr.label}</Btn>
        ))}
      </div>
      <div style={{ fontSize: fs(6.5), color: '#6a8a6a', marginTop: -2, marginBottom: 4, lineHeight: 1.45 }}>
        {(mission.limits || 'lunar') === 'mars'
          ? <>Walk {param('levelWalkSpeedKmh')} km/h (suited cost on Mars ×{MARS_SUIT_COST_RATIO.value.toFixed(2)}, Norcross 2009) · budget {param('evaDurationH')} h (Apollo 17 30-min reserve) · ≤{param('maxRadialDistanceKm')} km. Re-plan the science EVA to fit.</>
          : <>NASA lunar EVA values (2 km/h, 8 h, 2 km) — optimistic for Mars gravity.</>}
      </div>
      <div style={{ ...row, marginTop: 5 }}>
        <Btn active={mission.rover} color="#ffbb66" onClick={() => set('rover', !mission.rover)} style={{ flex: 1 }}>
          {mission.rover ? '✓ PRESSURIZED ROVER PARKED AT START' : 'PRESSURIZED ROVER AS SAFE HAVEN'}
        </Btn>
      </div>
      {mission.rover && (
        <div style={{ fontSize: fs(7), color: '#b8c8b0', lineHeight: 1.5 }}>
          The rover drives the crew to the start point and waits there; the crew must stay within a
          {' '}<b>{ROVER.walkbackMin.value}-minute walk</b> of it.
          {drive && <> Drive from the habitat: {drive.km.toFixed(2)} km, ~{Math.round(drive.minutes)} min (straight line, {ROVER.driveSpeedKmh.value} km/h).</>}
        </div>
      )}
      <div style={{ fontSize: fs(6.5), color: '#6a7a6a', marginTop: 2 }}>Suit masses, carry limit, walkback: Ogilvie et al., ICES 2026 (NASA)</div>
    </div>
  );
}

// ---- Dose rate in four places (log scale): why Mars radiation differs ----
function DoseComparison() {
  const lo = Math.log10(0.003), hi = Math.log10(2);
  const w = (v) => `${Math.max(2, ((Math.log10(v) - lo) / (hi - lo)) * 100)}%`;
  const fmt = (v) => (v < 0.1 ? v.toFixed(4) : v.toFixed(2));
  return (
    <div style={{ margin: '2px 0 3px' }} title="Daily dose equivalent, log scale. Hover a row for why it differs and the source.">
      {DOSE_COMPARISON.map(d => {
        const mars = d.key === 'mars';
        return (
          <div key={d.key} title={`${d.why}\n${d.source}`} style={{ display: 'grid', gridTemplateColumns: '34px 1fr 44px', gap: 4, alignItems: 'center',
            fontSize: fs(6.8), color: mars ? '#ffcc88' : 'rgba(160,200,160,0.75)', lineHeight: 1.5 }}>
            <span>{d.label}</span>
            <div style={{ height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 2 }}>
              <div style={{ width: w(d.mSvPerDay), height: '100%', borderRadius: 2,
                background: mars ? '#ff9f5a' : d.key === 'moon' ? '#b9b9c9' : d.key === 'iss' ? '#7fb2e5' : '#6fbf73' }} />
            </div>
            <span style={{ textAlign: 'right' }}>{fmt(d.mSvPerDay)}</span>
          </div>
        );
      })}
      <div style={{ color: '#4a6a4a', fontSize: fs(6.3), lineHeight: 1.35 }}>
        mSv/day, log scale · Mars: no global magnetic field and a thin atmosphere ≈ {Math.round(daysEquivalent(DOSE_COMPARISON[3].mSvPerDay).earth)} days of Earth background per sol.
        Moon measured at solar minimum (2019), Mars near maximum (2012–13). UNSCEAR · Zhang et al. 2020 · Hassler et al. 2014
      </div>
    </div>
  );
}

// ---- Route Analysis ----
const ROUTE_DESC = {
  SAFE: s => `Low-risk path. Avoids craters + shadows. Avg hazard=${(s.avgHazard||0).toFixed(3)}, slip=${(s.avgSlip||0).toFixed(3)}, slope=${(s.avgSlopeAngle||0).toFixed(1)}°.`,
  ECO:  s => `Energy-efficient. Prefers sunlit + flat terrain. Illum=${(s.avgIllumination||0).toFixed(3)}, traversability=${(s.avgTraversability||0).toFixed(3)}.`,
  FAST: s => `Speed-optimized. Shortest distance=${(s.distance||0).toFixed(1)}m, total cost=${(s.totalCost||0).toFixed(1)}.`,
  AUTO: s => `Balanced route. Hazard=${(s.avgHazard||0).toFixed(3)}, illum=${(s.avgIllumination||0).toFixed(3)}, dist=${(s.distance||0).toFixed(1)}m.`,
};

// ---- Marswalk (DEM) stats card body ----
function MarswalkStats({ mode, s, ev = null }) {
  const fail = (ok) => ok ? '#88dd99' : '#ff6655';
  return (
    <>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:2}}>
        <span style={{color:'rgba(160,200,160,0.8)',fontSize:fs(7.5)}}>
          Walk <b style={{color:'#e8e0c8'}}>{fmtHM(s.walkTimeS)}</b>
          {s.returnTimeS > 1 && <>{'  '}+ fastest return <b style={{color:fail(s.checks.budget)}}>{fmtHM(s.returnTimeS)}</b></>}
        </span>
        {ev ? <StatusBadge status={ev.status} /> : <span style={{
          fontSize:fs(7.5), fontWeight:'bold', padding:'1px 5px', borderRadius:3,
          color: s.go ? '#0a1a0a' : '#fff', background: s.go ? '#44dd66' : '#cc3322',
        }}>{s.go ? 'GO' : 'NO-GO'}</span>}
      </div>
      <div style={{color:'rgba(160,200,160,0.7)',fontSize:fs(7),lineHeight:1.55}}>
        Total <span style={{color:fail(s.checks.budget)}}>{fmtHM(s.roundTripS)}</span> = {(s.budgetFrac*100).toFixed(0)}% of the {param('evaDurationH')} h budget
        {s.stopCount > 0 && <> · incl. {fmtHM(s.dwellTotalS)} sampling at {s.stopCount} stops</>}
        <br/>
        Walk-back margin (min): <span style={{color:fail(s.checks.budget)}}>{Number.isFinite(s.minMarginS) ? fmtSignedHM(s.minMarginS) : 'no path home'}</span>
        {s.ponrIdx >= 0 && <span style={{color:'#ff6655'}}> · ⛔ point of no return at {Math.round(s.ponrIdx / Math.max(1, s.marginS.length - 1) * 100)}% of the route</span>}
        <br/>
        Max slope: <span style={{color:fail(s.checks.slope)}}>{s.maxSlopeDeg.toFixed(1)}°</span> / {param('maxWalkableSlopeDeg')}°
        <br/>
        Steep ground (&gt;{s.steepDeg.toFixed(0)}°): <span style={{color:'#e8c890'}}>{(s.steepFrac*100).toFixed(0)}%</span>
        {' · '}Climb {s.climbM.toFixed(0)} m · Descent {s.descentM.toFixed(0)} m
        {' · '}Max distance from start <span style={{color:fail(s.checks.radial)}}>{(s.maxRadialM/1000).toFixed(2)}</span> / {param('maxRadialDistanceKm')} km
      </div>
      {s.light && (
        <div style={{color:'rgba(160,200,160,0.7)',fontSize:fs(7),lineHeight:1.55,marginTop:1}}>
          Light (walking): in terrain shadow <span style={{color:'#e8c890'}}>{(s.light.shadowFrac*100).toFixed(0)}%</span>
          {s.light.darkFrac > 0 && <> · <span style={{color:'#8899cc'}}>in darkness {(s.light.darkFrac*100).toFixed(0)}%</span></>}
          {' · '}{s.light.homeBySunset === null ? 'no sunrise/sunset'
            : s.light.homeBySunset ? <span style={{color:'#88dd99'}}>home before sunset</span>
            : <span style={{color:fail(false)}}>✕ not completed in daylight — NO-GO (rule: start after sunrise, home before sunset)</span>}
          {s.light.air && <><br/>Air ({climateHeightM(SITE.climate)} m, during the EVA): <span style={{color:'#ffcc88'}}>
            {K_TO_C(s.light.air.minMedian).toFixed(0)}…{K_TO_C(s.light.air.maxMedian).toFixed(0)} °C</span>
            {s.light.air.minP10 != null && <span style={{color:'#7a8a7a'}}> (extremes {K_TO_C(s.light.air.minP10).toFixed(0)}…{K_TO_C(s.light.air.maxP90).toFixed(0)})</span>}</>}
        </div>
      )}
      {(s.carry || s.rover) && (
        <div style={{color:'rgba(160,200,160,0.7)',fontSize:fs(7),lineHeight:1.55,marginTop:1}}>
          {s.carry && <>Carried weight: <span style={{color:fail(s.checks.carry)}}>{s.carry.earthEqKg.toFixed(1)} kg</span> / {s.carry.limitKg} kg Earth-eq. ({s.carry.suit.label})</>}
          {s.rover && <><br/>Farthest from the rover: <span style={{color:fail(s.checks.rover)}}>{fmtHM(s.rover.maxReturnS)}</span> walk / {Math.round(s.rover.limitS / 60)} min limit</>}
        </div>
      )}
      {(s.radiation || s.layers) && (
        <div style={{color:'rgba(160,200,160,0.7)',fontSize:fs(7),lineHeight:1.55,marginTop:1}}>
          {s.radiation && <>Radiation (GCR, Curiosity RAD): <span style={{color:'#e8c890'}}>{s.radiation.doseMSv.toFixed(2)} mSv</span>
            <span style={{color:'#7a8a7a'}}> = {(s.radiation.careerFrac * 100).toFixed(3)}% of the 600 mSv career limit
              {' '}≈ {Math.round(daysEquivalent(s.radiation.doseMSv).earth)} days of Earth background</span></>}
          {s.layers?.thermal && <><br/>Ground (THEMIS TI): <span style={{color:'#e8c890'}}>{Math.round(s.layers.thermal.median)}</span>
            <span style={{color:'#7a8a7a'}}> · {s.layers.thermal.cls}</span></>}
          {s.layers?.rock && <><br/>Largest rock relief on route: <span style={{color: s.layers.rock.maxReliefM > s.layers.rock.limitM ? '#ff6655' : '#e8c890'}}>
            {s.layers.rock.maxReliefM.toFixed(2)} m</span><span style={{color:'#7a8a7a'}}> / {s.layers.rock.limitM} m limit</span></>}
          {s.layers?.minerals?.length > 0 && <><br/>Minerals crossed (CRISM): <span style={{color:'#88ddcc'}}>
            {s.layers.minerals.slice(0, 3).map(m => `${m.name} ${(m.share * 100).toFixed(0)}%`).join(' · ')}</span></>}
        </div>
      )}
      <div style={{color:'rgba(100,150,100,0.75)',fontSize:fs(7),marginTop:2}}>{MODE_WEIGHTS[mode]?.desc}</div>
    </>
  );
}

// ---- Stage 6: science EVA (geology stops) ----
function SciencePanel({ science, onPlan, busy, dwellMin, setDwellMin, disabled, objective = null, objectiveStatus = null, cards = [] }) {
  const [pov, setPov] = useState(null);
  const [chemStop, setChemStop] = useState(null);
  const blocked = !objective ? 'Select a mission objective first (step 1).'
    : objectiveStatus === 'unsupported' ? 'The selected objective has no supporting data in this site.' : null;
  return (
    <>
      <div style={{display:'flex',alignItems:'center',gap:5,fontSize:fs(7.5),color:'#9ab89a',marginBottom:4}}>
        <span>Time per stop</span>
        <input type="range" min={5} max={60} step={5} value={dwellMin}
          onChange={e=>setDwellMin(Number(e.target.value))} style={{flex:1}}/>
        <b style={{color:'#e8e0c8',width:44,textAlign:'right'}}>{dwellMin} min</b>
      </div>
      <div style={{fontSize:fs(6.5),color:'#7a6a4a',marginBottom:4}}>
        Assumption: no sourced time per stop was found.{' '}
        {objective?.rules
          ? <>Score = the objective's points per distinct piece of evidence ({objective.short}: primary 5, supporting 1–3) — a design choice.</>
          : <>Score = diversity of distinct units (bedrock {SCIENCE_PARAMS.weights.bedrock}, surface {SCIENCE_PARAMS.weights.surface}, contact {SCIENCE_PARAMS.weights.contact}{SITE.chemistry ? `, ChemCam standout ${SCIENCE_PARAMS.weights.chemistry}` : ''}) — a design choice.</>}
      </div>
      {blocked && <div style={{fontSize:fs(7),color:'#ffb347',marginBottom:4}}>{blocked}</div>}
      {pov && <PovViewer stop={pov.stop} label={pov.label} onClose={() => setPov(null)} />}
      {chemStop && <ChemistryCard stop={chemStop.stop} label={chemStop.label} onClose={() => setChemStop(null)} />}
      <Btn disabled={busy || disabled || !!blocked} onClick={onPlan}
        style={{width:'100%',background:'rgba(70,40,0,0.55)',borderColor:'rgba(230,150,60,0.6)',color:'#ffbb66',fontWeight:'bold'}}>
        {busy ? 'SEARCHING…' : 'PLAN SCIENCE EVA'}
      </Btn>
      {science && (
        <div style={{marginTop:5,fontSize:fs(7.5),lineHeight:1.5,color:'#b8c8b0'}}>
          <div>
            {getObjective(science.objective)?.label || 'General site survey'}:{' '}
            {science.stops.length} stops / {science.candidates.length} candidates ·
            {' '}score <b style={{color:'#ffcc66'}}>{science.score}</b>/{science.maxScore}
            {' '}· plan {fmtHM(science.totalS)}
          </div>
          {science.primaryHit === false && (
            <div style={{color:'#ff6655'}}>No reachable stop carries this objective's primary evidence within the EVA limits — the plan below holds context stops only.</div>
          )}
          <StopCards cards={cards}
            hasGround={(c) => !!nearestPanorama(c.x, c.z)} hasChem={(c) => hasChemistry(c.x, c.z)}
            onGround={(c) => setPov({ stop: { x: c.x, z: c.z }, label: `S${c.n} ${c.name}` })}
            onChem={(c) => setChemStop({ stop: { x: c.x, z: c.z }, label: `S${c.n} ${c.name}` })} />
          {science.candidates.length > science.stops.length && (
            <div style={{color:'#7a8a7a',marginTop:2}}>
              Not chosen: {science.candidates.filter(c => !science.stops.some(st => st.idx === c.idx)).map(c => c.label).join('; ')}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function RouteAnalysis({ routes, activeRoute, onSelect, onCuffCard, evaluations = {} }) {
  if (!routes) return (
    <div style={{fontSize:fs(8),color:'#3a5a3a',textAlign:'center',padding:'8px 0'}}>
      Plan a path to see route analysis.
    </div>
  );
  return (
    <div style={{display:'flex',flexDirection:'column',gap:6}}>
      {Object.entries(ROUTE_COLORS)
        .filter(([mode]) => mode !== 'HOME_RETURN')
        .map(([mode,color]) => {
        const r=routes[mode];
        const s=r?.stats;
        const active=mode===activeRoute;
        return (
          <div key={mode} onClick={()=>onSelect(mode)} style={{
            border:`1px solid ${active?color:'rgba(40,70,40,0.35)'}`,
            borderRadius:4, padding:'5px 7px', cursor:'pointer',
            background:active?'rgba(0,0,0,0.5)':'rgba(5,12,5,0.4)',
            boxShadow:active?`0 0 8px ${color}33`:'none',
            transition:'all 0.12s',
          }}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:3}}>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <div style={{width:7,height:7,borderRadius:'50%',background:color,boxShadow:`0 0 4px ${color}`}}/>
                <span style={{color,fontSize:fs(9),fontWeight:'bold',letterSpacing:0.5}}>{mode}</span>
              </div>
              {s && <span style={{color:'rgba(150,200,150,0.7)',fontSize:fs(8)}}>{s.distance.toFixed(1)}m</span>}
            </div>
            {s && s.walkTimeS !== undefined && <MarswalkStats mode={mode} s={s} ev={evaluations[mode]} />}
            {s && s.walkTimeS !== undefined && active && <SafetyPanel evaluation={evaluations[mode]} />}
            {s && s.walkTimeS !== undefined && active && r.path?.length > 1 && (
              <div style={{ marginTop:5, borderTop:'1px solid rgba(60,100,60,0.3)', paddingTop:3 }}
                title="Elevation along the route (MOLA metres), stops numbered — as Mars Trek plots for a measured path">
                <ElevationProfile path={r.path} stats={s} originM={SITE.heightOrigin || 0} color={color} />
              </div>
            )}
            {s && s.walkTimeS !== undefined && active && s.stopCount > 0 && onCuffCard && (
              <button onClick={(e) => { e.stopPropagation(); onCuffCard(mode); }} title="One printable page: route map + station times, Apollo cuff-checklist style"
                style={{ marginTop:5, width:'100%', background:'rgba(244,162,97,0.12)', color:'#f4c49a', border:'1px solid rgba(244,162,97,0.55)',
                  borderRadius:3, padding:'3px 0', fontFamily:'monospace', fontSize:fs(7.5), letterSpacing:'0.1em', cursor:'pointer' }}>
                ▤ PRINT CUFF CARD
              </button>
            )}
            {s && s.walkTimeS === undefined && (
              <>
                <div style={{color:'rgba(160,200,160,0.7)',fontSize:fs(7.5),marginBottom:2}}>
                  Risk: <span style={{color:'#ffcc44'}}>{s.riskPercent.toFixed(1)}%</span>
                  {'  '}Cost: <span style={{color:'#88ccff'}}>{s.totalCost.toFixed(1)}</span>
                </div>
                <div style={{color:'rgba(100,150,100,0.75)',fontSize:fs(7),lineHeight:1.5}}>
                  {ROUTE_DESC[mode]?.(s)}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- Heatmap ----
function HeatmapViewer({ sunAngle, sunElevation, learningModel, refreshKey, drape = null, onDrape = null,
  drapeOpacity = 0.6, setDrapeOpacity = () => {} }) {
  const ref=useRef(null);
  const [sel,setSel]=useState(HEATMAP_DEFAULT);
  // keep the 3D drape on the selected layer
  useEffect(() => { if (drape && drape !== sel) onDrape?.(sel); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open,setOpen]=useState(false);
  const [tick,setTick]=useState(0);
  // Compare (swipe): layer A on the left, layer B on the right of a draggable line —
  // the comparison mode of NASA Worldview, here between two layers of the same site.
  const refB=useRef(null);
  const [compare,setCompare]=useState(false);
  const [selB,setSelB]=useState(SITE.ortho ? ORTHO_LAYER : 'Elevation');
  const [split,setSplit]=useState(0.5);
  const dragSplit = useCallback((e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setSplit(Math.min(0.97, Math.max(0.03, (e.clientX - r.left) / r.width)));
  }, []);
  useEffect(()=>{
    const cv = refB.current;
    if (!compare || !cv) return undefined;
    let alive = true;
    if (selB === ORTHO_LAYER) {
      loadOrthoImage().then(img => {
        if (!alive || !img) return;
        const ctx = cv.getContext('2d');
        ctx.globalCompositeOperation='source-over';
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        ctx.globalCompositeOperation='multiply'; ctx.fillStyle='#e9b48a'; ctx.fillRect(0,0,cv.width,cv.height);
        ctx.globalCompositeOperation='source-over';
      });
    } else {
      generateHeatmapCanvas(cv, selB, sunAngle, undefined, sunElevation);
    }
    return () => { alive = false; };
  }, [compare, selB, sunAngle, sunElevation, refreshKey]);
  // Experience map is mutated in place (same array reference), so it needs a
  // live poll while visible — other layers are derived from static terrain data.
  useEffect(()=>{
    if (sel !== 'Experience') return;
    const id = setInterval(()=>setTick(t=>t+1), 500);
    return () => clearInterval(id);
  }, [sel]);
  useEffect(()=>{
    if (!ref.current) return;
    const experienceMap = sel === 'Experience' ? learningModel?.getExperienceMap?.() : undefined;
    generateHeatmapCanvas(ref.current,sel,sunAngle,experienceMap,sunElevation);
  }, [sel,sunAngle,sunElevation,tick,learningModel,refreshKey]);
  return (
    <div>
      <Label>{IS_DEM ? 'Map Layers' : 'Parameter Heatmap'}</Label>
      <div style={{position:'relative',marginTop:4,marginBottom:5}}>
        <div onClick={()=>setOpen(o=>!o)} style={{
          background:'rgba(18,36,18,0.7)',border:'1px solid rgba(60,100,60,0.5)',
          borderRadius:3,padding:'3px 7px',cursor:'pointer',fontFamily:'monospace',
          display:'flex',justifyContent:'space-between',fontSize:fs(9),color:HM_COLORS[sel]||'#aaa',
        }}>
          {sel}<span style={{color:'#558855'}}>▼</span>
        </div>
        {open&&(
          <div style={{position:'absolute',top:'100%',left:0,right:0,zIndex:200,
            background:'rgba(6,16,6,0.97)',border:'1px solid rgba(60,100,60,0.5)',borderRadius:3,overflow:'hidden'}}>
            {HEATMAP_OPTIONS.map(o=>(
              <div key={o} onClick={()=>{setSel(o);setOpen(false);}}
                style={{padding:'4px 7px',fontSize:fs(9),cursor:'pointer',fontFamily:'monospace',
                  color:HM_COLORS[o]||'#aaa',background:o===sel?'rgba(40,80,40,0.5)':'transparent'}}
                onMouseEnter={e=>e.currentTarget.style.background='rgba(30,60,30,0.6)'}
                onMouseLeave={e=>e.currentTarget.style.background=o===sel?'rgba(40,80,40,0.5)':'transparent'}
              >{o}</div>
            ))}
          </div>
        )}
      </div>
      <div style={{position:'relative',width:MAP_S,height:MAP_S,touchAction:compare?'none':'auto',cursor:compare?'ew-resize':'default'}}
        onPointerDown={compare ? (e)=>{ e.currentTarget.setPointerCapture(e.pointerId); dragSplit(e); } : undefined}
        onPointerMove={compare ? (e)=>{ if (e.buttons || e.pointerType==='touch') dragSplit(e); } : undefined}>
        <canvas ref={ref} width={MAP_S} height={MAP_S}
          style={{width:MAP_S,height:MAP_S,display:'block',borderRadius:3,border:'1px solid rgba(80,120,60,0.3)',boxSizing:'border-box'}}/>
        {compare && (<>
          <canvas ref={refB} width={MAP_S} height={MAP_S} aria-label={`Layer B: ${selB}`}
            style={{position:'absolute',inset:0,width:MAP_S,height:MAP_S,borderRadius:3,pointerEvents:'none',
              clipPath:`inset(0 0 0 ${(split*100).toFixed(2)}%)`}}/>
          <div style={{position:'absolute',top:0,bottom:0,left:`${split*100}%`,width:2,marginLeft:-1,background:'#fff',boxShadow:'0 0 4px #000',pointerEvents:'none'}}>
            <div style={{position:'absolute',top:'50%',left:-9,marginTop:-9,width:20,height:18,borderRadius:9,background:'#fff',color:'#111',
              font:'bold 10px monospace',textAlign:'center',lineHeight:'18px'}}>◂▸</div>
          </div>
          <span style={{...CMP_TAG,left:4}}>A · {sel}</span>
          <span style={{...CMP_TAG,right:4}}>B · {selB}</span>
        </>)}
      </div>
      {IS_DEM && (
        <div style={{display:'flex',alignItems:'center',gap:5,marginTop:4}}>
          <Btn active={compare} color="#9fd0ff" onClick={()=>setCompare(c=>!c)} style={{flex:'none',padding:'3px 7px'}}
            title="Swipe between two layers of this site — drag the line on the map">
            {compare ? '◧ COMPARING ✓' : '◧ COMPARE LAYERS'}
          </Btn>
          {compare && (
            <select value={selB} onChange={e=>setSelB(e.target.value)} aria-label="Layer B (right side)"
              style={{flex:1,minWidth:0,background:'rgba(18,36,18,0.9)',color:'#cfe6ff',border:'1px solid rgba(100,150,200,0.5)',
                borderRadius:3,fontFamily:'monospace',fontSize:fs(8),padding:'2px 3px'}}>
              {[...(SITE.ortho ? [ORTHO_LAYER] : []), ...HEATMAP_OPTIONS].filter(o=>o!==sel).map(o=><option key={o} value={o}>B: {o}</option>)}
            </select>
          )}
        </div>
      )}
      {dataLayerLegend(sel) ? (
        <DataLayerLegend lg={dataLayerLegend(sel)} />
      ) : geologyLegend(sel) ? (
        <div style={{fontSize:fs(7),color:'#aab8a0',marginTop:3,lineHeight:1.5}}>
          {geologyLegend(sel).map(e => (
            <div key={e.name} style={{display:'flex',alignItems:'center',gap:4}}>
              <span style={{width:7,height:7,background:e.color,display:'inline-block',flexShrink:0}}/>
              <span style={{flex:1}}>{e.name}</span><span>{e.pct.toFixed(1)}%</span>
            </div>
          ))}
          <div style={{color:'#6a7a6a'}}>{SITE.geology?.source?.short || 'Stack et al. 2020 (CC BY 4.0)'}</div>
        </div>
      ) : (
      <div style={{display:'flex',justifyContent:'space-between',fontSize:fs(7),color:'#558855',marginTop:2}}>
        <span>LOW</span><span style={{color:HM_COLORS[sel]}}>{sel.toUpperCase()}</span><span>HIGH</span>
      </div>
      )}
      {IS_DEM && onDrape && (
        <div style={{display:'flex',alignItems:'center',gap:5,marginTop:5}}>
          <Btn active={!!drape} color="#ffbb66" onClick={() => onDrape(drape ? null : sel)}
            style={{flex:'none',padding:'3px 7px'}}>
            {drape ? '⛰ ON 3D TERRAIN ✓' : '⛰ DRAPE ON 3D TERRAIN'}
          </Btn>
          {drape && (
            <input type="range" min={0.2} max={0.95} step={0.05} value={drapeOpacity} title="Layer opacity"
              onChange={e => setDrapeOpacity(Number(e.target.value))} style={{flex:1}} />
          )}
        </div>
      )}
    </div>
  );
}

function DataLayerLegend({ lg }) {
  return (
    <div style={{fontSize:fs(7),color:'#aab8a0',marginTop:3,lineHeight:1.5}}>
      {lg.kind === 'classes' ? lg.entries.map(e => (
        <div key={e.name} style={{display:'flex',alignItems:'center',gap:4}}>
          <span style={{width:7,height:7,background:e.color,display:'inline-block',flexShrink:0}}/>
          <span style={{flex:1}}>{e.name}</span><span>{e.pct.toFixed(1)}%</span>
        </div>
      )) : (
        <>
          <div style={{height:6,borderRadius:2,background:'linear-gradient(90deg,#0000ff,#00ffff,#00ff00,#ffff00,#ff0000)'}}/>
          <div style={{display:'flex',justifyContent:'space-between'}}>
            <span>{lg.lo}</span><span style={{color:'#7a8a7a'}}>{lg.unit}</span><span>{lg.hi}+</span>
          </div>
        </>
      )}
      {lg.note && <div style={{color:'#7a8a7a'}}>{lg.note}</div>}
      <div style={{color:'#6a7a6a'}}>{lg.source}</div>
    </div>
  );
}

// ---- Image Processing Preview (Rover camera 3D / DEM: EV1 helmet camera) ----
const CAM_H = Math.round(126 * UI_SCALE);
function ProcessingMapPreview({ slopeMap, craterMask, hMap, roverPos, signalLost, signalQuality }) {
  const ref = useRef(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;

    ctx.fillStyle = 'rgba(8,20,10,1)';
    ctx.fillRect(0, 0, W, H);

    const sizeFrom = arr => {
      const n = arr?.length || 0;
      const s = Math.round(Math.sqrt(n));
      return Number.isFinite(s) && s > 0 && s * s <= n ? s : 0;
    };

    const grid = sizeFrom(hMap) || sizeFrom(slopeMap) || sizeFrom(craterMask);
    if (!grid) {
      ctx.fillStyle = '#557755';
      ctx.font = CANVAS_FONT(8);
      ctx.fillText('camera feed unavailable', 8, 16);
      return;
    }

    const iClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const idx = (r, c) => iClamp(r, 0, grid - 1) * grid + iClamp(c, 0, grid - 1);
    const sample = (arr, wx, wz, fb = 0) => {
      if (!arr || !arr.length) return fb;
      const u = ((wx + HALF) / TERRAIN_SIZE) * (grid - 1);
      const v = ((wz + HALF) / TERRAIN_SIZE) * (grid - 1);
      if (u < 0 || v < 0 || u > grid - 1 || v > grid - 1) return fb;

      const c0 = Math.floor(u), c1 = Math.min(grid - 1, c0 + 1);
      const r0 = Math.floor(v), r1 = Math.min(grid - 1, r0 + 1);
      const fu = u - c0, fv = v - r0;

      const a = arr[idx(r0, c0)] ?? fb;
      const b = arr[idx(r0, c1)] ?? fb;
      const c = arr[idx(r1, c0)] ?? fb;
      const d = arr[idx(r1, c1)] ?? fb;
      return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
    };
    const craterEdge = (wx, wz) => {
      if (!craterMask) return 0;
      const step = TERRAIN_SIZE / Math.max(8, grid - 1);
      const cx = Math.abs(sample(craterMask, wx + step, wz, 0) - sample(craterMask, wx - step, wz, 0));
      const cz = Math.abs(sample(craterMask, wx, wz + step, 0) - sample(craterMask, wx, wz - step, 0));
      return cx + cz;
    };

    // Simple software rendering from rover front camera perspective.
    const heading = roverPos?.heading ?? 0;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const rx = Math.cos(heading);
    const rz = -Math.sin(heading);

    // Mount camera slightly toward rover nose so view feels like true front cam
    // (DEM: helmet camera at eye height).
    const camForwardOffset = IS_DEM ? 0.2 : 0.75;
    const camX = (roverPos?.x ?? 0) + fx * camForwardOffset;
    const camZ = (roverPos?.z ?? 0) + fz * camForwardOffset;

    const camGround = sample(hMap, camX, camZ, 0);
    const camY = camGround + (IS_DEM ? 1.7 : 1.28);
    const horizon = Math.round(H * 0.48);
    const fov = 95 * Math.PI / 180;
    const near = 1.2;
    const far = IS_DEM ? 160 : 44;
    const stepD = IS_DEM ? 1.2 : 0.48;

    const yBuffer = new Float32Array(W);
    yBuffer.fill(H);

    for (let d = near; d <= far; d += stepD) {
      const halfLane = Math.tan(fov * 0.5) * d;
      const fog = Math.max(0.24, 1.0 - d / far);

      for (let sx = 0; sx < W; sx++) {
        const nx = sx / (W - 1);
        const lateral = (nx * 2 - 1) * halfLane;

        const wx = camX + fx * d + rx * lateral;
        const wz = camZ + fz * d + rz * lateral;
        if (wx < -HALF || wx > HALF || wz < -HALF || wz > HALF) continue;

        const h = sample(hMap, wx, wz, 0);
        const slope = Math.max(0, Math.min(1, sample(slopeMap, wx, wz, 0) / 0.8));
        const crater = Math.max(0, Math.min(1, sample(craterMask, wx, wz, 0)));
        const edge = craterEdge(wx, wz);

        const sy = horizon - ((h - camY) * 65 * UI_SCALE) / Math.max(1.0, d);
        if (sy >= yBuffer[sx]) continue;

        const hazard = Math.max(crater, slope * 0.66);
        let r = 24 + 180 * hazard;
        let g = 84 + 118 * (1 - hazard);
        let b = 26 + 44 * (1 - hazard);

        // Edge detector output: mark crater rims clearly.
        if (edge > 0.20) {
          r = 255;
          g = 78;
          b = 52;
        }

        const yTop = Math.max(0, sy);
        const yBottom = Math.min(H, yBuffer[sx]);
        if (yBottom <= yTop) continue;

        ctx.strokeStyle = `rgba(${Math.round(r * fog)}, ${Math.round(g * fog)}, ${Math.round(b * fog)}, 0.95)`;
        ctx.beginPath();
        ctx.moveTo(sx + 0.5, yTop);
        ctx.lineTo(sx + 0.5, yBottom);
        ctx.stroke();
        yBuffer[sx] = yTop;
      }
    }

    // HUD overlay
    ctx.strokeStyle = 'rgba(120,220,130,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 10, H / 2); ctx.lineTo(W / 2 + 10, H / 2);
    ctx.moveTo(W / 2, H / 2 - 8);  ctx.lineTo(W / 2, H / 2 + 8);
    ctx.stroke();
    ctx.fillStyle = '#76d476';
    ctx.font = CANVAS_FONT(7);
    ctx.fillText(IS_DEM ? 'SLOPE HAZARD VIEW' : 'EDGE DETECT: CRATER RIMS', 6, fs(10));

    // Subtle scan-lines for a terminal style readout.
    ctx.strokeStyle = 'rgba(120,180,120,0.08)';
    ctx.lineWidth = 1;
    for (let y = 2; y < H; y += 4) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    // Dust interference camera degradation (noisy/glitchy, not full black)
    const noiseLevel = Math.max(0, Math.min(1, 1 - (signalQuality ?? 1)));
    if (noiseLevel > 0.04) {
      const lines = Math.floor(24 + noiseLevel * 180);
      for (let i = 0; i < lines; i++) {
        const y = Math.random() * H;
        ctx.strokeStyle = `rgba(${150 + Math.random() * 90},${150 + Math.random() * 90},${150 + Math.random() * 90},${0.06 + noiseLevel * 0.24})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y + (Math.random() - 0.5) * 3.5);
        ctx.stroke();
      }

      const glitches = Math.floor(1 + noiseLevel * 12);
      for (let i = 0; i < glitches; i++) {
        const gw = 16 + Math.random() * 66;
        const gh = 2 + Math.random() * 15;
        const gx = Math.random() * (W - gw);
        const gy = Math.random() * (H - gh);
        ctx.fillStyle = `rgba(${120 + Math.random() * 120},${120 + Math.random() * 120},${120 + Math.random() * 120},${0.08 + noiseLevel * 0.30})`;
        ctx.fillRect(gx, gy, gw, gh);
      }
    }

    if (signalLost) {
      for (let y = 0; y < H; y += 2) {
        const n = 80 + Math.random() * 145;
        ctx.strokeStyle = `rgba(${n},${n},${n},${0.09 + Math.random() * 0.2})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y + (Math.random() - 0.5) * 2.2);
        ctx.stroke();
      }

      ctx.fillStyle = 'rgba(10,10,10,0.42)';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,90,90,0.68)';
      ctx.strokeRect(1, 1, W - 2, H - 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff7755';
      ctx.font = CANVAS_FONT(11, true);
      ctx.fillText('OPTICAL SENSOR FAILURE', W / 2, H / 2 - 10);
      ctx.fillStyle = '#ffb48a';
      ctx.font = CANVAS_FONT(10, true);
      ctx.fillText('SIGNAL LOST', W / 2, H / 2 + 8);
      ctx.fillStyle = '#ffd8b4';
      ctx.font = CANVAS_FONT(7);
      ctx.fillText('NO SIGNAL - DUST INTERFERENCE', W / 2, H / 2 + 22);
      ctx.textAlign = 'start';
    }
  }, [slopeMap, craterMask, hMap, roverPos?.x, roverPos?.z, roverPos?.heading, signalLost, signalQuality]);

  return (
    <div>
      <Label>{IS_DEM ? 'EV1 Helmet Camera (slope hazard view)' : 'Rover Front Camera (3D)'}</Label>
      <div style={{ marginTop: 4 }}>
        <canvas
          ref={ref}
          width={MAP_S}
          height={CAM_H}
          style={{
            width: MAP_S,
            height: CAM_H,
            display: 'block',
            borderRadius: 3,
            border: '1px solid rgba(80,120,60,0.3)',
            background: 'rgba(7,14,8,0.85)',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize:fs(7), color: '#557755', marginTop: 2 }}>
          <span style={{ color: signalLost ? '#ff7755' : '#66cc66' }}>{signalLost ? 'NO SIGNAL' : 'SAFE'}</span>
          <span style={{ color: signalLost ? '#ff9966' : '#8cd08c' }}>{IS_DEM ? 'HELMET CAM' : 'FRONT CAM + EDGE DETECT'}</span>
          <span style={{ color: '#ff6644' }}>{IS_DEM ? 'STEEP' : 'RIM / HAZARD'}</span>
        </div>
      </div>
    </div>
  );
}

// ---- Export helpers ----
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportPNG() {
  // The Three.js canvas is the first <canvas> in the 3D scene div
  const canvas = document.querySelector('canvas');
  if (!canvas) return false;
  canvas.toBlob(blob => {
    if (blob) downloadBlob(blob, `${IS_DEM ? 'martian_map' : 'moon_rover'}_${Date.now()}.png`);
  }, 'image/png');
  return true;
}

function exportJSON(waypoints, routes, activeRoute, sunAngleDeg, mission = null) {
  const payload = {
    version: mission ? 2 : 1,
    ...(mission ? { mission } : {}),
    app: IS_DEM ? 'Martian Map' : 'Moon Rover',
    site: IS_DEM ? { name: SITE.name, center: SITE.meta?.center } : null,
    timestamp: new Date().toISOString(),
    sunAngleDeg,
    activeRoute,
    waypoints: waypoints.map(w => ({ x: +w.x.toFixed(2), z: +w.z.toFixed(2),
      ...(w.dwellS ? { dwellS: w.dwellS, label: w.label } : {}) })),
    routes: routes
      ? Object.fromEntries(Object.entries(routes).map(([mode, r]) => [mode, {
          stats: r.stats,
          path:  r.path.map(([x, y, z]) => [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)]),
        }]))
      : null,
  };
  // typed arrays (elapsedS, marginS) → plain arrays
  const json = JSON.stringify(payload, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v, x => +x.toFixed(2)) : v), 2);
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, `${IS_DEM ? 'martian_map_route' : 'moon_rover_route'}_${Date.now()}.json`);
}


export default function RightPanel({
  roverState, pathRef,
  routes, activeRoute, setActiveRoute,
  waypoints, onAddWaypoint, onSetStartWaypoint, onRemoveLastWaypoint, onClearWaypoints,
  onPlanPath,
  isPlanning = false,
  hasGeology = false, science = null, onPlanScience = () => {}, isPlanningScience = false,
  scienceDwellMin = 20, setScienceDwellMin = () => {},
  mission = DEFAULT_MISSION, setMission = () => {},
  sunAngleDeg, setSunAngleDeg,
  sun = null, evaStartMs = null, setEvaStartMs = () => {},
  cameraMode, setCameraMode,
  wireframe, setWireframe,
  orthoOn, setOrthoOn,
  showTrack = false, setShowTrack = null,
  onStartRover, onStopRover, isRoving,
  evaStatus = 'idle', onAbortEva = () => {}, onPauseEva = null,
  drapeLayer = null, setDrapeLayer = null, drapeOpacity = 0.6, setDrapeOpacity = () => {},
  slopeMap, craterMask, hMap,
  learningModel, routeLog, showToast,
  dustMode, dustHazard, cameraSignalLost, cameraSignalQuality, onTriggerDustHazard, onDustPlaced, onClearDustHazard,
  objectives = [], objectiveId = null, onSelectObjective = () => {}, objectiveSupport = {},
}) {
  const narrow = useNarrow();   // phone: bottom sheet under the 3D view
  // ---- mission-planning state shared by the panels (DEM) ----
  const [layersReviewed, setLayersReviewed] = useState(false);
  const [hazardReviewed, setHazardReviewed] = useState(false);
  const [exported, setExported] = useState(false);
  const [evaRan, setEvaRan] = useState(false);
  useEffect(() => { if (evaStatus !== 'idle') setEvaRan(true); }, [evaStatus]);
  const objective = getObjective(objectiveId);
  const records = useMemo(() => siteProvenance(SITE), []);
  const radRecord = findRecord(records, 'rad');
  const { wx: sw, state: swState } = useSpaceWeather(IS_DEM ? evaStartMs : NaN);
  const bufferM = mission.obstacleBufferM || 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hazards = useMemo(() => getSiteHazards(), [bufferM, mission.rover, routes]);
  const evaluations = useMemo(() => {
    if (!IS_DEM || !routes) return {};
    const out = {};
    for (const [mode, r] of Object.entries(routes)) {
      if (!r?.stats || r.stats.walkTimeS === undefined) continue;
      out[mode] = evaluateMission(r.stats, {
        limits: { slopeDeg: param('maxWalkableSlopeDeg'), radialKm: param('maxRadialDistanceKm'), budgetH: param('evaDurationH'), rockM: param('maxRockReliefM') },
        profile: getEvaProfile(), spaceWeather: sw, swState,
        radiationCategory: radRecord?.categories?.[0], rockLayer: !!SITE.layers?.rock,
        routeHazards: routeHazardsFor(r.path),
      });
    }
    return out;
  }, [routes, sw, swState, radRecord, hazards]); // eslint-disable-line react-hooks/exhaustive-deps
  const stopCards = useMemo(() => {
    if (!IS_DEM || !science?.stops) return [];
    const obj = getObjective(science.objective);
    return science.stops.map((st, i) => stopCard(st, i, {
      objective: obj, site: SITE, records, slope: slopeMap, hazardFlags: hazards?.flags || null, dwellS: science.dwellS,
      latLon: localToLatLon, groundView: nearestPanorama(st.x, st.z),
    }));
  }, [science, records, slopeMap, hazards]);
  const summary = useMemo(() => {
    const r = routes?.[activeRoute];
    if (!IS_DEM || !r?.stats || r.stats.walkTimeS === undefined) return null;
    return missionSummary({ objective: science ? getObjective(science.objective) : null, siteName: SITE.name, siteLabel: SITE.meta?.label,
      science, mode: activeRoute, stats: r.stats, evaluation: evaluations[activeRoute], routeHazards: routeHazardsFor(r.path),
      radiationRecord: radRecord, mission, startMs: evaStartMs });
  }, [routes, activeRoute, science, evaluations, radRecord, mission, evaStartMs]);
  const workflow = IS_DEM ? [
    { id: 'objective', label: 'Mission objective', state: objective ? 'done' : 'todo', hint: 'Choose what the EVA is for.' },
    { id: 'site', label: 'Exploration site', state: 'done', hint: `Loaded: ${SITE.meta?.label}. Switch with the site selector (top left).` },
    { id: 'crew', label: 'Crew & equipment', state: carryCheck(mission).ok ? 'done' : 'blocked', hint: 'Suit, equipment, EVA limits, rover.' },
    { id: 'layers', label: 'Data layers', state: layersReviewed ? 'done' : 'todo', hint: 'Open a layer record to review its source and limits.' },
    { id: 'hazards', label: 'Hazard assessment', state: hazardReviewed ? 'done' : 'todo', hint: 'Review the hazard map and its limits.' },
    { id: 'stops', label: 'Science stops', state: science ? 'done' : 'todo', hint: 'PLAN SCIENCE EVA.' },
    { id: 'route', label: 'EVA route', state: routes ? 'done' : 'todo', hint: 'Routes are planned from the stops.' },
    { id: 'gonogo', label: 'GO / NO-GO', state: evaluations[activeRoute] ? 'done' : 'todo', hint: 'See the safety explanation on the active route card.' },
    { id: 'eva', label: 'EVA simulation', state: evaRan ? 'done' : 'todo', hint: 'START EVA.' },
    { id: 'export', label: 'Mission export', state: exported ? 'done' : 'todo', hint: 'Cuff card, JSON mission file, share link.' },
  ] : [];
  const goToStep = (id) => {
    const target = { objective: 'objective', site: 'objective', crew: 'crew', layers: 'layers', hazards: 'hazards', stops: 'stops',
      route: 'route', gonogo: 'route', eva: 'route', export: 'export' }[id];
    document.getElementById('mm-sect-' + target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (id === 'hazards') setHazardReviewed(true);
  };
  const [pickMode, setPickMode] = useState(false);
  const [cuffMode, setCuffMode] = useState(null);   // route mode whose cuff card is open
  const [shareLabel, setShareLabel] = useState('SHARE LINK');

  const handlePick = useCallback(pos => {
    if (waypoints.length === 0) {
      onSetStartWaypoint(pos);
    } else {
      onAddWaypoint(pos);
    }
    setPickMode(false);
  }, [waypoints.length, onSetStartWaypoint, onAddWaypoint]);

  const { x=0, z=0, speed=0, heading=0 } = roverState || {};
  const trail = pathRef?.current?._roverTrail?.length || 0;
  const lm = learningModel?.getStats?.() || { traversals:0, cellsKnown:0, maxHazard:0 };

  // Extract just paths for the mini-map
  const routePaths = routes
    ? Object.fromEntries(Object.entries(routes).map(([m,r])=>[m, r?.path || r]))
    : null;

  const dustPickMode = dustMode === 'dust_placement_mode';
  const startPos = waypoints[0] || null;
  const endPos   = waypoints[waypoints.length-1] || null;

  return (
    <div style={{
      position:'fixed',right:0,bottom:0,
      ...(narrow
        ? { left:0, height:`${SHEET_VH}vh`, borderTop:'1px solid rgba(80,140,80,0.6)', WebkitOverflowScrolling:'touch' }
        : { top:0, width:PW, borderLeft:'1px solid rgba(35,70,35,0.5)' }),
      background:'rgba(4,10,4,0.96)',
      display:'flex',flexDirection:'column',overflowY:'auto',
      zIndex:10,backdropFilter:'blur(5px)',
    }}>
      {/* Header */}
      <div style={{padding:'7px 10px 5px',borderBottom:'1px solid rgba(35,70,35,0.4)',
        background:'rgba(0,14,0,0.7)',flexShrink:0}}>
        <div style={{color:'#3dff55',fontSize:fs(10),fontWeight:'bold',letterSpacing:2}}>{IS_DEM ? 'MARTIAN MAP' : 'MOON ROVER SIM'}</div>
        <div style={{color:'#245524',fontSize:fs(7),letterSpacing:1}}>{IS_DEM ? 'MARSWALK PLANNER' : 'MISSION CONTROL TERMINAL'}</div>
      </div>

      <div style={{flex:1,padding:'6px 8px',display:'flex',flexDirection:'column',gap:8,overflowY:'auto'}}>

        {IS_DEM && workflow.length > 0 && (
          <Sect label="Mission workflow">
            <WorkflowSteps steps={workflow} onGo={goToStep} />
          </Sect>
        )}

        {/* ── Topographic Map — first thing the user sees ── */}
        <div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:3}}>
            <Label>TOPOGRAPHIC MAP</Label>
            <span style={{fontSize:fs(7),color: dustPickMode?'#ffcc88':'#4a884a'}}>
              {dustPickMode ? '☁ CLICK TO PLACE DUST' : pickMode ? '▶ CLICK TO PLACE WP' : 'SCROLL=ZOOM · DRAG=PAN'}
            </span>
          </div>
          <MiniMap
            waypoints={waypoints}
            roverPos={{x,z,heading}}
            routes={routePaths}
            activeRoute={activeRoute}
            ponr={routes?.[activeRoute]?.stats?.ponrPoint || null}
            pickMode={pickMode}
            onPick={handlePick}
            dustHazard={dustHazard}
            dustPickMode={dustPickMode}
            onDustPlace={onDustPlaced}
            orthoOn={!wireframe && orthoOn}
            showTrack={showTrack}
          />
          <div style={{fontSize:fs(7),color:'#3a5a3a',marginTop:3,display:'flex',gap:4,justifyContent:'space-between'}}>
            <span style={{color:startPos?'#22ff66':'#2a4a2a'}}>
              S: {startPos?`${startPos.x.toFixed(0)},${startPos.z.toFixed(0)}`:'--'}
            </span>
            <span style={{color:endPos&&waypoints.length>1?'#ff4422':'#4a2a2a'}}>
              E: {endPos&&waypoints.length>1?`${endPos.x.toFixed(0)},${endPos.z.toFixed(0)}`:'--'}
            </span>
          </div>
          {IS_DEM && SITE.track && setShowTrack && (
            <div style={{marginTop:5}}>
              <Btn active={showTrack} color="#c8ccff" onClick={()=>setShowTrack(v=>!v)} style={{width:'100%'}}
                title={`${SITE.track.rover}'s own route through this site (sols ${SITE.track.sols[0]}–${SITE.track.sols[1]}, ${(SITE.track.length_m/1000).toFixed(1)} km) and named places — ${SITE.track.credit}`}>
                {showTrack ? '✓ ' : ''}{SITE.track.rover.toUpperCase()}'S ROUTE & PLACES
              </Btn>
              {showTrack && SITE.track.labels.some(l=>l.derived) && (
                <div style={{fontSize:fs(6.5),color:'#6a7a6a',marginTop:2}}>Region names: this project's derived levels, not NASA's mapped units.</div>
              )}
            </div>
          )}
          <div style={{height:1,background:'rgba(30,70,30,0.2)',marginTop:8}}/>
        </div>

        {/* Terrain */}
        <Sect label="Terrain Mode">
          <Row>
            <Btn active={!wireframe && !(SITE.ortho && orthoOn)} onClick={()=>{setWireframe(false); setOrthoOn?.(false);}}>{IS_DEM ? 'DEM' : 'PROCEDURAL'}</Btn>
            {SITE.ortho && (
              <Btn active={!wireframe && orthoOn} onClick={()=>{setWireframe(false); setOrthoOn(true);}}
                title={`Orbital image: ${SITE.ortho.source?.title}`}>HiRISE</Btn>
            )}
            <Btn active={wireframe}  onClick={()=>setWireframe(true)}>WIRE</Btn>
          </Row>
        </Sect>

        {/* Waypoints */}
        <Sect label={`Waypoints (${waypoints.length})`}>
          {/* Waypoint list */}
          {waypoints.length > 0 && (
            <div style={{marginBottom:5,maxHeight:Math.round(58*UI_SCALE),overflowY:'auto',fontSize:fs(8),fontFamily:'monospace',
              background:'rgba(0,12,0,0.4)',borderRadius:3,padding:'3px 5px'}}>
              {waypoints.map((wp,i) => (
                <div key={i} style={{display:'flex',alignItems:'center',gap:4,marginBottom:1}}>
                  <div style={{width:5,height:5,borderRadius:'50%',flexShrink:0,
                    background:i===0?'#22ff55':i===waypoints.length-1?'#ff4422':WP_COLORS_2D[i%WP_COLORS_2D.length]}}/>
                  <span style={{color:'#779977'}}>{i===0?'S':i===waypoints.length-1?'E':i}:</span>
                  <span style={{color:'#aaffaa'}}>{wp.x.toFixed(0)},{wp.z.toFixed(0)}</span>
                  {wp.label && <span style={{color:'#ffbb66',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={wp.label}>⛏ {wp.label}</span>}
                </div>
              ))}
            </div>
          )}
          <Row style={{marginBottom:4}}>
            <Btn active={pickMode} color="#44ffaa"
              onClick={()=>setPickMode(m=>!m)}>
              {pickMode?'● ADDING…':'+ ADD WP'}
            </Btn>
            <Btn onClick={onRemoveLastWaypoint} disabled={waypoints.length===0}>
              ← REMOVE
            </Btn>
          </Row>
          <Row>
            <Btn onClick={onClearWaypoints} disabled={waypoints.length===0}>CLEAR ALL</Btn>
            <Btn disabled={waypoints.length<2 || isPlanning} onClick={onPlanPath}
              style={{flex:1.5,background:'rgba(0,65,0,0.55)',borderColor:'rgba(0,180,0,0.5)',
                color:'#44ff88',fontWeight:'bold'}}>
              {isPlanning ? 'PLANNING…' : 'PLAN PATH'}
            </Btn>
          </Row>
        </Sect>

        {IS_DEM && objectives.length > 0 && (
        <Sect label="1 · Mission objective" id="objective">
          <ObjectivePanel objectives={objectives} value={objectiveId} onChange={onSelectObjective}
            support={objectiveSupport} disabled={isRoving} />
        </Sect>
        )}

        {IS_DEM && (
        <Sect label="3 · Crew & equipment (mission setup)" id="crew">
          <MissionPanel mission={mission} setMission={setMission} start={waypoints?.[0]} disabled={isRoving} />
        </Sect>
        )}

        {IS_DEM && (
        <Sect label="4 · Data layers & provenance" id="layers">
          <ProvenancePanel records={records} onOpen={() => setLayersReviewed(true)} />
        </Sect>
        )}

        {IS_DEM && hazards && (
        <Sect label="5 · Hazard assessment" id="hazards">
          <div onPointerDown={() => setHazardReviewed(true)}>
            <HazardPanel hazards={hazards} bufferM={bufferM} disabled={isRoving} refreshKey={routes}
              setBufferM={(m) => setMission({ ...mission, obstacleBufferM: m })}
              draped={drapeLayer === HAZARD_LAYER}
              onDrape={setDrapeLayer ? () => setDrapeLayer(drapeLayer === HAZARD_LAYER ? null : HAZARD_LAYER) : null} />
          </div>
        </Sect>
        )}

        {hasGeology && (
        <Sect label="6 · Science stops (science EVA)" id="stops">
          <SciencePanel science={science} onPlan={onPlanScience} busy={isPlanningScience || isPlanning}
            dwellMin={scienceDwellMin} setDwellMin={setScienceDwellMin} disabled={isRoving}
            objective={objective} objectiveStatus={objective ? objectiveSupport[objective.id]?.status : null} cards={stopCards} />
        </Sect>
        )}

        {/* Sun — DEM: Mars24 time controls; procedural: manual dial */}
        {IS_DEM && sun ? (
        <Sect label="Mars Time">
          <MarsTimePanel sun={sun} evaStartMs={evaStartMs} setEvaStartMs={setEvaStartMs} sw={sw} swState={swState} radRecord={radRecord} />
        </Sect>
        ) : (
        <Sect label="Sun Direction">
          <div style={{display:'flex',gap:7,alignItems:'center'}}>
            <SunDial angle={sunAngleDeg} onChange={setSunAngleDeg}/>
            <div style={{flex:1}}>
              <div style={{color:'#FFD700',fontSize:fs(14),fontWeight:'bold',marginBottom:3}}>{sunAngleDeg}°</div>
              <input type="range" min={0} max={359} value={sunAngleDeg}
                onChange={e=>setSunAngleDeg(Number(e.target.value))} style={{width:'100%'}}/>
              <div style={{color:'#554433',fontSize:fs(7),marginTop:2}}>
                {['N','NE','E','SE','S','SW','W','NW','N'][Math.round(sunAngleDeg/45)%8]} — PATH FAVORS LIT ZONES
              </div>
            </div>
          </div>
        </Sect>
        )}

        {/* Route selector + start */}
        <Sect label={IS_DEM ? 'Route & EVA' : 'Select Route'}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:3,marginBottom:5}}>
            {Object.entries(ROUTE_COLORS)
              .filter(([mode]) => mode !== 'HOME_RETURN')
              .map(([mode,color])=>(
              <div key={mode} onClick={()=>setActiveRoute(mode)} style={{
                padding:'5px 3px',textAlign:'center',cursor:'pointer',borderRadius:3,
                fontSize:fs(9),fontWeight:'bold',
                border:`1px solid ${activeRoute===mode?color:'rgba(40,70,40,0.35)'}`,
                color:activeRoute===mode?color:'#446644',
                background:activeRoute===mode?'rgba(0,0,0,0.5)':'rgba(6,12,6,0.35)',
                boxShadow:activeRoute===mode?`0 0 7px ${color}44`:'none',
                transition:'all 0.12s',
              }}>
                <span style={{display:'inline-block',width:5,height:5,borderRadius:'50%',background:color,
                  marginRight:3,verticalAlign:'middle'}}/>
                {mode}
              </div>
            ))}
          </div>
          {IS_DEM ? (
            <>
              <Btn onClick={evaStatus==='playing' ? onPauseEva : onStartRover}
                disabled={!routes||!routes[activeRoute]}
                style={{width:'100%',padding:'7px 0',
                  background:evaStatus==='playing'?'rgba(60,40,0,0.6)':'rgba(0,65,0,0.6)',
                  border:`1px solid ${evaStatus==='playing'?'rgba(220,170,40,0.6)':'rgba(40,180,40,0.6)'}`,
                  color:evaStatus==='playing'?'#ffd166':'#44ff88',fontSize:fs(10),fontWeight:'bold',letterSpacing:1}}>
                {evaStatus==='playing' ? '❚❚  PAUSE EVA' : evaStatus==='paused' ? '▶  RESUME EVA'
                  : evaStatus==='done' ? '↻  REPLAY EVA' : '▶  START EVA'}
              </Btn>
              {evaStatus !== 'idle' && (
                <Row style={{marginTop:4}}>
                  <Btn onClick={onAbortEva} color="#ff8a3a" disabled={evaStatus==='done' || evaStatus==='ready'}>⏏ ABORT EVA</Btn>
                  <Btn onClick={onStopRover}>✕ CLOSE</Btn>
                </Row>
              )}
            </>
          ) : (
          <Btn onClick={isRoving?onStopRover:onStartRover}
            disabled={!routes||!routes[activeRoute]}
            style={{width:'100%',padding:'7px 0',
              background:isRoving?'rgba(65,0,0,0.6)':'rgba(0,65,0,0.6)',
              border:`1px solid ${isRoving?'rgba(180,40,40,0.6)':'rgba(40,180,40,0.6)'}`,
              color:isRoving?'#ff5533':'#44ff88',fontSize:fs(10),fontWeight:'bold',letterSpacing:1}}>
            {isRoving?'■  STOP ROVER':'▶  START ROVER'}
          </Btn>
          )}
        </Sect>

        {/* ── Hazard Control (DEM: contingency) ── */}
        <Sect label={IS_DEM ? 'Contingency' : 'Hazard Control'}>
          {/* Status banner */}
          {dustMode === DUST_STATES.INTERFERENCE && (
            <div style={{marginBottom:5,padding:'4px 6px',borderRadius:3,fontSize:fs(8),fontFamily:'monospace',
              background:'rgba(60,20,0,0.7)',border:'1px solid rgba(255,120,0,0.6)',color:'#ffcc66',
              letterSpacing:0.4}}>
              ⚠ DUST INTERFERENCE DETECTED
            </div>
          )}
          {dustMode === DUST_STATES.SIGNAL_LOST && (
            <div style={{marginBottom:5,padding:'4px 6px',borderRadius:3,fontSize:fs(8),fontFamily:'monospace',
              background:'rgba(65,0,0,0.72)',border:'1px solid rgba(255,80,80,0.68)',color:'#ff8a66',
              letterSpacing:0.4}}>
              ✖ SIGNAL LOST / OPTICAL SENSOR FAILURE
            </div>
          )}
          {dustMode === DUST_STATES.RETURN_HOME && (
            <div style={{marginBottom:5,padding:'4px 6px',borderRadius:3,fontSize:fs(8),fontFamily:'monospace',
              background:'rgba(40,10,0,0.7)',border:'1px solid rgba(255,80,0,0.5)',color:'#ff9955',
              letterSpacing:0.4,animation:'slideDown 0.25s ease'}}>
              {IS_DEM ? '↩ EVA ABORTED — CREW RETURNING TO THE HABITAT' : '↩ RETURNING TO HOME BASE'}
            </div>
          )}
          {dustMode === DUST_STATES.PRESENT && (
            <div style={{marginBottom:5,padding:'4px 6px',borderRadius:3,fontSize:fs(8),fontFamily:'monospace',
              background:'rgba(24,24,24,0.62)',border:'1px solid rgba(150,150,150,0.45)',color:'#c9c9c9',
              letterSpacing:0.4}}>
              {IS_DEM ? '☁ DUST DEVIL — ROUTE LOOK-AHEAD ACTIVE' : '☁ DUST PRESENT - CONTINUOUS MONITORING'}
            </div>
          )}
          {dustMode === DUST_STATES.STOPPED && (
            <div style={{marginBottom:5,padding:'4px 6px',borderRadius:3,fontSize:fs(8),fontFamily:'monospace',
              background:'rgba(0,30,0,0.7)',border:'1px solid rgba(60,180,60,0.5)',color:'#88ffaa',
              letterSpacing:0.4}}>
              {IS_DEM ? '✓ Crew safe at the habitat.' : '✓ Rover stopped safely.'}
            </div>
          )}

          {/* Dust-hazard trigger button — arms/cancels PLACEMENT mode so the
              user can click the map to drop a hazard; it does NOT drive the
              rover home itself. That's why the idle label says "SIMULATE
              DUST HAZARD" rather than "RETURN TO HOME" — the actual return
              drive is auto-triggered later, once the placed hazard causes
              sensor interference (see startReturnToHome() in App.jsx). */}
          <button onClick={onTriggerDustHazard} style={{
            width:'100%',padding:'6px 0',fontSize:fs(9),fontFamily:'monospace',fontWeight:'bold',
            letterSpacing:0.7,cursor:'pointer',borderRadius:3,marginBottom:4,
            background: dustPickMode
              ? 'rgba(80,40,0,0.7)'
              : dustMode===DUST_STATES.RETURN_HOME||dustMode===DUST_STATES.INTERFERENCE||dustMode===DUST_STATES.SIGNAL_LOST
                ? 'rgba(50,20,0,0.5)'
                : 'rgba(50,20,0,0.6)',
            border:`1px solid ${dustPickMode?'rgba(255,160,0,0.8)':'rgba(255,100,0,0.55)'}`,
            color: dustPickMode ? '#ffcc44' : '#ff9944',
            display:'flex',alignItems:'center',justifyContent:'center',gap:5,
            boxShadow: dustPickMode ? '0 0 8px rgba(255,140,0,0.4)' : 'none',
          }}>
            <span style={{fontSize:fs(11)}}>☁</span>
            {dustPickMode ? (IS_DEM ? '● PLACING DUST DEVIL… (CANCEL)' : '● PLACING DUST… (CANCEL)')
              : (IS_DEM ? 'SIMULATE DUST DEVIL' : 'SIMULATE DUST HAZARD')}
          </button>

          {dustHazard && (
            <div style={{fontSize:fs(7),fontFamily:'monospace',color:'#b5b5b5',marginBottom:3}}>
              {IS_DEM ? 'HELMET CAM SIGNAL' : 'CAM SIGNAL'}: <span style={{color:cameraSignalLost ? '#ff6655' : '#aaffaa'}}>{cameraSignalLost ? 'LOST' : `${Math.round((cameraSignalQuality ?? 1) * 100)}%`}</span>
            </div>
          )}

          {/* Dust hazard info + clear button */}
          {IS_DEM && (
            <div style={{fontSize:fs(6.5),color:'#7a6a4a',marginBottom:4,lineHeight:1.4}}>
              A dust devil that lies on the route within the next {Math.round(600/60)} min of walking
              aborts the EVA; the crew walks home on the fastest path. Radius is illustrative.
            </div>
          )}
          {dustHazard && (
            <div style={{display:'flex',alignItems:'center',gap:3}}>
              <div style={{flex:1,fontSize:fs(7),fontFamily:'monospace',color:'rgba(200,160,100,0.8)',
                background:'rgba(40,20,0,0.4)',borderRadius:3,padding:'3px 5px'}}>
                ☁ ({dustHazard.x.toFixed(0)},{dustHazard.z.toFixed(0)}) r={dustHazard.radius}m
              </div>
              <Btn onClick={onClearDustHazard} color="#ff8844"
                style={{flex:'none',padding:'3px 7px',fontSize:fs(7)}}>
                CLEAR
              </Btn>
            </div>
          )}
        </Sect>

        {/* Route Analysis */}
        <Sect label={IS_DEM ? '7–8 · EVA route & GO / NO-GO' : 'Route Analysis'} id="route">
          <RouteAnalysis routes={routes} activeRoute={activeRoute} onSelect={setActiveRoute}
            onCuffCard={IS_DEM ? (m) => { setCuffMode(m); setExported(true); } : null} evaluations={evaluations}/>
          {cuffMode && routes?.[cuffMode]?.stats?.marginS && (
            <CuffCard mode={cuffMode} route={routes[cuffMode]} startMs={evaStartMs} mission={mission} evaluation={evaluations[cuffMode] || null} onClose={() => setCuffMode(null)} />
          )}
        </Sect>

        {/* Camera */}
        <Sect label="Camera">
          <Row>
            <Btn active={cameraMode==='free'}   onClick={()=>setCameraMode('free')}>FREE</Btn>
            <Btn active={cameraMode==='follow'} onClick={()=>setCameraMode('follow')}>{IS_DEM ? 'FOLLOW EV1' : 'FOLLOW'}</Btn>
            {IS_DEM && <Btn active={cameraMode==='overview'} onClick={()=>setCameraMode('overview')}>OVERVIEW</Btn>}
          </Row>
        </Sect>

        {/* Heatmap */}
        <HeatmapViewer sunAngle={sunAngleDeg} sunElevation={sun?.elevationDeg} learningModel={learningModel}
          refreshKey={routes} drape={drapeLayer} onDrape={setDrapeLayer}
          drapeOpacity={drapeOpacity} setDrapeOpacity={setDrapeOpacity}/>

        {/* Image processing proof panel */}
        <ProcessingMapPreview
          slopeMap={slopeMap}
          craterMask={craterMask}
          hMap={hMap}
          roverPos={{ x, z, heading }}
          signalLost={cameraSignalLost}
          signalQuality={cameraSignalQuality}
        />

        {/* AI (rover traversal learning — Moon mode only) */}
        {!IS_DEM && (
        <Sect label="AI Learning">
          <div style={{fontSize:fs(8),color:'#557755',lineHeight:1.9,fontFamily:'monospace'}}>
            <div>Traversals:  <V>{lm.traversals}</V></div>
            <div>Cells known: <V>{lm.cellsKnown}</V></div>
            <div>Max hazard:  <V c={lm.maxHazard>0.7?'#ff6644':'#99ff99'}>{(lm.maxHazard||0).toFixed(3)}</V></div>
          </div>
        </Sect>
        )}

        {/* Telemetry */}
        <Sect label={IS_DEM ? 'Telemetry (EV1)' : 'Telemetry'}>
          <div style={{fontFamily:'monospace',fontSize:fs(8),color:'#557755',lineHeight:1.9}}>
            <div>X: <V>{x.toFixed(1)}</V>  Z: <V>{z.toFixed(1)}</V> m</div>
            {IS_DEM && (() => { const ll = localToLatLon(x, z); return ll && (
              <div>Lat/Lon: <V>{ll.lat.toFixed(5)}°N {ll.lon.toFixed(5)}°E</V></div>); })()}
            <div>Speed: <V>{(speed*3.6).toFixed(1)}</V> km/h{IS_DEM ? ' (mission time)' : ''}</div>
            <div>Heading: <V>{((heading*180/Math.PI+360)%360).toFixed(0)}°</V></div>
            {!IS_DEM && <div>Trail pts: <V>{trail}</V></div>}
          </div>
        </Sect>

        {/* Exports & Share */}
        {IS_DEM && (
        <Sect label="Mission summary" id="export">
          <MissionSummaryPanel summary={summary} />
        </Sect>
        )}

        <Sect label={IS_DEM ? '10 · Mission export & share' : 'Export & Share'}>
          <div style={{display:'flex',flexDirection:'column',gap:4}}>

            {/* PNG */}
            <button onClick={() => {
              const ok = exportPNG();
              if (!ok) { showToast?.('Could not capture scene — try again in a moment.', 'warning'); return; }
              showToast?.('PNG saved to Downloads.', 'info');
            }} style={{
              width:'100%', padding:'6px 0', fontSize:fs(9), fontFamily:'monospace',
              fontWeight:'bold', letterSpacing:0.6, cursor:'pointer', borderRadius:3,
              background:'rgba(0,30,50,0.6)', border:'1px solid rgba(40,120,180,0.55)',
              color:'#66ccff', display:'flex', alignItems:'center', justifyContent:'center', gap:5,
            }}>
              <span style={{fontSize:fs(11)}}>📷</span> EXPORT PNG
            </button>

            {/* JSON */}
            <button onClick={() => {
              if (!routes && waypoints.length < 2) {
                showToast?.('Plan a route first to export JSON.', 'warning'); return;
              }
              exportJSON(waypoints, routes, activeRoute, sunAngleDeg, IS_DEM ? {
                objective: objective ? { id: objective.id, label: objective.label, purpose: objective.purpose,
                  criteria: objective.criteria, uncertainties: objective.uncertainties } : null,
                summary, evaluation: evaluations[activeRoute] || null, stopCards,
                provenance: records.map(({ id, name, mission: m, instrument, source, observation, resolution, coverage, dataType, categories, subtype, processing, status, uncertainty, limitations, investigation }) =>
                  ({ id, name, mission: m, instrument, source, observation, resolution, coverage, dataType, categories, subtype, processing, status, uncertainty, limitations, investigation })),
                hazardSummary: hazards ? Object.fromEntries(Object.entries(hazards.summary)) : null,
              } : null);
              setExported(true);
              showToast?.(IS_DEM ? 'Mission file (JSON) saved to Downloads.' : 'JSON route file saved to Downloads.', 'info');
            }} style={{
              width:'100%', padding:'6px 0', fontSize:fs(9), fontFamily:'monospace',
              fontWeight:'bold', letterSpacing:0.6, cursor:'pointer', borderRadius:3,
              background:'rgba(0,40,10,0.6)', border:'1px solid rgba(40,180,80,0.55)',
              color:'#66ff99', display:'flex', alignItems:'center', justifyContent:'center', gap:5,
            }}>
              <span style={{fontSize:fs(11)}}>📄</span> {IS_DEM ? 'EXPORT MISSION (JSON)' : 'EXPORT JSON'}
            </button>

            {/* Share link */}
            <button onClick={async () => {
              if (waypoints.length < 1) {
                showToast?.('Add at least one waypoint to share.', 'warning'); return;
              }
              const url = buildShareURL(window.location.href, SITE.name, {
                waypoints, science: !!science, route: activeRoute, startMs: evaStartMs,
                mission, dwellMin: scienceDwellMin, objective: science?.objective || objectiveId,
              });
              try {
                await navigator.clipboard.writeText(url);
                setShareLabel('✓ COPIED!');
                showToast?.('Share link copied to clipboard.', 'info');
                setTimeout(() => setShareLabel('SHARE LINK'), 2500);
              } catch {
                // Fallback: open in new window so user can copy manually
                window.prompt('Copy this link:', url);
              }
            }} style={{
              width:'100%', padding:'6px 0', fontSize:fs(9), fontFamily:'monospace',
              fontWeight:'bold', letterSpacing:0.6, cursor:'pointer', borderRadius:3,
              background:'rgba(40,20,0,0.6)', border:'1px solid rgba(180,120,40,0.55)',
              color:'#ffcc66', display:'flex', alignItems:'center', justifyContent:'center', gap:5,
            }}>
              <span style={{fontSize:fs(11)}}>🔗</span> {shareLabel}
            </button>

          </div>
        </Sect>

        {/* Log */}
        <Sect label={IS_DEM ? 'Mission Log' : 'Route Log'}>
          <div style={{fontSize:fs(7),color:'#3a5a3a',maxHeight:Math.round(68*UI_SCALE),overflowY:'auto',fontFamily:'monospace'}}>
            {routeLog?.length
              ?routeLog.slice(-14).map((l,i)=>(
                <div key={i} style={{color:l.includes('[ERR]')?'#ff6644':'#557755',marginBottom:1}}>{l}</div>
              ))
              :<div style={{color:'#253a25'}}>▶ Add waypoints and press PLAN PATH.</div>
            }
          </div>
        </Sect>

      </div>
    </div>
  );
}

// ---- Micro components ----
function Sect({ label, children, id }) {
  return (
    <div id={id ? 'mm-sect-' + id : undefined}>
      <Label>{label}</Label>
      <div style={{marginTop:4}}>{children}</div>
      <div style={{height:1,background:'rgba(30,70,30,0.2)',marginTop:8}}/>
    </div>
  );
}
function Label({ children }) {
  return <div style={{color:'#3a663a',fontSize:fs(7),textTransform:'uppercase',letterSpacing:1.2}}>{children}</div>;
}
function Row({ children, style={} }) {
  return <div style={{display:'flex',gap:3,...style}}>{children}</div>;
}
function V({ children, c }) {
  return <span style={{color:c||'#99ff99'}}>{children}</span>;
}
function Btn({ children, active, onClick, disabled, color, title, style={} }) {
  return (
    <button title={title} onClick={disabled?undefined:onClick} style={{
      flex:1,padding:'4px 4px',fontSize:fs(8),fontWeight:'bold',
      cursor:disabled?'default':'pointer',borderRadius:3,
      border:`1px solid ${active?(color||'rgba(60,180,60,0.7)'):'rgba(35,70,35,0.4)'}`,
      background:active?'rgba(0,50,0,0.5)':'rgba(6,14,6,0.4)',
      color:active?(color||'#77ff77'):'#447744',
      opacity:disabled?0.4:1,transition:'all 0.12s',
      fontFamily:'monospace',letterSpacing:0.4,
      ...style,
    }}>
      {children}
    </button>
  );
}
