# Changelog

## 0.3.0 — double-click starter

- **Start Seventh Leaf by double-clicking** `Start Seventh Leaf.bat` (Windows) or
  `Start Seventh Leaf.command` (macOS; Linux runs it with `sh`). No terminal, and on Windows no
  Python: the starter is a tiny web server in PowerShell (Python on macOS and Linux) that opens
  the browser. Close its window to stop Seventh Leaf.
- It listens only on `127.0.0.1` (nothing on the network can reach it), on a fixed port, 41777,
  so the browser finds the saved library again. If another program uses that port, it takes the
  next free one up to 41786 and explains what that means.
- Starting it while Seventh Leaf is running opens the running copy. A different copy (another
  version or folder) is stopped and replaced, so an old version cannot keep running by mistake.
- It answers only requests addressed to itself, serves nothing outside the project folder, and
  tells the browser to check for newer files every time.

## 0.2.1 — automatic changes with large folders

- Fixed: with a large folder (for example 1,000 PNGs in subfolders, many of them in three-portrait
  sets), the wall could stop changing for good while the title kept moving on. When it was time
  for the next picture, the wall asked for it again on every frame until the change began, and
  each request abandoned the one before, so a change that took longer than a frame to prepare
  never started. It now asks once, and schedules the next change when this one starts.
- Pictures being prepared for a change are no longer released by the memory clean-up before the
  change starts, which could leave cells blank.
- `tools/test-folder-mode.html` checks automatic changes too (38 checks).

## 0.2.0 — folder mode for large libraries

- **Folder mode.** Show thousands of photos and videos, and play thousands of music tracks,
  straight from a folder you choose (subfolders included), without copying them into the browser.
  Pictures and music have separate folders. Chromium-based browsers remember the folder and ask
  for permission again with **Reconnect folder**. Other browsers use a folder chooser that lasts
  until the page is closed, and the panel says so.
- A background scan with progress and **Cancel**. The browser keeps only a small index (path, size,
  date, kind, size in pixels, a ~256 px WebP thumbnail). **Rescan** keeps unchanged entries and
  their thumbnails, adds new files and drops missing ones.
- Thumbnails are made in a Web Worker, a few at a time, with the ones in view first. Video
  thumbnails are made one at a time when the page is idle.
- Files that cannot be read are skipped and counted. A folder that has gone, or a refused
  permission, gets a clear message and **Choose again**.
- The wall makes a picture's source, and reads its file, only when the picture comes up, and lets
  everything go again (texture, video element, object URL) once it has been shown. Shuffle and the
  three-portrait layout work with decks of thousands.
- Pictures are decoded in a Web Worker at the size they are shown (at most 2560 px; a portrait in
  a set at its panel's size), two at a time, and only the GPU keeps the pixels. With 520 real
  4096 px phone photos, the longest frame during wall changes fell from 4.5 s to about 40 ms and
  peak browser memory from about 3.5 GB to 2.5 GB. This also fixes changes that could stop for
  good under load, because a pending `img.decode()` never finished.
- The library grid and the music list are virtual, so 10,000 items scroll smoothly. The library has
  a search box and a count, and the picture editor stays in view at the foot of the panel.
- Imported pictures and music work as before. Elements meant to be hidden now always are (the
  *Fit to wall* row stayed visible for pictures in a three-portrait set).
- `tools/test-folder-mode.html` tests folder mode against a generated library in the browser's
  private file system.

## 0.1.0 — first public version

- Licensed under the PolyForm Noncommercial License 1.0.0: source-available and free for
  non-commercial use. (The very first upload, on 5 October 2026, briefly carried the MIT licence;
  this version replaces it.)

- A 12 × 7 split-flap wall in 3D: each change flips every cell seven times, in a diagonal wave on a
  shared mechanical clock, with timing measured from a real installation.
- A measured leaf motion (creep, hesitation at the stops, fall under gravity) and a pendulum swing
  as each leaf settles; satin leaves that catch the light.
- Synthesised flip sounds with a room echo; separate volumes for flips, music and video sound.
- A library for your own photos and videos, stored only in your browser, plus an optional picture
  folder (`local/deck.json`) and a set of generated demo pictures.
- Three-portrait layout, eight wave patterns, drag-to-rotate and wheel zoom, optional axle rings
  and leaf stops, and an interface in English, Chinese and Japanese.
