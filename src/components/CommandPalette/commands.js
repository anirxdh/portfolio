// Everything the command palette can do. Copy rules: plain English, first person, no dashes,
// and only facts that already live on the site (content/pages/about.md, src/constants).
//
// A command is { id, group, kind, title, subtitle?, keywords?, icon?, image?, accent?, href?, external?, run? }
// and `run` says how the palette executes it:
//   'navigate'  go to href in this tab (Cmd/Ctrl+Enter opens a new tab)
//   'external'  open href in a new tab
//   'after'     close the palette, then call perform() (focus has been handed back by then)
//   'now'       call perform() and close, inside the user gesture (downloads, mailto)
//   'stay'      call perform(ctx) and keep the palette open (perform decides when to close)

import { myProjects } from '../../constants/index.js';
import { ANIBOT_OPEN_EVENT, SHOW_PROJECT_EVENT } from './events.js';

export const EMAIL = 'anirudhvasudevan11@gmail.com';
export const RESUME_PDF = '/assets/anirudh-vasudevan-resume.pdf';

// Display order of the groups when the search box is empty.
export const GROUP_ORDER = ['Actions', 'Jump to', 'Pages', 'Projects', 'Articles', 'Elsewhere'];

// ---------- effects ----------
export function jumpTo(id, fallbackHref) {
  const el = document.getElementById(id);
  if (!el) {
    if (fallbackHref) window.location.assign(fallbackHref);
    return;
  }
  // A real hash change scrolls like the navbar links do and moves the Tab starting point there.
  const hash = `#${id}`;
  if (window.location.hash === hash) el.scrollIntoView({ block: 'start' });
  else window.location.hash = hash;
}

const openAniBot = (question) =>
  window.dispatchEvent(new CustomEvent(ANIBOT_OPEN_EVENT, question ? { detail: { question } } : undefined));

function downloadResume() {
  const a = document.createElement('a');
  a.href = RESUME_PDF;
  a.download = 'anirudh-vasudevan-resume.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and non-secure contexts: fall back to a hidden textarea.
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// ---------- static commands ----------
const shortName = (title) => title.split(':')[0].trim();
const firstSentence = (text) => {
  const clean = text.replace(/^[^A-Za-z0-9]+/, '').trim(); // drop a leading award emoji
  const m = /^(.+?[.!?])(\s|$)/.exec(clean);
  return m ? m[1] : clean;
};
const tileStyle = (logoStyle = {}) => ({ backgroundColor: logoStyle.backgroundColor, border: logoStyle.border });

const actions = [
  {
    id: 'action:anibot',
    title: 'Talk to AniBot',
    subtitle: 'Ask my AI assistant about my work',
    icon: 'chat',
    keywords: ['chat', 'ai', 'assistant', 'bot', 'ask', 'question', 'voice'],
    run: 'after',
    perform: () => openAniBot(),
  },
  {
    id: 'action:resume',
    title: 'Download resume',
    subtitle: 'PDF',
    icon: 'download',
    keywords: ['cv', 'pdf', 'resume'],
    href: RESUME_PDF,
    run: 'now',
    perform: downloadResume,
  },
  {
    id: 'action:copy-email',
    title: 'Copy email address',
    subtitle: EMAIL,
    icon: 'copy',
    keywords: ['email', 'mail', 'gmail', 'contact', 'clipboard'],
    run: 'stay',
    perform: async ({ flash, close }) => {
      const ok = await copyText(EMAIL);
      flash(ok ? 'Copied to clipboard' : `Could not copy. My email is ${EMAIL}`, ok);
      if (ok) close(900);
    },
  },
  {
    id: 'action:email',
    title: 'Send me an email',
    subtitle: 'Opens your mail app',
    icon: 'mail',
    keywords: ['email', 'mail', 'contact', 'reach', 'hire'],
    run: 'now',
    perform: () => {
      window.location.href = `mailto:${EMAIL}`;
    },
  },
];

const sections = [
  ['home', 'Home', 'Back to the top', ['top', 'hero', 'start']],
  ['about', 'About', 'Who I am, my stack, and where I am based', ['bio', 'intro', 'stack', 'skills', 'san francisco']],
  ['projects', 'Selected work', 'Projects with live sites and source code', ['projects', 'portfolio', 'demos', 'showcase']],
  ['hackathons', 'Hackathons', 'Wins and podium finishes', ['awards', 'wins', 'prizes', 'y combinator', 'elevenlabs']],
  ['writing', 'Writing', 'The latest articles', ['blog', 'articles', 'posts', 'deep dives']],
  ['work', 'Work experience', 'Rivo, Nonlinear, and the University of Minnesota', ['experience', 'jobs', 'career', 'rivo', 'nonlinear', 'employment']],
  ['contact', 'Contact', 'Send me a message', ['email', 'message', 'form', 'reach', 'hire']],
].map(([id, title, subtitle, keywords]) => ({
  id: `section:${id}`,
  title,
  subtitle,
  keywords: [id, ...keywords],
  icon: 'hash',
  href: `/#${id}`,
  run: 'after',
  perform: () => jumpTo(id, id === 'writing' ? '/blog/' : undefined),
}));

const pages = [
  ['/about/', 'About Anirudh', 'Full bio, patent, research, and education', ['about', 'bio', 'profile', 'patent', 'research', 'emnlp', 'education']],
  ['/blog/', 'All writing', 'Every project deep dive', ['blog', 'articles', 'writing', 'deep dives', 'rss']],
  ['/resume/', 'Resume', 'Read my resume on the web', ['cv', 'resume', 'experience']],
  ['/projects/', 'All projects', 'The full project list', ['projects', 'portfolio', 'builds']],
].map(([href, title, subtitle, keywords]) => ({
  id: `page:${href}`,
  title,
  subtitle,
  keywords: [href, ...keywords],
  icon: 'page',
  href,
  run: 'navigate',
}));

const projects = myProjects
  .filter((p) => p.id)
  .map((p) => ({
    id: `project:${p.id}`,
    title: shortName(p.title),
    subtitle: firstSentence(p.desc),
    keywords: [p.title, p.desc, ...(p.tags || []).map((t) => t.name), 'project'],
    icon: 'project',
    image: p.logo ? { src: p.logo, style: tileStyle(p.logoStyle) } : undefined,
    href: '/#projects',
    run: 'after',
    perform: () => {
      window.dispatchEvent(new CustomEvent(SHOW_PROJECT_EVENT, { detail: { id: p.id } }));
      jumpTo('projects');
    },
  }));

const elsewhere = [
  ['https://github.com/anirxdh', 'GitHub', 'github.com/anirxdh', ['code', 'source', 'repos'], '/assets/github.svg'],
  ['https://www.linkedin.com/in/anirudhvasudev/', 'LinkedIn', 'linkedin.com/in/anirudhvasudev', ['profile', 'connect'], '/assets/linkedin.png'],
  ['https://devpost.com/anirxdh', 'Devpost', 'My hackathon submissions', ['hackathons', 'projects']],
  ['https://scholar.google.com/citations?user=NvrJL_YAAAAJ', 'Google Scholar', 'Papers and citations', ['research', 'papers', 'emnlp', 'publications']],
  ['https://leetcode.com/u/anirudhvasudev/', 'LeetCode', 'More than 500 problems solved', ['algorithms', 'dsa', 'problems']],
  ['https://x.com/anirxdhv', 'X', '@anirxdhv', ['twitter', 'social']],
  ['https://www.youtube.com/@anirudhvasudevan5581', 'YouTube', 'My YouTube channel', ['videos', 'channel']],
  ['https://av-world.replit.app/', 'Play Anirudh’s World', 'A 3D village that lives on the real clock', ['game', 'explore', 'world', '3d', 'village']],
].map(([href, title, subtitle, keywords, image]) => ({
  id: `link:${href}`,
  title,
  subtitle,
  keywords,
  icon: 'external',
  image: image ? { src: image } : undefined,
  href,
  external: true,
  run: 'external',
}));

const withGroup = (group, kind, list) => list.map((c) => ({ ...c, group, kind }));

export const buildStaticCommands = () => [
  ...withGroup('Actions', 'Action', actions),
  ...withGroup('Jump to', 'Section', sections),
  ...withGroup('Pages', 'Page', pages),
  ...withGroup('Projects', 'Project', projects),
  ...withGroup('Elsewhere', 'Link', elsewhere),
];

// ---------- dynamic commands ----------
const logoBySlug = new Map(
  myProjects.filter((p) => p.article && p.logo).map((p) => [p.article, { src: p.logo, style: tileStyle(p.logoStyle) }]),
);

// Articles come from /blog/index.json (written by scripts/build-blog.mjs; drafts are never in it).
export const articleCommands = (list) =>
  list
    .filter((a) => a && a.slug && a.title)
    .map((a) => ({
      id: `article:${a.slug}`,
      group: 'Articles',
      kind: 'Article',
      title: a.title,
      subtitle: [a.project, a.award, a.readingMinutes ? `${a.readingMinutes} min read` : null].filter(Boolean).join(' · '),
      keywords: [a.project, a.award, ...(a.tags || []), a.description].filter(Boolean),
      icon: 'article',
      accent: a.accent,
      image: logoBySlug.get(a.slug),
      href: `/blog/${a.slug}/`,
      run: 'navigate',
    }));

export const askAniBotCommand = (question) => ({
  id: 'ask-anibot',
  group: 'AniBot',
  kind: 'AniBot',
  title: `Ask AniBot: “${question}”`,
  subtitle: 'Get an answer from my AI assistant',
  icon: 'sparkle',
  run: 'after',
  perform: () => openAniBot(question),
});
