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
      name: 'Work',
      href: '#work',
    },
    {
      id: 4,
      name: 'Contact',
      href: '#contact',
    },
  ];
  
  export const myProjects = [
    {
      title: 'BlewIt - A Reddit Clone',
      desc: 'BlewIt is a full-stack social media platform inspired by Reddit, allowing multiple users to create, interact, and manage their content seamlessly.',
      subdesc: 'Built using Flask, PostgreSQL, HTML, CSS, and JavaScript, BlewIt supports image uploads, commenting, upvotes/downvotes, and category-based content following. Integrated authentication via Auth0 for a secure user experience.',
      href: 'https://blewit.onrender.com/',
      texture: '/textures/project/project1.mp4',
      logo: '/assets/BlewIt.png',
      logoStyle: {
        backgroundColor: '#2A1816',
        border: '0.2px solid #36201D',
        boxShadow: '0px 0px 60px 0px #AA3C304D',
      },
      spotlight: '/assets/spotlight1.png',
      tags: [
        {
          id: 1,
          name: 'React.js',
          path: '/assets/react.svg',
        },
        {
          id: 2,
          name: 'Bootstrap',
          path: 'assets/Bootstrap.png',
        },
        {
          id: 3,
          name: 'flask',
          path: '/assets/flask.png',
        },
        {
          id: 4,
          name: 'auth0',
          path: '/assets/auth0.png',
        },
      ],
    },
    {
      title: 'CIVS - Contactless Integrated Voting System',
      desc: 'A patent-pending voting system designed for secure, hygienic, and accessible elections, featuring speech recognition and hand gesture input for enhanced usability.',
      subdesc: 'Developed using React, Flask, and RESTful APIs, CIVS ensures real-time interaction, ballot rectification, and accessibility for physically challenged individuals. Designed with user research-driven Figma prototypes.',
      href: 'https://github.com/anirxdh/CIVS',
      texture: '/textures/project/project2.mp4',
      logo: '/assets/project-logo2.png',
      logoStyle: {
        backgroundColor: '#13202F',
        border: '0.2px solid #17293E',
        boxShadow: '0px 0px 60px 0px #2F6DB54D',
      },
      spotlight: '/assets/spotlight2.png',
      tags: [
        {
          id: 1,
          name: 'React.js',
          path: '/assets/react.svg',
        },
        {
          id: 2,
          name: 'TailwindCSS',
          path: 'assets/tailwindcss.png',
        },
        {
          id: 3,
          name: 'TypeScript',
          path: '/assets/typescript.png',
        },
        {
          id: 4,
          name: 'Figma',
          path: '/assets/figma.svg',
        },
      ],
    },
    {
      title: 'SettleIn - University Transition UI',
    desc: 'SettleIn is a mobile app designed to support international students at the University of Minnesota by streamlining key onboarding tasks and enhancing social integration.',
    subdesc: 'Developed with a comprehensive design process including user research, personas, heuristic evaluations, and cognitive walkthroughs. The app guides students in finding housing, completing paperwork, and building peer connections.',
    href: 'https://www.figma.com/proto/4jpCPHsjQomd4FouaDapLv/SettleIn?page-id=0%3A1&node-id=11-4&p=f&viewport=531%2C327%2C0.07&t=3MOfR7hJHdPX5VPa-1&scaling=scale-down&content-scaling=fixed&starting-point-node-id=11%3A4',
      texture: '/textures/project/project3.mp4',
      logo: '/assets/project-logo3.png',
      logoStyle: {
        backgroundColor: '#60f5a1',
        background:
          'linear-gradient(0deg, #60F5A150, #60F5A150), linear-gradient(180deg, rgba(255, 255, 255, 0.9) 0%, rgba(208, 213, 221, 0.8) 100%)',
        border: '0.2px solid rgba(208, 213, 221, 1)',
        boxShadow: '0px 0px 60px 0px rgba(35, 131, 96, 0.3)',
      },
      spotlight: '/assets/spotlight3.png',
      tags: [
        {
          id: 1,
          name: 'Figma',
          path: '/assets/figma.svg',
        },
        {
          id: 2,
          name: 'exaclidraw',
          path: 'assets/exaclidraw.png',
        }
      ],
    },
    {
      title: 'DeepFake Image Classification',
    desc: 'An AI-powered deepfake detection system leveraging deep learning techniques like ResNext and LSTM to identify manipulated videos.',
    subdesc: 'Using transfer learning, the pretrained ResNext CNN extracts feature vectors, which are further analyzed by an LSTM layer for accurate classification of deepfake content.',
    href: 'https://github.com/anirxdh/Deep_Fake_classification',
      texture: '/textures/project/project4.mp4',
      logo: '/assets/project-logo4.png',
      logoStyle: {
        backgroundColor: '#0E1F38',
        border: '0.2px solid #0E2D58',
        boxShadow: '0px 0px 60px 0px #2F67B64D',
      },
      spotlight: '/assets/spotlight4.png',
      tags: [
        {
          id: 1,
          name: 'React.js',
          path: '/assets/react.svg',
        },
        {
          id: 2,
          name: 'TailwindCSS',
          path: 'assets/tailwindcss.png',
        },
        {
          id: 3,
          name: 'TypeScript',
          path: '/assets/typescript.png',
        },
  
      ],
    },
    // {
    //   title: 'Imaginify - AI Photo Manipulation App',
    //   desc: 'Imaginify is a groundbreaking Software-as-a-Service application that empowers users to create stunning photo manipulations using AI technology. With features like AI-driven image editing, a payments system, and a credits-based model.',
    //   subdesc:
    //     'Built with Next.js 14, Cloudinary AI, Clerk, and Stripe, Imaginify combines cutting-edge technology with a user-centric approach. It can be turned into a side income or even a full-fledged business.',
    //   href: 'https://www.youtube.com/watch?v=Ahwoks_dawU',
    //   texture: '/textures/project/project5.mp4',
    //   logo: '/assets/project-logo5.png',
    //   logoStyle: {
    //     backgroundColor: '#1C1A43',
    //     border: '0.2px solid #252262',
    //     boxShadow: '0px 0px 60px 0px #635BFF4D',
    //   },
    //   spotlight: '/assets/spotlight5.png',
    //   tags: [
    //     {
    //       id: 1,
    //       name: 'React.js',
    //       path: '/assets/react.svg',
    //     },
    //     {
    //       id: 2,
    //       name: 'TailwindCSS',
    //       path: 'assets/tailwindcss.png',
    //     },
    //     {
    //       id: 3,
    //       name: 'TypeScript',
    //       path: '/assets/typescript.png',
    //     },
    //     {
    //       id: 4,
    //       name: 'Framer Motion',
    //       path: '/assets/framer.png',
    //     },
    //   ],
    // },
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
      name: 'Nonlinear | San Francisco, CA',
      pos: 'AI Engineer',
      duration: 'August 2025 – Present',
      title: "Engineered the Universal Node System for AI workflows, enabling dynamic property handling, mustache variable parsing, and seamless frontend–backend synchronization. Created AI agents for workflow automation and developed a Microsoft Teams bot, successfully published on the Teams Store. Delivered production-grade features using Next.js 15, React 19, TypeScript, tRPC, Redux Toolkit, Zustand, Drizzle ORM, PostgreSQL, Tailwind CSS, Radix UI, AWS, and integrated OpenAI, Anthropic, and Gemini models.",
      icon: '/assets/Nonlinear.png',
      animation: 'clapping',
    },
    {
      id: 2,
      name: 'University of Minnesota | Twin Cities, MN',
      pos: 'Graduate Research Assistant',
      duration: 'January 2024 – July 2025',
      title: "As a Research Assistant at the Institute of Health Informatics, I conduct data processing, causal analysis, and predictive modeling to address K-12 educational and health inequities in Minnesota. I collaborate with stakeholders to implement analytical methodologies in Python within a high-security framework.",
      icon: '/assets/university.png',
      animation: 'victory',
    },
    {
      id: 3,
      name: 'Blue Hex Software | Chennai, Tamil Nadu',
      pos: 'Python Intern',
      duration: 'September 2021 – March 2022',
      title: "Built an OCR application using Python and Flask for automated data extraction from PDFs. Integrated SQL for optimized data storage and retrieval while contributing to deployment and version control processes using Git/GitHub.",
      icon: '/assets/bhs.png',
      animation: 'clapping',
    },
  ];