// content.js — reads the site's existing JSON and normalises everything into a
// single Exhibit shape so the 3D layer never has to care where data came from.
//
// Exhibit = {
//   id, kind, title, meta, blurb, tags[], href?, bodyHtml?, external?, image?
// }

import { ROOMS, THEMES } from './config.js';

const BASE = new URL('../', import.meta.url); // site root, museum.html lives there

async function getJSON(path) {
  try {
    const res = await fetch(new URL(path, BASE), { cache: 'force-cache' });
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return await res.json();
  } catch (err) {
    console.warn(`[museum] could not load ${path}:`, err.message);
    return null;
  }
}

const asArray = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v).find(Array.isArray) || [] : []);

/** Strip HTML to a plain-text preview of roughly `max` characters. */
function excerpt(html, max = 190) {
  if (!html) return '';
  const text = String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = cut.lastIndexOf(' ');
  return `${cut.slice(0, stop > 60 ? stop : max)}…`;
}

// --- the static, hand-written rooms -----------------------------------------

const ABOUT = [
  {
    id: 'about-bio',
    kind: 'about',
    title: 'David Zhang · 张博诚',
    meta: 'University of Illinois Urbana-Champaign',
    blurb:
      'I care about loving God and people. Undergraduate studying Computer Science and Physics.',
    bodyHtml: `
      <p>I care about loving God and people.</p>
      <p>Undergraduate student at the <strong>University of Illinois Urbana-Champaign</strong>,
      studying Computer Science and Physics.</p>
      <p>I'm currently an independent researcher in <strong>reinforcement learning and 3D vision
      for LLMs</strong>. I want to build smart, autonomous, tool-using agents.</p>`,
    image: 'museum/tex/portrait.png',
  },
  {
    id: 'about-work',
    kind: 'about',
    title: 'Previously',
    meta: 'Research history',
    blurb: 'ULab UIUC, the NVIDIA math reasoning team, and the QMCPy group.',
    bodyHtml: `
      <p>Previously, I worked with <strong>Professor Jiaxuan You</strong> on multi-agent
      reinforcement learning.</p>
      <p>I collaborated with the <strong>NVIDIA math reasoning team</strong> through
      Dr. Branislav Kisacanin, where I designed the math olympiad dataset for our
      published study.</p>
      <p>For two years in high school I worked with the <strong>QMCPy team</strong>, advised by
      Professor Fred Hickernell, designing randomization techniques.</p>`,
  },
  {
    id: 'about-hlf',
    kind: 'about',
    title: 'Heidelberg Laureate Forum',
    meta: '2025 · Young Researcher',
    blurb:
      'Conversations with Richard Sutton, David Silver, Pat Hanrahan, Sanjeev Arora and more.',
    bodyHtml: `
      <p>Selected as a <strong>Young Researcher</strong> for the 2025 Heidelberg Laureate Forum.</p>
      <p>Had meaningful conversations with Richard Sutton, David Silver, Pat Hanrahan,
      Sanjeev Arora, Ngo Bao Chau, Jack Dongarra, Bob Tarjan and many more.</p>`,
  },
];

const CONTACT = [
  { id: 'c-email', kind: 'link', title: 'Email',     meta: 'davidz10@illinois.edu', href: 'mailto:davidz10@illinois.edu', external: true, blurb: 'The most reliable way to reach me.' },
  { id: 'c-cv',    kind: 'link', title: 'CV',        meta: 'PDF',                   href: 'assets/cv.pdf',                 external: true, blurb: 'Curriculum vitae.' },
  { id: 'c-x',     kind: 'link', title: 'X',         meta: '@bdavidzhang',          href: 'https://x.com/bdavidzhang',     external: true, blurb: 'Short thoughts, mostly research.' },
  { id: 'c-gh',    kind: 'link', title: 'GitHub',    meta: 'bdavidzhang',           href: 'https://github.com/bdavidzhang', external: true, blurb: 'Code, experiments, this museum.' },
  { id: 'c-li',    kind: 'link', title: 'LinkedIn',  meta: 'David Zhang',           href: 'https://www.linkedin.com/in/bdavidzhang/', external: true, blurb: 'Professional history.' },
  { id: 'c-yt',    kind: 'link', title: 'YouTube',   meta: '@bdavidzhang',          href: 'https://www.youtube.com/@bdavidzhang', external: true, blurb: 'The podcast lives here.' },
];

// --- normalisers -------------------------------------------------------------

const fromEssays = (raw) =>
  asArray(raw).map((e, i) => ({
    id: `essay-${e.slug || i}`,
    kind: 'essay',
    title: e.title || 'Untitled',
    meta: e.date || '',
    tags: e.tags || [],
    blurb: excerpt(e.body),
    bodyHtml: e.body || '',
    href: `essay.html?slug=${encodeURIComponent(e.slug || '')}`,
  }));

const fromPublications = (raw) =>
  asArray(raw).map((p, i) => ({
    id: `pub-${i}`,
    kind: 'publication',
    title: p.title || 'Untitled',
    meta: [p.venue, p.year].filter(Boolean).join(' · '),
    tags: [],
    blurb: excerpt(p.description, 220),
    bodyHtml: p.description ? `<p>${p.description}</p>` : '',
    href: p.link || p.url || '',
    external: Boolean(p.link || p.url),
  }));

const fromMath = (raw) =>
  asArray(raw).map((m, i) => ({
    id: `math-${m.slug || i}`,
    kind: 'math',
    title: m.title || 'Untitled',
    meta: [m.subject, m.date].filter(Boolean).join(' · '),
    tags: m.tags || [],
    blurb: excerpt(m.description, 220),
    bodyHtml: m.description ? `<p>${m.description}</p>` : '',
    href: `math-note.html?slug=${encodeURIComponent(m.slug || '')}`,
    links: m.links || [],
  }));

const fromPodcast = (raw) =>
  asArray(raw).map((p, i) => ({
    id: `pod-${i}`,
    kind: 'podcast',
    title: p.title || 'Untitled',
    meta: [p.guest, p.date].filter(Boolean).join(' · '),
    tags: p.guest ? [p.guest] : [],
    blurb: excerpt(p.description, 220),
    bodyHtml: p.description ? `<p>${p.description}</p>` : '',
    href: p.link || '',
    external: true,
  }));

// ---------------------------------------------------------------------------

/**
 * Load every content source in parallel and attach exhibits to each room.
 * Rooms whose source yields nothing are still returned (empty) so the
 * architecture stays consistent — callers may filter them out.
 *
 * @returns {Promise<Array<room & {exhibits: Exhibit[]}>>}
 */
export async function loadContent() {
  const [essays, pubs, math, podcast] = await Promise.all([
    getJSON('essay.json'),
    getJSON('publications.json'),
    getJSON('math.json'),
    getJSON('podcast.json'),
  ]);

  const bySource = {
    about:        ABOUT,
    contact:      CONTACT,
    essays:       fromEssays(essays),
    publications: fromPublications(pubs),
    math:         fromMath(math),
    podcast:      fromPodcast(podcast),
  };

  // accentHue lives on the theme now, but exhibits.js and the UI read it off
  // the room, so resolve it here rather than making every consumer look it up.
  return ROOMS.map((room) => {
    const theme = THEMES[room.theme] || {};
    return {
      ...room,
      accentHue: theme.accentHue ?? 210,
      palette: theme,
      exhibits: bySource[room.source] || [],
    };
  });
}

export { excerpt };
