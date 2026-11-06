# localvibecheck.site

Static site for [Local Vibe Check](https://www.youtube.com/@LocalVibeCheck): one page per YouTube video, with
the embedded video, every price tier written out, and the local business the video names. Same build-and-deploy
setup as bluecollarrankings.com.

- **Price guides** (`/guides/`): each pricing video gets tier cards, comparison tables, chapters, its Short, and a "give them a shout" business card.
- **Business Spotlight** (`/spotlight/`): each spotlight gets a page and the **Vibe Check: Passed** award.
- **Places** (`/places/`): every guide, spotlight and Short filed under its town.
- **Videos** (`/videos/`): everything on the channel, including Shorts.

## How videos get on the site

`scripts/build.mjs` reads the channel's YouTube feed on every build. Any upload that isn't in `data/videos.json`
yet gets a page automatically, built from its YouTube description (the 🔗 links, "Heading:" + "•" price lists,
📞/🛠️ business details and "Chapters:"). The deploy workflow rebuilds daily, so new uploads appear within a day
with no commit.

To file a video properly (town, topic, headline price, featured business, Short), add it to `data/videos.json`:

```json
{
  "id": "YouTubeVideoId",
  "kind": "guide",            // guide | pick | spotlight | short
  "title": "Title as on YouTube",
  "published": "2026-11-05",
  "duration": "3:06",
  "slug": "westlake-village-bathroom-remodel-cost",
  "headline": "Bathroom Remodel Cost in Westlake Village",
  "topic": "Bathroom Remodel",
  "category": "Home & Remodeling",
  "places": ["westlake-village-ca"],   // keys from data/places.json
  "price": "From $5,250",              // the orange pill
  "range": "$5,250 – $52,500+",
  "business": "All Exclusive Construction",  // key from data/businesses.json
  "short": "S-54zHprY-0",              // optional: the matching Short
  "description": "Paste the YouTube description here"
}
```

Save the thumbnail as `static/img/thumbs/{id}.jpg` (640×360). Shorts also use `{id}-v.jpg` (360×640).

## The award

Spotlights with an `award` block earn the **Vibe Check: Passed** seal and footer badge:

```json
"award": { "line": "General Contractor · SoCal", "awarded": "2026-11-06" }
```

`line` runs around the bottom of the seal. Run `npm run images` after adding one, so its PNGs exist in
`static/awards/` for the embed codes on the spotlight page.

## Build

```sh
npm run build    # writes public/
npm run images   # also renders award PNGs, favicons and the share image (needs Playwright + Chromium)
npm run serve    # preview public/ locally
```

`SKIP_YOUTUBE_FEED=1 npm run build` builds offline from `data/videos.json` only.

## Deploy

Every push to the default branch, plus a daily scheduled run, executes `.github/workflows/deploy.yml`, which
builds the site and deploys `public/` to the `local-vibe-check` Cloudflare Pages project. It needs a
`CLOUDFLARE_API_TOKEN` repository secret with Pages:Edit, Zone:Read and DNS:Edit (plus Zone:Edit if the workflow
should add localvibecheck.site to Cloudflare itself). Once the domain is in Cloudflare, the workflow attaches
`localvibecheck.site` and `www.localvibecheck.site` and points DNS at Pages. `functions/_middleware.js` redirects
`www.` and `*.pages.dev` to the bare domain.

Nameservers for localvibecheck.site at Namecheap (Domain List → Manage → Nameservers → Custom DNS) are the pair
Cloudflare shows when the domain is added to the account; for this account that has been
`anahi.ns.cloudflare.com` and `braden.ns.cloudflare.com`.
