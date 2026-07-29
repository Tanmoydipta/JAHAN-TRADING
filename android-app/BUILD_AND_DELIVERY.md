# Building & Delivering the Android App

This project cannot be built from this machine's command line — there's no
Java/Android SDK installed here. The path forward is Android Studio, which
bundles everything needed (JDK 17 + Android SDK) in one installer.

## 1. What to download

| # | Item | Where | Size | Notes |
|---|------|-------|------|-------|
| 1 | **Android Studio** (latest stable, "Ladybug" or newer) | https://developer.android.com/studio | ~1.1 GB installer, ~5-8 GB after SDK install | Includes JDK 17 and the Gradle/Android SDK components — you do **not** need to separately install Java or the SDK. |

That's the only download. Everything else (Gradle wrapper, dependencies,
compiler) is fetched automatically by Android Studio the first time you open
the project (needs internet access during that first sync).

A physical or virtual Android device is also useful for testing:
- **Physical phone**: enable Developer Options (Settings → About phone → tap
  "Build number" 7 times) → enable USB Debugging → plug in via USB.
- **Emulator**: Android Studio can create one (Device Manager → Create
  Device) — no extra download beyond the system image it prompts for (~1 GB).

## 2. Install & open the project

1. Run the Android Studio installer, accept defaults (Standard install type).
2. On first launch, let it finish its own "SDK Components Setup" wizard —
   this downloads the Android SDK, platform tools, and build tools. Can take
   10-20 minutes depending on connection.
3. **File → Open** → select the `android-app` folder in this repo.
4. Android Studio will detect there's no Gradle wrapper jar and prompt
   something like *"Gradle wrapper is not found, create one?"* — accept it
   (or it may just sync using its bundled Gradle directly). Let Gradle sync
   finish; it will download all the project's dependencies (Compose, Retrofit,
   Room, Hilt, WorkManager, etc.) automatically.
5. If sync reports a missing SDK platform (e.g. "Android 35"), click the
   "Install missing SDK package(s)" link that appears in the sync banner.

## 3. Point the app at your live API before building for a client

The app talks to the Flask REST API, not the database directly — same
security model as the desktop exe. Before shipping to a real client, the
Flask server needs to be reachable from their phone over the internet
(not `10.0.2.2` or a LAN IP, unless the client's phone is on the same LAN as
the machine running the exe).

- Deploy `app.py` + `database.py` + `ca.pem` to a host with a public URL and
  HTTPS (Railway, Render, or a VPS with a reverse proxy + TLS cert).
- Open `app/build.gradle.kts`, find the `release` block, and replace:
  ```kotlin
  buildConfigField("String", "API_BASE_URL", "\"https://your-api.example.com/\"")
  ```
  with the real deployed URL (must end in `/`).
- Alternatively, skip this and let the client type the server URL directly
  into the login screen's "API Server" field at first launch — the app
  saves whatever URL is entered, so a hardcoded release default isn't
  strictly required, just a convenience.

## 4. Generate the release APK

1. **Build → Generate Signed App Bundle / APK…**
2. Choose **APK** → Next.
3. **Create new…** keystore (first time only):
   - Pick a save path (e.g. `jahan-release-key.jks`) — **back this up**,
     losing it means you can never publish an update under the same app
     identity again.
   - Set a keystore password, key alias, and key password. Store these
     somewhere safe (password manager), not in this repo.
4. Select build variant: **release**.
5. Check both signature versions (V1 + V2) if prompted, then **Finish**.
6. Android Studio builds and shows a notification with a **"locate"** link —
   the APK lands at:
   ```
   android-app/app/release/app-release.apk
   ```

## 5. Deliver to the client

The app is not on the Play Store, so it's a direct "sideload":

1. Send `app-release.apk` to the client (email, WhatsApp, Google Drive link,
   USB transfer — any file transfer method).
2. On their Android phone, they tap the file to install. Android will show
   a warning about installing from an unknown source — they tap
   **Settings → allow this source**, then **Install**. This is normal for
   apps distributed outside the Play Store.
3. First launch: they enter the API server URL (the one from step 3) and log
   in with their existing username/password from the desktop system.
4. First run will also prompt for the **Notifications** permission (Android
   13+) and, the first time a phone-number field's contact-pick button is
   tapped, the **Contacts** permission — both are optional to grant; the app
   still works without them (no background alerts / no contact-pick shortcut).

## 6. What's new in this build

- **Notifications**: a background check every 6 hours (via WorkManager, no
  Firebase/Google account needed) surfaces outstanding receivables, low-stock
  counts, and pending authorizations as local notifications. Tapping one
  opens the app. Runs only while a user is logged in.
- **Contact linking**: any free-text field whose name implies a phone number
  (`contact_number`, `mobile_number`, etc.) now has a contacts icon — tapping
  it opens the device's contact picker and fills the field with the selected
  contact's number, instead of typing it manually.

## 7. Future updates

To ship an update later: bump `versionCode`/`versionName` in
`app/build.gradle.kts`, repeat step 4 **using the same keystore file and
passwords** (a mismatched keystore means the client must uninstall the old
app before installing the new one — they'd lose local cached/offline data),
then redistribute the new APK the same way.
