# Google Drive Setup — Challan Uploads & Business Pad Image

The same one-time setup below powers **two** features:

1. **Sales Report → Upload Challan** button on every row — uploads the
   photo/scan you pick to a shared Google Drive folder. Files are named
   `{ChalanNo}_{CustomerName}_{Date}.{ext}` automatically, e.g.
   `000042_Rahman Traders_2026-07-30.jpg`.
2. **Business Pad Setup → pad header image** — when you upload/replace the
   image used as your invoice/quotation letterhead, it now goes to Drive too
   instead of being stored directly in the database. This is what keeps your
   Aiven MySQL storage small — a full image can be several MB, but the link
   saved in the database is just a few bytes.

**This uses OAuth as your own Google account** — not a service account.
(We tried a service account first; Google rejected it with `Service Accounts
do not have storage quota` — that's a hard Google rule for personal/free
Drive accounts, only lifted inside a paid Google Workspace "Shared Drive."
OAuth as your own account avoids that entirely.) The tradeoff is a one-time
browser sign-in step (Step 6 below) instead of a fully silent setup — after
that, it's just as automatic.

Everything lands in **one shared folder** in your own Drive that you
control (the pad image reuses this same folder).

---

## Step 1 — Create a Google Cloud project ✅ (done)

## Step 2 — Enable the Google Drive API ✅ (done)

## Step 3 — Configure the OAuth consent screen

1. In the left sidebar: **APIs & Services → OAuth consent screen**.
2. User Type: **External** → **Create**.
3. Fill in the required fields: App name (e.g. `Jahan Trading Drive`), your
   email as the User support email, your email again as the Developer
   contact. Everything else can stay blank → **Save and Continue**.
4. On the **Scopes** step, click **Add or Remove Scopes**, search for
   `drive.file`, check the one described as *"See, edit, create, and delete
   only the specific Google Drive files you use with this app"* → **Update**
   → **Save and Continue**. (Deliberately narrow — the app only ever
   uploads new files, never touches your other Drive content, and this
   narrower scope is why you won't hit Google's app-verification process.)
5. On the **Test users** step, click **Add Users** and add your own Google
   account's email → **Save and Continue**.
6. Review and click **Back to Dashboard**.

## Step 4 — Create the OAuth Client ID

1. Left sidebar: **APIs & Services → Credentials**.
2. Click **+ Create Credentials → OAuth client ID**.
3. Application type: **Desktop app**. Name it anything, e.g. `Jahan Trading Desktop`.
4. Click **Create**. A dialog pops up — click **Download JSON**.
5. Rename the downloaded file to `oauth_client_secret.json` and place it in
   the project's root folder (next to `config.json`).

## Step 5 — Create the Drive folder

1. Go to https://drive.google.com (your normal Google Drive).
2. Create a new folder, e.g. **"Challans"**.
3. Open it and copy its **folder ID** from the URL:
   `https://drive.google.com/drive/folders/`**`THIS_PART_IS_THE_ID`**
4. Paste it into `config.json`:
   ```json
   "google_drive": {
     "oauth_client_secret_path": "oauth_client_secret.json",
     "oauth_token_path": "drive_token.json",
     "challans_folder_id": "PASTE_THE_FOLDER_ID_HERE"
   }
   ```
   (No sharing step needed this time — it's your own account uploading into
   your own folder.)

## Step 6 — Run the one-time authorization

From the project folder, run:
```bash
python authorize_google_drive.py
```
This opens your browser to a Google sign-in/consent screen (you'll likely
see an "unverified app" warning since this is your own personal-use app —
click **Advanced → Go to (app name) (unsafe)**, this is expected and safe
since it's your own app). Approve access. The script saves a `drive_token.json`
file in the project folder and prints a success message.

**That's the only manual sign-in you'll ever need to do** — the app reuses
and auto-refreshes this token from then on.

## Step 7 — Try it

1. Restart the app (`python app.py`, or restart the packaged exe).
2. Go to **Sales Report** → click **Challan** on any row → pick a photo. It
   should upload and a **View File** link will appear in that row's "Challan
   File" column.
3. Go to **Business Pad Setup** → pick a pad image → **Save Business Pad
   Settings**. The image uploads to the Drive folder at save time (not the
   moment you pick the file), and only the resulting link is stored.

---

## If you're deploying to Render

Render's filesystem is read-only for anything committed to the repo, and you
should **never commit `oauth_client_secret.json` or `drive_token.json` to
git** (both are credentials — `drive_token.json` in particular grants
ongoing upload access without needing to sign in again).

1. In the Render dashboard → your service → **Environment → Secret Files**.
2. Add two Secret Files: `oauth_client_secret.json` and `drive_token.json`
   (paste each file's full contents as its value — run Step 6 locally first
   to generate `drive_token.json`, since Render can't open a browser for you).
3. Render mounts them at `/etc/secrets/...` — update `config.json`'s
   `oauth_client_secret_path`/`oauth_token_path` to those full paths (same
   pattern already used for `ca.pem`/the database credentials on Render; see
   `DEPLOYMENT.md`).

## Troubleshooting

- **"Google Drive isn't authorized yet"** — run `python authorize_google_drive.py`
  (Step 6).
- **"Google Drive authorization has expired or was revoked"** — run
  `python authorize_google_drive.py` again. This can happen if you revoke
  access from your Google Account's security settings, or if the token file
  is deleted/moved.
- **"Google Drive folder is not configured"** — `challans_folder_id` is
  blank in `config.json`.
- **"Service Accounts do not have storage quota" / 403 storageQuotaExceeded**
  — this means something is still pointed at the old service-account
  approach; make sure `config.json`'s `google_drive` block matches Step 5
  above (oauth_client_secret_path/oauth_token_path, not
  service_account_key_path).
- The "Google hasn't verified this app" warning during Step 6 is expected
  and safe to click through (**Advanced → Go to ... (unsafe)**) — it's your
  own app, using a narrow scope that only touches files it creates itself.
