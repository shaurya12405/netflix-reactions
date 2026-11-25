# Setting up Scene Talk's backend (free)

Everything here uses free tiers: Supabase Free and a Google Cloud project with
no billing. Allow about 20 minutes. Dashboard labels change from time to time;
if a name below doesn't match exactly, look for the closest equivalent.

You will end up with two values for `.env` (the Supabase URL and the public
key) and a Google client secret that lives **only in the Supabase dashboard**.
Never put the Google client secret or Supabase's `service_role`/secret key in
this repo or in `.env`.

---

## 1. Create the Supabase project

1. Go to https://supabase.com and sign in (GitHub sign-in is fine).
2. Click **New project**.
   - **Name:** `scene-talk`
   - **Database password:** click *Generate*, then save it in your password manager.
   - **Region:** the one closest to most of your users.
   - **Plan:** Free.
3. Click **Create new project** and wait 1–2 minutes until the dashboard is ready.
4. Note your **project ref**: the random ID in the dashboard URL
   (`supabase.com/dashboard/project/<project-ref>`). Your API URL is
   `https://<project-ref>.supabase.co`.

## 2. Copy the URL and public key into `.env`

1. Open **Project Settings → API Keys** (on older dashboards: **Project Settings → API**).
2. Copy the **publishable** key (starts with `sb_publishable_`). If you only see
   legacy keys, copy the **anon / public** key instead. Do **not** copy the
   secret / `service_role` key.
3. In the repo folder, create `.env` from the template:

   ```bash
   cp .env.example .env
   ```

   On Windows PowerShell use `Copy-Item .env.example .env`. Then fill it in:

   ```
   WXT_SUPABASE_URL=https://<project-ref>.supabase.co
   WXT_SUPABASE_ANON_KEY=sb_publishable_...
   ```

The public key is designed to ship inside the extension: Row Level Security
in the database decides what it can do.

## 3. Create the database tables

**Option A: Supabase CLI (recommended).** From the repo folder:

```bash
npx supabase@latest login
```

```bash
npx supabase@latest link --project-ref <project-ref>
```

```bash
npx supabase@latest db push --remote
```

`link` asks for the database password from step 1. `db push --remote` applies
every file in `supabase/migrations/` to your online project, in order, and
records which ones ran, so later milestones only need the same command again.
(Without `--remote`, newer CLI versions target a local Docker copy of Supabase
and fail with "connect ECONNREFUSED 127.0.0.1:54322".)

**Option B: SQL editor.** In the dashboard open **SQL Editor**, then for each
file in `supabase/migrations/`, oldest first, paste its contents and click
**Run**. (If you use this option, keep using it: the CLI won't know these ran.)

Check: **Table Editor** should list `profiles`, `comments`, `likes`,
`reactions` and `reports`, each marked as RLS enabled.

## 4. Create the Google OAuth client

1. Go to https://console.cloud.google.com and sign in.
2. Project picker (top left) → **New project** → name it `Scene Talk` → **Create**,
   then make sure it's selected. No billing account is needed.
3. Open **Google Auth Platform** (search for "OAuth consent screen" if you
   don't see it) → **Get started**:
   - **App name:** `Scene Talk`
   - **User support email:** your email
   - **Audience:** **External**
   - **Contact information:** your email
   - Agree to the policy → **Create**.
   - **Don't upload a logo.** A logo triggers Google's brand verification;
     without one, basic sign-in needs no review.
4. **Data access → Add or remove scopes:** select only `openid`,
   `.../auth/userinfo.email` and `.../auth/userinfo.profile` → **Update** → **Save**.
5. **Clients → Create client:**
   - **Application type:** Web application
   - **Name:** `Scene Talk (Supabase)`
   - **Authorized redirect URIs → Add URI:**
     `https://<project-ref>.supabase.co/auth/v1/callback`
   - Click **Create**, then copy the **Client ID** and **Client secret**.
6. **Audience → Test users → Add users:** add the Google account(s) you will
   test with (up to 100), then **Save**. While the app is in *Testing*, only
   these accounts can sign in; everyone else sees "access blocked".
7. **Later, to let anyone sign in: publish the app.** Google enables
   **Audience → Publish app** only once the **Branding** page is complete,
   which includes an app home page link and a **privacy policy link**. The
   privacy policy page is added in M6 (GitHub Pages). Then: fill in Branding
   (home page `https://github.com/shaurya12405/netflix-reactions`, privacy
   policy URL, and add `shaurya12405.github.io` under authorized domains if
   asked), and click **Publish app → Confirm**. With only the three basic
   scopes above, Google requires no verification for production.

## 5. Turn on Google sign-in in Supabase

1. Supabase dashboard → **Authentication → Sign In / Providers** (older: **Providers**) → **Google**.
2. Enable it, paste the **Client ID** and **Client secret** from step 4.5, and click **Save**.

## 6. Allow the extension's redirect URLs

Supabase only sends sign-ins back to addresses on its allow list.

1. **Authentication → URL Configuration.**
2. **Site URL:** `https://shaurya12405.github.io/netflix-reactions/` (any URL you
   own works; it's only a fallback).
3. **Redirect URLs → Add URL**, add:
   - Chrome: `https://ogpidfiegoigmchlfmmdempbapjlbcnp.chromiumapp.org/`
   - Firefox: load the Firefox build, open the Scene Talk popup, expand
     **Sign-in setup info**, and copy the URL shown there (it ends in
     `.extensions.allizom.org/`).
4. **Save.**

## 7. Build and try it

```bash
npm run build
```

Then reload the extension on `chrome://extensions` (circular arrow on the Scene Talk card).

1. Click the Scene Talk toolbar icon → **Sign in with Google**. The popup
   closes and a Google window opens; choose your account.
2. Open the popup again: it asks for a **display name**. Save one.
3. The popup now says **Commenting as &lt;your name&gt;**.

In Supabase → **Authentication → Users** you should see your account, and
**Table Editor → profiles** should show your display name.

## 8. Netflix connectivity check

This checks whether Netflix's security settings block Scene Talk from talking
to Supabase directly from the page (relevant for Firefox especially).

1. Open any Netflix episode. In the Scene Talk panel click **Check Supabase connectivity**.
2. Note the four results (content script / background × REST / Realtime).
3. Repeat in Firefox if you can.

Green everywhere means comments can load straight from the page. Any red
under "From content script" means M3 routes those requests through the
background script instead. Either way, send the results to continue.

---

## Free-tier notes

- **Pausing:** Supabase pauses Free projects after about a week with no
  activity. Restore it from the dashboard with one click. Any real use keeps it awake.
- **Limits** (comfortable for a portfolio project): 500 MB database, 50,000
  monthly active users, 500,000 Edge Function calls/month, 200 concurrent
  Realtime connections.
- **Consent screen domain:** Google shows `<project-ref>.supabase.co` as the
  app's domain. A custom auth domain is a paid Supabase add-on, so we keep the default.
