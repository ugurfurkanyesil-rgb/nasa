/**
 * Data provenance — one record per data layer the planner or the crew sees, per site.
 *
 * Every record answers: which mission and instrument, which original product, when it was
 * observed, at what resolution and coverage, how this project processed it, what KIND of
 * information it is, and what it cannot tell. The kind ("category") is the key safety field:
 *
 *   direct      Direct measurement   — an instrument on the ground at this site measured it
 *   orbital     Orbital observation  — measured from orbit (spectra, images, stereo topography)
 *   derived     Derived data         — computed from other data (by a published team or by us)
 *   transferred Transferred reference — measured somewhere else and used here as a reference
 *   modelled    Modelled data        — the output of a physical / empirical model
 *   simulated   Simulated data       — produced by this app's own simulation (EVA playback)
 *
 * status: 'integrated' (loaded and used), 'missing' (expected file did not load), or
 * 'unavailable' (investigated, not integrated — `investigation` says what exists and why not).
 *
 * The record never upgrades a category: transferred / derived data are never shown as a local
 * measurement. Pure module; `siteProvenance(site)` reads only what the site actually loaded.
 */

export const CATEGORIES = {
  direct: { label: 'Direct measurement', short: 'MEASURED', color: '#6fd08c',
    desc: 'Measured in place at this site by a rover instrument.' },
  orbital: { label: 'Orbital observation', short: 'ORBITAL', color: '#7fb2e5',
    desc: 'Measured from orbit; resolution and pixel mixing limit what it says about one spot.' },
  derived: { label: 'Derived data', short: 'DERIVED', color: '#e8c36a',
    desc: 'Computed from other data — an interpretation, not a measurement.' },
  transferred: { label: 'Transferred reference data', short: 'TRANSFERRED', color: '#ff9f5a',
    desc: 'Measured elsewhere and used here as a reference — NOT a local measurement.' },
  modelled: { label: 'Modelled data', short: 'MODELLED', color: '#c39be8',
    desc: 'Output of a model with stated assumptions.' },
  simulated: { label: 'Simulated data', short: 'SIMULATED', color: '#9aa8b8',
    desc: 'Produced by this app\'s own simulation.' },
};

// ---- shared texts ----
const HASSLER = 'Hassler et al. (2014), Mars\' surface radiation environment measured with the MSL Curiosity rover, Science 343, 1244797';
const HASSLER_URL = 'https://doi.org/10.1126/science.1244797';
const DONKI = {
  id: 'donki', name: 'Space-weather events (DONKI)', mission: 'NASA heliophysics fleet (via CCMC)', instrument: 'SEP / flare detections; WSA-ENLIL CME model',
  source: { title: 'NASA CCMC — Space Weather Database Of Notifications, Knowledge, Information (DONKI)', url: 'https://kauai.ccmc.gsfc.nasa.gov/DONKI/' },
  observation: 'Catalogued events in a ±2-day window around the EVA date (looked up live, or a bundled archive)',
  resolution: 'event list (time, type); not a map', coverage: 'heliosphere — not site-specific',
  dataType: 'radiation (space weather)', categories: ['transferred', 'modelled'],
  processing: 'SEP events and X-class flares as catalogued; CMEs kept only where the ENLIL model run lists an arrival at Mars inside the window.',
  uncertainty: 'CME arrival times at Mars are model predictions (hours to a day off are common).',
  limitations: [
    'SEP and flare detections are made near Earth, not at Mars — a listed SEP is a warning sign, not a Mars measurement.',
    'DONKI is a catalogue of what HAS happened; it is not a forecast. A future EVA date has no data.',
    'No event listed does NOT mean zero risk if the lookup failed or the date is not covered.',
  ],
};

/** Records for one site. `site` is siteData.site (or a test stand-in). */
export function siteProvenance(site) {
  if (!site || site.mode !== 'dem') return SIMULATOR_RECORDS;
  const L = site.layers || {};
  const name = site.name;
  const recs = [];
  const add = (r, loaded) => recs.push({ ...r, status: r.status || (loaded ? 'integrated' : 'missing') });

  // Terrain (both sites)
  const terr = site.meta?.source || {};
  add({
    id: 'terrain', name: 'Terrain elevation (DTM)', mission: 'Mars Reconnaissance Orbiter', instrument: terr.instrument || 'HiRISE stereo',
    source: { title: terr.title, url: terr.doi || terr.page, citation: terr.citation },
    observation: 'HiRISE stereo pairs (multiple dates); product released ' + (name === 'gale' ? '2016' : '2020'),
    resolution: `${terr.native_resolution_m ?? 1} m native → ${site.cellM} m grid`, coverage: `${((site.sizeM || 0) / 1000).toFixed(2)} km × ${((site.sizeM || 0) / 1000).toFixed(2)} km around the site centre`,
    dataType: 'topographic', categories: ['orbital'],
    processing: 'Cut and resampled onto the 4 m site grid in a local equirectangular projection (pipeline/build_site.py).',
    uncertainty: 'Vertical precision of stereo DTMs is a fraction of a metre at best; slopes on 4 m cells smooth out sub-cell relief.',
    limitations: ['Relief smaller than a few metres is not resolved.', name === 'gale' ? 'Merged product (HiRISE with CTX / HRSC fill) — quality varies across the site.' : 'MOLA-tied mosaic used for terrain-relative navigation.'],
  }, !!site.heights);

  add({
    id: 'slope', name: 'Slope', mission: '—', instrument: '—', source: { title: 'Computed from the terrain DTM' },
    observation: '—', resolution: `${site.cellM} m`, coverage: 'whole site', dataType: 'topographic', categories: ['derived'],
    processing: 'Central differences on the 4 m grid. Cells steeper than the walkable limit (20°) are walls.',
    uncertainty: 'Inherits DTM noise; a 4 m cell averages steeper sub-cell faces.',
    limitations: ['A short steep step inside a cell is not seen.'],
  }, !!site.heights);

  add({
    id: 'rock', name: 'Rock relief (boulders / outcrops)', mission: 'Mars Reconnaissance Orbiter', instrument: 'HiRISE (via the 1 m DTM)',
    source: { title: L.rock?.source?.title, url: L.rock?.source?.doi || L.rock?.source?.page },
    observation: 'as the DTM', resolution: `1 m DTM summarised per ${site.cellM} m cell`, coverage: 'whole site', dataType: 'topographic', categories: ['derived'],
    processing: L.rock?.method || 'max − min of the 1 m DTM after removing each cell\'s best-fit plane',
    uncertainty: name === 'gale' ? 'At Gale, DEM noise on steep ground raises the relief (median 0.20 m vs 0.04 m at Jezero).' : 'Few cells exceed the 0.5 m wall limit (smooth landing area).',
    limitations: ['A 1 m DTM resolves rocks of a few metres only; rocks under ~1–2 m are NOT detected and are not obstacles in the planner.', 'Relief is a proxy: it cannot tell a boulder from an outcrop edge.'],
  }, !!L.rock);

  add({
    id: 'ortho', name: 'Orbital image (HiRISE)', mission: 'Mars Reconnaissance Orbiter', instrument: 'HiRISE',
    source: { title: site.ortho?.source?.title, url: site.ortho?.source?.doi || site.ortho?.source?.page },
    observation: 'single HiRISE passes (mosaic); one moment of lighting', resolution: '25 cm source, shown at 0.5 m/px', coverage: 'whole site',
    dataType: 'optical', categories: ['orbital'],
    processing: 'Warped onto the site grid, aligned to the DTM to ≤ 1 m (phase correlation, pipeline/build_ortho.py).',
    uncertainty: 'Alignment ≤ 1 m.', limitations: ['Shown at half resolution to keep the download small.'],
  }, !!site.ortho);

  add({
    id: 'pov', name: 'Rover ground views', mission: name === 'gale' ? 'Mars Science Laboratory' : 'Mars 2020',
    instrument: name === 'gale' ? 'Navcam / Mastcam' : 'Navcam / Mastcam-Z',
    source: { title: site.pov?.credit || 'NASA/JPL-Caltech raw images', url: name === 'gale' ? 'https://mars.nasa.gov/msl/multimedia/raw-images/' : 'https://mars.nasa.gov/mars2020/multimedia/raw-images/' },
    observation: povSols(site), resolution: 'camera frames', coverage: `${site.pov?.stations?.length ?? 0} rover positions inside the site`,
    dataType: 'optical', categories: ['direct'],
    processing: 'Near-horizontal frames with pointing; azimuth = mast azimuth + rover heading.',
    uncertainty: site.pov?.note || 'Frame directions accurate to a few degrees.',
    limitations: ['Images load from mars.nasa.gov (need internet).', 'Only where the rover stopped; most of the site has no ground view.'],
  }, !!site.pov);

  add({
    id: 'track', name: 'Rover traverse', mission: name === 'gale' ? 'Mars Science Laboratory' : 'Mars 2020', instrument: 'rover localisation (MMGIS waypoints)',
    source: { title: site.track?.credit, url: 'https://mars.nasa.gov/mmgis-maps/' },
    observation: site.track ? `sols ${site.track.sols[0]}–${site.track.sols[1]}` : '—', resolution: 'one position per drive', coverage: site.track ? `${(site.track.length_m / 1000).toFixed(1)} km inside the site` : '—',
    dataType: 'positional', categories: ['direct'],
    processing: 'Waypoints inside the site, split where the rover leaves it (pipeline/build_track.py). Region labels are derived.',
    uncertainty: 'Localisation to about a metre.', limitations: ['Region names on the map are this project\'s derived levels, not NASA\'s mapped units.'],
  }, !!site.track);

  if (name === 'jezero') {
    const g = site.geology?.source || {};
    add({
      id: 'geology', name: 'Geologic units (surface + bedrock)', mission: 'Mars 2020 (science team, from orbital images)', instrument: 'HiRISE-based photogeologic mapping',
      source: { title: `${g.creators || 'Stack et al.'} (${g.year || 2020}). ${g.title || ''}`, url: g.doi },
      observation: 'mapped 2020 (pre-landing)', resolution: 'HiRISE-scale polygons, rasterised to 4 m', coverage: 'whole site', dataType: 'geologic',
      categories: ['derived'], subtype: 'published, peer-reviewed map',
      processing: 'Shapefile polygons rasterised to the grid (cell centres, even–odd rule; pipeline/build_geology.py).',
      uncertainty: 'Unit boundaries are interpretations of orbital images; ground truth may differ by metres to tens of metres.',
      limitations: ['A photogeologic map: it interprets what the units look like from orbit, not what they are made of.'],
    }, !!site.geology);
    add({
      id: 'minerals', name: 'Dominant minerals (CRISM)', mission: 'Mars Reconnaissance Orbiter', instrument: 'CRISM',
      source: { title: `${L.minerals?.source?.creators || 'Parente et al.'} (${L.minerals?.source?.year || 2021}). ${L.minerals?.source?.title || ''}`, url: L.minerals?.source?.doi },
      observation: `CRISM scenes ${(L.minerals?.source?.scenes || []).join(', ')}`, resolution: `${L.minerals?.source?.resolution_m ?? 36} m source pixels → 4 m grid`, coverage: 'whole site (classes where detected)',
      dataType: 'spectral', categories: ['orbital'],
      processing: 'Published spectral classification (dominant mineral per pixel) resampled to the grid; medium-confidence pixels kept and flagged.',
      uncertainty: 'Class names are the closest match of each spectral prototype (dataset README).',
      limitations: ['36 m pixels: a 4 m stop inside a pixel may sit on a different rock.', 'Shows the dominant phase only.'],
    }, !!L.minerals);
    add({
      id: 'thermal', name: 'Thermal inertia (THEMIS)', mission: '2001 Mars Odyssey', instrument: 'THEMIS (night-time IR)',
      source: { title: `${L.thermal?.source?.creators || 'Edwards & Buz'} (${L.thermal?.source?.year || 2021}). ${L.thermal?.source?.title || ''}`, url: L.thermal?.source?.doi },
      observation: 'mosaic of night-time THEMIS images', resolution: `${L.thermal?.source?.resolution_m ?? 100} m → 4 m grid`, coverage: 'whole site', dataType: 'thermal',
      categories: ['orbital'],
      processing: 'Resampled to the grid; classes (dust / sand / clasts / rock) from a published interpretation table.',
      uncertainty: 'Absolute accuracy of THEMIS thermal inertia is about 20 % (Fergason et al. 2006).',
      limitations: ['100 m pixels: guidance on ground type, not a per-step measurement.'],
    }, !!L.thermal);
    add({
      id: 'climate', name: 'Air temperature climatology (MEDA)', mission: 'Mars 2020', instrument: 'MEDA ATS (1.45 m)',
      source: { title: site.climate?.source?.title, url: site.climate?.source?.doi, citation: site.climate?.source?.paper },
      observation: site.climate ? `sols ${site.climate.solRange[0]}–${site.climate.solRange[1]} (one Mars year)` : '—', resolution: '5-min means, binned per 10° Ls × time of day',
      coverage: 'the rover\'s location (crater floor near the landing site)', dataType: 'atmospheric', categories: ['direct'],
      processing: 'Median / p10 / p90 per season and time of day (pipeline/build_climate.py).',
      uncertainty: 'Year-to-year variation not captured (one year).', limitations: ['A climatology, NOT a forecast for the EVA date.'],
    }, !!site.climate);
    add({
      id: 'rad', name: 'Surface radiation (RAD)', mission: 'Mars Science Laboratory', instrument: 'RAD',
      source: { title: HASSLER, url: HASSLER_URL },
      observation: 'Aug 2012 – Jun 2013, at Gale crater', resolution: 'one value (daily mean dose)', coverage: 'measured at Gale (−4.4 km); used here at Jezero',
      dataType: 'radiation', categories: ['transferred'],
      processing: '0.64 ± 0.12 mSv/day dose equivalent applied to time outside, without an altitude correction.',
      uncertainty: '±0.12 mSv/day (1σ, published); solar-cycle phase differs from today.',
      limitations: ['NOT a Jezero measurement: Jezero is about 1.8 km higher than Gale, so less atmosphere shields it — the real dose there is likely somewhat higher.', 'No local RAD-class instrument on Perseverance.'],
    }, true);
    add({ ...DONKI }, true);
    add({
      id: 'chemistry', name: 'Rock chemistry (SuperCam / PIXL)', mission: 'Mars 2020', instrument: 'SuperCam LIBS, PIXL', status: 'unavailable',
      source: { title: 'PDS Geosciences Node — Mars 2020 SuperCam (data_derived_spectra: supercam_libs_moc.csv) and PIXL (data_oxides_pmc) bundles',
        url: 'https://pds-geosciences.wustl.edu/missions/mars2020/supercam.htm' },
      observation: '—', resolution: '—', coverage: '—', dataType: 'chemical', categories: ['direct'],
      processing: 'Not integrated.', uncertainty: '—',
      limitations: ['No chemistry layer at Jezero in this app.'],
      investigation: 'Both instruments publish major-oxide tables in the PDS (SuperCam LIBS "MOC" table with RMSEP per oxide; PIXL point-by-point oxides). Neither table carries target coordinates: placing each analysis needs the rover pose and pointing (SuperCam) or the arm-workspace position files (PIXL), the same reconstruction this project does for ChemCam at Gale. That pipeline is not built, and this session could not download the tables (network allowlist), so the layer is shown as unavailable instead of approximated.',
    }, false);
  }

  if (name === 'gale') {
    const g = site.geology?.source || {};
    add({
      id: 'geology', name: 'Stratigraphic level + terrain class', mission: 'derived by this project', instrument: 'Curiosity track elevations + MSL Gale merged DEM',
      source: { title: g.title || 'Derived: Curiosity track + MSL Gale DEM (this project)' },
      observation: `boxwork campaign sols ${g.method?.boxwork_sols?.join('–') ?? '4541–4844'}`, resolution: '4 m', coverage: 'whole site', dataType: 'geologic',
      categories: ['derived'], subtype: 'this project\'s derivation — NOT an official published GIS geologic map',
      processing: `Level = elevation band Curiosity crossed in the boxwork campaign (${(g.method?.boxwork_layer_elev_m || [-3655, -3595.5]).join(' to ')} m), assuming near-horizontal layers. Terrain class = relief against a ${g.method?.relief_sigma_m ?? 15} m background (ridge / hollow / smooth / steep).`,
      uncertainty: 'Lateral edges of the boxwork terrain are not modelled; dipping layers would shift contacts.',
      limitations: ['No published GIS geologic map covers this part of Mount Sharp (the USGS 1:60,000 map awaited review in 2023).', 'The 15 m background does not resolve individual boxwork ridges (a few metres wide).'],
    }, !!site.geology);
    add({
      id: 'chemistry', name: 'Rock chemistry (ChemCam)', mission: 'Mars Science Laboratory', instrument: 'ChemCam LIBS',
      source: { title: site.chemistry?.source?.title, url: site.chemistry?.source?.url, citation: site.chemistry?.source?.citation },
      observation: site.chemistry ? `sols ${site.chemistry.stats?.sols?.join('–')}` : '—', resolution: 'laser spots a few mm wide', coverage: `${site.chemistry?.targets?.length ?? 0} targets along the rover track`,
      dataType: 'chemical', categories: ['direct'],
      processing: site.chemistry?.location_method || 'rover position + pointing and range',
      uncertainty: 'Accuracy (RMSEP) per oxide, e.g. SiO₂ ±5.0, MgO ±2.3 wt%; position ignores the ~0.8 m mast offset.',
      limitations: ['Major oxides only (no S, H, Cl) in this table.', 'Only where Curiosity aimed the laser.'],
    }, !!site.chemistry);
    add({
      id: 'climate', name: 'Air temperature climatology (REMS)', mission: 'Mars Science Laboratory', instrument: 'REMS ATS (~1.6 m)',
      source: { title: site.climate?.source?.title, url: site.climate?.source?.url, citation: site.climate?.source?.paper },
      observation: site.climate ? `sols ${site.climate.solRange[0]}–${site.climate.solRange[1]} (one Mars year)` : '—', resolution: '5-min means, binned per 10° Ls × time of day',
      coverage: 'lower Mount Sharp along the traverse of that year', dataType: 'atmospheric', categories: ['direct'],
      processing: 'Reliable-flag readings only; outlier screen removes sensor drop-outs near sunset (pipeline/build_climate_rems.py).',
      uncertainty: 'REMS\'s own estimate of ambient air temperature.', limitations: ['A climatology, NOT a forecast.', 'Curiosity drove a few km that year.'],
    }, !!site.climate);
    add({
      id: 'rad', name: 'Surface radiation (RAD)', mission: 'Mars Science Laboratory', instrument: 'RAD',
      source: { title: HASSLER, url: HASSLER_URL },
      observation: 'Aug 2012 – Jun 2013', resolution: 'one value (daily mean dose)', coverage: 'Gale crater floor (Bradbury Landing region)',
      dataType: 'radiation', categories: ['direct'],
      processing: '0.64 ± 0.12 mSv/day dose equivalent applied to time outside.',
      uncertainty: '±0.12 mSv/day; measured near solar maximum — today\'s galactic dose depends on the solar cycle.',
      limitations: [
        `Measured on the crater floor (≈ −4.4 km) in 2012–13; this site lies at ${elevRange(site)}, roughly 0.9 km higher — less air overhead, so the dose here is likely somewhat higher than the measured value.`,
        'Not re-measured at this spot or for the EVA date.',
      ],
    }, true);
    add({ ...DONKI }, true);
    add({
      id: 'minerals', name: 'Minerals (CRISM)', mission: 'Mars Reconnaissance Orbiter', instrument: 'CRISM', status: 'unavailable',
      source: { title: 'PDS: CRISM MTRDR targeted products (e.g. FRT scenes over lower Mount Sharp)', url: 'https://ode.rsl.wustl.edu/mars/' },
      observation: '—', resolution: '≈18–36 m source pixels', coverage: '—', dataType: 'spectral', categories: ['orbital'],
      processing: 'Not integrated.', uncertainty: '—',
      limitations: ['No mineral layer at Gale in this app.'],
      investigation: 'CRISM targeted MTRDR cubes and spectral summary parameters exist in the PDS for Mount Sharp, and published studies map hematite, sulfates and clays there (e.g. Fraeman et al. 2016). No published, georeferenced mineral-class map of this 2 km boxwork window (like Parente et al. 2021 for Jezero) was found; building one means processing MTRDR scenes ourselves. That is a new derived product, not done here, so the layer is unavailable rather than approximated.',
    }, false);
    add({
      id: 'thermal', name: 'Thermal inertia (THEMIS)', mission: '2001 Mars Odyssey', instrument: 'THEMIS', status: 'unavailable',
      source: { title: 'USGS — THEMIS Thermal Inertia Mosaic, Quantitative, 100 m/px (±60° latitude tiles)', url: 'https://astrogeology.usgs.gov/search/map/themis_thermal_inertia_mosaic_quantitative_30s060e_100mpp' },
      observation: '—', resolution: '100 m/px (≈ 20 × 20 pixels over this site)', coverage: '—', dataType: 'thermal', categories: ['orbital'],
      processing: 'Not integrated.', uncertainty: 'Published absolute accuracy ~20 %.',
      limitations: ['No thermal layer at Gale in this app.'],
      investigation: 'The global quantitative THEMIS thermal-inertia mosaic (Fergason et al. 2006 method, USGS) covers Gale at 100 m/px. Each 30° × 60° tile is ~2.5 GB; it was not downloaded or checked against this site\'s grid in this session (network allowlist), so its alignment and coverage gaps here are unverified and it is not shown.',
    }, false);
  }

  // Models and simulation (both sites)
  recs.push(...MODEL_RECORDS);
  return recs;
}

function elevRange(site) {
  const e = site.meta?.elevation_m;
  return e ? `${Math.round(e.min)} … ${Math.round(e.max)} m` : 'a different elevation';
}

function povSols(site) {
  const st = site.pov?.stations;
  if (!st?.length) return '—';
  let lo = Infinity, hi = -Infinity;
  for (const s of st) { if (s.sol < lo) lo = s.sol; if (s.sol > hi) hi = s.sol; }
  return `sols ${lo}–${hi}`;
}

const MODEL_RECORDS = [
  { id: 'sun', name: 'Sun position, local solar time', mission: '—', instrument: '—', status: 'integrated',
    source: { title: 'Mars24 algorithm (Allison & McEwen 2000), NASA GISS', url: 'https://www.giss.nasa.gov/tools/mars24/' },
    observation: 'any date', resolution: '—', coverage: 'site centre', dataType: 'ephemeris', categories: ['modelled'],
    processing: 'Sun elevation / azimuth along the route at the time each point is walked; terrain shadows cast on the DTM.',
    uncertainty: 'Largest difference 0.25 min vs the MEDA team sunset table (tests).', limitations: ['No atmospheric dust opacity: "daylight" is geometric.'] },
  { id: 'walk', name: 'Suited walking time', mission: '—', instrument: '—', status: 'integrated',
    source: { title: 'NASA xEVA ConOps (2 km/h level pace) + Tobler (1993) slope shape; Mars set: Norcross et al. (2009)' },
    observation: '—', resolution: 'per 4 m cell', coverage: 'whole site', dataType: 'mobility', categories: ['modelled'],
    processing: 'A* / Dijkstra on walking time.', uncertainty: 'The slope–speed shape is an assumption (Earth, unsuited).',
    limitations: ['No NASA data on suited walking speed vs slope on Mars.'] },
  { id: 'hazard', name: 'Hazard map', mission: '—', instrument: '—', status: 'integrated',
    source: { title: 'This project (utils/hazardMap.js) from the DTM, rock relief and rover track' },
    observation: '—', resolution: '4 m', coverage: 'whole site', dataType: 'safety', categories: ['derived'],
    processing: 'Slope and rock walls, a keep-out buffer around rock obstacles, closed depressions (priority-flood fill depth), steep / rough ground, cells with no rover ground view nearby.',
    uncertainty: 'Every threshold is listed in the legend with its basis.',
    limitations: ['Only what a 1 m DTM and 4 m grid can see; small rocks, loose sand and soft ground are not detected.'] },
  { id: 'eva', name: 'EVA playback (crew, clock, dose so far)', mission: '—', instrument: '—', status: 'integrated',
    source: { title: 'This app — utils/evaPlayback.js, from the planner\'s own timeline' },
    observation: '—', resolution: '—', coverage: '—', dataType: 'simulation', categories: ['simulated'],
    processing: 'Replays the planned timeline; dust devils are user-placed test hazards.', uncertainty: '—',
    limitations: ['A visualisation of the plan, not a prediction of crew performance.'] },
];

const SIMULATOR_RECORDS = [
  { id: 'moon-terrain', name: 'Procedural lunar terrain', mission: '—', instrument: '—', status: 'integrated',
    source: { title: 'This app — three/terrainGenerator.js (procedural)' }, observation: '—', resolution: '100 m area, 256² grid', coverage: '—',
    dataType: 'topographic', categories: ['simulated'], processing: 'Noise + craters + debris; not a real place.', uncertainty: '—',
    limitations: ['Moon rover simulator only: no NASA data, not used for any Mars plan.'] },
];

/** Provenance layer ids behind a science tag (B:, S:, U:, C: geology; M: minerals; X:, T: chemistry). */
export function tagLayer(tag) {
  const p = tag[0];
  return p === 'M' ? 'minerals' : (p === 'X' || p === 'T') ? 'chemistry' : 'geology';
}

/** The weakest category among a list of records, for a qualitative confidence label (no score). */
const ORDER = ['direct', 'orbital', 'derived', 'modelled', 'transferred', 'simulated'];
export function weakestCategory(records) {
  let worst = -1;
  for (const r of records) for (const c of r?.categories || []) worst = Math.max(worst, ORDER.indexOf(c));
  return worst >= 0 ? ORDER[worst] : null;
}

export function findRecord(records, id) {
  return records.find(r => r.id === id) || null;
}
