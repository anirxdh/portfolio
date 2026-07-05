export const navLinks = [
    {
      id: 1,
      name: 'Home',
      href: '#home',
    },
    {
      id: 2,
      name: 'About',
      href: '#about',
    },
    {
      id: 3,
      name: 'Hackathons',
      href: '#hackathons',
    },
    {
      id: 4,
      name: 'Work',
      href: '#work',
    },
    {
      id: 5,
      name: 'Contact',
      href: '#contact',
    },
    {
      id: 6,
      name: 'Explore',
      href: 'https://av-world.replit.app/',
      external: true,
    },
  ];
  
  export const myProjects = [
    {
      title: 'LARK — Multi-Agent Orchestration MCP',
      desc: '🏆 Top 10 at the Y Combinator AI Hackathon. A hierarchical multi-agent system built on the Model Context Protocol (MCP) that turns ChatGPT and Claude into action platforms.',
      subdesc:
        'A unified parent MCP orchestrator routes across three specialized child servers (media, messaging, telephony) with dynamic tool selection — making real Twilio calls and group calls, enabling cross-model AI-to-AI messaging, and handling music and YouTube, all from a phone-like widget inside chat. Built with TypeScript, React 19, and Twilio, and deployed via mcp-use.',
      href: 'https://github.com/anirxdh/YC-hack',
      textures: ['/textures/project/lark-1.jpg', '/textures/project/lark-2.jpg'],
      logo: '/assets/project-logo5.png',
      logoStyle: {
        backgroundColor: '#1C1A43',
        border: '0.2px solid #252262',
        boxShadow: '0px 0px 60px 0px #635BFF4D',
      },
      spotlight: '/assets/spotlight5.png',
      tags: [
        { id: 1, name: 'TypeScript', path: '/assets/typescript.png' },
        { id: 2, name: 'React.js', path: '/assets/react.svg' },
        { id: 3, name: 'TailwindCSS', path: '/assets/tailwindcss.png' },
      ],
    },
    {
      title: 'Apartment 4B — Horror Mystery Game',
      desc: '🥉 3rd place at ElevenHacks (ElevenLabs × Zed). A first-person lo-fi horror mystery game built end-to-end in 36 hours.',
      subdesc:
        'Explore procedurally generated apartments, collect voice-acted cassette tapes, and solve sequential lock puzzles under a ticking timer to unravel the mystery. Built with React Three Fiber, Three.js, TypeScript, Zustand, and Howler.js, with ElevenLabs for voice and sound — featuring save state, multiple endings, and a PS1-style aesthetic.',
      href: 'https://apartment-4b.netlify.app',
      textures: ['/textures/project/apartment4b-1.jpg', '/textures/project/apartment4b-2.jpg'],
      logo: '/assets/project-logo1.png',
      logoStyle: {
        backgroundColor: '#2A1816',
        border: '0.2px solid #36201D',
        boxShadow: '0px 0px 60px 0px #AA3C304D',
      },
      spotlight: '/assets/spotlight1.png',
      tags: [
        { id: 1, name: 'TypeScript', path: '/assets/typescript.png' },
        { id: 2, name: 'React.js', path: '/assets/react.svg' },
        { id: 3, name: 'TailwindCSS', path: '/assets/tailwindcss.png' },
      ],
    },
    {
      title: 'Living Photos — Memories in 3D',
      desc: 'An ElevenHacks project that turns a single old photograph into a walkable 3D scene, with the voice of someone you loved playing softly inside.',
      subdesc:
        'Upload a photo and step into it: Gaussian-splat 3D rendering, consent-gated voice cloning, and procedural ambient soundscapes bring memories to life. Built with Next.js 15, React 19, TypeScript, React Three Fiber, Drizzle, Postgres, ElevenLabs, and Stripe.',
      href: 'https://living-photos-rust.vercel.app/',
      textures: ['/textures/project/livingphotos-1.jpg', '/textures/project/livingphotos-2.jpg', '/textures/project/livingphotos-3.jpg'],
      logo: '/assets/project-logo2.png',
      logoStyle: {
        backgroundColor: '#13202F',
        border: '0.2px solid #17293E',
        boxShadow: '0px 0px 60px 0px #2F6DB54D',
      },
      spotlight: '/assets/spotlight2.png',
      tags: [
        { id: 1, name: 'TypeScript', path: '/assets/typescript.png' },
        { id: 2, name: 'React.js', path: '/assets/react.svg' },
        { id: 3, name: 'TailwindCSS', path: '/assets/tailwindcss.png' },
      ],
    },
    {
      title: 'FaceTime from Mars',
      desc: '🥈 2nd place at the ElevenLabs × Replit hackathon. Real-time voice conversations with AI colonists living on Mars in the year 2159.',
      subdesc:
        'A walkie-talkie interface lets you talk to three distinct AI characters with unique ElevenLabs voices, set against an interactive 3D Mars with radio effects and ambient space audio. Built with Next.js, React Three Fiber, FastAPI, Claude, and ElevenLabs.',
      href: 'https://facetime-from-mars-2158--anirxdh.replit.app/',
      textures: ['/textures/project/facetime-1.jpg', '/textures/project/facetime-2.jpg', '/textures/project/facetime-3.jpg'],
      logo: '/assets/project-logo3.png',
      logoStyle: {
        backgroundColor: '#2E1912',
        border: '0.2px solid #4A2A17',
        boxShadow: '0px 0px 60px 0px #E0662F4D',
      },
      spotlight: '/assets/spotlight3.png',
      tags: [
        { id: 1, name: 'TypeScript', path: '/assets/typescript.png' },
        { id: 2, name: 'React.js', path: '/assets/react.svg' },
        { id: 3, name: 'TailwindCSS', path: '/assets/tailwindcss.png' },
      ],
    },
    {
      title: 'ScreenSense — Voice Browser Agent',
      desc: 'An ElevenLabs × Firecrawl hackathon build: a Chrome extension that turns voice commands into autonomous browser actions.',
      subdesc:
        'Hold a key, speak a command, and an AI agent clicks, fills forms, and completes multi-step workflows across sites — e.g. “add the cheapest USB-C cable to my Amazon cart.” Powered by Claude on AWS Bedrock (multimodal vision), ElevenLabs speech, and Firecrawl, on a React + FastAPI stack.',
      href: 'https://screen-sense-anirudh.netlify.app/',
      textures: ['/textures/project/screensense-1.jpg', '/textures/project/screensense-2.jpg', '/textures/project/screensense-3.jpg'],
      logo: '/assets/logo-screensense.png',
      logoStyle: {
        backgroundColor: '#12312A',
        border: '0.2px solid #1C4A3E',
        boxShadow: '0px 0px 60px 0px #2FB5834D',
      },
      spotlight: '/assets/spotlight4.png',
      tags: [
        { id: 1, name: 'TypeScript', path: '/assets/typescript.png' },
        { id: 2, name: 'React.js', path: '/assets/react.svg' },
        { id: 3, name: 'TailwindCSS', path: '/assets/tailwindcss.png' },
      ],
    },
    {
      title: 'TalkativePDF — AI PDF Chat SaaS',
      desc: 'A production SaaS that lets you chat with any PDF, using GPT-4, LangChain, and Pinecone for fast, semantic, RAG-based document Q&A.',
      subdesc:
        'Built end-to-end with Next.js, TypeScript, Firebase storage, Clerk auth, and Stripe subscriptions. A RAG architecture with document chunking improved query response time by ~87%, and the app handled 500+ document uploads during internal testing.',
      href: 'https://talkative-pdf.vercel.app/',
      textures: ['/textures/project/talkativepdf-1.jpg', '/textures/project/talkativepdf-2.jpg'],
      logo: '/assets/project-logo5.png',
      logoStyle: {
        backgroundColor: '#0E1F38',
        border: '0.2px solid #0E2D58',
        boxShadow: '0px 0px 60px 0px #2F67B64D',
      },
      spotlight: '/assets/spotlight5.png',
      tags: [
        { id: 1, name: 'TypeScript', path: '/assets/typescript.png' },
        { id: 2, name: 'React.js', path: '/assets/react.svg' },
        { id: 3, name: 'TailwindCSS', path: '/assets/tailwindcss.png' },
      ],
    },
    {
      title: 'CIVS — Contactless Voting System',
      desc: 'A contactless voting system — the basis of a granted patent — for secure, hygienic, and accessible elections using speech and hand-gesture input.',
      subdesc:
        'Built with React, Flask, and REST APIs alongside user-research-driven Figma prototypes, CIVS supports real-time interaction, ballot rectification, and accessibility for physically challenged voters. It became the basis for a granted patent (ID 202341031598).',
      href: 'https://github.com/anirxdh/CIVS',
      textures: ['/textures/project/civs-1.jpg', '/textures/project/civs-2.jpg'],
      logo: '/assets/project-logo2.png',
      logoStyle: {
        backgroundColor: '#13202F',
        border: '0.2px solid #17293E',
        boxShadow: '0px 0px 60px 0px #2F6DB54D',
      },
      spotlight: '/assets/spotlight2.png',
      tags: [
        { id: 1, name: 'React.js', path: '/assets/react.svg' },
        { id: 2, name: 'flask', path: '/assets/flask.png' },
        { id: 3, name: 'Figma', path: '/assets/figma.svg' },
      ],
    },
  ];
  
  export const calculateSizes = (isSmall, isMobile, isTablet) => {
    return {
      deskScale: isSmall ? 0.05 : isMobile ? 0.06 : 0.065,
      deskPosition: isMobile ? [0.5, -4.5, 0] : [0.25, -5.5, 0],
      cubePosition: isSmall ? [4, -5, 0] : isMobile ? [5, -5, 0] : isTablet ? [5, -5, 0] : [9, -5.5, 0],
      reactLogoPosition: isSmall ? [3, 4, 0] : isMobile ? [5, 4, 0] : isTablet ? [5, 4, 0] : [12, 3, 0],
      ringPosition: isSmall ? [-5, 7, 0] : isMobile ? [-10, 10, 0] : isTablet ? [-12, 10, 0] : [-24, 10, 0],
      targetPosition: isSmall ? [-5, -10, -10] : isMobile ? [-9, -10, -10] : isTablet ? [-11, -7, -10] : [-13, -13, -10],
    };
  };
 

  export const workExperiences = [
    {
      id: 1,
      name: 'Rivo | San Francisco, CA',
      pos: 'Member of Technical Staff',
      duration: 'December 2025 – Present',
      title: "At Rivo (a San Francisco fintech), I build production conversational AI — primarily voice agents — in Python across a cloud-based microservices stack. I implemented full caching (TanStack Query with endpoint-level invalidation) that cut homepage load time by ~87% and improved p95 latency, and ship agentic AI workflows for personalized client messaging and internal automation. I own end-to-end quality and growth: Playwright and Maestro E2E coverage, Jest, and CI/CD hardening, plus a full observability and product-analytics stack — Sentry, Statsig, Mixpanel, GA4, and Microsoft Clarity — for user-behavior tracking and growth funnels. I also maintain the marketing site in Webflow (CMS) and run Meta Ads optimization.",
      icon: '/assets/rivo.png',
      animation: 'clapping',
    },
    {
      id: 2,
      name: 'Nonlinear | San Francisco, CA',
      pos: 'Founding Engineer',
      duration: 'August 2025 – December 2025',
      title: "As Founding Engineer, I engineered the Universal Node System for AI workflows with dynamic property handling, mustache variable parsing, and Zustand-powered state caching, cutting configuration time by 45%. I built Agentic RAG pipelines powering context-aware AI agents and a Microsoft Teams bot (published on the Teams Store), reducing retrieval latency by 60% and tripling user engagement. Delivered production features with Next.js 15, React 19, TypeScript, tRPC, Redux Toolkit, Zustand, Drizzle ORM, PostgreSQL, Tailwind CSS, Radix UI, AWS, and integrated OpenAI, Anthropic, and Gemini models.",
      icon: '/assets/Nonlinear.png',
      animation: 'salute',
    },
    {
      id: 3,
      name: 'University of Minnesota | Twin Cities, MN',
      pos: 'Graduate Research Assistant',
      duration: 'January 2024 – July 2025',
      title: "As a Research Assistant at the Institute of Health Informatics, I performed data processing, causal analysis, and predictive modeling in Python to address K-12 educational and health inequities in Minnesota. I collaborated with stakeholders to implement analytical methodologies within a high-security, privacy-compliant framework.",
      icon: '/assets/university.png',
      animation: 'victory',
    },
  ];

  export const stats = [
    { value: 5, suffix: '×', label: 'Hackathon Wins' },
    { value: 2, suffix: '', label: 'Patent & Publication' },
    { value: 7, suffix: '', label: 'Projects Shipped' },
    { value: 200, suffix: '+', label: 'LeetCode Solved' },
  ];

  export const hackathons = [
    {
      id: 1,
      result: 'Top 10',
      event: 'Y Combinator AI Hackathon',
      project: 'LARK — Multi-Agent Orchestration MCP',
      blurb: 'A hierarchical multi-agent system on MCP that turns ChatGPT & Claude into action platforms.',
      href: 'https://github.com/anirxdh/YC-hack',
      accent: '#f97316',
    },
    {
      id: 2,
      result: '2nd Place',
      event: 'ElevenLabs × Replit Hackathon',
      project: 'FaceTime from Mars',
      blurb: 'Real-time voice calls with AI colonists on Mars in 2159, over an interactive 3D world.',
      href: 'https://facetime-from-mars-2158--anirxdh.replit.app/',
      accent: '#e0662f',
    },
    {
      id: 3,
      result: '3rd Place',
      event: 'ElevenHacks · ElevenLabs × Zed',
      project: 'Apartment 4B',
      blurb: 'A first-person lo-fi horror mystery game built end-to-end in 36 hours.',
      href: 'https://apartment-4b.netlify.app',
      accent: '#aa3c30',
    },
    {
      id: 4,
      result: 'Built',
      event: 'ElevenHacks · Stripe × ElevenLabs',
      project: 'Living Photos',
      blurb: 'Turns a single old photo into a walkable 3D scene with the voice of a loved one inside.',
      href: 'https://living-photos-rust.vercel.app/',
      accent: '#2f6db5',
    },
    {
      id: 5,
      result: 'Built',
      event: 'ElevenLabs × Firecrawl Hackathon',
      project: 'ScreenSense — Voice Browser Agent',
      blurb: 'A Chrome extension that turns voice commands into autonomous browser actions.',
      href: 'https://screen-sense-anirudh.netlify.app/',
      accent: '#2fb583',
    },
  ];