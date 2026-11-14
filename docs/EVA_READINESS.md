# EVA readiness: payload, dust, terrain

Three assessments sit under **3b · EVA readiness** in the panel. Each one reports its own result and its own explanation. They are never merged into a single risk score. All three feed the existing mission status (GO / CONDITIONAL / NO-GO / INSUFFICIENT DATA) through explicit rules.

| Assessment | Module | Result values | Effect on mission status |
|---|---|---|---|
| A. Payload & Mass | `web/src/utils/payloadAssessment.js` | WITHIN LIMIT · OVER LIMIT · INVALID INPUT | Over the limit: the carry check **fails** (NO-GO). Invalid input: the carry check is **not checked** (INSUFFICIENT DATA) |
| B. Dust Exposure & Equipment Reliability | `web/src/config/dust.js`, `web/src/utils/dustAssessment.js` | CAUTION · INSUFFICIENT DATA | **Cautions only.** Dust never makes a plan NO-GO or CONDITIONAL on its own |
| C. Terrain & Mobility | `web/src/utils/mobilityAssessment.js` | PASS · FAIL · NOT CHECKED | Uses the **same** hard checks the status already uses (slope, rock, walk-back margin, radius, rover reach). No new rule |

## Audit before the change

| Quantity | Where | How it was calculated |
|---|---|---|
| Suit mass | `config/mission.js` `SUITS` | Mars suit target 104 kg (≈ 42 kg pressure garment + 62 kg PLSS); lunar xEMU 170 kg (Ogilvie et al. 2026) |
| Equipment | `mission.equipmentKg` | One number, default 10 kg |
| Carry limit | `carryCheck` | (suit + equipment) × 3.711 / 9.807 ≤ 23 kg NIOSH + 22 kg pressure offload = 45 kg Earth-equivalent |
| Mobility | `marswalkProfile.js` | Level speed 2.0 km/h (lunar ConOps) or 1.21 km/h (Mars set: ÷ 1.65, Norcross et al. 2009), shaped by Tobler's slope function. **Payload had no effect on speed** |
| EVA duration | `marswalkProfile.js` | 8 h (lunar) or 7.5 h (Mars set: 30-min Apollo 17 reserve removed) |
| Safety | `computeDemStats`, `missionStatus.js` | Hard checks: walk-back margin, slope, rock, radius, carry, rover reach, daylight |

**Finding.** NASA's study derives the 104 kg Mars suit from its Eq. 7. That equation includes the crew member's own body weight, a restricted-mobility factor and a **50 lbm (≈ 23 kg) tool and sample carry mass that is already reserved**. The project's 45 kg rule is a simplified reading of the same paper. For the paper's reference crew (49 kg, VO₂max 36 ml/min/kg), Eq. 7 allows ≈ 126.6 kg of suit + carry mass. The project rule allows 118.9 kg, which makes it the stricter of the two. **It is kept unchanged.** Eq. 7 is implemented (`ogilvieEq7`) for reference only, and a test checks that it reproduces the paper's 104 kg.

## A. Payload & Mass

- **Carried mass** = suit mass + scientific instruments + extra communication equipment + sampling equipment and samples + emergency supplies + additional / general payload (the existing `equipmentKg`).
- **No double counting.** The pressure garment and life-support backpack are inside the suit mass. They are listed as *included* and cannot be entered again. The communication field covers only equipment carried **in addition** to the suit's own radio, because the NASA study does not say whether suit communications sit inside the 104 kg.
- **Displayed:** total carried mass, weight on Mars (Earth-equivalent), configured limit, remaining capacity and status.
- **Missing or invalid values.** An empty category counts as "not carried" (0 kg). A negative, non-numeric or infinite value is reported, never treated as zero. In that case the carry check becomes *not checked*.
- **No mobility penalty.** NASA suited tests measured metabolic cost against suit weight in simulated **lunar** gravity on one suit (IST-1, Norcross et al. 2010). No validated model of suited walking speed against carried mass on Mars was found. Payload is therefore a mass limit, not a speed change.

## B. Dust Exposure & Equipment Reliability

### Evidence classes

| Class | Meaning | Sources used |
|---|---|---|
| **Direct Mars evidence** | Observed on the Martian surface | Perseverance SHERLOC suit-material swatches (NASA/JPL 2025); VanBommel et al., PNAS 2026 (fine dust on suit materials over 1,645 sols); Perseverance bit-carousel debris (NASA, Jan 2022); InSight dust on solar panels (NASA, Dec 2022); Phoenix perchlorate (NASA/JPL 2009) |
| **Lunar research: analogy only** | Engineering reference, **not** Mars validation | Gaier, NASA/TM-2005-213610 (Apollo); Gaier, *Lunar Dust 101* (Apollo 12 seal decay); Christoffersen et al. 2008 (Apollo suits); Ross 2017 (xEMU dust-tolerant mechanisms); McFarland & Rhodes, ICES-2023-121 (xEMU EPG); NASA ICES-2025-56 (outer-fabric deficiencies); ICES-2025-61 (roadmaps); EDS on Blue Ghost 2025 |
| **Mars-analog field research** | Earth analog, **not** Mars evidence | MARS-V (Gobi Desert, Mongolia): in early development; no published equipment or dust results found |
| **Project assumption** | A stated planning choice | Qualitative levels; protection lowers a level by one step at most, never below moderate |

The **xEMU** is NASA's lunar-focused exploration suit development. It is **not** a Mars-certified suit, and NASA's EVA roadmap lists Mars dust mitigation and a Mars environmental protection garment as future work. Each source record holds its title, programme, date, research context, applicability, engineering relevance and limitations (shown in the app under *show all sources* and in the exported mission file).

### Configuration

Suit outer-layer dust resistance, joint and bearing protection, equipment dust protection, and protective covers. Each defaults to **Not stated**, which is reported as a data gap. No protection percentage exists anywhere.

### Components and qualitative rules

| Component | Base level | Why | Protection that can lower it |
|---|---|---|---|
| Spacesuit joints | high | Apollo abrasion was not mitigated; heritage outer fabric is poor in lunar-simulant tests; suit materials changed within 200 days on Mars | dust-resistant outer layer, covered or sealed joints |
| Bearings and mechanical interfaces | high | Apollo 12 suit pressure decay after EVAs; NASA treats bearings, latches and locks as dust-critical. A **covered** Apollo 16 wrist bearing was unharmed, so protection matters | covered or sealed joints |
| External connectors | high | Dust could not be fully cleared off Apollo fittings | covers |
| Sampling instruments and seals | moderate | Debris halted Perseverance's bit carousel; Apollo sample seals were compromised; hand tools have fewer precision mechanisms | protected equipment |
| Cameras, visor, optics | moderate | Apollo vision obscuration; dust deposits on Mars surfaces; EDS works on the Moon only | covers |
| Rover interfaces (only with a rover) | high | Dust carried into the Apollo cabin; suitports suggested for Mars | covers |
| Exposed moving mechanisms | moderate | Apollo clogging; Mars carousel debris | protected equipment, covers |

**Rule.** A stated protection lowers the level by **one step at most** and **never below moderate**, because no source quantifies any protection's effectiveness on Mars.

### Exposure

The exposure indicators come only from data:

- time outside
- science stops (regolith handling)
- share of the route over loose fine material: at Jezero, the THEMIS class "dust / fine sand" or aeolian bedform units. At **Gale there is no such layer, so the share is UNKNOWN, not zero.**

Exposure level, by design rule: HIGH if ≥ 25 % loose material or ≥ 5 stops; MODERATE if any; LOW otherwise; UNKNOWN without data. Dust storm and dust-devil activity for the date is not available and is shown as unknown.

**Never computed:** failure probability, degradation rate, protection percentage, mass increase or walking-speed change. Tests assert this.

### Warnings (cautions in the safety panel)

- Exposed mechanical interfaces may be vulnerable to regolith intrusion.
- Unprotected joints may need inspection or maintenance.
- Optical surfaces may need additional protection.
- Dust exposure information is insufficient to quantify degradation.

## C. Terrain & Mobility

All values are read from the planner. Nothing is recomputed.

- **Routing:** A* on walking time.
- **Walk-home times:** Dijkstra.
- **Speed model:** Tobler slope shape scaled to the level speed (an assumption).
- **Walls:** slope limit and rock relief, plus the optional rock keep-out buffer.
- **Return safety:** walk-back margin and point of no return.
- **Hazards on the route:** steep, rough, closed depressions (craters), rock buffer zone, no ground truth.

The only validated suit-level speed adjustment is the Mars-conservative set (÷ 1.65). It sits inside the single walking-time model, so outbound and return times scale identically. A test checks that both Dijkstra maps scale by 2.0 / 1.21. The *difficulty* label (easy / moderate / demanding) is a display summary with a written rule, never a constraint.

## Model limitations

- The 45 kg rule simplifies NASA's Eq. 7 and is more conservative for the reference crew. It does not adapt to the crew member's body mass or fitness.
- No validated model links payload or dust to walking speed on Mars, so none is applied.
- Dust vulnerability levels are qualitative judgements from mostly lunar evidence. Direct Mars evidence covers material exposure and robotic mechanisms, not a working suit.
- Loose-material exposure is known only where a surface-material layer exists (Jezero). Dust storms are not modelled.
