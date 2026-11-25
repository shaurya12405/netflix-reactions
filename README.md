# Scene Talk

Spoiler-safe comments that replay at the exact moment they were written.
Works with Netflix. Not affiliated with or endorsed by Netflix.

> **Status: Milestone 2 (backend).** The extension detects the player, mounts a
> status panel (also in fullscreen and across episode changes), records which
> parts of each episode you have actually watched, and supports Google sign-in
> with a chosen display name. The database schema is in place; the comment UI
> arrives in M3.

**Backend setup (free, ~20 minutes): [docs/SETUP.md](docs/SETUP.md)**

## How it works (so far)

| Piece | Where | Notes |
| --- | --- | --- |
| Netflix adapter | `src/adapters/netflix.ts` | The **only** file that knows Netflix's URLs and DOM. Reads the title ID from `/watch/<id>` and the `<video>` element's time and events. Never touches DRM, the stream or frames. |
| Watched ranges | `src/core/watched-ranges.ts` | Pure, unit-tested. Records intervals you actually played through. Continuity is measured in media time: a jump of more than 2 s counts as a seek, so skipping ahead never unlocks the skipped part. |
| Controller | `src/content/controller.ts` | Wires the adapter to tracking, storage and the UI. Platform-agnostic. |
| UI | `src/ui/` | Preact inside a Shadow DOM, mounted inside the player container so it survives fullscreen. |
| Event shield | `src/ui/event-shield.ts` | Keeps the player from reacting to typing and clicks in our panel (details below). |
| Auth | `src/background/auth.ts` | Google sign-in through Supabase (PKCE) with `identity.launchWebAuthFlow`, run in the background script, because the popup closes when the Google window opens. The session lives in extension storage. |
| Database | `supabase/migrations/` | Postgres tables with Row Level Security, rate limits and the heat-map RPC (see below). |

The content script matches all of `www.netflix.com` because Netflix is a
single-page app: you reach `/watch/<id>` from `/browse` without a page load, so
a script matching only `/watch/*` would never be injected. It stays dormant (no
UI, no network) until the adapter finds a watch page with a player.

**Keyboard shield.** Netflix handles keys like space, `f` and the arrows. If those
listeners run in the capture phase, stopping events at our shadow host would be
too late. So Scene Talk registers capture listeners on `window` at
`document_start`, before any page script, and swallows key events that
originate inside its UI. Text input still works because default actions are
unaffected.

## Database and security model

All rules are enforced in Postgres, so they hold no matter which client calls the API.

| Table | Signed-out visitors | Signed-in users |
| --- | --- | --- |
| `profiles` | read `id`, `display_name` only | create, rename, delete their own; names are unique ignoring case |
| `comments` | read | read, delete their own. **No direct insert or edit**: from M3 an Edge Function validates and moderates, then inserts with the service role |
| `likes` | none | like/unlike as themselves; see only their own likes. `like_count` is kept by a `SECURITY DEFINER` trigger |
| `reactions` | read (without `user_id`) | add/remove their own |
| `reports` | none | report as themselves, once per comment; see only their own reports |

Triggers also force `created_at` and `like_count` on insert, keep replies one
level deep on the same video, and rate-limit per user: 5 comments and 20
reactions per minute, serialised with an advisory lock so parallel requests
can't slip through. `heatmap(p_video_id)` returns comment and reaction counts
per 10-second bucket. Video IDs are namespaced by platform (`netflix:80100172`).

`supabase/tests/database/` holds pgTAP tests for every rule above. Run them with
`npm run test:db` (Linux or WSL: needs PostgreSQL plus pgTAP; see the script
header), or with Docker via `npx supabase start` then `npx supabase test db`. CI runs them on every push.

## Development

Requires Node 22+.

```bash
npm install
```

```bash
cp .env.example .env
```

Fill in `.env` as described in [docs/SETUP.md](docs/SETUP.md). Without it the
extension still builds; sign-in is simply disabled.

```bash
npm run dev            # Chrome with hot reload
npm run dev:firefox    # Firefox with hot reload
npm run build:all      # production builds in .output/chrome-mv3 and .output/firefox-mv3
npm run typecheck
npm test               # unit tests (Vitest)
npm run test:db        # database tests (pgTAP) on a throwaway local Postgres
npm run test:e2e       # builds, then runs a Playwright smoke test against a fake player page
```

`test:e2e` needs `ffmpeg` (to generate a test video) and a Playwright Chromium
(`npx playwright install chromium`). Set `PW_CHROMIUM_PATH` to use another
Chromium binary. The smoke test uses a fake player page, so it checks Scene
Talk's own logic but not Netflix's real markup; for that, see below.

### Load the build manually

- **Chrome:** `chrome://extensions` → turn on **Developer mode** → **Load unpacked** →
  pick `.output/chrome-mv3`. The extension ID is always
  `ogpidfiegoigmchlfmmdempbapjlbcnp` (pinned by the public `key` in
  `wxt.config.ts`, which keeps the sign-in redirect URL stable).
- **Firefox:** `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** →
  pick `.output/firefox-mv3/manifest.json`. If the panel doesn't appear, open
  the Scene Talk toolbar popup and click **Allow access to netflix.com**.

### Verifying the adapter on Netflix

Netflix's markup is undocumented and changes. If the panel stops appearing,
check these in DevTools on a `/watch/` page:

1. `document.querySelectorAll('video').length`: expect 1.
2. Which of `PLAYER_CONTAINER_SELECTORS` in `netflix.ts` matches an ancestor of the video.
3. After entering fullscreen: `document.fullscreenElement` must contain the
   `<scene-talk-root>` element.
