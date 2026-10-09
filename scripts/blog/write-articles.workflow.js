export const meta = {
  name: 'write-articles',
  description: 'Write, fact-check, and revise one deep-dive article per project from its source code',
  phases: [
    { title: 'Write', detail: 'one writer per project, grounded in the cloned repo' },
    { title: 'Check', detail: 'independent fact-check against the code + style rules' },
    { title: 'Revise', detail: 'writer fixes every flagged issue' },
  ],
}

// args: { projects: [{ repo, slug, title_hint, project, accent, award, live_url, repo_public, context, facts, related_repos, sensitivity }], date }
const { projects, date } = args
const REPO_ROOT = '/Users/anirudh/Desktop/webdev/portfolio'
const CLONES = '/private/tmp/claude-501/-Users-anirudh-Desktop-webdev-portfolio/02d0d5bb-ef3a-464f-a573-d90be0f90949/scratchpad/repos'

const STYLE = `VOICE AND STYLE (non-negotiable)
- First person, Anirudh Vasudevan telling the story of building this. Plain English at a normal reading level. Short sentences. Concrete nouns.
- Story shape, not a spec sheet: what was the moment or problem, what I decided, what I built, what broke, what I learned.
- NO em dashes or en dashes anywhere (no "—" or "–"). Use commas, periods, or parentheses instead. This is a hard rule.
- Do not use these words: delve, crucial, robust, comprehensive, nuanced, multifaceted, furthermore, moreover, additionally, pivotal, landscape, tapestry, underscore, foster, showcase, intricate, vibrant, seamless, leverage, harness, journey, testament, game-changer.
- No hype, no filler intro like "In today's world". Start with something specific.
- Technical depth is the point: name the real modules, files, functions, models, APIs, and data flow you read in the code. Show 2 to 4 short real code excerpts (10 lines max each, copied from the repo, with the file path as the code block's first comment line). Explain what they do.
- Be honest: hackathon code has shortcuts. Say what was hacky and what you would do differently.
- NEVER invent facts: no made-up user counts, metrics, timelines, teammates, or quotes. Numbers only if they appear in the repo or README (then say where they come from). If the hackathon result is given in the facts below, state it plainly; do not embellish.
- Do not expose secrets, API keys, tokens, or personal data found in the repo. If the repo is private, do not link it and say the source is private.
- Length: 1600 to 2400 words of body text.
- GEO (generative engine optimization) rules, because LLM crawlers will read this: within the first two paragraphs include one plain definitional sentence of the form "<Project> is a <what it is> that <what it does>, built by Anirudh Vasudevan for <context>." Use the project's name (not "it") in section openers. Every section should make sense if quoted alone. Prefer concrete statements over vague ones.`

const STRUCTURE = `ARTICLE FILE FORMAT
Write to ${REPO_ROOT}/content/articles/<slug>.md with this frontmatter (YAML), then the body in Markdown:
---
title: "<specific, human title; 45 to 70 chars; no colon-cliches>"
description: "<one sentence, 120 to 160 chars, what it is and why it matters>"
date: ${date}
slug: <slug>
project: "<short project name>"
tags: [<3 to 6 tags: technologies and themes, e.g. MCP, Voice AI, Three.js>]
award: "<exact award/result text if any, else omit this line>"
repo: <public GitHub URL, omit if private>
live: <live URL if one exists and is given in the facts, else omit>
accent: "<hex accent color>"
summary: "<2 sentence TL;DR, 200 to 320 chars>"
---
Body sections (use ## headings; pick natural, specific titles, these are the beats, in this order):
1. Opening: the specific moment or problem (2 to 3 short paragraphs) including the definitional sentence.
2. Why I built it this way: the decision. What options I considered (be honest, including "the obvious approach"), why I picked this one, and what constraint drove it (time, sponsor APIs, latency, cost, the demo). This is the "why" section and it must be concrete.
3. What I built: what the thing does, from the user's point of view, step by step.
4. Architecture: 1 paragraph, then the diagram image line exactly as: ![<caption>](/blog/diagrams/<slug>-architecture.svg) then 1 to 2 paragraphs walking through the diagram, then a Markdown table titled by a short intro sentence with columns | Layer | Choice | Why | (5 to 9 rows, real choices from the code).
5. How it works: the deep part. 3 to 5 subsections (###) on the real mechanisms, with the code excerpts. In the most important subsection include the second diagram line exactly as: ![<caption>](/blog/diagrams/<slug>-flow.svg) showing one end-to-end request or user action flowing through the system.
6. The hard parts: what broke, what I traded off, what was hacky.
7. Results: what happened (award, demo, what shipped). Facts only.
8. What I would do differently / what is next.
9. Key takeaways: 4 to 6 bullets, each a standalone engineering insight someone could reuse (not a summary of the article).
10. FAQ: heading exactly "## FAQ", then 3 to 5 questions as ### headings phrased the way someone would ask a search engine (e.g. "### How does <Project> keep voice latency low?"), each answered in 1 to 2 self-contained paragraphs that name the project.
11. Links: live demo and source (only what exists).

DIAGRAM FILES (two)
Write ${REPO_ROOT}/content/diagrams/<slug>-architecture.mmd: a mermaid flowchart (graph LR for pipelines, graph TD for hierarchies), 7 to 14 nodes, short node labels (max 4 words), detail on edge labels, subgraphs for boundaries (client / server / external APIs).
Write ${REPO_ROOT}/content/diagrams/<slug>-flow.mmd: one end-to-end flow. Either a mermaid flowchart (graph LR) of the steps, or a sequenceDiagram with 3 to 6 participants and 6 to 14 messages.
Rules for both: only ASCII in labels. No parentheses, quotes, brackets, semicolons, or the # character inside labels except the node shape syntax itself. Node ids like A, B, C. No "end" as a node id. Verify the syntax is valid mermaid (v11).`

const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
    unverifiable_claims: { type: 'array', items: { type: 'string' } },
    style_violations: { type: 'array', items: { type: 'string' } },
    word_count: { type: 'number' },
  },
  required: ['ok', 'issues', 'word_count'],
}

const WRITE_SCHEMA = {
  type: 'object',
  properties: {
    slug: { type: 'string' },
    title: { type: 'string' },
    word_count: { type: 'number' },
    files_written: { type: 'array', items: { type: 'string' } },
    key_claims: { type: 'array', items: { type: 'string' } },
  },
  required: ['slug', 'title', 'word_count', 'files_written', 'key_claims'],
}

const facts = (p) => `PROJECT FACTS (from a prior code scouting pass; treat as ground truth for context, verify details in the code)
- repo: anirxdh/${p.repo} (${p.repo_public ? 'public' : 'PRIVATE, do not link'}), local clone: ${CLONES}/${p.repo}
- project name: ${p.project}
- slug: ${p.slug}
- accent color: ${p.accent}
- award / result: ${p.award || 'none'}
- live URL: ${p.live_url || 'none (do not add a live link)'}
- FULL scouting notes: READ THE JSON FILE ${p.facts_path} FIRST. It holds the suggested title direction, context (hackathon, dates), what it is, architecture, notable engineering, demo assets, related repos (cloned next to this one under ${CLONES}/), and sensitivity flags (things you must not print).
${p.extra ? `- SPECIAL INSTRUCTIONS FOR THIS ARTICLE: ${p.extra}` : ''}
If the clone is missing, run: gh repo clone anirxdh/${p.repo} ${CLONES}/${p.repo} -- --depth 1`

const writePrompt = (p) => `You are writing a deep-dive engineering article for Anirudh Vasudevan's portfolio blog about one of his projects. Read the actual source code first, then write.

${facts(p)}

STEP 1: Explore the clone thoroughly: README, package/pyproject, entry points, core modules, API routes, prompts, models used, data stores, deployment config. Understand the real data flow before writing a word.
STEP 2: Write the article and the diagram file exactly per the format below.
STEP 3: Re-read your article and remove every em dash / en dash and banned word. Count words.

${STYLE}

${STRUCTURE}

Return the structured result with the key factual claims you made (each with the file that supports it).`

const checkPrompt = (p, w) => `You are an adversarial fact-checker and style editor for a technical blog article about a real code repository. Your job is to find every problem; assume there are some.

Article: ${REPO_ROOT}/content/articles/${p.slug}.md
Diagrams: ${REPO_ROOT}/content/diagrams/${p.slug}-architecture.mmd and ${REPO_ROOT}/content/diagrams/${p.slug}-flow.mmd
Repo clone: ${CLONES}/${p.repo}
Writer's key claims: ${JSON.stringify(w.key_claims)}${w.key_claims.length ? '' : ' (none supplied: this draft was written in an earlier run, so derive the claims from the article itself and verify each one)'}

Check, by reading the code yourself:
1. FACTS: every technical claim (modules, libraries, models, APIs, flows, numbers, awards) must be supported by the repo, the README, or the facts below. List anything unsupported or wrong as an issue with the fix. Any invented metric, user count, teammate, timeline, or quote is a blocking issue.
2. CODE EXCERPTS: each code block must exist in the repo essentially verbatim (minor trimming ok) with a correct file path comment. Flag fabricated or heavily altered snippets.
3. STYLE: count em dashes (—) and en dashes (–): any occurrence is a violation. Flag banned words: delve, crucial, robust, comprehensive, nuanced, multifaceted, furthermore, moreover, additionally, pivotal, landscape, tapestry, underscore, foster, showcase, intricate, vibrant, seamless, leverage, harness, journey, testament, game-changer. Flag hype or filler openings. Flag anything that reads like an AI summary rather than a person telling a story.
4. FRONTMATTER: title 45-70 chars, description 120-160 chars, date ${date}, slug ${p.slug}, tags 3-6, award matches "${p.award || ''}" exactly (or absent), repo absent if the repo is private, live URL only if real, summary 200-320 chars.
5. DIAGRAMS: both files exist; valid mermaid v11 syntax (flowchart or sequenceDiagram), ASCII-only labels, no parentheses/quotes/brackets/semicolons/# inside labels, no node id named "end"; the article references ![...](/blog/diagrams/${p.slug}-architecture.svg) exactly once and ![...](/blog/diagrams/${p.slug}-flow.svg) exactly once. The diagrams must match the code (no invented components).
6. LENGTH: 1600-2400 body words.
7. SECRETS: no API keys, tokens, emails of other people, or private data.
8. STRUCTURE: sections present in this order: opening with a definitional sentence naming the project and Anirudh Vasudevan; a "why this approach" decision section with real alternatives; what it does; architecture with the diagram and a | Layer | Choice | Why | table (5-9 rows); how it works with 3-5 ### subsections and 2-4 real code excerpts; hard parts; results; what I would do differently; "Key takeaways" bullets (4-6, reusable insights); "## FAQ" with 3-5 "### question" entries each answered in self-contained paragraphs; links. Flag any missing or thin section.

Context facts:
${facts(p)}

ok=true only if there are zero blocking issues and at most trivial style nits. Return every issue as an actionable instruction.`

const revisePrompt = (p, check) => `You are revising a technical blog article to fix reviewer issues. Edit the files in place (do not rewrite from scratch unless an issue demands it), keep the voice and structure, and keep everything grounded in the repo.

Article: ${REPO_ROOT}/content/articles/${p.slug}.md
Diagrams: ${REPO_ROOT}/content/diagrams/${p.slug}-architecture.mmd and ${REPO_ROOT}/content/diagrams/${p.slug}-flow.mmd
Repo clone: ${CLONES}/${p.repo}

Issues to fix (fix ALL of them):
${check.issues.map((i, n) => `${n + 1}. ${i}`).join('\n')}
${check.style_violations?.length ? `\nStyle violations:\n${check.style_violations.map((s) => `- ${s}`).join('\n')}` : ''}
${check.unverifiable_claims?.length ? `\nUnverifiable claims (remove or ground them in the code):\n${check.unverifiable_claims.map((s) => `- ${s}`).join('\n')}` : ''}

${STYLE}

${STRUCTURE}

After editing, re-read the whole article once more and remove any remaining em dash / en dash or banned word. Return the structured result.`

const results = await pipeline(
  projects,
  (p) =>
    p.has_draft
      ? Promise.resolve({ slug: p.slug, title: '', word_count: 0, files_written: [], key_claims: [] })
      : agent(writePrompt(p), { label: `write:${p.slug}`, phase: 'Write', schema: WRITE_SCHEMA, effort: 'high' }),
  async (w, p) => {
    if (!w) return null
    // Stored first-pass report from the previous run: revise from it before spending a fresh check.
    let check = p.issues_path
      ? { ok: false, issues: [`Read the stored fact-check report for this article in the JSON file ${p.issues_path}: key "${p.slug}", use the LAST entry of its "checks" array (fields: issues, style_violations, unverifiable_claims). Fix every item that is still present in the article (some may already be fixed; verify each against the file).`], style_violations: [], unverifiable_claims: [] }
      : await agent(checkPrompt(p, w), { label: `check:${p.slug}`, phase: 'Check', schema: CHECK_SCHEMA, effort: 'high' })
    let rounds = 0
    while (check && !check.ok && rounds < 3) {
      rounds += 1
      const revised = await agent(revisePrompt(p, check), { label: `revise:${p.slug}#${rounds}`, phase: 'Revise', schema: WRITE_SCHEMA, effort: 'high' })
      if (!revised) break
      check = await agent(checkPrompt(p, revised), { label: `recheck:${p.slug}#${rounds}`, phase: 'Check', schema: CHECK_SCHEMA, effort: 'high' })
    }
    return { slug: p.slug, title: w.title, rounds, final_ok: !!check?.ok, remaining_issues: check?.issues || [], word_count: check?.word_count || w.word_count }
  },
)

const done = results.filter(Boolean)
log(`${done.length}/${projects.length} articles written; ${done.filter((r) => r.final_ok).length} passed fact-check clean`)
return { articles: done, failed: projects.filter((p) => !done.some((d) => d.slug === p.slug)).map((p) => p.slug) }
