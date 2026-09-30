# METAL SNAKE: COSMIC CALAMITY

A retro top-down stealth game in the style of 16-bit *Metal Gear*, with visuals inspired by Bungie's *Marathon* trilogy (AIs and aliens, steel terminals, the motion sensor).

Two years into an uneasy "V"-style truce, Earth and the reptilian **Vyrr** share an occupation. The Vyrr are building something. The military sends in **Snake**, a cyborg operative bonded to a military AI called **IRIS**. His route runs through their warehouses, a field camp and a research annex. Then he stows away to their mothership in orbit.

**Play:** https://mtd-public.github.io/cosmic-calamity/ (GitHub Pages, deployed from `main`). It works on desktop and mobile, and offline once loaded.

## Features
- **Stealth AI.** Enemies have vision cones and a gradual awareness meter (`?` → `!`). Troopers patrol, sentries look around, scout drones sweep, and wall cameras pan. Every enemy uses tile pathfinding.
- **Alert → Evasion → Infiltration.**
  - **Alert** has a countdown that only runs while you're out of sight.
  - **Evasion** sends the Vyrr searching around your last known position.
  - Alerts jam the motion sensor.
- **Tools:**
  - Silent takedowns from behind. Heavies must be punched to stun them first.
  - Hide in lockers, bins and boxes. If a guard sees you get in, he comes to check.
  - Knock on walls to lure a guard.
  - Tall grass hides you.
  - A suppressed rail-pistol: a shot into an unaware back is a one-shot drop, but gunfire carries.
- **Bodies.** Knocked-out troopers can be discovered and eventually wake up.
- **5 stages:** Truce Depot 7 → Camp Serpens → Research Annex → Orbital Hangar → Mothership (sabotage 3 cores, then beat the detonation timer).
- **Marathon-style terminal comms** between Colonel Hale, IRIS and a captive ship AI, THRENODY.
- A rank at the end of each stage: PHANTOM / GHOST / FOX / JACKAL / RHINO / CHICKEN.
- Everything is procedural, with no image or audio files: pixel art is drawn in code and sound is synthesized with WebAudio.

## Controls
| Action | Keyboard | Touch | Gamepad |
|---|---|---|---|
| Move | WASD / Arrows | Left thumb: floating stick | Stick / D-pad |
| Sneak (slow) | Hold Shift | Push the stick lightly | LB |
| Act: takedown, punch, hide, open, knock, download, plant | J / Space / E | ACT | A |
| Fire | K / F | FIRE | X / RB |
| Pause | Esc / P | ❚❚ (top right) | Start |
| Mute / Help | M / ? | Pause menu | — |

## Run locally
There's no build step. Serve the folder over HTTP:
```sh
python3 -m http.server 4180    # then open http://localhost:4180/
```
Useful URL flags:
- `?stage=N` starts at stage N (0–4).
- `?skipintro` skips the briefings.
- `?map=N` renders the full map of stage N, with cones and entities, for level design.

## Checks
```sh
node tools/check-levels.mjs     # map widths, borders, reachability of every objective/pickup/exit
python3 -m http.server 4180 &
BASE=http://localhost:4180/ CHROMIUM=/opt/pw-browsers/chromium node tools/sim-check.mjs   # mechanics, headless
BASE=http://localhost:4180/ CHROMIUM=/opt/pw-browsers/chromium node tools/smoke.mjs       # 4 device profiles, 0 errors, 0 scroll
node touch-zoom-guard/test/tap-spam.mjs "http://localhost:4180/?stage=0&skipintro" --start "#stagecard" --buttons "#btnAct,#btnFire"
```

## Code map
| File | What |
|---|---|
| `index.html`, `css/style.css` | Shell, HUD, screens, terminal UI (Marathon-style steel bezels) |
| `js/levels.js` | ASCII maps, legend, briefings and story, cast |
| `js/game.js` | Simulation: player, enemy AI and perception, alert phases, bullets, pathfinding, world render, motion sensor |
| `js/art.js` | Procedural pixel art: tiles per theme, characters, drones, cameras, AI portraits, 3x5 bitmap font |
| `js/audio.js` | WebAudio SFX and step-sequenced chiptune music |
| `js/input.js` | Keyboard, Pointer-Events touch stick and buttons, gamepad |
| `js/main.js` | Boot, fixed-step loop, screens, terminal comms, HUD, save, auto-pause, `window.GAME` test hooks |
| `tools/` | Level validator, headless mechanics check, smoke test, icon generator |
| `.github/workflows/pages.yml` | Deploys `main` to GitHub Pages |

## Lineage
The game follows the house rules in `mtd-public/mstr-gme-dsgn-tmpt`:
- sim / render / UI split
- fixed-step loop
- Pointer-Events controls
- auto-pause on blur, visibility and zoom
- namespaced `localStorage`
- smoke tests

Reused pieces:
- `touch-zoom-guard/`: copied verbatim from `mstr-gme-dsgn-tmpt/kits/touch-zoom-guard`.
- The 3x5 bitmap font glyphs come from `mstr-gme-dsgn-tmpt/kits/vanilla-js/util/pixel-util-and-3x5-font.js`.
- `tools/smoke.mjs`: adapted from `dr-mow/tools/smoke.mjs`.
- `sw.js`, the manifest and the Pages workflow follow `mtd-public/turn-tactics`. The workflow publishes to both Pages sources: a `gh-pages` branch, and the Actions artifact.
- The CIC-terminal look (square steel bezels, amber readouts, scanlines) is borrowed from turn-tactics and pushed toward *Marathon*'s terminals and motion sensor.

## GitHub Pages setup
On the first run the workflow tries to enable Pages automatically. If the site doesn't appear, go to **Settings → Pages** and set **Source** to **GitHub Actions**. Setting it to **Deploy from a branch → `gh-pages` / root** also works.
