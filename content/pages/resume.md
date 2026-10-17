---
# Web version of public/assets/anirudh-vasudevan-resume.pdf, rendered at /resume/ by scripts/build-blog.mjs.
# Keep it in sync with the PDF, with two deliberate exceptions: no phone number (privacy) and no
# Blue Hex Software role (removed from the website). Bullets accept inline Markdown (bold, links).
# Links to /blog/<slug>/ are dropped automatically while that article is still a draft.
# Optional `fullName` on a school is used in structured data only.
title: "Resume"
description: "The resume of Anirudh Vasudevan, a full-stack and AI engineer in San Francisco: Rivo, Nonlinear, RUA, a granted patent, an EMNLP paper, and education."
date: 2026-10-17
slug: resume
pdf: /assets/anirudh-vasudevan-resume.pdf
name: Anirudh Vasudevan
headline: Full-stack and AI engineer in San Francisco. Member of Technical Staff at Rivo.
pronouns: He/Him
email: anirudhvasudevan11@gmail.com
links:
  - label: Website
    url: https://anirudhvasudevan.com/
  - label: LinkedIn
    url: https://www.linkedin.com/in/anirudhvasudev/
  - label: GitHub
    url: https://github.com/anirxdh

education:
  - school: University of Minnesota, Twin Cities
    location: MN, USA
    degree: Master of Science in Computer Science
    gpa: 3.89/4
    dates: 2023 to 2025
  - school: SRM Institute of Science and Technology
    location: TN, India
    degree: Bachelor of Technology in Computer Science and Engineering
    gpa: 9.2/10
    dates: 2019 to 2023
  - school: IIT Madras
    fullName: Indian Institute of Technology Madras
    location: TN, India
    degree: Diploma in Data Science
    dates: 2021 to 2023

skills:
  - group: Languages and frameworks
    items: [JavaScript, TypeScript, Python, React, React Native, Next.js, Flask]
  - group: Database and backend
    items: [SQL, PostgreSQL, Supabase, Firebase, RESTful APIs, Pinecone, Microservices Architecture]
  - group: AI and machine learning
    items: [LangChain, LangGraph, RAG, Agents, Fine-tuning, MCP, Ollama, LiveKit, Hugging Face]
  - group: Analytics and growth
    items: [Google Tag Manager, GA4, Mixpanel, Statsig, Meta Ads, TikTok Ads, Reddit Ads, Google Ads]
  - group: Cloud and DevOps
    items: [AWS, Docker, Git, GitHub, Figma, Agile, System Design, CI/CD, Playwright, Maestro, Jest]

experience:
  - org: Rivo
    url: https://www.rivofi.com/
    location: San Francisco, CA, US
    role: Member of Technical Staff
    dates: Dec 2025 to Present
    bullets:
      - Deployed production conversational and agentic AI in Python on cloud microservices, plus LiveKit voice agents that capture leads and an internal support chatbot.
      - Implemented TanStack Query caching with endpoint-level invalidation, cutting homepage load time **87%** and improving p95 across critical flows.
      - Own and maintain the iOS and web apps on one React Native codebase migrated from Next.js, hardened with Playwright and Maestro E2E tests and Sentry monitoring with testing workflows.
      - Own product analytics and growth for a B2C fintech app, running full-funnel tracking and paid ads across TikTok, Meta, Reddit, and Google.
      - Shipped a scalable, admin-configurable referral system the team extends without engineering.
      - Built an automated pipeline that generates UGC-style video ads end to end.
  - org: Nonlinear
    url: https://www.nonlinear.build/
    location: San Francisco, CA, US
    role: Founding Engineer
    dates: Aug 2025 to Dec 2025
    bullets:
      - Engineered the Universal Node System for AI workflows with dynamic property handling and a Zustand-powered state caching, reducing configuration time by 45% and enabling faster feature rollout across the platform.
      - Built Agentic RAG pipelines powering context-aware AI agents and a Teams bot, reducing retrieval latency by 60% and tripling user engagement post-launch.

projects:
  - name: RUA
    subtitle: Privacy-First AI Assistant for Caregivers
    links:
      - label: Website
        url: https://rua-care.netlify.app
      - label: Write-up
        url: /blog/rua-caregiver-app-offline-first/
    bullets:
      - Solo-built and shipped an iOS (TestFlight) and web app for family caregivers, with an integrated voice agent for the people in their care and a privacy-first design that keeps records encrypted and grounded to the user's own data.
      - Built the paperwork automation as configurable node-and-edge workflows that draft insurance appeals, prior-auth packets, and Medicaid renewals, cutting a denial appeal from 3.5 hours to 12 minutes.
      - "Shipped the core features: medication and inventory tracking with refill runway, ER sheets, appointment prep, and Ask RUA, the AI assistant that answers from the user's records."
  - name: YouTube Shorts Factory
    subtitle: Automated UGC Video Engine and Dashboard
    links:
      - label: Write-up
        url: /blog/youtube-shorts-factory-automated-pipeline/
    bullets:
      - Built an end-to-end pipeline that turns a topic into a published Short (LLM scripting, Fal.ai image and video, ElevenLabs TTS, Whisper subtitles), fully auto-uploaded.
      - Runs 4 channels on daily cron via GitHub Actions, with a review-and-approve dashboard.

achievements:
  - "**Contactless Integrated Voting System**, granted patent. Patent ID 202341031598, May 2023. [Patent link](https://drive.google.com/file/d/1l-Lth10_zWK-jLUpnK5FIKWJEJR-O6oq/view?usp=sharing), [how CIVS works](/blog/civs-contactless-voting-patent/)."
  - "*ConsensusDrift: Semantic Salience Can Override Majority Evidence in LLM Aggregation*, **EMNLP 2026 (Main Conference)**."
  - "**5x Hackathon Winner**, with multiple ElevenLabs sponsor prizes plus Replit and Zed. [See the projects](/projects/)."
  - "[*A Deep CNN for Remote Life Activities Detection using FMCW Radar under Realistic Environments*](https://link.springer.com/chapter/10.1007/978-3-031-31153-6_32)."
---
