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
├── index.html           # Landing page (profile, bio, all content previews)
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

- `index.html` has a placeholder: `"If you see this, please remind me to update my website!!!"`
- The Publications section, research bio, awards list, and past experience are all commented out in `index.html` — they exist but are hidden
- `swe_interview` essay ends with `"To be finished."`

## Deployment

Push to `main` → GitHub Pages auto-deploys. No CI, no build process.
To test locally, run a local HTTP server (e.g. `python3 -m http.server`) — `fetch()` calls require HTTP, not `file://`.
