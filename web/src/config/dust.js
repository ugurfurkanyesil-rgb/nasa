/**
 * Martian dust, spacesuit and equipment reliability — the evidence base and the component list.
 *
 * Every claim used by the dust assessment points to one of DUST_SOURCES. Each source states its
 * APPLICABILITY, which decides how much it can say about Mars:
 *
 *   mars-direct     Direct Mars evidence — measured / observed on the Martian surface
 *   lunar-analogy   Lunar research (Apollo, Artemis/xEMU) used as an ENGINEERING ANALOGY only
 *   mars-analog     Mars-analog field research on Earth — NOT a Mars measurement
 *   assumption      A project assumption (a planning choice), stated as such
 *
 * Lunar or analog evidence is never presented as Mars validation. The xEMU is NASA's lunar-
 * focused exploration suit development: it is NOT a Mars-certified suit, and NASA's own suit
 * roadmap lists Mars dust mitigation and a Mars environmental protection garment as future work.
 *
 * No protection percentage, failure probability or degradation rate is given anywhere: none
 * of the sources quantifies them for a Mars EVA. Vulnerability is qualitative (low / moderate /
 * high) and every level carries its rationale.
 */

export const APPLICABILITY = {
  'mars-direct': { label: 'Direct Mars evidence', short: 'MARS', color: '#6fd08c' },
  'lunar-analogy': { label: 'Lunar research — analogy only', short: 'LUNAR ANALOGY', color: '#7fb2e5' },
  'mars-analog': { label: 'Mars-analog field research (Earth)', short: 'ANALOG', color: '#e8c36a' },
  assumption: { label: 'Project assumption', short: 'ASSUMPTION', color: '#c39be8' },
};

export const DUST_SOURCES = [
  {
    id: 'gaier2005', applicability: 'lunar-analogy',
    title: 'Gaier, J.R. — The Effects of Lunar Dust on EVA Systems During the Apollo Missions (NASA/TM-2005-213610, Rev1 2007)',
    program: 'Apollo (review by NASA Glenn Research Center)', date: 'March 2005 (Rev1 April 2007)',
    url: 'https://ntrs.nasa.gov/citations/20070021819',
    context: 'Review of mission documents of the six Apollo landings; effects sorted into nine categories (vision obscuration, false readings, coating, traction, clogging of mechanisms, abrasion, thermal control, seal failures, inhalation).',
    relevance: 'The only human EVA dust experience on another body. Simple measures helped some problems; clogging, abrasion and lost heat rejection were not mitigated; ground tests underestimated severity.',
    limitations: 'Lunar regolith in vacuum (sharp, unweathered grains), EVAs of hours over a few days. Mars dust is wind-worn, in a thin CO₂ atmosphere — the severity on Mars is not established by this source.',
  },
  {
    id: 'gaier-dust101', applicability: 'lunar-analogy',
    title: 'Gaier, J.R. — "What Do We Know About Problems Identified During Apollo?" (Lunar Dust 101, NASA presentation)',
    program: 'Apollo', date: 'presentation (undated, NASA 2019 upload)',
    url: 'https://www.nasa.gov/wp-content/uploads/2019/04/06_2_jgaier_whatdoweneedtoknowv1_pres.pdf',
    context: 'Seal failures: Apollo 12 suit pressure decay rose after each EVA (0.15, then 0.25 psi/min against a 0.30 psi/min limit); dust could not be completely cleared off fittings; all Apollo environmental and sample seals were compromised.',
    relevance: 'Dust at a sealing interface degraded suit pressure integrity within two EVAs.',
    limitations: 'Lunar; one suit, one mission. Not a Mars measurement or a rate model.',
  },
  {
    id: 'christoffersen2008', applicability: 'lunar-analogy',
    title: 'Christoffersen, R. et al. — Lunar Dust Effects on Spacesuit Systems: Insights from the Apollo Spacesuits (GSA Annual Meeting 2008)',
    program: 'Apollo suit artefacts (NASA JSC)', date: '2008', url: 'https://gsa.confex.com/gsa/2008AM/webprogram/Paper150328.html',
    context: 'SEM study of Apollo 12 / 17 outer fabrics and the Apollo 16 glove wrist-rotation bearing.',
    relevance: 'The covered glove wrist bearing showed no more wear than the cabin gloves: for that short exposure, gauntlet + bearing design kept dust out. Components do NOT share one dust sensitivity.',
    limitations: 'Lunar, short exposure, a few artefacts.',
  },
  {
    id: 'ross2017', applicability: 'lunar-analogy',
    title: 'Ross, A. — xPGS (EVA Technology Workshop 2017, NASA JSC)',
    program: 'NASA Advanced Space Suit / xEMU', date: 'October 2017', url: 'https://ntrs.nasa.gov/api/citations/20170010132/downloads/20170010132.pdf',
    context: 'xEMU dust mitigation efforts: environmental protection garment (EPG) lay-up; dust-tolerant mechanisms and connectors (bearings, latches, locks).',
    relevance: 'Shows which suit interfaces NASA treats as dust-critical: bearings, latches, locks, connectors.',
    limitations: 'Development intent for a lunar suit; no Mars test.',
  },
  {
    id: 'mcfarland2023', applicability: 'lunar-analogy',
    title: 'McFarland, S.M. & Rhodes, R.A. — NASA Advanced Space Suit Pressure Garment System Status and Development Priorities 2023 (ICES-2023-121)',
    program: 'xEMU / Artemis', date: 'July 2023',
    url: 'https://ntrs.nasa.gov/api/citations/20230000765/downloads/ICES-2023-121%2C%20NASA%20Advanced%20Space%20Suit%20Pressure%20Garment%20System%20Status%202023-strives.pdf',
    context: 'The xEMU pressure garment added a new EPG for dust protection; the EPG architecture had to change because the full EPG ply plus the coverage needed for dust protection restricted mobility.',
    relevance: 'Dust protection at the joints competes with joint mobility — protection is not free.',
    limitations: 'Lunar suit (Artemis). xEMU is not Mars-certified.',
  },
  {
    id: 'asm2025', applicability: 'lunar-analogy',
    title: 'NASA — Artemis Suit Material Overview (ICES-2025-56)',
    program: 'Artemis Suit Material (ASM) project, NASA JSC', date: 'July 2025',
    url: 'https://ntrs.nasa.gov/api/citations/20250003726/downloads/ICES-2025-56%20Artemis%20Suit%20Material%20Overview%20FINAL.pdf',
    context: 'Previous tests with lunar simulants showed Ortho-Fabric (the heritage outer layer) has significant deficiencies in dust repellency and abrasion resistance; a new outer shell fabric for the lunar EPG is in development.',
    relevance: 'A standard (heritage) outer layer is not dust-resistant; a qualified replacement does not exist yet.',
    limitations: 'Lunar simulant tests; no Mars data.',
  },
  {
    id: 'roadmap2025', applicability: 'lunar-analogy',
    title: 'Chullen, C. et al. — NASA EVA technology roadmaps (ICES-2025-61)',
    program: 'NASA EVA / xEMU', date: 'July 2025', url: 'https://ntrs.nasa.gov/api/citations/20250006297/downloads/ICES-2025-61%20Roadmaps%20Presentation.pdf',
    context: 'Roadmap items include Mars dust mitigation, a Mars EPG and dust-tolerant bearings (SBIR Phase I); xEMU changes included a new EPG for dust protection.',
    relevance: 'Mars-specific dust protection for suits is still future work — there is no Mars-qualified protection to credit.',
    limitations: 'Planning document, not test results.',
  },
  {
    id: 'sherloc2025', applicability: 'mars-direct',
    title: 'NASA/JPL — How NASA\'s Perseverance Is Helping Prepare Astronauts for Mars (2025); PIA26520',
    program: 'Mars 2020 Perseverance — SHERLOC calibration target', date: 'March 2025',
    url: 'https://www.jpl.nasa.gov/news/how-nasas-perseverance-is-helping-prepare-astronauts-for-mars/',
    context: 'Five 20 mm spacesuit-material swatches (polycarbonate visor, Vectran glove palm, Ortho-Fabric, two Teflons) exposed on the rover since 2021; about half of the changes seen happened in the first 200 days; Vectran changed first.',
    relevance: 'First direct Mars exposure of suit materials: they do change on the surface, early.',
    limitations: 'Small, static samples on a rover deck — not a flexing, abraded suit joint. A science paper was still in preparation; no degradation rate usable for EVA planning is published here.',
  },
  {
    id: 'vanbommel2026', applicability: 'mars-direct',
    title: 'VanBommel, S. et al. — PNAS (27 Oct 2026), doi:10.1073/pnas.2620747123; NASA: "NASA\'s Perseverance Offers Clues to Protect Crews From Mars Dust"',
    program: 'Mars 2020 Perseverance — PIXL and SHERLOC calibration targets', date: 'October 2026',
    url: 'https://doi.org/10.1073/pnas.2620747123',
    context: 'Over 1,645 sols, fine (< 2.5 µm) and ultrafine (~100 nm) dust clung to suit-material samples; static charging decides which grain sizes stick to which material; Teflon readily collects fine dust; the finest particles stayed through years of driving and drilling.',
    relevance: 'Mars dust adheres electrostatically and is hard to remove from suit polymers; suitports / dual-chamber airlocks were suggested to keep it out of living quarters.',
    limitations: 'Dust adhesion on static samples; the article does not report dust penetrating suit layers, and gives no wear or failure rate.',
  },
  {
    id: 'carousel2022', applicability: 'mars-direct',
    title: 'NASA/JPL — Assessing Perseverance\'s Seventh Sample Collection (blog, Jan 2022); PIA25066',
    program: 'Mars 2020 Perseverance — sampling and caching', date: 'January 2022',
    url: 'https://science.nasa.gov/missions/mars-2020-perseverance/assessing-perseverances-seventh-sample-collection/',
    context: 'Fragments of a cored rock fell into the bit carousel and stopped the bit seating; the carousel was designed to tolerate debris and two pebbles were cleared by rotating it.',
    relevance: 'Regolith debris intruding into an exposed mechanism halted sampling on Mars.',
    limitations: 'Robotic mechanism and pebble-size debris, not fine dust on a suit.',
  },
  {
    id: 'insight2022', applicability: 'mars-direct',
    title: 'NASA — InSight mission end (21 Dec 2022)',
    program: 'InSight lander', date: 'December 2022', url: 'https://www.jpl.nasa.gov/news/nasa-retires-insight-mars-lander-mission-after-years-of-science',
    context: 'Dust accumulating on the lander\'s solar panels gradually reduced its energy until the solar-powered batteries ran out, after more than four years on Mars.',
    relevance: 'Dust deposits on exposed surfaces on Mars and, over time, degraded a critical function (power).',
    limitations: 'Years of deposition on a static lander; an EVA lasts hours.',
  },
  {
    id: 'eds2025', applicability: 'lunar-analogy',
    title: 'NASA — Electrodynamic Dust Shield (EDS) on Blue Ghost Mission 1 (March 2025)',
    program: 'NASA KSC / CLPS', date: 'March 2025', url: 'https://www.nasa.gov/?p=835526',
    context: 'EDS lifted and removed lunar regolith from glass and thermal-radiator surfaces on the Moon.',
    relevance: 'Active dust removal from optical / radiator surfaces works on the Moon.',
    limitations: 'Lunar demonstration on a lander; not tested on Mars or on a suit.',
  },
  {
    id: 'phoenix2009', applicability: 'mars-direct',
    title: 'NASA/JPL — NASA Phoenix Results Point to Martian Climate Cycles (2 Jul 2009)',
    program: 'Phoenix Mars Lander', date: 'July 2009', url: 'https://www.jpl.nasa.gov/news/nasa-phoenix-results-point-to-martian-climate-cycles/',
    context: 'Perchlorate made up a few tenths of a percent of all three soil samples analysed at the Phoenix (arctic) site.',
    relevance: 'Martian soil can be chemically reactive — a concern beyond abrasion.',
    limitations: 'One high-latitude site; its effect on suit materials is not quantified by this source.',
  },
  {
    id: 'marsv2025', applicability: 'mars-analog',
    title: 'MARS-V project (Mongolia) — CNN report (Oct 2025) and Universe Magazine',
    program: 'MARS-V (Mongolian NGO, with MARSA; Mars Society partner)', date: '2025',
    url: 'https://universemagazine.com/en/mars-v-rehearsal-for-life-on-the-red-planet/',
    context: 'A Mars-analog station in the Gobi Desert in early development, with prototype analog suits and planned dust / sandstorm field work; public launch planned for 2029.',
    relevance: 'A future source of field experience with dust and analog equipment.',
    limitations: 'Earth dust in an analog setting, analog (not flight) suits, tourism-oriented; no published equipment-reliability or dust results were found. Not Mars evidence.',
  },
  {
    id: 'project', applicability: 'assumption',
    title: 'Martian Map — project assumptions', program: '—', date: '—', url: null,
    context: 'Vulnerability levels are qualitative judgements from the sources above. A protective feature lowers a level by one step at most, and never below "moderate", because no source quantifies its effectiveness on Mars.',
    relevance: 'Keeps the assessment explicit about what is judged, not measured.',
    limitations: 'No failure probability, protection percentage or degradation rate is computed.',
  },
];

export function dustSource(id) { return DUST_SOURCES.find(s => s.id === id) || null; }

/** Crew-configurable protection settings. 'unknown' = not stated (default) — shown as a data gap. */
export const DUST_CONFIG = {
  outerLayer: { label: 'Suit outer-layer dust resistance', options: {
    unknown: 'Not stated', heritage: 'Heritage outer layer (Ortho-Fabric type)', developmental: 'Dust-resistant outer shell (in development, lunar-tested)' } },
  joints: { label: 'Joint & bearing protection', options: {
    unknown: 'Not stated', none: 'Exposed bearings / joints', covered: 'Covered (gauntlet / EPG over the joint)', sealed: 'Dust seals on bearings (in development)' } },
  equipment: { label: 'Equipment dust protection', options: {
    unknown: 'Not stated', none: 'No dedicated protection', protected: 'Sealed / dust-tolerant equipment' } },
  covers: { label: 'Protective covers for exposed interfaces', options: {
    unknown: 'Not stated', none: 'None carried', available: 'Caps / covers carried and used' } },
};

export const DEFAULT_DUST = { outerLayer: 'unknown', joints: 'unknown', equipment: 'unknown', covers: 'unknown' };

const LEVELS = ['low', 'moderate', 'high'];
export { LEVELS as VULNERABILITY_LEVELS };

/**
 * Components assessed separately. base: vulnerability WITHOUT the protection named in
 * `protectedBy` (the config keys whose credited values lower it one step).
 */
export const DUST_COMPONENTS = [
  {
    id: 'joints', label: 'Spacesuit joints (soft-goods, outer fabric at flex points)', base: 'high',
    protectedBy: { outerLayer: ['developmental'], joints: ['covered', 'sealed'] },
    mechanism: 'Abrasion of the outer fabric where it flexes; fine dust working into the lay-up; material ageing in the Mars surface environment.',
    rationale: 'Apollo listed abrasion among the effects simple measures did not mitigate; the heritage outer fabric performed poorly on dust repellency and abrasion in lunar-simulant tests; on Mars, suit materials changed within the first 200 days and fine dust clings electrostatically to suit polymers.',
    precautions: ['Limit kneeling and contact with loose ground to the tasks that need it.', 'Brush / clean the suit before ingress; inspect flex areas after the EVA.'],
    sources: ['gaier2005', 'asm2025', 'sherloc2025', 'vanbommel2026'],
    confidence: 'Moderate on the direction (dust damages fabric); no Mars rate is known.',
  },
  {
    id: 'bearings', label: 'Bearings & mechanical interfaces (wrist, waist, hip, neck rings)', base: 'high',
    protectedBy: { joints: ['covered', 'sealed'] },
    mechanism: 'Grit entering rotary bearings and sealing interfaces: stiffness, wear, loss of seal.',
    rationale: 'Apollo 12 suit pressure decay rose after each EVA as dust fouled fittings; NASA treats bearings, latches and locks as dust-critical for the xEMU. Christoffersen et al. found a COVERED Apollo 16 wrist bearing unharmed after a short exposure — protection matters, so this level depends on the joint-protection setting.',
    precautions: ['Keep bearing covers / gauntlets closed outside.', 'Check suit leak rate before each EVA; inspect bearings between EVAs.'],
    sources: ['gaier-dust101', 'ross2017', 'christoffersen2008'],
    confidence: 'Moderate (lunar evidence; seal behaviour on Mars untested).',
  },
  {
    id: 'connectors', label: 'External connectors (umbilical, PLSS, tool interfaces)', base: 'high',
    protectedBy: { covers: ['available'] },
    mechanism: 'Dust on mating faces: incomplete mating, leaks, electrical contact problems.',
    rationale: 'On Apollo dust could not be completely cleared off fittings; dust-tolerant connectors are still a development item for the xEMU.',
    precautions: ['Keep dust caps on until mating; clean faces before mating.', 'Avoid connecting / disconnecting in the field when possible.'],
    sources: ['gaier-dust101', 'ross2017'],
    confidence: 'Moderate (lunar).',
  },
  {
    id: 'sampling', label: 'Sampling instruments, containers and their seals', base: 'moderate',
    protectedBy: { equipment: ['protected'] },
    mechanism: 'Debris in tool mechanisms; dust on container seals compromising sample integrity.',
    rationale: 'On Mars, rock fragments in Perseverance\'s bit carousel halted sampling until cleared; on Apollo all environmental and sample seals were compromised. Hand tools have fewer precision mechanisms than a robotic carousel, so the base level is moderate, not high.',
    precautions: ['Keep container seals clean; close containers immediately.', 'Shake / inspect tools before stowing.'],
    sources: ['carousel2022', 'gaier-dust101'],
    confidence: 'Moderate (direct Mars evidence for a robotic mechanism; hand tools not tested).',
  },
  {
    id: 'optics', label: 'Cameras, helmet visor and other optical surfaces', base: 'moderate',
    protectedBy: { covers: ['available'] },
    mechanism: 'Dust coating reduces visibility and image quality; wiping can scratch.',
    rationale: 'Apollo crews reported vision obscuration and dusty gauges; on Mars dust deposits on exposed surfaces (InSight\'s panels) and clings to visor-type polymers. Active removal (EDS) works on glass on the Moon but is not proven on Mars.',
    precautions: ['Cover lenses when not in use; clean with the approved method, not the glove.', 'Plan photography before the dustiest tasks.'],
    sources: ['gaier2005', 'insight2022', 'vanbommel2026', 'eds2025'],
    confidence: 'Moderate (deposition on Mars is direct evidence; effect on a visor over one EVA is not quantified).',
  },
  {
    id: 'rover', label: 'Rover interfaces (hatch / suitport seals, ingress)', base: 'high', needsRover: true,
    protectedBy: { covers: ['available'] },
    mechanism: 'Dust carried into the cabin; dust on hatch / suitport seals.',
    rationale: 'Apollo crews carried dust into the lunar module (inhalation and irritation); the Perseverance dust study suggests suitports or dual-chamber airlocks to keep fine Mars dust out of living quarters.',
    precautions: ['Dust off before ingress; use the suitport / airlock procedure.', 'Inspect hatch seals after each EVA.'],
    sources: ['gaier2005', 'vanbommel2026'],
    confidence: 'Moderate (lunar cabin experience; the Mars suitport / airlock suggestion is not a tested result).',
  },
  {
    id: 'mechanisms', label: 'Exposed moving mechanisms (latches, hinges, deployables)', base: 'moderate',
    protectedBy: { equipment: ['protected'], covers: ['available'] },
    mechanism: 'Clogging and jamming by grit.',
    rationale: 'Clogging of mechanisms is one of the Apollo categories simple measures did not fix; dust-tolerant latches and locks are xEMU development items; Mars debris jammed a rover mechanism. Base level moderate: most EVA mechanisms are actuated rarely.',
    precautions: ['Actuate only when needed; inspect before relying on a latch.'],
    sources: ['gaier2005', 'ross2017', 'carousel2022'],
    confidence: 'Low to moderate (component-specific data lacking).',
  },
];
