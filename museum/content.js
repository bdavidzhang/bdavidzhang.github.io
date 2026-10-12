// content.js — reads the site's existing JSON and normalises everything into a
// single Exhibit shape so the 3D layer never has to care where data came from.
//
// Exhibit = {
//   id, kind, title, meta, blurb, tags[], href?, bodyHtml?, external?, image?,
//   imageAlt?, // swapped in while the plate is focused (the portrait easter egg)
//   links?     // [{title, url, description}] — math notes only
// }
//
// `kind` decides how exhibits.js renders it: everything is a framed wall plate
// except `kind: 'link'`, which becomes a standing lectern with a pressable
// button that opens `href` in a new tab.
//
// An exhibit with `stand: { x, depth, rotationY }` is free-standing: it takes no
// wall anchor and gets a lectern on the floor at that spot instead (see
// `standSpot` in config.js). Its `id` is also its deep link — `#story`. `label`
// overrides the kind label printed on its lectern.

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
      <p>I'm the founder of <strong><a href="https://www.open-reality.io">Open Reality</a></strong>
      — a spatial AI platform that maps physical spaces in real time from a phone camera and lets
      AI agents reason and act in 3D. It won $20K in prizes at HackIllinois 2026.</p>
      <p>I'm also an independent researcher in <strong>reinforcement learning and 3D vision
      for LLMs</strong>. I want to build smart, autonomous, tool-using agents.</p>`,
    image: 'museum/tex/portrait.png',
    // Only shows while you are looking at the plate — the museum's version of
    // the hover swap on the text site.
    imageAlt: 'museum/tex/portrait_alt.png',
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

// The two stories — the only exhibits that stand out on the atrium floor rather
// than hanging on a wall. Each is the destination of a shareable link:
//
//   /story               → story.html               → #story               (personal)
//   /open-reality-story  → open-reality-story.html  → #open-reality-story  (founder)
//
// The texts are the Story sections of personal-story.md and story.md; edit them
// there first, then here. integration-test.mjs fails the build if a garden prop
// is ever moved onto either stand.

// Just right of the flagstone path, between the first tree box and the bench,
// turned a little toward the entrance so it is in view from the spawn point.
const PERSONAL_STORY = {
  id: 'story',
  kind: 'story',
  label: 'Personal story',
  title: 'Where I come from',
  meta: 'Personal story · October 2026',
  blurb: 'Shenyang, a saga in an invented language, and the teacher who made math fun.',
  stand: { x: 2.0, depth: 5.9, rotationY: -0.4 },
  bodyHtml: `
    <p>I was homeschooled for grades one through three in Shenyang, where my parents ran an
    English tutoring school that hosted American teachers. I grew up between two cultures, a
    Chinese kid in Northern China surrounded by American kids.</p>
    <p>At eight I started writing a Tolkien-inspired saga, <em>The Chronicles of Arlenvar</em>.
    It ran to three novels, and I invented an inflectional language, Lufasta, to go with it. The
    world ran on wind: natural channels of air that people rode from place to place on gliders
    or large animals, which was my idea of flying cars. The hero is a boy who travels from the
    kingdom of men to the kingdom of elves, falls in love with elvish culture, and finally
    understands that he belongs to both worlds. Then he becomes an inventor. I wrote it in a mix
    of Chinese and English, which confused some readers and earned me a small following on a
    Chinese writing platform. Looking back, I was writing about myself.</p>
    <p>Math came later, and it came hard. In 2020 my middle school ranked everyone's test
    scores, and I badly wanted to be first. Math was my weakest subject. I would sit up late
    over a single problem and get nowhere. During lockdown, Sheng, a graduate of my school who
    was then in his first year at Oxford, offered a class on "fun math." I did not think those
    two words went together. He taught math as a series of puzzles, and more than that, he
    taught his passion for it. Three months later I was a different student. I taught myself the
    rest of middle and high school math in four months, and by the end of the year I was reading
    Rudin's <em>Principles of Mathematical Analysis</em>. Ten months earlier I had been stuck on
    geometry. In high school I turned to competitions and qualified for the USAMO.</p>
    <p>I also founded my high school's math team. I asked everyone I knew to join, including a
    girl my friends had told me to ask to prom. In our first year the coach forgot to register
    us for the AMC. I was furious, but I was the captain, so I stayed. We built a systematic
    training routine borrowed from Chinese competition curricula, with students teaching each
    other. We placed 13th in the state in our division my sophomore year, 5th my junior year and
    3rd my senior year. I entered the two-person event alone and won the state title. The team
    has been state champion both years since I graduated.</p>
    <p>Sheng was about my age when he reached out to me. To give that back, I organized and led
    a two-week olympiad camp in China for 33 students. I wrote the curriculum on recursion and
    geometric transformations, worked 14-hour days for three weeks to prepare the lectures,
    recruited the students, and handled the hotels, the food and the activities.</p>
    <p>Math is still my favorite subject, and I still go to the Putnam seminar. What I took from
    those years is that Sheng did not just teach me math. He taught me his passion for it, and
    that is what I try to pass on, in a classroom or in a company.</p>`,
};

// Beside the Open Reality wall, in the gap between the threshold's reveal
// (|x| <= 1.96) and the description board (|x| >= 3.16), with its back to the wall
// and angled toward the middle of the room. Both the stand and the spot the
// visitor is walked to (1.6 m out from it) are outside the portal's trigger zone
// (z >= -1.15 inside |x| <= 1.96), so arriving here never opens the tab.
const OPEN_REALITY_STORY = {
  id: 'open-reality-story',
  kind: 'story',
  label: 'Founder story',
  title: 'How Open Reality began',
  meta: 'Founder story · October 2026',
  blurb: 'A 36-hour bet at HackIllinois, a summer alone, and the people who showed up.',
  stand: { x: 2.55, depth: 1.2, rotationY: Math.PI + 0.5 },
  href: 'https://www.open-reality.io',
  external: true,
  bodyHtml: `
    <p>OpenReality began as a 36-hour bet at HackIllinois 2026. Four of us, Jalen, Parin,
    Tarang and I, all came from research in agents, computer vision and memory, and we wanted
    to turn that into something you could actually see working. We wired six foundation models
    into one pipeline, designed an agent network on top of it, and defined a 3D scene
    representation the agents could read and write. The first version was far too slow to demo.
    We were still cutting latency the morning of the presentation: sampling only keyframes, 16
    per submap, and loading the scene one submap at a time. It worked. We won Best AI Inference
    from Modal, Most Creative Idea and Best Use of Gemini API, $20K in prizes.</p>
    <p>Then everyone went back to their lives. In May I asked who wanted to co-found it. They
    were all busy, and they are advisors today. I went on alone.</p>
    <p>Raising was hard. I spent three weeks in the Bay Area and could not convince a single
    investor that I could sell this. So I left and went home to China, and that is where the
    company actually started. A team called Neural Motion began using the product and pushed me
    through fast iterations. I also pitched the big embodied-AI labs, PsiRobot and AgiBot, and
    got real pushback: they have abundant teleoperation labor and believe egocentric and
    UMI-style data collection will lead robotics. I fundamentally disagree. There are trillions
    of hours of action video already online, and I think the path to agents that can operate any
    hardware runs through simulation environments captured directly from video. Our sim-to-real
    pipeline is how we will prove it.</p>
    <p>In late June, Modal flew me back for their Series C party. There I met a new group of
    investors, and Roderick Dong, introduced by a Stanford friend, wrote the entire $50K
    pre-seed. With that same group of friends I co-hosted a 900-person Robotics and Physical AI
    founder-investor summit at Stanford in July, which opened doors at NVIDIA and with robotics
    companies. Choosing the attendees and matching founders, researchers and investors taught me
    that a startup is mostly a matter of bringing the right people together.</p>
    <p>It also taught me that talking to customers was easy and converting them was very hard.
    So I opened the core. Open Reality OS is open source, and we charge only for inference. It
    passed 100 GitHub stars in two weeks and is past 300 now. I was solo all summer. Today we
    are about ten people at UIUC, and I consider every one of them part of the founding
    team.</p>`,
};

// The Reading Room's links. These do not hang on the wall as cards — exhibits.js
// gives every `kind: 'link'` exhibit a standing lectern with a lit button you
// walk up to and press, and pressing it opens the URL in a new tab.
//
// Adding or removing one reflows this room's anchors (architecture.js derives
// pitch from the exhibit count), which is why themes/library.js reads
// `ctx.anchors` instead of hardcoding where the bays fall.
const CONTACT = [
  { id: 'c-email', kind: 'link', title: 'Email',     meta: 'davidz10@illinois.edu', href: 'mailto:davidz10@illinois.edu', external: true, blurb: 'The most reliable way to reach me.' },
  { id: 'c-cv',    kind: 'link', title: 'CV',        meta: 'PDF',                   href: 'assets/cv.pdf',                 external: true, blurb: 'Curriculum vitae.' },
  { id: 'c-x',     kind: 'link', title: 'X',         meta: '@bdavidzhang',          href: 'https://x.com/bdavidzhang',     external: true, blurb: 'Short thoughts, mostly research.' },
  { id: 'c-gh',    kind: 'link', title: 'GitHub',    meta: 'bdavidzhang',           href: 'https://github.com/bdavidzhang', external: true, blurb: 'Code, experiments, this museum.' },
  { id: 'c-li',    kind: 'link', title: 'LinkedIn',  meta: 'David Zhang',           href: 'https://www.linkedin.com/in/bdavidzhang/', external: true, blurb: 'Professional history.' },
  { id: 'c-yt',    kind: 'link', title: 'YouTube',   meta: '@bdavidzhang',          href: 'https://www.youtube.com/@bdavidzhang', external: true, blurb: 'The podcast lives here.' },
  { id: 'c-ig',    kind: 'link', title: 'Instagram', meta: '@david7hang',           href: 'https://www.instagram.com/david7hang/', external: true, blurb: 'Life outside the research.' },
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
    about:        [...ABOUT, PERSONAL_STORY, OPEN_REALITY_STORY],
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
