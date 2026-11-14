# Data provenance

Every data layer in Martian Map has a provenance record (`web/src/config/provenance.js`). The app shows these records in **4 · Data layers & provenance** and includes them in the exported mission file. This page summarises them.

## Kinds of data

| Category | Meaning | Shown as |
|---|---|---|
| Direct measurement | A rover instrument measured this at the site | `MEASURED` |
| Orbital observation | Measured from orbit. Resolution and pixel mixing limit what it can say about one spot | `ORBITAL` |
| Derived data | Computed from other data. This is an interpretation, not a measurement | `DERIVED` |
| Transferred reference data | Measured somewhere else and used here as a reference. **Not** a local measurement | `TRANSFERRED` |
| Modelled data | The output of a model with stated assumptions | `MODELLED` |
| Simulated data | Produced by this app's own simulation | `SIMULATED` |

A record never moves up a category. Transferred or derived information is never presented as a local measurement.

## Jezero crater

| Layer | Mission / instrument | Category | Resolution | Key limitation |
|---|---|---|---|---|
| Terrain (DTM) | MRO HiRISE stereo (USGS Mars 2020 TRN mosaic) | Orbital | 1 m → 4 m grid | Relief under a few metres is not resolved |
| Slope | from the DTM | Derived | 4 m | A steep step inside a cell is not seen |
| Rock relief | HiRISE 1 m DTM | Derived | 1 m summarised per 4 m cell | Rocks under ~1–2 m are **not detected** |
| Orbital image | MRO HiRISE (TRN orthomosaic) | Orbital | 25 cm, shown at 0.5 m | A single moment of lighting |
| Geologic units | Mars 2020 science team, Stack et al. (2020) | Derived (published map) | HiRISE-scale polygons | An interpretation of orbital images |
| Minerals | MRO **CRISM**, Parente et al. (2021) | Orbital | 36 m source pixels | Each class is the closest spectral match; a 4 m stop may sit on different rock |
| Thermal inertia | Mars Odyssey **THEMIS**, Edwards & Buz (2021) | Orbital | 100 m | ~20 % absolute accuracy; guidance only |
| Air temperature | Perseverance **MEDA** ATS, Munguira et al. (2024) | Direct | 5-min means, one Mars year | A climatology, not a forecast |
| Surface radiation | Curiosity **RAD**, Hassler et al. (2014) | **Transferred** | one value | Measured at Gale, about 1.8 km lower than Jezero. The local dose is likely somewhat higher |
| Space weather | NASA CCMC **DONKI** | Transferred + modelled | event list | Detections are made near Earth; CME arrival at Mars is a model output; not a forecast |
| Ground views, traverse | Perseverance Navcam / Mastcam-Z, MMGIS waypoints | Direct | camera frames | Only where the rover stopped |
| Rock chemistry | SuperCam / PIXL | **Unavailable** | — | See *Missing-data investigation* below |

## Gale crater: Mount Sharp boxwork

| Layer | Mission / instrument | Category | Resolution | Key limitation |
|---|---|---|---|---|
| Terrain (DTM) | MSL Gale merged DEM (HiRISE + CTX / HRSC) | Orbital | 1 m → 4 m | Merged product: quality varies |
| Rock relief | from the 1 m DEM | Derived | 4 m | DEM noise on steep ground raises the relief |
| Stratigraphic level + terrain class | **this project** (Curiosity track elevations + DEM relief) | **Derived, NOT an official published GIS geologic map** | 4 m | Assumes near-horizontal layers; individual boxwork ridges are not resolved |
| Rock chemistry | Curiosity **ChemCam** LIBS (PDS MOC) | Direct | laser spots a few mm wide | Major oxides only; positions reconstructed (~1 m mast offset ignored) |
| Air temperature | Curiosity **REMS** (PDS MODRDR) | Direct | 5-min means, one Mars year | A climatology, not a forecast |
| Surface radiation | Curiosity **RAD**, Hassler et al. (2014) | Direct | one value | Measured on the crater floor (≈ −4.4 km). This site is ~0.9 km higher, so the dose here is likely somewhat higher |
| Space weather | NASA CCMC DONKI | Transferred + modelled | event list | Not a forecast |
| Ground views, traverse | Curiosity Navcam / Mastcam, MMGIS waypoints | Direct | camera frames | Only where the rover stopped |
| Minerals (CRISM) | — | **Unavailable** | — | See below |
| Thermal inertia (THEMIS) | — | **Unavailable** | — | See below |

## Both sites: models and simulation

Sun position and local time come from Mars24 (modelled). Suited walking time uses the xEVA pace with the Tobler slope shape (modelled). The hazard map is derived. EVA playback is simulated. Primary O₂ use is modelled: sourced per-architecture rates and planning capacities (BVAD REV2 2022, ICES-2025-090, ICES-2026-158) applied to the planner's timeline; the capacities are design-study planning values, not flight hardware ([docs/EVA_READINESS.md](EVA_READINESS.md#d-life-support--primary-o)).

## Missing-data investigation (Phase 4)

Data is integrated only when its source, format, coordinate system, resolution and coverage have been checked against the site grid. None of the candidates below could be checked in this update, so the app shows them as **unavailable**. It does not approximate them.

| Site | Layer | What exists | Why it is not integrated |
|---|---|---|---|
| Gale | CRISM minerals | CRISM targeted MTRDR cubes and summary parameters in the PDS. Published studies map hematite, sulfates and clays on lower Mount Sharp (for example Fraeman et al. 2016). | No published, georeferenced mineral-class map of this 2 km window was found (Parente et al. 2021 provides one for Jezero). Making one means processing the MTRDR scenes ourselves, which would be a new derived product. |
| Gale | THEMIS thermal inertia | USGS *THEMIS Thermal Inertia Mosaic, Quantitative, 100 m/px* (±60° latitude tiles, ~20 % absolute accuracy). This covers Gale at about 20 × 20 pixels per site. | Each tile is ~2.5 GB. It could not be downloaded and checked against the site grid from the build environment (network allow-list), so alignment and gaps are unverified. |
| Jezero | SuperCam LIBS chemistry | PDS Geosciences Node, SuperCam bundle, `data_derived_spectra/supercam_libs_moc.csv`: major oxides with RMSEP per oxide. | The table carries **no target coordinates**. Placing each analysis needs the rover pose and pointing, the same reconstruction `pipeline/build_chemistry.py` does for ChemCam. That step is not built yet. |
| Jezero | PIXL chemistry | PDS PIXL bundle, `data_oxides_pmc`: point-by-point oxides with stated uncertainties. | Location is only indirect (scan point → MCC image pixel; arm positions in E34 files). Georeferencing it is likewise not built. |

The earlier README sentence "SuperCam and PIXL compositions are not yet published as a table in the PDS" was wrong and has been corrected. The tables exist; what is missing is target georeferencing.
