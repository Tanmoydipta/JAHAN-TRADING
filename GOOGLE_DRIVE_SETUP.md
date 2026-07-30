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

Both use a **service account** (a robot Google identity, not your personal
login) so no one has to click through a Google sign-in screen — it works the
same on your desktop exe and on Render.

Everything lands in **one shared "Challans" folder** that you control (the
pad image reuses this same folder — there's nothing extra to set up for it).

You only have to do this once. Follow the steps in order.

---

## Step 1 — Create a Google Cloud project

1. Go to https://console.cloud.google.com/ and sign in with your Google account.
2. Click the project dropdown (top left, next to "Google Cloud") → **New Project**.
3. Name it something like `jahan-trading-drive` → **Create**.
4. Wait a few seconds for it to finish, then make sure it's selected in the
   project dropdown at the top.

## Step 2 — Enable the Google Drive API

1. In the search bar at the top, type **"Google Drive API"** and open it.
2. Click **Enable**.

## Step 3 — Create the service account

1. In the left sidebar: **APIs & Services → Credentials**.
2. Click **+ Create Credentials → Service account**.
3. Give it a name, e.g. `jahan-challan-uploader`. Click **Create and Continue**.
4. On the "Grant this service account access to project" step, you can click
   **Continue** without picking a role (we'll share a specific folder with it
   instead — that's more secure than project-wide access).
5. Click **Done**.

## Step 4 — Generate the JSON key

1. You'll now see the service account in the Credentials list. Click on it.
2. Go to the **Keys** tab → **Add Key → Create new key**.
3. Choose **JSON** → **Create**. A `.json` file downloads automatically —
   this is the only copy Google gives you, so keep it safe (treat it like a
   password: never commit it to a public git repo, never share it).
4. Note the service account's **email address** shown on this page — it looks
   like `jahan-challan-uploader@jahan-trading-drive.iam.gserviceaccount.com`.
   You'll need it in the next step.

## Step 5 — Create the shared Drive folder and share it with the service account

1. Go to https://drive.google.com (your normal Google Drive, in your own account).
2. Create a new folder, e.g. **"Challans"**.
3. Right-click it → **Share** → paste in the service account's email address
   from Step 4 → give it **Editor** access → **Send** (it's fine that it's a
   robot account, not a real person — Drive will let you share with it).
4. Open the folder and copy its **folder ID** from the URL:
   `https://drive.google.com/drive/folders/`**`THIS_PART_IS_THE_ID`**

## Step 6 — Wire it into the app

1. Rename the downloaded JSON key file to `service_account.json` and place it
   in the project's root folder (next to `config.json` and `ca.pem`).
2. Open `config.json` and fill in the `google_drive` block:
   ```json
   "google_drive": {
     "service_account_key_path": "service_account.json",
     "challans_folder_id": "PASTE_THE_FOLDER_ID_FROM_STEP_5_HERE"
   }
   ```
3. Restart the app (`python app.py`, or restart the packaged exe).
4. Go to **Sales Report** → click **Challan** on any row → pick a photo. It
   should upload and a **View File** link will appear in that row's "Challan
   File" column.
5. Go to **Business Pad Setup** → pick a pad image → **Save Business Pad
   Settings**. The image uploads to the same Drive folder at save time (not
   the moment you pick the file), and only the resulting link is stored —
   check `config.json`'s folder afterward and you'll see a file named
   `letterhead_pad.jpg`/`.png` there.

---

## If you're deploying to Render

Render's filesystem is read-only for anything committed to the repo, and you
should **never commit `service_account.json` to git** (it's a credential).
Instead:

1. In the Render dashboard → your service → **Environment → Secret Files**.
2. Add a Secret File with filename `service_account.json` and paste the full
   contents of the downloaded JSON key as its value.
3. Render mounts it at `/etc/secrets/service_account.json` — update
   `config.json`'s `service_account_key_path` to that full path (this is the
   same pattern already used for `ca.pem`/the database credentials on Render;
   see `DEPLOYMENT.md`).

## Troubleshooting

- **"Google Drive is not configured yet"** — `service_account_key_path` is
  missing or the file isn't at that path.
- **"Google Drive challans folder is not configured"** — `challans_folder_id`
  is blank in `config.json`.
- **403 / permission errors on upload** — the folder wasn't actually shared
  with the service account's email address (Step 5), or it was shared as
  "Viewer" instead of "Editor".
- Uploaded files not visible in your normal Drive view — that's expected if
  you look at "My Drive" instead of the shared "Challans" folder itself;
  files created by the service account live inside that folder, open the
  folder directly (or the "Shared with me" view) to see them.
