# Seventh Leaf for Android: plan

This is the working plan for an Android app version of Seventh Leaf. It is written for whoever builds the app
(a Claude Code cloud session, a local session, or a person) and for Mel, who decides and tests. Each stage ends
with a pull request that Mel reviews and tries on the phone before the next stage starts.

## Decisions so far

- **Device**: an Android phone first, the realme GT 7 Pro. Tablets and other phones should work, but are not
  tested until a friend asks.
- **Pictures, videos and music**: in the phone's own storage (camera folder, Pictures, Music). No cloud, no
  network: the app works fully offline, as the desktop version does.
- **Distribution**: for Mel and a few friends, as an installable file (APK). Not on Google Play for now.

## The test phone

- realme GT 7 Pro (RMX5010), Android 16 (API 36), Snapdragon 8 Elite, 12 GB RAM.
- Screen 1264 × 2780 at 560 dpi: the web page sees about 361 × 794 CSS pixels in portrait (794 × 361 in
  landscape), at a device pixel ratio of 3.5. 120 Hz display.
- Android System WebView 151.
- The library is several thousand JPG photos, a few dozen MP4 and MOV videos, and MP3, FLAC and M4A music,
  plus some WMA files. There are no HEIC photos.
- Free space on the phone is small (under 10 GB): the app's index and thumbnails must stay small.
- The phone is connected to Mel's PC over wireless ADB. Cloud sessions cannot reach it: installing builds and
  on-device checks happen on the PC.

## Approach

Keep the existing web app and wrap it in a native Android shell with **Capacitor**, adding small native pieces
only where Android needs them. Almost everything already runs in Android's WebView: the three.js wall, the
decode and thumbnail workers, OffscreenCanvas, createImageBitmap, `<video>`, `<audio>` and the Web Audio flip
sounds. A rewrite in Kotlin would redo about 3,600 lines for no visible gain.

The one part that does not carry over is **folder mode**. On the desktop it uses Chromium's
`showDirectoryPicker()` and remembers the folder handle; Android's WebView has neither, and its
`webkitdirectory` input cannot keep access. On Android the app instead uses the system folder picker
(Storage Access Framework, `ACTION_OPEN_DOCUMENT_TREE`) and keeps access with a persistable URI permission.
This needs no broad photo, video or audio permission (`READ_MEDIA_*`), which also keeps a future Google Play
listing simple. Android does not allow picking the root of internal storage or the Download folder, so the
user adds folders such as DCIM/Camera, Pictures and Music one by one.

## Rules

- **Private pictures never leave the PC or the phone.** `local/` and `_local*/` are git-ignored and must stay
  out of the APK too: the script that assembles the app's web files copies an explicit list of files and
  folders, never the whole project folder (`_local_test` alone is several gigabytes). No personal photos or
  music in commits, CI logs, screenshots or pull requests: use the demo pictures for anything shown.
- **The desktop version stays as it is.** No build step for the web app: `Start Seventh Leaf.bat` and opening
  `index.html` through the launcher behave exactly as before. Android-only code is loaded only inside the app.
- **Offline.** The app makes no network requests. Prefer leaving the `INTERNET` permission out of the manifest
  if Capacitor's local server works without it; otherwise verify with logcat that nothing goes out.
- **Licence.** The app is under the same PolyForm Noncommercial 1.0.0 licence, shown on an About screen. Only
  pictures and sounds the project may share go into the APK (see CONTRIBUTING.md).
- **Style.** Plain modern JavaScript modules and short comments that explain why, as in the rest of the
  project. Kotlin or Java for native code, kept small.
- **Unsupported files** are skipped, as on the desktop: WMA (no Android decoder), and anything not in
  `EXT` in `src/folder.js`.

## Layout in the repository

```text
android-app/                  everything Android-only
  package.json                Capacitor CLI and plugins (pinned versions)
  capacitor.config.json       appId io.github.pipbaby.seventhleaf, appName "Seventh Leaf", webDir "www"
  scripts/assemble-web.mjs    copies index.html, style.css, src/, vendor/, demo/, LICENSE into www/
  www/                        generated, git-ignored
  android/                    the Capacitor Android project (committed; build output and
                              local.properties git-ignored)
src/folder-android.js         folder mode on Android: same interface as Folder in src/folder.js
.github/workflows/android.yml builds the APK on GitHub
```

## Stages

Each stage is one pull request. "Done when" is what Mel checks on the phone.

### Stage 1: the wall in an app

- Capacitor project in `android-app/`, minSdk 29 (Android 10) or higher if a plugin needs it, targetSdk 36.
- Full screen (immersive: no status or navigation bar), drawn under the camera cut-out, screen kept on while
  the wall shows, landscape only for now. The Android back gesture closes an open panel, then leaves the app.
- WebView debugging on in debug builds, so `chrome://inspect` on the PC shows the console.
- `.github/workflows/android.yml`: on pull requests and pushes that touch `android-app/`, `src/`, `index.html`,
  `style.css` or `vendor/`, set up JDK 21 and Node, assemble the web files, `npx cap sync android`,
  `./gradlew assembleDebug`, and upload the APK as an artifact named `seventh-leaf-debug`.
- **Done when**: the debug APK installs on the GT 7 Pro; the demo wall runs full screen in landscape and flips as
  it does on the desktop; the console shows no errors; the desktop version is unchanged.

### Stage 2: folders on the phone

- A small Capacitor plugin, for example `SeventhLeafFolders`:
  - `pick(slot)`: opens the system folder picker, takes a persistable read permission, returns an id and the
    folder's display name.
  - `list(id)`: walks the folder tree and returns entries in chunks (relative path, size, last modified, MIME
    type), skipping hidden files and folders, like `visible()` in `src/folder.js`.
  - `granted()`: which saved folders still have permission (Android can revoke it).
  - File contents are served to the WebView at an internal URL (for example `https://localhost/_sl/<id>/<path>`)
    by intercepting the WebView's requests and streaming from the content URI, with HTTP `Range` support so
    videos can seek. No copying, and no base64 through the plugin bridge.
- `src/folder-android.js` implements the same interface as `Folder` in `src/folder.js`. Pictures are read with
  `fetch()` (a `Range` request for the first 256 KB where the thumbnail worker only needs the header); videos
  and music get the internal URL as their `src`. `src/folder.js` picks this backend when running inside the app.
- The index and thumbnails stay in IndexedDB as on the desktop. Keep thumbnails small; if building the index
  for several thousand photos is too slow in the web workers, use Android's own thumbnails
  (`DocumentsContract.getDocumentThumbnail`) instead.
- When permission was revoked or a folder moved, ask to choose it again, as the desktop does after a restart.
- **Done when**: Mel adds the camera folder and Music on the phone; the first index finishes with visible
  progress and can be interrupted and resumed; after closing and reopening the app the folders are still there
  without asking again; photos, videos and music play.

### Stage 3: made for a phone

- Touch controls in place of keyboard and mouse: tap shows or hides the controls; swipe left or right goes to the
  next or previous set; pinch zooms; drag turns the view; double-tap resets it; long-press opens settings.
  Patterns (keys 1 to 7 on the desktop) and music on and off get on-screen buttons.
- Panels (library, settings, sound) fit and scroll at 794 × 361 in landscape.
- Portrait: build two prototypes for Mel to choose from on the phone: a 7 × 12 wall, or the 12 × 7 wall with
  controls beneath. Until then the app stays landscape.
- App name and icon (adaptive icon), and an About screen with the licence.
- **Done when**: Mel can use every feature with touch alone, and has picked a portrait layout or chosen
  landscape only.

### Stage 4: music, video and leaving the app

- Music from the phone's Music folder (MP3, FLAC, M4A, OGG, Opus, WAV). Pause for phone calls and other apps'
  audio (audio focus). When the screen turns off or the app goes to the background: pause by default, with a
  setting to keep the music playing.
- Videos on the wall muted by default, as on the desktop.
- **Done when**: music behaves as Mel expects during a call, with the screen off, and when switching apps.

### Stage 5: smooth, cool and light

- Measure on the phone: frame rate (`adb shell dumpsys gfxinfo <package>` and requestAnimationFrame timing),
  memory over an hour (`dumpsys meminfo`), temperature and battery. Check that the WebView actually runs at
  120 Hz; some phones hold apps at 60 Hz unless the window asks for a higher rate.
- Tune decode concurrency and memory for the phone; cap the thumbnail cache.
- realme's battery management can stop apps in the background: the app should resume cleanly after that.
- **Done when**: an hour of the wall with the screen on stays smooth and does not overheat the phone.

### Stage 6: sharing with friends

- A release signing key, made by Mel on the PC and **never committed**. A copy is kept somewhere safe: without
  it, updates cannot be installed over an earlier version. For GitHub builds the key is stored as GitHub
  Actions secrets.
- A workflow that builds the signed APK when a tag like `android-v0.1.0` is pushed and attaches it to a GitHub
  Release. The version comes from the app, and every release raises the version code.
- A short install guide for friends in the README: download the APK and allow the browser or file manager to
  install apps, or install with ADB.
- Google is introducing developer verification for apps installed outside Google Play: from 30 September 2026
  in Brazil, Indonesia, Singapore and Thailand, later elsewhere. Installing with ADB stays possible. For
  sharing with friends, Google's free "limited distribution" account for hobbyists (up to 20 devices, no
  government ID) is the expected route; check the current rules before the first release.
- **Done when**: a friend installs the release from the guide, and a later release installs over it.

## Testing

**In a cloud session** (no phone): build the debug APK; unit tests for `src/folder-android.js` against a fake
plugin, in Node; check that the desktop version still works (`tools/test-folder-mode.html` and the demo deck)
in a headless Chromium if one is available; layout checks at 794 × 361 and 361 × 794 CSS pixels.

**On the PC with the phone** (Mel, or a local Claude Code session over wireless ADB): install the debug APK
(`adb install -r`), open it, read the WebView console through `chrome://inspect` and errors with
`adb logcat`, take screenshots with the demo pictures only, and run the stage's "done when" checks. The first
install may ask for confirmation on the phone.

## Cloud environment

- The cloud image has OpenJDK 21 with Gradle and Node, but not the Android SDK, and the default "Trusted"
  network level does not reach `dl.google.com`, where the SDK comes from. The environment used for this
  repository needs **Network access: Custom**, with `dl.google.com` listed and **Also include default list of
  common package managers** ticked. Its setup script is `tools/android/cloud-setup.sh` (pasted into the
  environment's setup script field).
- That script installs the SDK to `/opt/android-sdk`, or to `~/android-sdk` when `/opt` is not writable, and
  prints where. Point Gradle at it with `android-app/android/local.properties` (`sdk.dir=...`, git-ignored) or
  `ANDROID_HOME`.
- Commands time out after 2 minutes unless asked for longer (up to 10). A cold Gradle build may need the longer
  timeout.
- Builds made in the cloud do not reach the phone directly: they come back through the pull request, and the
  GitHub Actions artifact is what Mel installs.

## Open questions for Mel

1. Portrait: a 7 × 12 wall, the 12 × 7 wall with controls beneath, or landscape only? (Stage 3)
2. Music when the screen is off: stop, or keep playing? (Stage 4)
3. Which folders first: the camera folder only, or Pictures too? (Pictures on the test phone holds many
   screenshots and app images.) (Stage 2)
