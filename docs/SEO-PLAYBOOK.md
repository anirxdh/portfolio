# SEO and GEO playbook: make "Anirudh Vasudevan" yours

Goal: when anyone searches **Anirudh Vasudevan** or asks an AI assistant **who is Anirudh Vasudevan**, the first page and the answer are about you, and every fact matches the site.

The site already does its part: the homepage, `/about/` and `/resume/` carry one Person entity with the same id, facts and profile links (`scripts/blog/person.mjs`), `/projects/` and every article point at that same Person as the creator and author, and there is a sitemap, an RSS feed and `/llms.txt` for AI crawlers. What is left happens outside the repo, in your accounts. This file is the checklist, in priority order. Each step has the clicks and the text to paste.

Menus on these sites move around. If a label here does not match what you see, search the settings page for the field name in **bold**.

## The order

| # | Step | Time | Why it matters |
|---|---|---|---|
| 1 | Google Search Console | 20 min once | Tells Google the site is yours, gets the key pages indexed, and later helps you claim a knowledge panel |
| 2 | Request indexing for the profile pages | 10 min once | Puts `/about/` and friends in front of Google now instead of whenever it gets to them |
| 3 | Bing Webmaster Tools | 10 min once | Bing's index feeds Microsoft Copilot and DuckDuckGo, and ChatGPT search draws on it too |
| 4 | IndexNow | 1 min per deploy | Tells Bing and others the moment a page changes |
| 5 | Make every profile say the same thing | 1 to 2 hours once | Search engines and AI models decide who "Anirudh Vasudevan" is by matching profiles. Same name, photo, title and link everywhere is the strongest signal you control |
| 6 | Syndicate one article a week | 20 min a week | Each copy on DEV, Hashnode and Medium is another page with your name on it, linking home |
| 7 | Knowledge panel | later | Once Google shows one, claim it |
| 8 | Measure | 15 min a week | Know what is working |

The **Bio kit** at the end has the bios in four lengths, first and third person. Use those words everywhere so every profile tells the same story.

## 1. Google Search Console (domain property)

A domain property covers `https://`, `http://` and `www.` in one place. You prove you own the domain with a DNS record at GoDaddy.

1. Go to `https://search.google.com/search-console` and sign in with the Google account you want to own the site (keep using this one account for everything Google).
2. Click the property menu at the top left, then **Add property**.
3. In the left box, **Domain**, type `anirudhvasudevan.com` and click **Continue**.
4. Google shows a **TXT record** that starts with `google-site-verification=`. Click **Copy**.
   - If the provider list offers **GoDaddy**, you can pick it and click **Start verification**; GoDaddy asks you to sign in and adds the record for you. Then skip to step 7.
5. In another tab, go to `https://dcc.godaddy.com/control/portfolio`, sign in, click `anirudhvasudevan.com`, then **DNS** (or **Manage DNS**).
6. Click **Add New Record** and fill in:
   - **Type:** `TXT`
   - **Name:** `@`
   - **Value:** the `google-site-verification=...` text you copied
   - **TTL:** leave the default
   
   Click **Save**. Do not edit or delete the existing records that point the domain at Netlify.
   
   If GoDaddy says the domain uses other nameservers (names ending in `nsone.net` mean Netlify DNS), add the same TXT record in Netlify instead: Netlify, **Domains**, `anirudhvasudevan.com`, **Add new record**.
7. Back in Search Console, click **Verify**. If it fails, wait 15 minutes and click **Verify** again. DNS can take up to an hour.
8. Submit the sitemap. In the left menu, under **Indexing**, click **Sitemaps**. In **Add a new sitemap**, paste:

   ```text
   https://anirudhvasudevan.com/sitemap.xml
   ```

   Click **Submit**. The status usually turns to **Success** within a day. The sitemap lists the homepage, the profile pages, the Writing index, every topic page and every article.

## 2. Request indexing for the pages that answer "who is"

Search Console lets you ask Google to crawl a page now. There is a daily limit, so do these first, in this order:

```text
https://anirudhvasudevan.com/
https://anirudhvasudevan.com/about/
https://anirudhvasudevan.com/resume/
https://anirudhvasudevan.com/projects/
https://anirudhvasudevan.com/hackathons/
https://anirudhvasudevan.com/research/
https://anirudhvasudevan.com/blog/
```

`/hackathons/` and `/research/` are new pages. Open each one in a browser first and skip any that shows the 404 page until it is deployed.

For each URL:

1. Paste it into the search bar at the very top of Search Console (**Inspect any URL**) and press Enter.
2. Wait for the result. If it says **URL is not on Google**, or the page changed recently, click **Request indexing**.
3. Wait for **Indexing requested**, then do the next one.

After the profile pages, do the articles about hackathon wins and the patent the same way, a few a day:

```text
https://anirudhvasudevan.com/blog/lark-multi-agent-mcp/
https://anirudhvasudevan.com/blog/living-photos-gaussian-splats/
https://anirudhvasudevan.com/blog/facetime-from-mars/
https://anirudhvasudevan.com/blog/screensense-voice-browser-agent/
https://anirudhvasudevan.com/blog/apartment-4b-horror-game/
https://anirudhvasudevan.com/blog/civs-contactless-voting-patent/
```

Repeat **Request indexing** for a page whenever you change it in a way that matters (a new job title on `/about/`, a new award).

## 3. Bing Webmaster Tools (import from Search Console)

1. Go to `https://www.bing.com/webmasters` and sign in (a Microsoft account works; you can also sign in with Google).
2. On the welcome screen, choose **Import your sites from GSC** and click **Import**.
3. Pick the Google account you used in step 1 and click **Allow**.
4. Tick `anirudhvasudevan.com` and click **Import**. Bing copies the verification and the sitemap.
5. Open the site in Bing Webmaster Tools, go to **Sitemaps**, and check that `https://anirudhvasudevan.com/sitemap.xml` is listed. If not, click **Submit sitemap** and paste it.

## 4. IndexNow (after every deploy)

IndexNow tells Bing, Yandex, Seznam and Naver that a page changed. Google does not use it, which is why step 2 exists.

Once, check that the key file is live: open `https://anirudhvasudevan.com/b052ce8c9a5ba7e6d77b67afd279520e.txt`. It should show the same string.

After a deploy is live, from the repo:

```bash
node scripts/indexnow.mjs                    # every URL in the live sitemap
node scripts/indexnow.mjs /about/ /resume/   # only the pages you changed
```

A `HTTP 200` or `HTTP 202` means it worked. If you see `429`, you sent too many; next time send only the changed paths.

## 5. Make every profile say the same thing

Search engines and language models connect accounts into one person when the name, photo, title and links match. The site's Person data already lists these profiles, so each one must point back at `https://anirudhvasudevan.com/` and say the same things.

Rules for every profile:

- **Name:** `Anirudh Vasudevan`, exactly. Not a handle, no extra words.
- **Photo:** the same photo as the site (`public/assets/anirudh-avatar.png` in this repo).
- **Title:** `Member of Technical Staff at Rivo` and `full-stack and AI engineer in San Francisco`.
- **Link:** `https://anirudhvasudevan.com/` in the website field.
- **Facts:** only what the site says (see the fact sheet at the end). If a profile says something different, change the profile, or change the site first and then the profile.

### LinkedIn (`linkedin.com/in/anirudhvasudev`)

1. Open your profile and click the pencil on the top card.
   - **Headline:**
     ```text
     Member of Technical Staff at Rivo | Full-stack and AI engineer building voice AI agents | 5x hackathon winner | Granted patent | EMNLP author
     ```
   - **Location:** San Francisco, California
   - Click **Save**.
2. Click **Contact info**, then the pencil. Under **Website**, click **Add website**:
   - **URL:** `https://anirudhvasudevan.com/`
   - **Type:** Personal (or Portfolio)
   
   Click **Save**.
3. **About:** click the pencil on the About section (or **Add profile section**, then **Add about**). Paste the first-person 300-word bio from the Bio kit, then add these lines at the end:
   ```text
   Every project, with the architecture and what I learned: https://anirudhvasudevan.com/blog/
   More about me: https://anirudhvasudevan.com/about/
   ```
4. **Featured:** **Add profile section**, **Add featured**, **Add a link**. Add `https://anirudhvasudevan.com/about/` first, then `https://anirudhvasudevan.com/projects/`.
5. **Experience:** make each entry match the site exactly:
   - Rivo, Member of Technical Staff, December 2025 to Present, San Francisco
   - Nonlinear, Founding Engineer, August 2025 to December 2025, San Francisco
   - University of Minnesota, Graduate Research Assistant (Institute for Health Informatics), January 2024 to July 2025
6. **Add profile section**, then:
   - **Patents:** title `Contactless Integrated Voting System`, patent or application number `202341031598`, patent office India, status **Patent issued**. Patent URL: `https://anirudhvasudevan.com/blog/civs-contactless-voting-patent/`
   - **Publications:** `ConsensusDrift: Semantic Salience Can Override Majority Evidence in LLM Aggregation`, publisher EMNLP (Main Conference), add the co-authors Gokul Srinath Seetha Ram and Rashmi Elavazhagan. Then `A Deep Convolutional Neural Network for Remote Life Activities Detection Using FMCW Radar Under Realistic Environments`, publisher Springer, 2023, URL `https://doi.org/10.1007/978-3-031-31153-6_32`
   - **Honors & awards**, one each:
     - Top 10, Y Combinator AI Hackathon (LARK)
     - Winner, ElevenHacks, Stripe x ElevenLabs (Living Photos)
     - 2nd Place, ElevenLabs x Replit Hackathon (FaceTime from Mars)
     - 3rd Place, ElevenHacks, ElevenLabs x Zed (Apartment 4B)
     - Best Voice Agent, ElevenLabs x Firecrawl Hackathon (ScreenSense)
     - 4th overall, ElevenHacks Season 1
7. **Education:** University of Minnesota, Twin Cities, MS in Computer Science, 2023 to 2025. SRM Institute of Science and Technology, B.Tech in Computer Science and Engineering, 2019 to 2023. IIT Madras, Diploma in Data Science, 2021 to 2023.

### GitHub (`github.com/anirxdh`)

1. Go to `https://github.com/settings/profile`.
   - **Name:** `Anirudh Vasudevan`
   - **Bio:**
     ```text
     Full-stack and AI engineer in San Francisco. Member of Technical Staff at Rivo, building voice AI agents. 5x hackathon winner.
     ```
   - **URL:** `https://anirudhvasudevan.com/`
   - **Social accounts:** `https://www.linkedin.com/in/anirudhvasudev/` and `https://x.com/anirxdhv`
   - **Company:** `Rivo`
   - **Location:** `San Francisco, CA`
   
   Click **Update profile**.
2. **Pinned repos:** on your profile page click **Customize your pins**, tick these six, and click **Save pins**:
   `YC-hack`, `Living-Photos`, `facetime-from-mars-2159`, `elevenlab_firecrawl`, `Apartment-4B`, `CIVS`
3. On each of those repos, click the gear next to **About** on the right and set **Description** and **Website**. Then **Save changes**.

   | Repo | Description | Website |
   |---|---|---|
   | `YC-hack` | LARK: an MCP gateway and phone-style widget that lets ChatGPT and Claude place calls, play music, and message other AI agents. Top 10 at the Y Combinator AI Hackathon. | `https://anirudhvasudevan.com/blog/lark-multi-agent-mcp/` |
   | `Living-Photos` | Living Photos: walk into an old photograph as a 3D Gaussian-splat scene with a consent-cloned voice inside. Winner, ElevenHacks (Stripe x ElevenLabs). | `https://anirudhvasudevan.com/blog/living-photos-gaussian-splats/` |
   | `facetime-from-mars-2159` | FaceTime from Mars: push-to-talk voice calls with three AI colonists living on Mars in 2159. 2nd Place, ElevenLabs x Replit Hackathon. | `https://anirudhvasudevan.com/blog/facetime-from-mars/` |
   | `elevenlab_firecrawl` | ScreenSense: a Chrome extension that turns a spoken command into browser actions and can ask you questions mid-task. Best Voice Agent, ElevenLabs x Firecrawl Hackathon. | `https://anirudhvasudevan.com/blog/screensense-voice-browser-agent/` |
   | `Apartment-4B` | Apartment 4B: a first-person lo-fi horror mystery game built in React Three Fiber in 36 hours, voiced with ElevenLabs. 3rd Place, ElevenHacks (ElevenLabs x Zed). | `https://anirudhvasudevan.com/blog/apartment-4b-horror-game/` |
   | `CIVS` | CIVS: a contactless voting kiosk that checks a voter's face against ID photos and takes the ballot by hand gesture. Basis of a granted patent (202341031598). | `https://anirudhvasudevan.com/blog/civs-contactless-voting-patent/` |

   For the site's own repo (`portfolio`), set the website to `https://anirudhvasudevan.com/`.
4. **Profile README** (optional, worth it): create a new public repo named exactly `anirxdh`, tick **Add a README file**, and replace its text with:
   ```markdown
   # Anirudh Vasudevan

   (paste the first-person 120-word bio from the Bio kit here)

   - Website: https://anirudhvasudevan.com/
   - About: https://anirudhvasudevan.com/about/
   - Project write-ups: https://anirudhvasudevan.com/blog/
   - LinkedIn: https://www.linkedin.com/in/anirudhvasudev/
   ```

### X (`x.com/anirxdhv`)

Profile, **Edit profile**:

- **Name:** `Anirudh Vasudevan`
- **Bio:**
  ```text
  Full-stack and AI engineer in San Francisco. Member of Technical Staff at Rivo, building voice AI agents. 5x hackathon winner, granted patent, EMNLP author.
  ```
- **Location:** `San Francisco, CA`
- **Website:** `https://anirudhvasudevan.com/`

Click **Save**.

### YouTube (`youtube.com/@anirudhvasudevan5581`)

1. Go to `https://studio.youtube.com`, click **Customization**, then the **Profile** tab (called **Basic info** in older layouts).
2. **Name:** `Anirudh Vasudevan`
3. **Description:** paste the first-person 50-word bio from the Bio kit, then:
   ```text
   Write-ups for every project: https://anirudhvasudevan.com/blog/
   ```
4. **Links:** click **Add link**. **Title:** `Website`, **URL:** `https://anirudhvasudevan.com/`. Add a second one, **Title:** `LinkedIn`, **URL:** `https://www.linkedin.com/in/anirudhvasudev/`.
5. Click **Publish**.

Keep the handle as it is. If you ever change it, update the YouTube link in `scripts/blog/person.mjs` and `content/pages/about.md` the same day, or the site will point at a dead profile.

### Devpost (`devpost.com/anirxdh`)

1. Open your Devpost profile and click **Edit profile** (or **Settings**, then the profile tab).
2. **Name:** `Anirudh Vasudevan`
3. **Bio:**
   ```text
   I'm Anirudh Vasudevan, a full-stack and AI engineer in San Francisco and a Member of Technical Staff at Rivo, where I build production voice AI agents.
   ```
4. **Website:** `https://anirudhvasudevan.com/`. Also fill in GitHub (`anirxdh`) and LinkedIn.
5. On each of your project pages on Devpost, click **Edit project** and, under **Try it out** links, add the matching write-up URL from `https://anirudhvasudevan.com/blog/`. Judges and recruiters land on these pages, and each link is one more pointer home.

### Google Scholar

1. Go to `https://scholar.google.com/citations`, open your profile, and click the pencil next to your name.
2. Fill in:
   - **Name:** `Anirudh Vasudevan`
   - **Affiliation:** `Member of Technical Staff, Rivo`
   - **Areas of interest:** `Voice AI, AI agents, Large language models, Retrieval-augmented generation, Computer vision`
   - **Homepage:** `https://anirudhvasudevan.com/`
3. Click **Save**.
4. Check that both papers are on the profile. If ConsensusDrift is missing, click **+** (Add), then **Add articles**, and search for its exact title; if it is not found yet, use **Add article manually** with only the details you have (title, authors, EMNLP, year).

### ORCID (`orcid.org/0009-0005-2249-312X`)

1. Sign in at `https://orcid.org/signin` and go to your record.
2. **Websites & social links:** click the pencil, **Add link**. **Link title:** `Personal website`, **URL:** `https://anirudhvasudevan.com/`. Add LinkedIn and GitHub the same way. Set visibility to **Everyone** and click **Save changes**.
3. **Biography:** click the pencil and paste the third-person 120-word bio from the Bio kit. Visibility **Everyone**.
4. **Keywords:** `Voice AI`, `AI agents`, `Large language models`, `Retrieval-augmented generation`, `Computer vision`.
5. **Employment**, **+ Add**, one each:
   - Rivo, San Francisco, Member of Technical Staff, start 2025-12
   - Nonlinear, San Francisco, Founding Engineer, 2025-08 to 2025-12
   - University of Minnesota, Graduate Research Assistant, Institute for Health Informatics, 2024-01 to 2025-07
6. **Education and qualifications**, **+ Add**: the three degrees from the fact sheet.
7. **Works**, **+ Add**, **Add DOI**, paste `10.1007/978-3-031-31153-6_32`, click **Retrieve work details**, then **Add to list**. When the EMNLP paper has a DOI, add it the same way.

### Instagram (`instagram.com/anirxdh`)

Profile, **Edit profile**:

- **Name:** `Anirudh Vasudevan` (this field is searchable on Instagram; the handle is not enough)
- **Bio:**
  ```text
  Full-stack and AI engineer in San Francisco. Member of Technical Staff at Rivo. 5x hackathon winner.
  ```
- **Links**, **Add external link**: **URL** `https://anirudhvasudevan.com/`, **Title** `Website`.

### LeetCode (`leetcode.com/u/anirudhvasudev`)

**Edit profile**: **Name** `Anirudh Vasudevan`, **Website** `https://anirudhvasudevan.com/`, **Summary**: the one-line first-person bio.

### When you finish

Open each profile from the Profiles row of the fact sheet (end of this file) in a private window: every one should show your name, your photo and a link to `https://anirudhvasudevan.com/`. If you add a new profile anywhere, add its URL to `SAME_AS` in `scripts/blog/person.mjs` and to the Elsewhere list in `content/pages/about.md`, only after checking it is really yours.

## 6. Syndicate one article a week

Everything is generated in `syndication/` (how it works, and how to regenerate it: `syndication/README.md`). The posting order and a checkbox per platform are in `syndication/SCHEDULE.md`. It starts with the hackathon wins and the patent, because those carry the facts people search for.

Before the first post:

1. Make the diagrams readable on white pages. Run `git mv syndication/diagrams public/blog/diagrams/raster`, then `node syndication/export.mjs`, then commit and deploy. Details are in `syndication/README.md`.
2. Set up the three author profiles, with the same rules as step 5:
   - **DEV** (`https://dev.to/settings`): **Name** `Anirudh Vasudevan`, **Website URL** `https://anirudhvasudevan.com/`, **Location** `San Francisco, CA`, **Bio**: the one-line first-person bio, **Work**: `Member of Technical Staff at Rivo`.
   - **Hashnode**: create the blog on a free `*.hashnode.dev` address (do not point anirudhvasudevan.com at it). **Name**, **Tagline** `Full-stack and AI engineer in San Francisco. Member of Technical Staff at Rivo.`, **Bio** the 50-word first-person bio, website link.
   - **Medium**: **Name** `Anirudh Vasudevan`, **Short bio**: `Full-stack and AI engineer in San Francisco. Member of Technical Staff at Rivo, building voice AI agents. 5x hackathon winner, granted patent, EMNLP author.` The username `@anirxdh` on Medium belongs to someone else, so pick a different username, and never link to `medium.com/@anirxdh`.

Every week:

1. Take the next row in `syndication/SCHEDULE.md`.
2. Check that Google has indexed the original first: Search Console, URL inspection, paste the article URL, look for **URL is on Google**. If not, click **Request indexing** and post the copies next week instead. The original should always be the one Google saw first.
3. **DEV:** copy all of `syndication/devto/<slug>.md` into a new post (basic markdown editor). It has `canonical_url` set and `published: false`. Preview, then set `published: true` and save.
4. **Hashnode:** new draft. Fill the title, subtitle, cover, slug, tags and the original (canonical) URL from the front matter of `syndication/hashnode/<slug>.md`, paste the rest as the body, publish.
5. **Medium:** `https://medium.com/p/import`, paste the article URL, **Import**. Medium sets the canonical link itself. Upload the two diagram images listed in `syndication/medium/import-list.md`, add the five tags, publish.
6. Tick the three boxes in `syndication/SCHEDULE.md`.
7. Share the original article URL (on anirudhvasudevan.com) on LinkedIn and X with one sentence about what you built.

Each copy ends with "Originally published on anirudhvasudevan.com" and a short bio with links to `/about/` and `/blog/`. Keep those lines.

## 7. Knowledge panel

### How Google picks one

A knowledge panel is the box on the right of Google results (at the top on phones) about one person or thing. Google shows it when its Knowledge Graph has an entity it is confident matches the query. For a name that more than one person has, it needs enough consistent, independent sources to know which Anirudh Vasudevan the searcher means. The usual inputs:

- An official site with Person structured data that lists the person's profiles (`sameAs`). Done: the homepage, `/about/` and `/resume/` all carry it.
- Profiles on sites Google trusts that match each other: LinkedIn, GitHub, Google Scholar, ORCID, YouTube, X. Step 5 does this.
- Independent pages that mention the person with the same facts: hackathon results pages, the patent record, the papers, syndicated articles, other people's posts.
- Search demand: people searching the name and clicking the same results.

You cannot request a panel. Steps 1 to 6 are what make one likely. Do not create a Wikipedia article about yourself; it breaks Wikipedia's conflict of interest rules and gets deleted. If a hackathon organizer or a teammate writes about a project, ask them to link your name to `https://anirudhvasudevan.com/`.

### How to claim it once it appears

1. Search Google for `Anirudh Vasudevan` while signed in to the Google account that owns Search Console.
2. At the bottom of the panel, click **Claim this knowledge panel**.
3. Google asks you to sign in to one of the official profiles it connects to you. The Search Console property for anirudhvasudevan.com from step 1 or the YouTube channel are the easiest proofs. If none of those are offered, Google asks for a photo ID.
4. Once Google approves the claim, the panel shows **Suggest edits**. Use it to set the photo and to fix any fact, quoting the matching page on the site as the source.

Check the panel each month. If it ever mixes you up with another Anirudh Vasudevan, use **Feedback** at the bottom of the panel and point to `https://anirudhvasudevan.com/about/`.

## 8. What to measure every week (15 minutes)

In Search Console (`https://search.google.com/search-console`, property `anirudhvasudevan.com`):

1. **Performance**, **Search results**. Set the date to **Last 7 days**, and open the **Compare** tab to compare with the previous 7 days.
   - Click **+ Add filter**, **Query**, **Queries containing**, type `anirudh vasudevan`, **Apply**. Write down **Total clicks**, **Total impressions**, **Average CTR** and **Average position**.
   - Click the **Pages** tab under the chart: which pages show up for your name. `/about/` and the homepage should lead.
   - Remove the filter and look at the **Queries** tab: which projects and topics bring people in.
2. **Indexing**, **Pages**: the **Indexed** count should climb toward the number of URLs in the sitemap (the build prints it: `sitemap.xml (N urls)`). Open **Why pages aren't indexed** and fix anything that is not a redirect or an intentional 404.
3. **Indexing**, **Sitemaps**: status **Success**, and the discovered URL count matches.
4. **Enhancements** (and **Experience**): Breadcrumbs and Profile page should show valid items and no errors. If an error appears, open it, click **Validate fix** after the fix ships.
5. **Links**, **Top linking sites**: DEV, Hashnode, Medium, GitHub and LinkedIn should appear over the weeks.

Outside Search Console, once a week:

6. Open a private window, search Google for `Anirudh Vasudevan`, and count how many of the ten results are about you. Do the same on Bing.
7. Ask each assistant the same questions and compare the answers with the site: ChatGPT (with search on), Perplexity, Gemini and Claude.
   ```text
   Who is Anirudh Vasudevan?
   What hackathons has Anirudh Vasudevan won?
   What is Anirudh Vasudevan's patent?
   Where does Anirudh Vasudevan work?
   ```
   When an answer is wrong, look at the sources it cites. Fix that source if it is yours. If it is someone else's page about a different person with the same name, make sure `/about/` answers the question in plain words (its FAQ is built for this) and request indexing again.

A simple log, one row a week:

| Week of | Name query clicks | Impressions | Avg position | Google page 1 results about me | Bing page 1 | Indexed pages | Assistants correct (of 4) | Notes |
|---|---|---|---|---|---|---|---|---|
| | | | | /10 | /10 | | | |

Expect slow movement for the first few weeks. Name queries usually move first, then project names.

## What not to do

- Do not change the URL of a page that already exists (`/about/`, `/blog/<slug>/`). If one must move, add a 301 redirect in `netlify.toml` the same day.
- Do not block crawlers. `public/robots.txt` allows everything, which is what you want for Google, Bing and the AI crawlers.
- Do not post a copy of an article anywhere without the canonical link back to the original.
- Do not open new accounts under a different spelling of your name, and do not let old ones drift. Delete or update profiles you no longer use.
- Do not buy links or submit the site to link directories. They do nothing for a name search and can count against the site.

## Bio kit

Every version below says only what `content/pages/about.md` says. When something changes (a new role, a new award), change `about.md` first, then update this kit, then the profiles.

### One line

Third person:

> Anirudh Vasudevan is a full-stack and AI engineer in San Francisco and a Member of Technical Staff at Rivo, where he builds production voice AI agents.

First person:

> I'm Anirudh Vasudevan, a full-stack and AI engineer in San Francisco and a Member of Technical Staff at Rivo, where I build production voice AI agents.

### About 50 words

Third person:

> Anirudh Vasudevan is a full-stack and AI engineer in San Francisco. He is a Member of Technical Staff at Rivo, where he builds production voice AI agents. Before that he was the founding engineer at Nonlinear. He has won five hackathons, holds a granted patent, and co-wrote a paper accepted to EMNLP.

First person:

> I'm Anirudh Vasudevan, a full-stack and AI engineer in San Francisco. I'm a Member of Technical Staff at Rivo, where I build production voice AI agents. Before that I was the founding engineer at Nonlinear. I have won five hackathons, hold a granted patent, and co-wrote a paper accepted to EMNLP.

### About 120 words

Third person:

> Anirudh Vasudevan is a full-stack and AI engineer in San Francisco. He is a Member of Technical Staff at Rivo, a San Francisco fintech, where he builds production voice AI agents, owns the iOS and web apps, and runs analytics and growth. Before Rivo he was the founding engineer at Nonlinear, an AI startup, where he built agentic RAG pipelines and a Microsoft Teams bot. He has won five hackathons, including a Top 10 finish at the Y Combinator AI Hackathon with LARK and a win at ElevenHacks (Stripe x ElevenLabs) with Living Photos. He holds a granted patent for a contactless voting system, co-wrote a paper accepted to EMNLP, and has an MS in Computer Science from the University of Minnesota.

First person:

> I'm Anirudh Vasudevan, a full-stack and AI engineer in San Francisco. I'm a Member of Technical Staff at Rivo, a San Francisco fintech, where I build production voice AI agents, own the iOS and web apps, and run analytics and growth. Before Rivo I was the founding engineer at Nonlinear, an AI startup, where I built agentic RAG pipelines and a Microsoft Teams bot. I have won five hackathons, including a Top 10 finish at the Y Combinator AI Hackathon with LARK and a win at ElevenHacks (Stripe x ElevenLabs) with Living Photos. I hold a granted patent for a contactless voting system, co-wrote a paper accepted to EMNLP, and have an MS in Computer Science from the University of Minnesota.

### About 300 words

Third person:

> Anirudh Vasudevan is a full-stack and AI engineer based in San Francisco. He is a Member of Technical Staff at Rivo, a San Francisco fintech, where most of his week goes into conversational AI that real customers talk to. He deploys LiveKit voice agents that capture leads and an internal support chatbot, owns the iOS and web apps on a single React Native codebase that he migrated from Next.js, and runs product analytics and growth, from full-funnel tracking and paid ads to a referral system and a pipeline that generates UGC-style video ads.
>
> Before Rivo he was the founding engineer at Nonlinear, a San Francisco AI startup, where he built the Universal Node System for AI workflows and the agentic RAG pipelines behind context-aware agents and a Microsoft Teams bot. Before that he was a graduate research assistant at the University of Minnesota's Institute for Health Informatics.
>
> He likes building a whole product in a weekend. He has won five hackathons: Top 10 at the Y Combinator AI Hackathon with LARK, Winner at ElevenHacks (Stripe x ElevenLabs) with Living Photos, 2nd Place at ElevenLabs x Replit with FaceTime from Mars, 3rd Place at ElevenHacks (ElevenLabs x Zed) with Apartment 4B, and Best Voice Agent at ElevenLabs x Firecrawl with ScreenSense. He also finished 4th overall in ElevenHacks Season 1.
>
> He holds a granted patent for the Contactless Integrated Voting System (202341031598), which lets people vote with speech and hand gestures instead of touching a machine, and he co-wrote ConsensusDrift, a paper accepted to the EMNLP Main Conference. He has an MS in Computer Science from the University of Minnesota, Twin Cities, a B.Tech in Computer Science and Engineering from SRM Institute of Science and Technology, and a Diploma in Data Science from IIT Madras. His projects and write-ups are at anirudhvasudevan.com.

First person:

> I'm Anirudh Vasudevan, a full-stack and AI engineer based in San Francisco. I'm a Member of Technical Staff at Rivo, a San Francisco fintech, where most of my week goes into conversational AI that real customers talk to. I deploy LiveKit voice agents that capture leads and an internal support chatbot, own the iOS and web apps on a single React Native codebase that I migrated from Next.js, and run product analytics and growth, from full-funnel tracking and paid ads to a referral system and a pipeline that generates UGC-style video ads.
>
> Before Rivo I was the founding engineer at Nonlinear, a San Francisco AI startup, where I built the Universal Node System for AI workflows and the agentic RAG pipelines behind context-aware agents and a Microsoft Teams bot. Before that I was a graduate research assistant at the University of Minnesota's Institute for Health Informatics.
>
> I like building a whole product in a weekend. I have won five hackathons: Top 10 at the Y Combinator AI Hackathon with LARK, Winner at ElevenHacks (Stripe x ElevenLabs) with Living Photos, 2nd Place at ElevenLabs x Replit with FaceTime from Mars, 3rd Place at ElevenHacks (ElevenLabs x Zed) with Apartment 4B, and Best Voice Agent at ElevenLabs x Firecrawl with ScreenSense. I also finished 4th overall in ElevenHacks Season 1.
>
> I hold a granted patent for the Contactless Integrated Voting System (202341031598), which lets people vote with speech and hand gestures instead of touching a machine, and I co-wrote ConsensusDrift, a paper accepted to the EMNLP Main Conference. I have an MS in Computer Science from the University of Minnesota, Twin Cities, a B.Tech in Computer Science and Engineering from SRM Institute of Science and Technology, and a Diploma in Data Science from IIT Madras. My projects and write-ups are at anirudhvasudevan.com.

### Fact sheet (copy from here, never from memory)

| Field | Value |
|---|---|
| Name | Anirudh Vasudevan |
| Role | Member of Technical Staff, Rivo (San Francisco fintech), December 2025 to Present |
| One-line description | Full-stack and AI engineer in San Francisco |
| Previous | Founding Engineer, Nonlinear (San Francisco AI startup), August 2025 to December 2025. Graduate Research Assistant, University of Minnesota Institute for Health Informatics, January 2024 to July 2025 |
| Website | https://anirudhvasudevan.com/ |
| About page | https://anirudhvasudevan.com/about/ |
| Email (public on the site) | anirudhvasudevan11@gmail.com |
| Hackathons | Top 10, Y Combinator AI Hackathon (LARK). Winner, ElevenHacks, Stripe x ElevenLabs (Living Photos). 2nd Place, ElevenLabs x Replit Hackathon (FaceTime from Mars). 3rd Place, ElevenHacks, ElevenLabs x Zed (Apartment 4B). Best Voice Agent, ElevenLabs x Firecrawl Hackathon (ScreenSense). 4th overall, ElevenHacks Season 1 |
| Patent | Contactless Integrated Voting System, granted. Indian application 202341031598, May 2023, assigned to SRM Institute of Science and Technology |
| Papers | ConsensusDrift: Semantic Salience Can Override Majority Evidence in LLM Aggregation, EMNLP (Main Conference), with Gokul Srinath Seetha Ram and Rashmi Elavazhagan. A Deep Convolutional Neural Network for Remote Life Activities Detection Using FMCW Radar Under Realistic Environments, Springer, 2023, DOI 10.1007/978-3-031-31153-6_32 |
| Education | MS in Computer Science, University of Minnesota, Twin Cities (2023 to 2025). B.Tech in Computer Science and Engineering, SRM Institute of Science and Technology (2019 to 2023). Diploma in Data Science, IIT Madras (2021 to 2023) |
| Profiles | LinkedIn `linkedin.com/in/anirudhvasudev`, GitHub `github.com/anirxdh`, X `x.com/anirxdhv`, YouTube `youtube.com/@anirudhvasudevan5581`, Devpost `devpost.com/anirxdh`, Google Scholar `scholar.google.com/citations?user=NvrJL_YAAAAJ`, ORCID `orcid.org/0009-0005-2249-312X`, LeetCode `leetcode.com/u/anirudhvasudev`, Instagram `instagram.com/anirxdh` |
