# Changelog

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
  everything go again (texture, video element, object URL) once it has been shown. Pictures larger
  than 4096 px are scaled down before upload. Shuffle and the three-portrait layout work with decks
  of thousands.
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
