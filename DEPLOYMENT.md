# Deploying Jahan Trading as a hosted link (website + Android app)

This replaces the old model (build an .exe, hand it to the client, it runs
locally on their PC). Instead: the Flask app runs continuously on a cloud
host with a public HTTPS URL. The client opens that URL in any browser —
that's the "website." The Android app talks to the exact same URL. One
backend, two front doors.

## Why Render

Render was chosen because it needs the least ceremony for a small Flask
app: free tier, automatic HTTPS, deploys straight from a GitHub push, and
supports uploading secret files outside of git (needed since `config.json`
holds live DB credentials and must never enter git history). Railway or a
plain VPS work too, but the steps below are Render-specific.

## 0. What you need

| Item | Where |
|---|---|
| A GitHub account | https://github.com/signup (free) |
| A Render account | https://render.com (free tier is enough to start) |

## 1. Finish the local git commit

This repo was just initialized (`git init`) and everything except live
secrets was staged. `config.json` was deliberately **left out** — it holds
your real Aiven DB password in plaintext and must never reach GitHub.

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
git commit -m "Initial commit"
```

## 2. Push to GitHub

1. Create a new repository at https://github.com/new — **make it Private**
   (the encrypted-config passphrase in `secure_config.py` and the app's
   internal logic are in this repo; private keeps it away from search
   engines and randoms, even though no live secret is actually committed).
2. Don't initialize it with a README (this repo already has commits).
3. Back in the terminal:
   ```bash
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git branch -M main
   git push -u origin main
   ```

## 3. Create the Render web service

1. https://dashboard.render.com → **New +** → **Web Service**.
2. Connect your GitHub account, pick the repo you just pushed.
3. Fill in:
   - **Name**: something like `jahan-trading-api` (this becomes part of
     your URL: `https://jahan-trading-api.onrender.com`)
   - **Region**: closest to where the client actually is
   - **Branch**: `main`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn app:app --bind 0.0.0.0:$PORT` (already in
     the `Procfile`, Render should detect it automatically — set it
     explicitly if it doesn't)
   - **Instance Type**: Free, to start

## 4. Upload the real config.json as a Secret File

Since `config.json` isn't in the repo, the deployed app has no config
until you give it one directly through Render (never through git):

1. In the new service → **Environment** tab → **Secret Files** → **Add
   Secret File**.
2. **Filename**: `config.json` (just the bare name — Render rejects a
   path here and mounts it under `/etc/secrets/` automatically; you don't
   type that prefix yourself)
3. **Contents**: paste the full contents of your local `config.json`
   (the real one, with the live Aiven credentials).
4. Same for `ca.pem` if you're not already committing it (it's just a
   public CA certificate, not a secret, so committing it — as this repo
   already does — is fine; only do this step if you'd rather keep it out
   of git too).
5. Environment tab → **Environment Variables** → add:
   - `CONFIG_PATH` = `/etc/secrets/config.json`

   (`database.py` reads this env var to locate the config — see the
   `CONFIG_PATH` override added for exactly this purpose.)

## 5. Deploy

Render deploys automatically once the service + secret file + env var are
set. Watch the **Logs** tab — you're looking for:

```
Database initialized in MYSQL mode successfully!
```

If it instead errors on startup, the two most likely causes are: the
`CONFIG_PATH` env var doesn't match the secret file's path exactly, or the
Aiven database's connection allowlist doesn't include Render's egress IPs
(Aiven defaults to allowing all IPs unless you've locked it down — if you
have, add Render's IPs or switch to Aiven's "allow all" for this DB).

## 6. Get your link

Once deployed, Render gives you:

```
https://jahan-trading-api.onrender.com
```

That's it — that's the "link." Anyone with it can open it in a browser and
see the same login screen the desktop exe used to show. No install, no
exe, no client PC needing to stay on.

## 7. Point the Android app at it

Two ways, pick one:

**A. Hardcode it as the default** (recommended for the version you hand
to the client) — edit `android-app/app/build.gradle.kts`, in the
`release` block:
```kotlin
buildConfigField("String", "API_BASE_URL", "\"https://jahan-trading-api.onrender.com/\"")
```
Then rebuild the signed APK (see `android-app/BUILD_AND_DELIVERY.md`).

**B. Type it into the login screen** — the app's "Server" field accepts
any URL at runtime and remembers it, no rebuild needed. Useful for testing
before you're ready to bake in the production URL.

## 8. What changed about who can reach it

This is now open to the **whole internet**, not just your LAN — that's the
point. It's safe to do this specifically *because* the token-based
authentication added in this same session means every endpoint except
`/`, `/api/config`, and `/api/login` requires a valid session token, and
`client_id` is now pinned server-side to the logged-in user's own account
unless their role explicitly allows cross-client access. Anyone without a
valid username/password gets 401s across the board.

## 9. A note on the free tier

Render's free web services spin down after ~15 minutes of no traffic and
take 30-60 seconds to wake back up on the next request. The client's first
tap of the link (or the app's first request) after a quiet period will
feel slow once, then be normal until it goes idle again. If that's not
acceptable, Render's paid "Starter" tier ($7/mo at time of writing) keeps
it always warm — worth it once this is in real use, not just testing.

## 10. The old exe path is still there, unused

`build.py` / PyInstaller packaging still works if you ever want an
offline-capable desktop build again, but it's no longer the delivery
method — nothing was deleted, it's just not part of this flow anymore.
