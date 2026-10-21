# Search results plan: pages 1 and 2 for "Anirudh Vasudevan"

Written 2026-10-17. Goal: when someone searches **Anirudh Vasudevan** on Google, as many of the first 20 results as possible are about you.

This file is the plan: who holds the results today, which 20 URLs should replace them, and what to do this week, this month and this quarter. The click-by-click setup for Search Console, Bing and IndexNow, plus the full bio kit, is in [SEO-PLAYBOOK.md](./SEO-PLAYBOOK.md). This file links to it instead of repeating it.

**The honest version up front.** Owning all 20 results for the bare name is not realistic. Five or six of them belong to Aniruddhan Vasudevan, a translator whose books are on Goodreads, Penguin and the Booker Prizes site, and search engines treat "Anirudh" and "Aniruddhan" as the same name. Google also keeps one or two slots for other people's LinkedIn profiles, and it usually shows only one or two results per website. What is realistic:

| When | Results about you in the top 20 |
|---|---|
| Today | 2 (LinkedIn and Google Scholar) |
| 1 month | 4 to 6 |
| 3 months | 7 to 9, with 4 to 6 on page 1 |
| 6 months | 10 to 13, with 6 or 7 of the top 10 |

For narrower searches such as "Anirudh Vasudevan engineer", "Anirudh Vasudevan Rivo", "Anirudh Vasudevan hackathon" and "Anirudh Vasudevan San Francisco", there is almost no competition. Holding 8 to 10 of the top 10 for those within about 3 months is realistic.

These estimates assume everything below gets done. Nothing counts until step 1 (ship the site) is done.

## 1. Where things stand today

Checked 2026-10-17 with a search tool whose results match Bing's index, not Google's. Google will differ a little. Confirm it yourself (see section 6) before you treat these ranks as exact.

| Rank | Result | Whose |
|---|---|---|
| 1 | Goodreads author page, Aniruddhan Vasudevan | Translator (different person) |
| 2 | National Book Foundation, Aniruddhan Vasudevan | Translator |
| 3 | Humantic AI profile | Namesake in Bengaluru (data aggregator) |
| **4** | **linkedin.com/in/anirudhvasudev** | **You** |
| 5 | Orinam author archive | Translator |
| 6 | LinkedIn, Atlanta | Namesake |
| **7** | **Google Scholar profile** | **You** |
| 8 | Purdue University PDF | Another person |
| 9 | LinkedIn, Seattle | Namesake |
| 10 | Princeton event page, book launch | Translator |
| 11 | Goodreads author blog post | Translator |
| 12 | Wikipedia, Vettaiyan soundtrack | Partial name match |
| 13 | LinkedIn, KAYAK | Namesake |
| 14 | LinkedIn /in/anirudhvasudevan | Namesake (holds the exact-match LinkedIn URL) |
| 15 | ZoomInfo | Namesake (data broker) |
| 16 | LinkedIn, V-Guard | Namesake |
| 17 | ZoomInfo | Namesake (data broker) |
| 18 | The Org, KAYAK org chart | Namesake |
| 19 | LinkedIn, SpaceX | Namesake |
| 20 | LinkedIn, AB InBev | Namesake |

Also ranking for variants of the name: the Booker Prizes and Penguin India pages for the translator. Treat those as locked.

Why your own site is missing: production still serves the old build. On 2026-10-17, `/about/`, `/hackathons/` and any made-up URL such as `/nope` all return the homepage with a canonical tag pointing at `/`. So Google sees one page, with almost no text before JavaScript runs, no meta description, and only three profile links. The live sitemap has 21 URLs; the new build has 61. Everything in PR #2 and PR #3 fixes this, but none of it is live.

Slots you should not try to win: the translator's pages (Goodreads, National Book Foundation, Booker, Penguin, Princeton) and the namesake LinkedIn profiles. Leave them alone and push past them. The thin pages (Humantic, ZoomInfo, The Org, Orinam, the Wikipedia partial match) will drop as your pages gain strength.

## 2. The target: 20 URLs for pages 1 and 2

Ordered by expected impact. Rows 1 to 10 are the ones that matter most. Rows 11 to 20 fill the remaining slots over months. Expect 10 to 13 of these to make the top 20 by month 6, not all 20.

| # | Target URL | Type | Status today | What to do | Effort | Impact |
|---|---|---|---|---|---|---|
| 1 | `https://anirudhvasudevan.com/` | Your site, home | Old build live, not ranking for anything | Merge and deploy PR #2 and #3, then Search Console and Bing | 1 hour | Highest |
| 2 | `https://anirudhvasudevan.com/about/` | Your site, profile page | Live URL serves the homepage | Same deploy; request indexing; point profile links here | Included above | High (second result or sitelinks from your domain) |
| 3 | `https://www.linkedin.com/in/anirudhvasudev/` | LinkedIn | Rank 4; site link not verified | Headline, website, Featured, end the Nonlinear role, full public visibility | 30 min | High |
| 4 | `https://github.com/anirxdh` | GitHub | Not in top 20; Website field points to GitHub itself, bio empty | Fill the profile fields; set the portfolio repo's website | 20 min | High |
| 5 | `https://scholar.google.com/citations?user=NvrJL_YAAAAJ` | Google Scholar | Rank 7; affiliation still University of Minnesota; no homepage | Affiliation, interests, homepage | 10 min | High |
| 6 | `https://www.rivofi.com/authors/anirudh-vasudevan` | Employer author page | Exists; page title is just "Rivo"; links to the old netlify.app address | Fix title, meta description and links in Rivo's Webflow CMS | 20 min | High (strong company domain, many articles under your name) |
| 7 | `https://devpost.com/anirxdh` | Devpost | Title already has your full name; bio empty; Website goes to GitHub | Bio, website, link each project to its write-up | 30 min | Medium to high |
| 8 | `https://www.youtube.com/@anirudhvasudevan5581` | YouTube channel | Name in lowercase, "San fransisco" typo, no links | Name, description, links; name your demo videos | 15 min | Medium to high (can add a video row to the results) |
| 9 | `https://x.com/anirxdhv` | X | Already right: full name, website, San Francisco, bio | Pin a post that links your site | 5 min | Medium |
| 10 | `https://orcid.org/0009-0005-2249-312X` | ORCID | Name stored as "Anirudh vasudevan" with no family name; empty record | Fix the name, add bio, links, employment, education, works | 20 min | Medium |
| 11 | `https://dev.to/anirudhvasudevan` | DEV profile | Does not exist | Create it, then post from `syndication/devto/` | 20 min, then weekly | Medium |
| 12 | `https://anirudhvasudevan.hashnode.dev` | Hashnode blog | Does not exist | Create it, then post from `syndication/hashnode/` | 20 min, then weekly | Medium |
| 13 | `https://www.crunchbase.com/person/anirudh-vasudevan` | Crunchbase person page | Not checked (blocked) | Sign in, find or add your person page, link it to Rivo | 20 min | Medium to high |
| 14 | `https://aclanthology.org/people/...` | ACL Anthology author page | Not yet (EMNLP proceedings not out) | Make sure the camera-ready lists you as "Anirudh Vasudevan"; link it once live | 5 min now | High once it exists |
| 15 | `https://medium.com/@anirudhvasudevan` | Medium profile | Handle looks free. `medium.com/@anirxdh` is a different person | Create it, import articles | 20 min, then weekly | Medium |
| 16 | arXiv author page | arXiv | No papers there today | Post the ConsensusDrift preprint only if your co-authors agree | 1 hour | Medium to high |
| 17 | `https://huggingface.co/Anirxdh` | Hugging Face | Full name shown, no links, nothing published | Add links now; publish one Space this month | 10 min, then 2 hours | Low to medium |
| 18 | `https://www.producthunt.com/@anirudhvasudevan` | Product Hunt | Name "Anirudh", headline "Ms cs grad student". Probably yours, not confirmed | Confirm it is yours, then fix name and headline | 10 min | Low to medium |
| 19 | `https://www.instagram.com/anirxdh/` | Instagram | Private; result title reads "anirudh (@anirxdh)" | Set the Name field and link, or drop it from the site's profile list | 5 min | Low to medium |
| 20 | `https://leetcode.com/u/anirudhvasudev/` | LeetCode | Name stored as "Anirudh vasudevan"; website is GitHub | Fix name case, add website | 5 min | Low |

Backups if a slot above does not pan out: a Rivo team page or engineering post that links to your site, Peerlist, a Bluesky account that uses your domain as its handle (`@anirudhvasudevan.com`), Gravatar, about.me.

Why article copies do not count as extra slots: copies on DEV, Hashnode and Medium point back to your site with a canonical link, so Google folds them into the original. Their value for the name search is the **profile page** on each platform, plus the links back home.

## 3. This week

### Before you paste anything: confirm these facts

Every bio below leaves these out until you confirm them, because a wrong fact copied to ten profiles is hard to undo.

1. **Patent status.** The site, the playbook bios and your GitHub README banner say "granted". A public record for application 202341031598 showed the status "Reply Filed". Tell the engineer which word is right ("granted", "filed" or "published") so the site and every profile say the same thing.
2. **Award labels.** Living Photos "Winner" and ScreenSense "Best Voice Agent" could not be confirmed on public pages (the ElevenHacks page showed ScreenSense as "Most Popular"). Confirm the exact labels.
3. **Title at Rivo.** The site says Member of Technical Staff. Rivo's author page says "Founding Engineer of Rivo" in one place and "Member of Technical Staff" in another. Pick one.
4. **LeetCode count.** The site says 500+ solved; the LeetCode profile showed about 200.

### The short bio (use it everywhere this week)

```text
Full-stack and AI engineer in San Francisco. Member of Technical Staff at Rivo, building voice AI agents. 5x hackathon winner.
```

Third person, for meta descriptions:

```text
Anirudh Vasudevan is a full-stack and AI engineer in San Francisco and a Member of Technical Staff at Rivo, building voice AI agents.
```

Longer bios are in the playbook's [Bio kit](./SEO-PLAYBOOK.md#bio-kit). Once you confirm the patent wording, those can be used as they are or updated.

**Photo:** use the same image on every profile. A real photo of you helps more than the cartoon avatar (image results, and any future knowledge panel), but either works as long as it is the same everywhere. If you pick a real photo, send it to the engineer as well (see section 5).

### The steps, in order

1. **Ship the site.** Merge PR #2 (`seo-entity-polish`) into `main`, then PR #3 (`seo-geo-2`). Netlify deploys `main`. Then check from a terminal:
   ```bash
   curl -sI https://anirudhvasudevan.com/nope | head -1                     # expect 404
   curl -s https://anirudhvasudevan.com/about/ | grep -o '<link rel="canonical"[^>]*>'   # expect .../about/
   curl -s https://anirudhvasudevan.com/sitemap.xml | grep -c '<loc>'       # expect about 61
   ```

2. **Tell Google and Bing.** Follow [SEO-PLAYBOOK.md](./SEO-PLAYBOOK.md) sections 1 to 4: Search Console domain property and sitemap, request indexing for the listed pages, Bing import, then `node scripts/indexnow.mjs`. About an hour, once.

3. **LinkedIn** (`linkedin.com/in/anirudhvasudev`). Log in and edit:
   - **Name:** `Anirudh Vasudevan`
   - **Headline:**
     ```text
     Member of Technical Staff at Rivo | Full-stack and AI engineer building voice AI agents | 5x hackathon winner
     ```
   - **Location:** `San Francisco Bay Area`
   - **Contact info, Website:** `https://anirudhvasudevan.com/`, type **Portfolio**
   - **Featured, Add a link:** `https://anirudhvasudevan.com/about/`, then `https://anirudhvasudevan.com/projects/`
   - **Experience:** Rivo, Member of Technical Staff, December 2025 to Present. Nonlinear, Founding Engineer, August 2025 to **December 2025**. A data-broker page copied your LinkedIn and still lists Nonlinear as your current job, so check that the Nonlinear entry has its end date.
   - **Edit public profile & URL:** visibility **Public**, every section switched on, including your full last name. Keep the URL `/in/anirudhvasudev/`; the exact `/in/anirudhvasudevan/` belongs to someone else.
   - About, patents, publications and awards: see playbook section 5, LinkedIn, after you confirm the facts above.

4. **GitHub** (`https://github.com/settings/profile`):
   - **Name:** `Anirudh Vasudevan`
   - **Bio:** the short bio
   - **URL:** `https://anirudhvasudevan.com/`
   - **Social accounts:** replace the `anirudhvasudevan.netlify.app` entry with `https://anirudhvasudevan.com/`. Keep LinkedIn. Add `https://x.com/anirxdhv` and `https://www.youtube.com/@anirudhvasudevan5581`.
   - **Company:** `Rivo`
   - **Location:** `San Francisco, CA`
   - On the `portfolio` repo, click the gear next to **About**. **Website:** `https://anirudhvasudevan.com/`. **Description:**
     ```text
     Source for anirudhvasudevan.com, the personal site of Anirudh Vasudevan: projects, hackathon write-ups and research.
     ```
   - Pinned repos and their descriptions: the table in playbook section 5, GitHub.
   - Your profile README banner says "granted patent holder". Change it to match whatever you confirm in fact 1.

5. **Rivo author page** (`rivofi.com/authors/anirudh-vasudevan`). In Rivo's Webflow CMS (you or whoever runs it), edit your author item and the Authors template:
   - **Website:** `https://anirudhvasudevan.com/` (now `https://anirudhvasudevan.netlify.app/`)
   - **X:** `https://x.com/anirxdhv` (now has `?s=11` on the end)
   - **Add GitHub:** `https://github.com/anirxdh`, also in the page's Person `sameAs` if the template builds one
   - **SEO title** (now just "Rivo"):
     ```text
     Anirudh Vasudevan, Member of Technical Staff | Rivo
     ```
   - **Meta description:**
     ```text
     Anirudh Vasudevan is a full-stack and AI engineer in San Francisco and a Member of Technical Staff at Rivo, building voice AI agents.
     ```
   - Make the description and job title fields use the same title (fact 3).
   - Best done on the Authors collection template, with the title and description bound to each author's name and bio, so every author page gets one.

6. **Google Scholar** (`https://scholar.google.com/citations`, pencil next to your name):
   - **Affiliation:** `Member of Technical Staff, Rivo`
   - **Areas of interest:** `Voice AI, AI agents, Large language models, Retrieval-augmented generation, Computer vision`
   - **Homepage:** `https://anirudhvasudevan.com/research/` (after step 1 is live; it is the page about your papers)
   - **Email for verification:** your Rivo work email, since the umn.edu address may stop working
   - Keep **Make my profile public** ticked.
   - The profile lists four items. The site holds two of them (the ransomware detection and text summarization papers) as drafts until you decide about them. Decide whether they stay on Scholar too.

7. **YouTube** (`https://studio.youtube.com`, **Customization**, **Profile**):
   - **Name:** `Anirudh Vasudevan`
   - **Description:**
     ```text
     Full-stack and AI engineer in San Francisco. Member of Technical Staff at Rivo, building voice AI agents. 5x hackathon winner.
     Project write-ups: https://anirudhvasudevan.com/blog/
     More about me: https://anirudhvasudevan.com/about/
     ```
   - **Links:** `Website` `https://anirudhvasudevan.com/` first (the first link shows in the channel header), then `LinkedIn` `https://www.linkedin.com/in/anirudhvasudev/`, then `GitHub` `https://github.com/anirxdh`.
   - For each demo video: title it `<Project name> demo | Anirudh Vasudevan` and put the matching blog post URL on the first line of the description.
   - Keep the handle unless `@anirudhvasudevan` is free and you want it. If you change it, tell the engineer the same day so `SAME_AS` is updated.

8. **Devpost** (`devpost.com/anirxdh`, **Edit profile**):
   - **Name:** `Anirudh Vasudevan`
   - **Bio:** the short bio
   - **Website:** `https://anirudhvasudevan.com/` (now goes to GitHub)
   - **GitHub:** `anirxdh`, **LinkedIn:** `https://www.linkedin.com/in/anirudhvasudev/`, **X:** `anirxdhv`
   - On each project, **Edit project**, **Try it out** links: add the matching `https://anirudhvasudevan.com/blog/<slug>/` write-up. Make sure every hackathon project is on the profile.

9. **ORCID** (`https://orcid.org/signin`):
   - **Names:** Given `Anirudh`, Family `Vasudevan`, Published name `Anirudh Vasudevan` (now "Anirudh vasudevan" with no family name)
   - **Biography:** the short bio
   - **Websites & social links:** `Personal website` `https://anirudhvasudevan.com/`, `Google Scholar` `https://scholar.google.com/citations?user=NvrJL_YAAAAJ`, `GitHub` `https://github.com/anirxdh`, `LinkedIn` `https://www.linkedin.com/in/anirudhvasudev/`
   - **Keywords:** `Voice AI`, `AI agents`, `Large language models`, `Retrieval-augmented generation`, `Computer vision`
   - **Employment** and **Education:** as in playbook section 5, ORCID
   - **Works:** add DOI `10.1007/978-3-031-31153-6_32`
   - Set every section to **Everyone**.

10. **Quick ones** (5 minutes each):
    - **LeetCode** (**Edit profile**): Name `Anirudh Vasudevan`, Website `https://anirudhvasudevan.com/` as the first entry, Summary = the short bio, Location `San Francisco, CA`, Work `Rivo`, add LinkedIn and X.
    - **Hugging Face** (**Settings**, **Profile**): Homepage `https://anirudhvasudevan.com/`, Twitter `anirxdhv`, LinkedIn `anirudhvasudev`, AI & ML interests `Voice AI, AI agents, NLP`.
    - **Instagram:** either set **Name** to `Anirudh Vasudevan` and add the link `https://anirudhvasudevan.com/` (the account can stay private), or tell the engineer to remove Instagram from the site's profile list. A private profile titled "anirudh" adds little.
    - **X:** pin a post that links `https://anirudhvasudevan.com/about/` or a project write-up.

11. **Tell the engineer what you finished**, so the site's profile list (`SAME_AS`) matches: Rivo author page (after step 5), Hugging Face, the Instagram decision, any handle change.

12. **Optional, your call:** a data-broker site (unifers.ai) has a page about you copied from LinkedIn, with your old job title and masked contact details behind a signup wall. It takes a search slot and never links to you. You can ask for removal at `https://unifers.ai/opt-out`. You need to submit that yourself.

## 4. Next 30 days and next 90 days

### Next 30 days

- **Create the three writing profiles** (rows 11, 12, 15): DEV `dev.to/anirudhvasudevan`, Hashnode `anirudhvasudevan.hashnode.dev`, Medium `@anirudhvasudevan` (never `@anirxdh`, which is someone else). Same name, short bio, website `https://anirudhvasudevan.com/`, location San Francisco, CA, work Rivo. Setup text is in playbook section 6.
- **Start syndication** from `syndication/SCHEDULE.md`: at least one article a week, two or three if you have time. Post only after Search Console shows the original as indexed. Share each original URL on LinkedIn and X.
- **Crunchbase:** sign in, search your name. If there is no person page, add one: primary job Member of Technical Staff at Rivo, website `https://anirudhvasudevan.com/`, LinkedIn, X, GitHub, the short bio. Ask whoever manages Rivo's Crunchbase page to list you under People.
- **Hugging Face Space:** publish one small demo from a project you already built, with your name and a link to the write-up in its README. An empty profile rarely ranks.
- **Product Hunt:** confirm `@anirudhvasudevan` is yours. If so: Name `Anirudh Vasudevan`, Headline `Member of Technical Staff at Rivo. Full-stack and AI engineer.`, About = short bio, website, X link.
- **Check the accounts that could not be read from outside** (they block bots or need a login): Peerlist, Kaggle, Replit, Stack Overflow (six accounts share your name; find yours), Wellfound (`/u/anirudh-vasudevan-2` and `-4` might be yours; the others are not), and your ElevenLabs hackathon builder profile. For each one that is yours, set the name, short bio and website. Replit stays off the site's profile list until the profile is public.
- **Photo:** if you chose a real photo, send it to the engineer (section 5) and put the same one on every profile.
- **First monthly check** (section 6). Expect 4 to 6 of 20.

### Next 90 days

- **EMNLP:** make sure the camera-ready lists you exactly as `Anirudh Vasudevan`. When the proceedings publish, add the paper to Scholar and ORCID (by DOI) and link the ACL Anthology page from `/research/`.
- **arXiv:** if your co-authors agree, post the ConsensusDrift preprint under `Anirudh Vasudevan`. It also feeds Semantic Scholar and Google Scholar.
- **Rivo team page:** ask Rivo to list "Anirudh Vasudevan, Member of Technical Staff" on a team page or an engineering post that links to `https://anirudhvasudevan.com/`. If Rivo is on The Org, ask to be added there with the same link.
- **Ask for links:** when a hackathon organizer, teammate or event page writes about a project, ask them to link your name to `https://anirudhvasudevan.com/`.
- **Video:** one demo video per hackathon project, named as in step 7.
- **Optional extra profiles,** only if you will keep them current: Bluesky with your domain as the handle (add the `_atproto` TXT record in your DNS), Gravatar (dev.to and Hashnode use it), about.me.
- **Knowledge panel:** if one appears, claim it (playbook section 7).
- **Third monthly check.** Expect 7 to 9 of 20, with 4 to 6 on page 1.

## 5. The site: what it already does, and what is left

### Already done in PR #2 and PR #3 (live once merged)

- One Person entity (`scripts/blog/person.mjs`) used on every page, with your profiles in `sameAs`. `/about/` and `/resume/` are ProfilePage pages; every article and `/projects/` point at the same Person.
- Real pages with their own canonical URLs: `/about/`, `/resume/`, `/projects/`, `/hackathons/`, `/research/`, `/uses/`, `/blog/` and 27 articles. Unknown URLs return a real 404 marked noindex, instead of the homepage.
- Homepage text prerendered into the HTML, so crawlers see it without JavaScript.
- Sitemap with 61 URLs and image entries, RSS feed, `llms.txt` and `llms-full.txt`, a `robots.txt` that allows search and AI crawlers, 301s from `netlify.app` and `www`.
- IndexNow key and script, `npm run check:seo` validator (0 errors), syndication kit with canonical links.

### Remaining gaps (engineer checklist)

Do now. None of these changes how the homepage looks:

- [ ] **Brand name on the 61 generated pages.** `scripts/build-blog.mjs:394` shows "Anirudh's Website </>". Change it to `Anirudh Vasudevan` (the `</>` can stay as an `aria-hidden` span). The title, `og:site_name` and WebSite schema already say "Anirudh Vasudevan".
- [ ] **`rel="me"` on every link to a profile in `SAME_AS`.** Zero today. Places: `extAttrs` in `scripts/build-blog.mjs:60` (add `me` when the href is in `SAME_AS`), the site footer at `:421-422`, the `/about/` header links at `:640-641`, the contact list in `scripts/prerender-home.mjs` (`contactSection`), and the social icons in `src/sections/Footer.jsx`. Low weight for Google, but cheap and used by Mastodon and other identity checks.
- [ ] **Profile meta on `/about/` and `/resume/`.** Both set `og:type` to `profile` (`build-blog.mjs:627`, `:906`) with no `profile:first_name` (`Anirudh`) or `profile:last_name` (`Vasudevan`) tags. Add them through the `extra` head option.
- [ ] **Homepage prerendered footer** (`scripts/prerender-home.mjs`, `footer()`): add `/hackathons/`, `/research/` and `/uses/` next to About, Projects, Writing and Resume, matching the site footer.
- [ ] **Static intro link text** (`index.html:148`): "About Anirudh" becomes `About Anirudh Vasudevan`, so the homepage's link to `/about/` carries the full name.
- [ ] **`/about/` title** (`content/pages/about.md:2`, low priority): lead with the name, `Anirudh Vasudevan: Bio, Hackathons, Patent and Research`.
- [ ] **`SAME_AS` updates** in `scripts/blog/person.mjs` and the Elsewhere list in `content/pages/about.md`, only as the owner confirms each profile links back: add the Rivo author page and Hugging Face; then DEV, Hashnode, Medium `@anirudhvasudevan`, Crunchbase, Product Hunt as they go live. Remove Instagram if he chooses that. Never add `medium.com/@anirxdh`. Keep Replit out until it is public.
- [ ] **Fact sync** once he answers the questions in section 3: the patent word in `person.mjs` (description and award), `about.md`, the `/about/` standfirst (`build-blog.mjs:636`), the static intro paragraph in `index.html:147`, and the playbook bio kit.

Blocked on him (a photo only he can supply; never generate one):

- [ ] **Real photo.** `Person.image` is `/assets/anirudh-avatar.png`, a 167x167 cartoon avatar, also the only image on `/about/` (`build-blog.mjs:632`). When he supplies one: add `public/assets/anirudh-vasudevan.jpg` at about 1200x1200; make `image` an ImageObject with `url`, `contentUrl`, `width`, `height` and `caption: "Anirudh Vasudevan"`; show it on `/about/` with `alt="Anirudh Vasudevan"` and set dimensions; switch `AVATAR_PATH` in `build-blog.mjs:1694` so the image sitemap picks it up.

With the hero build, or earlier only with his OK (these change how the homepage looks, and the homepage visuals are on hold until he picks a hero):

- [ ] **Visible h1 with the full name.** `index.html:146` and `src/sections/Hero.jsx:31-34` render "Turning Ideas into Web Solutions", with the name only in a screen-reader span and "Hi, I am Anirudh" above it. Make the h1 `Anirudh Vasudevan` and move the tagline to a `<p>`. Keep the static intro and `Hero.jsx` identical so the swap does not shift the layout.
- [ ] **Navbar brand** (`src/sections/Navbar.jsx:56-57`): same change as the generated pages.
- [ ] **Links to the hub pages from the rendered homepage.** The nav (`navLinks` in `src/constants/index.js`) uses `#home`, `#about` and similar, and `src/sections/Footer.jsx` links only About, Writing and the PDF. After React mounts, nothing links `/projects/`, `/resume/`, `/hackathons/`, `/research/` or `/uses/`. Either point nav items at the real pages (About to `/about/`, Hackathons to `/hackathons/`, Work to `/projects/`), or add a row of page links to `Footer.jsx` matching the site footer. Also wrap "Anirudh Vasudevan" in `Footer.jsx:5` in a link to `/about/`, as the generated pages do.
- [ ] **Hero guard rails,** whichever concept he picks (particle name, voice orb, Project Orbit, terminal):
  1. The name stays real text in the initial HTML, as the h1. A particle or canvas name is a decorative `aria-hidden` layer over that h1, never the only copy.
  2. Terminal concept: the typed lines are already in the HTML; the typing is a reveal, not text injected only by JavaScript.
  3. Voice orb: audio and WebGL code load after the first paint or on first interaction, never in the critical path. Keep the current pattern where the static intro is the largest paint and the 3D hero loads after it (`afterIntroPainted` in `src/App.jsx`).
  4. Reserve the hero's height so nothing jumps, and respect `prefers-reduced-motion`.

  A busy animation is a design choice, not a search problem, as long as rules 1 and 4 hold.

## 6. How to measure progress

The weekly 15-minute routine is in playbook section 8. On top of that:

**Search Console, monthly.** Performance, Search results, last 28 days, compared with the previous period. Add a filter: **Query**, **Custom (regex)**, `anirudh.*vasudev` (this also catches "anirudh vasudev" and similar spellings). Write down clicks, impressions and average position. Then open the **Pages** tab with the same filter: the homepage and `/about/` should lead, followed by `/hackathons/` and `/research/`.

**The first 20 results, monthly, on the 1st.** Open a private window, signed out, and search:

```text
https://www.google.com/search?q=Anirudh+Vasudevan&hl=en&gl=us&pws=0
```

Look at pages 1 and 2. For each of the 20 results, mark it as yours or not, and note which URLs from the section 2 table appeared or dropped. Do the same on Bing. Then run the narrower searches and count the top 10 only:

```text
Anirudh Vasudevan engineer
Anirudh Vasudevan Rivo
Anirudh Vasudevan hackathon
Anirudh Vasudevan San Francisco
Anirudh Vasudevan AI
```

Keep one row a month:

| Month | Google top 20 mine | Google top 10 mine | Bing top 10 mine | Narrow searches, top 10 mine (avg) | New of mine | Lost | GSC name clicks | GSC avg position | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 2026-10 (baseline) | 2/20 | 1/10 | | | | | | | Checked with a Bing-like index, not Google |
| | /20 | /10 | /10 | /10 | | | | | |

**What should happen, and when to worry.**

- By month 1: your homepage and `/about/` appear for the name, and GitHub or Devpost shows up. If the homepage is not in the top 20 after 4 weeks, check Search Console's **Pages** report for indexing problems before doing anything else.
- By month 3: 7 to 9 of 20. If a profile you fixed is not appearing, open it in a private window and check that it shows your full name and the site link without logging in.
- If a namesake result ever mixes up facts with yours (for example in an AI assistant's answer or a knowledge panel), the fix is a clear answer on `/about/` and feedback on the panel, as in playbook sections 7 and 8.
