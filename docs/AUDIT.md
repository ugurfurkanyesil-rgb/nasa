# Technical audit (Phase 1)

Audit of the repository as cloned (`main` @ `628b4f7`), carried out before any change. Every feature listed here was checked against the code and, where possible, by running it on the real site data with Node (`web/tests/helpers/realSite.mjs` loads `public/sites/<site>/` from disk).

## Architecture

| Part | Where | What it does |
|---|---|---|
| Data pipeline (Python) | `pipeline/` | Fetches and grids NASA / USGS products onto a 512 × 512, 4 m site grid. It writes `meta.json`, `grid.bin`, `layers.json`, `geology.json`, `climate.json`, `chemistry.json`, `pov.json`, `track.json` and `ortho.*`. GitHub workflows (`.github/workflows/fetch-*.yml`) run the fetches. |
| Web app (React + three.js, Vite) | `web/src` | Loads a site (`terrain/siteData.js`). The planner runs in a Web Worker (`workers/planner.worker.js` → `utils/pathfinder.js`). The panel UI is `components/RightPanel.jsx`, the 3D scene is `components/MoonScene.jsx`. |
| Moon simulator | `?site=moon` | The original procedural lunar terrain with craters and debris. It uses the same planner in its non-DEM branch. |
| Offline package | `MartianMap/` | Pre-built app plus `serve.py`. |

## Data sources (verified in the files)

- **Jezero:** USGS Mars 2020 TRN HiRISE DTM and orthomosaic; Stack et al. (2020) geology; Parente et al. (2021) CRISM; Edwards & Buz (2021) THEMIS; MEDA ATS (Munguira et al. 2024); Perseverance raw images and MMGIS waypoints.
- **Gale:** MSL Gale merged DEM and orthophoto (Parker & Calef 2016); derived levels and terrain classes (this project); ChemCam MOC (sols 4511–4843, 233 targets); REMS MODRDR (sols 4175–4843); Curiosity raw images and waypoints.
- **Both:** RAD (Hassler et al. 2014); DONKI, looked up live, because no `space_weather.json` is bundled for either site; Mars24.

## README claims vs code

| Claim | Verified | Evidence |
|---|---|---|
| A* route planning | ✓ | `pathfinder.aStar`; test "A* reaches the Dijkstra optimum" |
| Dijkstra walking-time maps | ✓ | `walkback.dijkstraTimes / homeTimeMaps` |
| Held–Karp stop optimisation | ✓ | `science.optimizeTour`; equals brute force on 40 random cases |
| Slope walls (20°) | ✓ | `getWallMap()`; 24.3 % of Gale cells, 0 % of Jezero cells |
| Rock obstacles (0.5 m relief) | ✓ | `getWallMap()` reads `layers.rock`. **No test covered it**; one was added |
| Walk-back margin, point of no return | ✓ | `walkbackProfile`; tests |
| GO / NO-GO checks | ✓ with a gap | `computeDemStats.checks`. **Gap:** the daylight check was *omitted* (not failed) when there was no start time or no sunrise/sunset, so missing information could silently give GO |
| Radiation (RAD dose, career fraction) | ✓ | `radiation.js`; tests |
| DONKI | ✓ with a gap | Live lookup only (no bundled archive). A failed lookup and a future date both showed "no data", but the route stayed GO: unknown space weather had no effect on the decision |
| EVA playback | ✓ | `evaPlayback.js`; the timeline equals the planner's round trip |
| Cuff card | ✓ | `cuffCard.js`; tests |
| NASA layer visualisation (map, drape, compare) | ✓ | `heatmaps.js`, `RightPanel.HeatmapViewer` |
| README plan numbers (SAFE, lunar limits) | ✓ | Re-run on real data: Jezero 8 stops, 4.11 km, margin 3.25 h; Gale 6 stops, 2.46 km, margin 4.60 h, as printed |
| "SuperCam and PIXL compositions are not yet published as a table in the PDS" | ✗ | Both are published (`supercam_libs_moc.csv`; PIXL `data_oxides_pmc`). What is missing is target georeferencing. Corrected |
| "Science objective" | partial | One fixed objective per site; no selector, so the scoring could not change with a scientific question |

## Jezero vs Gale (separately)

- **Jezero:** the site lies on the crater floor. The geology has only crater-floor and cover units. **The delta is outside the 2 km window** (the nearest remnant, Kodiak, is ~2.3 km west of the landing site) and no delta or lake unit occurs in the grid. CRISM shows three classes here: Olivine, Olivine + smectite and High-Ca pyroxene. Almost no rock-relief walls (smooth landing area). 5.4 % of cells lie in closed depressions ≥ 0.5 m (small craters).
- **Gale:** steep, with 24 % slope walls and rock relief raised by DEM noise. The units are derived by this project and labelled as such. ChemCam: 233 targets with 11 kinds of standout. No CRISM or THEMIS layer.

## Initial test results

```
node --test web/tests/*.test.mjs          tests 64  pass 64  fail 0
python -m unittest discover pipeline/tests   Ran 7 tests  OK
vite build                                ✓ built
```

## Findings acted on

1. No objective selector. Added a real one that drives scoring and candidate ranking.
2. Missing information could become GO (daylight; space weather). Added the INSUFFICIENT DATA and CONDITIONAL statuses.
3. The RAD transfer to Jezero was explained in a note but was not a first-class data category. Added provenance categories.
4. The SuperCam / PIXL statement was incorrect. Corrected and documented.
5. Rock-obstacle walls were untested. Tests added.
6. The Moon simulator had no tests. Tests added.
7. No hazard view beyond the No-Go and slope layers. Added a hazard map (depressions, rock buffer, rough and steep ground, ground-truth coverage, rover reach).
