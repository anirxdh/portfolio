// Single source of truth for the Person entity used in structured data across every page.
// index.html keeps a copy in <script id="person-ld"> so the dev server has it too, but the build
// (scripts/build-blog.mjs) overwrites that block in dist/index.html with person(), so the two can
// never drift in production. It also warns when the source copy is out of date.
export const SITE = 'https://anirudhvasudevan.com';
export const PERSON_ID = `${SITE}/#person`;
// The one url for the Person. Author and publisher references use the same value.
export const PERSON_URL = `${SITE}/`;

// Every URL here was checked to be his (2026-10-17). Do not add same-handle accounts that
// belong to other people (e.g. medium.com/@anirxdh is a different person).
export const SAME_AS = [
  'https://www.linkedin.com/in/anirudhvasudev/',
  'https://github.com/anirxdh',
  'https://scholar.google.com/citations?user=NvrJL_YAAAAJ',
  'https://orcid.org/0009-0005-2249-312X',
  'https://devpost.com/anirxdh',
  'https://x.com/anirxdhv',
  'https://www.youtube.com/@anirudhvasudevan5581',
  'https://leetcode.com/u/anirudhvasudev/',
  'https://www.instagram.com/anirxdh/',
];

export const person = (extra = {}) => ({
  '@type': 'Person',
  '@id': PERSON_ID,
  name: 'Anirudh Vasudevan',
  givenName: 'Anirudh',
  familyName: 'Vasudevan',
  url: PERSON_URL,
  image: `${SITE}/assets/anirudh-avatar.png`,
  jobTitle: 'Member of Technical Staff',
  description:
    'Anirudh Vasudevan is a full-stack and AI engineer in San Francisco. He is a Member of Technical Staff at Rivo, where he builds production voice AI agents, and a 5x hackathon winner with a granted patent and an EMNLP paper.',
  worksFor: { '@type': 'Organization', name: 'Rivo', url: 'https://www.rivofi.com/' },
  homeLocation: { '@type': 'Place', name: 'San Francisco, California' },
  alumniOf: [
    { '@type': 'CollegeOrUniversity', name: 'University of Minnesota, Twin Cities' },
    { '@type': 'CollegeOrUniversity', name: 'SRM Institute of Science and Technology' },
    { '@type': 'CollegeOrUniversity', name: 'Indian Institute of Technology Madras' },
  ],
  award: [
    'Top 10, Y Combinator AI Hackathon (LARK)',
    'Winner, ElevenHacks, Stripe x ElevenLabs (Living Photos)',
    '2nd Place, ElevenLabs x Replit Hackathon (FaceTime from Mars)',
    '3rd Place, ElevenHacks, ElevenLabs x Zed (Apartment 4B)',
    'Best Voice Agent, ElevenLabs x Firecrawl Hackathon (ScreenSense)',
    '4th overall, ElevenHacks Season 1',
    'Granted patent: Contactless Integrated Voting System (202341031598)',
  ],
  knowsAbout: [
    'Voice AI agents', 'AI agents', 'Model Context Protocol', 'Retrieval-augmented generation',
    'LiveKit', 'React', 'React Native', 'Next.js', 'TypeScript', 'Python', 'Three.js',
    'Product analytics', 'Growth engineering',
  ],
  sameAs: SAME_AS,
  // Already published on /about/ and /resume/.
  email: 'mailto:anirudhvasudevan11@gmail.com',
  ...extra,
});
