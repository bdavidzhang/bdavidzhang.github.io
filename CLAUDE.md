# CLAUDE.md — bdavidzhang.github.io

Personal website for Bocheng David Zhang (张博诚), CS & Physics student at UIUC.
Deployed via GitHub Pages at `bdavidzhang.github.io`.

## Stack

**Pure static site — no framework, no build step, no package manager.**

- HTML5 + vanilla JS (ES6+) + CSS3
- Content stored in JSON files, rendered client-side by JS loaders
- Python scripts for one-off data tasks (not part of the site itself)
- Deployed directly from `main` branch to GitHub Pages

## File Structure

```
/
├── index.html           # THE MUSEUM — the landing page. Entry point for the 3D gallery.
├── home.html            # The text site (profile, bio, all content previews).
│                        #   Was index.html; the museum took the root.
├── museum.html          # Redirect stub → / , so links shared before the swap survive
├── writing.html         # Essays listing with tag filter
├── essay.html           # Single essay viewer (?slug=...)
├── math.html            # Math notes listing
├── math-note.html       # Single math note viewer (?slug=...)
├── podcast.html         # Podcast episode listing
├── template.html        # Blank page template
│
├── essay.json           # Essay data: title, slug, date, tags, body (HTML)
├── math.json            # Math notes: title, slug, subject, tags, description
├── podcast.json         # Podcast episodes: guest, date, description, YouTube link
├── publications.json    # Academic publications: title, venue, year, description
│
├── loadHomeContent.js   # Fetches all JSON, renders homepage sections, search
├── loadEssays.js        # Essays listing with tag filtering
├── loadEssay.js         # Single essay by URL ?slug= param
├── loadMathNotes.js     # Math notes listing
├── loadMathNote.js      # Single math note by URL ?slug= param
├── loadPublications.js  # Publications section
│
├── inter.css            # Inter font family
├── newmin.css           # Minimalist base styles (new.css fork)
├── style.css            # Custom layout and component styles
├── notes.css            # Styles specific to math notes pages
│
├── assets/
│   ├── me_circle.png    # Profile photo (shown by default)
│   ├── me_jedi.png      # Alternate profile photo (shown on hover)
│   └── cv.pdf
│
├── essays/              # Raw markdown source files for essays
├── log/                 # Daily log entries (.md files)
├── diagrams/            # Diagram assets
├── testimonies/         # Testimonial content
│
├── convert.py           # Markdown → HTML converter (for essay.json body field)
├── convert_all.py       # Batch conversion
└── fetch_playlist.py    # Fetches podcast data from YouTube
```

## How Content Works

Content is **data-driven**: JSON files are the source of truth for what appears on the site.

- `essay.json` stores full HTML in the `body` field — essays are authored in Markdown, converted via `convert.py`, then pasted into the JSON
- Pages load their JSON on `DOMContentLoaded` via `fetch()` and render dynamically
- Individual essays/notes are identified by `?slug=` URL parameters
- Homepage shows 3 items per section by default with a "Show More" button
- Global search on homepage filters across all sections simultaneously

## CSS Variables

`newmin.css` defines CSS custom properties used throughout:
- `--nc-tx-1`, `--nc-tx-2` — text colors (primary, secondary)
- `--nc-bg-1`, `--nc-bg-2`, `--nc-bg-3` — background tiers
- `--nc-lk-1` — link/accent color
- `--nc-font-mono` — monospace font stack

Dark mode is handled via `@media (prefers-color-scheme: dark)`.

## Owner / Content

- **Name:** Bocheng David Zhang (David Zhang, 张博诚)
- **Email:** davidz10@illinois.edu
- **School:** University of Illinois Urbana-Champaign (UIUC)
- **Socials:** X (@bdavidzhang), LinkedIn, GitHub (bdavidzhang), Instagram (david7hang), YouTube (@bdavidzhang)

**Content areas:**
- AI/ML research: reinforcement learning, chain-of-thought reasoning, LLM alignment, game theory
- Mathematics: abstract algebra (Galois theory), Monte Carlo sampling
- Writing: poetry, philosophy, tech commentary
- Podcast: "Ethical AI Podcast" / "David Talks With..." — interviews with researchers and practitioners

**Research background (currently commented out in index.html):**
- Researcher at ULab UIUC (Prof. Jiaxuan You) — RL agents
- NVIDIA math reasoning team collaboration (Dr. Branislav Kisacanin) — math olympiad dataset
- QMCPy team (Prof. Fred Hickernell) — randomization techniques
- 2025 Heidelberg Laureate Forum — Young Researcher

## Profile Image Easter Egg

`index.html` has a hover effect: `me_circle.png` → `me_jedi.png` on hover (desktop) or tap (mobile via `.is-active` class toggle in `loadHomeContent.js`).

## Known TODOs in the Codebase

- `swe_interview` (in `essay.json`) ends with `"To be finished."`, its `title` field is
  the raw filename rather than the real title inside the body, and its `body` still
  carries unstripped front-matter
- The three `notes/*.pdf` links in `math.json` point at a `notes/` directory that does
  not exist — all three are dead
- Tag chips on essay/note pages navigate to `writing.html?tag=X` / `math.html?tag=X`,
  but neither listing page ever reads `?tag=`, so the filter silently does nothing
- `landing.html` is an unlinked ancestor of the old hero. Nothing points at it

Do NOT reintroduce the old claim that the bio, awards and past experience are
commented out in the landing page — that was true before the revamp and is not
true now. The awards list (MCM/ICM, USAMO) was deleted outright and survives only
in commit `02f07b7`; it is not hidden anywhere in the working tree.

## The 3D Museum (`index.html`)

A walkable first-person gallery rendering the same JSON content as the flat pages.
**It is the site's landing page.** The text site lives at `home.html`, and
`museum.html` is a redirect stub kept only so previously-shared links still work.
**Still no build step** — three.js r169 is vendored at `museum/vendor/` and resolved
through an `<script type="importmap">` in `museum.html`.

```
index.html               # entry: import map, canvas, WebGL/no-JS fallbacks to home.html
museum/
├── config.js            # SINGLE SOURCE OF TRUTH — THEMES, MODE, DIMS, ROOMS, TUNING
├── content.js           # fetches the existing *.json, normalises to one Exhibit shape
├── engine.js            # renderer, RAF loop, adaptive DPR, per-room culling
├── lighting.js          # the 4-light rig, retinted + cross-faded per room
├── architecture.js      # room shells, doorways, merged geometry, outlines, colliders
├── decor.js             # prop framework + ctx toolkit; dispatches to themes/
├── themes/*.js          # one file per room character (garden, lab, study, chalk, …)
├── exhibits.js          # framed plates + link lecterns, canvas labels, raycast targets
├── portal.js            # the Open Reality wall in the atrium (proximity, not raycast)
├── controls.js          # pointer-lock WASD, circle-vs-AABB collision, tap-to-walk, keyboard-only
├── ui.js                # DOM overlay: loader, reader panel, room map, day/night, perf
├── museum.css           # overlay styles; day is default, night via [data-museum-mode]
├── smoke-test.mjs       # headless contract tests — `node museum/smoke-test.mjs`
├── integration-test.mjs # builds the real museum from real JSON, counts draw calls
├── vendor/              # three.module.min.js + BufferGeometryUtils
└── tex/                 # downscaled 256px portraits (assets/*.png are 1.9–6.5 MB, too big)
```

**Day/night is NOT prefers-color-scheme.** The museum defaults to `day` for
everyone and remembers an explicit choice in `localStorage['museum-mode']`.
This is deliberate: the first version inherited OS dark mode and rendered walls
at `#1b1b1f`, and because Lambert shades as `albedo × light`, near-black walls
cannot be lit — the room just reads as gloomy. Night now uses mid-grey walls.
The same trap bites one level up in `lighting.js`: tinting a light with a dark
theme colour multiplies its intensity by that colour's lightness, so tints are
normalised to hue and intensity alone carries energy. Do not reintroduce a
`prefers-color-scheme` branch anywhere in the museum.

**Adding or changing a room's character:** edit its `theme` in `ROOMS`, or add a
`THEME_DEFS` entry plus a `themes/<name>.js` exporting `<name>(ctx)`. Themes get
a toolkit (`ctx.instanced`, `ctx.merged`, `ctx.mat`, `ctx.collide`, …) and must
use `ctx.rng()` rather than `Math.random()` so props land identically each load.

**Rooms are data.** Add or reorder entries in `ROOMS` in `config.js`; geometry,
colliders, anchors, the map UI and `#hash` deep links all follow automatically.
Each room's `source` key names the array `content.js` fills in.

**Phones navigate by tapping** — the Google Earth gesture. A tap is projected onto
the floor plane, a ring is dropped where it landed, and the ordinary velocity +
collision integrator walks the visitor over, swinging the view onto the bearing
as it goes. There is deliberately **no path-finding**: you walk the straight line
and slide along whatever you meet. A navmesh would have to be rebuilt every time
someone adds an entry to `ROOMS`, and in an enfilade of rectangular rooms the
straight line is the honest reading of "go over there". When the line is beaten
by geometry, `NAV_STALL` seconds of going nowhere abandons the walk rather than
leaving the visitor pressed into the plaster.

`walkToScreen` clamps **along the bearing first, into the building second**.
A near-horizon tap puts the floor point a hundred metres away; squaring that into
the room before shortening it swings the walk round to face down the enfilade
instead of where the visitor actually pointed. Do not swap those two clamps back.

**controls.js walks, main.js decides what a tap means.** A tap on an exhibit
already within `TUNING.interactDist` opens it; anything else is somewhere to walk
to. That split is why `controls.consumeTap()` exists: it is true exactly once per
tap, so the click a browser synthesises after a look-drag or a shove on the walk
pad never gets read as a destination. The whole gesture rides on the click that
follows a stationary touch — the same one the museum has always used to open a
plate — so `touchstart` must stay passive and must never `preventDefault`.

**The walk pad no longer appears on touch-down.** It shares the left half of the
screen with tap-to-walk, and a stick that flashes up under every tap reads as a
misfire, so `update()` reveals it after `STICK_HOLD`, or the first drag past the
tap slop does — and that drag re-centres the stick on where the thumb committed,
so it starts from zero instead of jumping. Dragging to look also clears
`navFace`: the visitor keeps walking to the tapped spot but gets their head back.

**The core design decision:** 3D handles *navigation*, DOM handles *reading*.
Walking up to a plate and pressing `E` opens a real HTML panel — text stays
selectable, zoomable, screen-reader accessible, and crisp at any resolution.

**Links are lecterns, not plates.** An exhibit with `kind: 'link'` is somewhere to
*go*, not something to read, so `exhibits.js` gives it a standing lectern with a lit
button instead of a wall card, and `main.js`'s `openFocused()` opens its URL in a new
tab instead of opening the reader. That `window.open` call **must stay synchronous
inside the keydown/click handler** — browsers only permit it during the user-activation
window, so deferring it to the frame loop, a timeout or a promise gets it silently
blocked. If it is blocked anyway, the reader panel opens as the fallback, because it
already renders `href` as a real `target="_blank"` anchor. `mailto:`/`tel:` go via
`location.href`, or they strand an `about:blank` tab behind the mail client.

Lecterns stand on the floor, so unlike wall plates they are solid: `buildExhibits`
returns a `colliders` array that `main.js` folds into the player's collider list, and
`integration-test.mjs` asserts no prop and no walkway overlaps one.

**The Open Reality wall** (`portal.js`) is the whole entrance wall of the atrium —
the solid `k === 0` boundary whose interior face is at `z = 0`, blank by default.
It carries the wordmark, the tagline, a lit central threshold, and two boards: the
owner's founder statement and what the platform does. Walking up to it opens
open-reality.io in a new tab.

**The wall stays solid and the visitor never passes through it.** `architecture.js`
already emits its collider, so `portal.js` returns `colliders: []` and every piece of
relief is shallower than the 0.48 m the player is stopped at. Do not make it passable:
if the tab is blocked, a walk-through would strand the visitor outside the building.

It is **not an exhibit and never a raycast target** — both suites assert one target
per exhibit, so adding it to `exhibits.targets` would fail the build. It triggers on
*zone occupancy* (`|x| ≤ 1.96`, `z ∈ [-1.15, 0.60]`), latched so it fires once per
entry and re-arms only after the visitor leaves.

**The trigger must stay nearer the wall than the spawn point.** `engine.js` spawns the
camera at `z = -1.8` facing away; the zone's near edge is `z = -1.145`, leaving 0.65 m
of slack. Move either number carelessly and booting the museum opens a tab on its own.
Because it is occupancy and not plane-crossing, a teleport straight past it does not
fire it — which is why the room map can never trip it.

Note `window.open(url, '_blank', 'noopener')` returns `null` **even on success** (the
spec severs the WindowProxy), so it is impossible to distinguish "opened" from
"blocked". Both `portal.js` and `main.js` therefore call `window.open(url, '_blank')`
and set `opened.opener = null` on the next statement instead. Do not "fix" this back.

**The portrait easter egg.** An exhibit may carry `imageAlt` alongside `image`;
`exhibits.js` shows it only while that plate is focused, so staring at the portrait in
the atrium turns it into the lightsaber shot — the museum's version of the hover swap
on the text site. Both textures load independently and either may arrive first or not
at all, so the desired state is a `wantAlt` flag and `showPortrait()` reconciles
whenever it or a texture changes. Do not rewrite it to assume load order.

**Themes must derive their layout from `ctx.anchors`, never from written-down
coordinates.** `themes/library.js` used to hardcode where the six contact plates fell;
adding a seventh link silently slid the bookcases over them. It now computes its bays
from the anchors it is handed, so the room reflows with its own contents. Any theme
that needs to know where exhibits land must do the same.

**Performance rules — do not regress these:**
- No shadow maps. Lights are hemisphere + ambient + one camera-following directional.
- Only the current room ±1 is ever submitted (`TUNING.cullRadius`); fog hides the seam.
- Adaptive DPR scales resolution down before frames start dropping (`TUNING.targetFrameMs`).
- Static meshes are merged per material per room, `matrixAutoUpdate = false`.
- `update()` loops allocate nothing — temporaries are hoisted to module scope.
- Raycasting for the focus prompt runs at ~20 Hz, not per frame.

`/log/`, `/testimonies/` and `/diagrams/` are gitignored, so no room may source
from them — that would publish unpublished material.

## Deployment

Push to `main` → GitHub Pages auto-deploys. No CI, no build process.
`/node_modules/` exists only so `museum/smoke-test.mjs` can resolve the bare
`three` specifier in Node; it is gitignored and not part of the site.
To test locally, run a local HTTP server (e.g. `python3 -m http.server`) — `fetch()` calls require HTTP, not `file://`.
