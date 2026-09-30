# Metal Snake: Cosmic Calamity — Game Design Document

> *Metal Gear* (16-bit top-down stealth) but the occupiers are "V"-style reptilian aliens under a fragile truce, dressed in *Marathon*'s AI-and-alien sci-fi.

Play: https://mtd-public.github.io/cosmic-calamity/ · Built from: `mstr-gme-dsgn-tmpt` house rules plus kits `touch-zoom-guard` and the 3x5 font. Shell and deploy patterns come from turn-tactics and dr-mow.

## 1. Pillars
1. **Seen = consequences, not death.** Being spotted starts an Alert you can escape by breaking line of sight and hiding. Every mistake can be recovered.
2. **Readable threat.** Vision cones are always drawn, a meter fills before `!`, and cone colours encode state: yellow calm, orange suspicious, red alert.
3. **Many tools, one button.** ACT is context-sensitive (takedown / punch / hide / open / download / plant / knock), and the prompt tells you which.
4. **Marathon mood.** Steel terminals, a round motion sensor, AIs with their own agenda.

## 2. Core loop
```
 ┌── stage objective (keycard / intel / cores) ───────────────────────┐
 │  read the motion sensor → time the patrol → slip past or take down │
 │  spotted → ALERT (timer resets while seen) → hide → EVASION → calm │
 │  collect keycard / intel → reach exit                              │
 └── exit → debrief (time, alerts, takedowns, kills → codename) ──────┘
```

## 3. Controls
| Input | Action |
|---|---|
| Touch: floating left stick (light push = sneak), ACT and FIRE on the right, pause top-right | move / act / fire |
| Keyboard: WASD/arrows, Shift sneak, J/Space/E act, K/F fire, Esc/P pause, M mute, ? help | |
| Gamepad: stick/d-pad, A act, X/RB fire, Start pause | |

## 4. Numbers (`js/game.js`)
| Parameter | Value | Why |
|---|---|---|
| Player speed | 62 px/s; sneak ×0.55 | about 4 tiles/s outruns a patrolling trooper (34) but not a chasing one (51) |
| Trooper vision | 88 px (5.5 tiles), ±31° | covers a room's width without seeing around corners |
| Heavy vision | 100 px, ±29° | a stationary guardian should out-see troopers |
| Camera | 100 px, ±24°, sweeps ±54° | narrow beam with a readable rhythm |
| Awareness rate | 1 + 3.4·(1−d/range)² per s | far away gives about 1 s to react; point blank is near-instant |
| Tall grass | invisible beyond 30 px | a hiding option that still fails up close |
| Alert timer | 15 s, resets while seen | MGS feel: you must break contact for its full length |
| Evasion | 12 s of searching near the last known spot | a tense cool-down, not an instant reset |
| Knock-out | 50 s | long enough to use, short enough that bodies matter |
| Trooper HP | 2, sneak shot deals 2 | rewards patient stealth over firefights |
| Ammo | start 8–10, +6 per pickup, max 30 | scarce: the gun is a tool, not the plan |
| Enemy fire | trooper 10 dmg every 1.0–1.5 s; heavy 3-bolt burst of 12 | about 8 hits to die: an alert is survivable, not free |
| Escape timer | 100 s | about twice the time the route needs |

Difficulty rises with the stage: more enemy types, cameras, then drones plus heavies, then everything at once.

## 5. Cast
| Actor | Behaviour | Telegraph | Counter |
|---|---|---|---|
| Snake (player) | cyborg operative, suppressed pistol | — | — |
| Vyrr trooper | line patrol or sentry | cone, `?`, meter | takedown from behind, sneak shot, hide |
| Vyrr heavy | armoured sentry, burst fire | wide cone | punch to stun → takedown |
| Scout drone | wall-following sweep, calls alerts | beeps, eye colour | shoot, grass, timing |
| Camera | fixed sweep, instant alarm on full meter | blue cone, LED | avoid the beam or shoot it (1 hit) |
| Ration / ammo / keycard | pickups | bob animation, keycard on the sensor | — |

## 6. HUD
- **Top-left bezel:** SHIELD bar (pulses at ≤30%), rail-pistol ammo (tabular numerals), keycard chip, objective.
- **Top-centre:** phase readout (ALERT / EVASION / DETONATION with a timer).
- **Top-right:** round motion sensor (jammed during alerts) and a pause button.
- **In the world:** vision cones, awareness meters, `!`/`?`, floating 3x5 text.
- **Context prompt:** bottom-centre on desktop; on touch it is the ACT button label.

## 7. Art direction
Procedural 16-bit pixel art with a low internal resolution (about 216 px tall) and integer scaling. Themes:
- **Depot:** night concrete and corrugated steel.
- **Camp:** dirt, grass, maroon tents.
- **Annex:** Marathon steel-blue with amber light strips.
- **Hangar:** steel and hazard stripes.
- **Mothership:** alien violet with green bioluminescence.

| Hex | Role |
|---|---|
| `#ff3b3b` | danger: alert, enemy dots, damage |
| `#5dff8a` / `#4fe07a` | good: motion sensor, pickups, terminal text |
| `#e0a040` | reward / primary action: prompts, labels |
| `#4fe3ff` | IRIS (friendly AI) |
| `#d35bff` | THRENODY and alien tech |

Type: **Oxanium** for headings and HUD, **VT323** for terminal text, a 3x5 bitmap font in the canvas.

## 8. Progression
| # | Stage | New idea | Objective |
|---|---|---|---|
| 1 | Truce Depot 7 | cones, takedowns, lockers, cameras | keycard → freight elevator |
| 2 | Camp Serpens | tall grass, drones, heavies | officer keycard → transport pad |
| 3 | Research Annex | camera-dense rooms, glass | keycard → intel → shuttle lift |
| 4 | Orbital Hangar | open ground, everything mixed | control keycard → shuttle |
| 5 | Mothership | 3 cores → alarm + detonation timer | plant charges → escape pod |

## 9. Juice
Screen shake on takedowns, hits and charges. A red hit flash with an invincibility blink. Particles for muzzle flash, sparks, goo and explosions. `!` alert sting, alert music and red tint. A typewriter terminal with a voice-waveform mouth.

## 10. Performance budget
- Canvas 2D at an internal resolution of about 384×216.
- One pre-rendered level background.
- About 20 rays per cone for 20 or fewer enemies.
- BFS paths are re-planned at most once per 1.2 s per enemy.
- DPR ≤ 2.

## 11. Reuse plan
| File | Source | Action |
|---|---|---|
| `touch-zoom-guard/` | mstr-gme-dsgn-tmpt/kits | copied verbatim |
| 3x5 font glyphs | mstr-gme-dsgn-tmpt/kits/vanilla-js/util | copied into `art.js` |
| `tools/smoke.mjs` | dr-mow/tools | adapted |
| `sw.js`, manifest, `pages.yml` | turn-tactics | adapted |

## 12. Open questions
- Should players be able to drag bodies into lockers? Default chosen: no. Bodies wake up after 50 s instead.
- Should the cardboard box be a portable item, MGS-style? Default chosen: fixed hiding spots only, for this first take.
- Should there be a boss fight on the mothership? Default chosen: an escape timer instead.

---

## Since the initial build (delta log)
### initial build
- First playable: 5 stages, full stealth loop, terminal comms, mobile and desktop controls, PWA, Pages deploy.
- Verification:
  - `check-levels` OK.
  - `sim-check`: 17/17 PASS.
  - `smoke`: desktop, iPhone 13, iPhone 13 landscape and iPad Pro 11 all PASS with 0 errors and 0 scroll.
  - tap-spam: PASS on iPhone and iPad.
