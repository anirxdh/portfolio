# Syndication kit

Copies of every published article, ready to post on DEV (dev.to), Hashnode and Medium. Each copy points back to the original on anirudhvasudevan.com with a canonical URL, so Google keeps ranking the original, and each copy adds a link to the site and another page that names Anirudh Vasudevan next to his work.

This folder is not part of the website. The site is built into `dist/` and Netlify publishes only `dist/` (see `netlify.toml`), so nothing here is ever served.

The full plan, including when to post and how this fits with Search Console, is in `docs/SEO-PLAYBOOK.md`.

## What is here

| Path | What it is |
|---|---|
| `devto/<slug>.md` | DEV post: front matter (title, `published: false`, description, 4 tags, canonical URL, cover image) and the article |
| `hashnode/<slug>.md` | Hashnode post: front matter (title, subtitle, slug, 5 tags, cover, canonical URL) and the article |
| `medium/import-list.md` | The URLs to paste into Medium's import tool, in posting order, with tags and the diagram images for each |
| `SCHEDULE.md` | One article a week, with a checkbox per platform |
| `diagrams/` | Every article diagram as a JPEG on the site's dark background (for Medium, and for hosting, see below) |
| `export.mjs` | Writes `devto/`, `hashnode/`, `medium/` and `SCHEDULE.md` from `content/articles/` |
| `render-diagrams.mjs` | Writes the diagram JPEGs from `public/blog/diagrams/*.svg` |

## Regenerate

After an article is added, changed or published:

```bash
node syndication/export.mjs
```

It only reads `content/articles/` and writes into this folder. Drafts are skipped, and copies of articles that went back to draft are deleted. Your ticks in `SCHEDULE.md` are kept.

After a diagram changes:

```bash
node syndication/render-diagrams.mjs     # only new or changed diagrams; FORCE=1 for all
node syndication/export.mjs
```

## What changes between the site and the copies

- Links like `/blog/facetime-from-mars/` or `/about/` become full `https://anirudhvasudevan.com/...` links.
- Each diagram becomes an image link with its caption written under it.
- The TL;DR, the award and the demo and source links from the top of the site page are added at the top.
- A footer says "Originally published on anirudhvasudevan.com" with the link, followed by a two-sentence bio that matches the site.
- Code blocks are copied exactly.

## Diagrams: one step to make them readable everywhere

The diagrams on the site are SVGs drawn for a dark page: transparent background, light grey lines. On DEV, Hashnode and Medium (white pages) the arrows and labels nearly disappear. The JPEGs in `diagrams/` have the dark background baked in.

Right now the copies link to the SVGs, because the JPEGs are not on the website yet. To switch every copy to the JPEGs:

```bash
git mv syndication/diagrams public/blog/diagrams/raster
node syndication/export.mjs
```

Then commit and deploy. `export.mjs` sees `public/blog/diagrams/raster/` and links to `https://anirudhvasudevan.com/blog/diagrams/raster/<name>.jpg` instead; `render-diagrams.mjs` writes there from then on. Do this before posting the first article.

## Posting, platform by platform

Do one article a week, in the order of `SCHEDULE.md`. Before each one, check that Google has indexed the original: Search Console, URL inspection, paste the article URL, and look for "URL is on Google".

### DEV (dev.to)

One time: in Settings, Customization, set the editor to the basic markdown editor. That editor reads the front matter at the top of the file. In Settings, Profile, set your name to Anirudh Vasudevan, the website to `https://anirudhvasudevan.com/`, and paste the one-line bio from the bio kit in `docs/SEO-PLAYBOOK.md`.

Each week:

1. Open `devto/<slug>.md` and copy the whole file, front matter included.
2. On dev.to, click Create Post and paste it over everything in the editor.
3. Click Preview. Check the cover, the two diagrams and the footer link.
4. The file says `published: false`, so saving keeps it as a draft. When it looks right, change that line to `published: true` and save.

The cover is the site's 1200 x 630 share image. DEV crops covers to a wider shape, so look at the preview once.

### Hashnode

One time: create the blog (a free `*.hashnode.dev` address is fine; do not point anirudhvasudevan.com at it). Set your profile name, tagline and website the same way as DEV.

Each week:

1. Open `hashnode/<slug>.md`. The block between the two `---` lines holds the settings; everything below it is the article.
2. In Hashnode, start a new draft. Paste the title. Add the subtitle from `subtitle:`.
3. Paste everything below the second `---` into the editor.
4. Cover: upload `public/blog/og/<slug>.png` from this repo (the same image as `cover:`).
5. In the draft settings: set the slug from `slug:`, add the tags from `tags:` (pick Hashnode's suggestion for each), and turn on the option for republished articles, then paste the `canonical:` URL as the original URL.
6. Preview, then publish.

If you later connect Hashnode to a GitHub repo instead, these files already use Hashnode's front matter keys; add a `domain:` line with your Hashnode blog address.

If Hashnode says a subtitle is too long, shorten it there; the site's description is the source.

### Medium

One time: in Settings, set your name to Anirudh Vasudevan and the short bio to the one-line bio from the bio kit.

Each week:

1. Go to `https://medium.com/p/import`, paste the next URL from `medium/import-list.md`, and click Import.
2. Medium makes a draft and sets the canonical link to the original by itself.
3. Find where the two diagrams belong (the captions are listed under the story in `medium/import-list.md`), upload the images listed there, and type the caption under each.
4. Check that the footer link to anirudhvasudevan.com survived.
5. Publish, and add the five tags listed for that story.
