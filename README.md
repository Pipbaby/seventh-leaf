# Seventh Leaf

**A split-flap picture wall for your own photos, in the browser.**
Source-available and free for non-commercial use.

**▶ Try it now: <https://pipbaby.github.io/seventh-leaf/>**

![A wave of flipping leaves crossing the wall](docs/wave.jpg)

Seventh Leaf is a wall of 84 split-flap cells (12 × 7). Each cell is split into an upper and a
lower half, like the letters on an old station departure board. When the picture changes, every
cell flips **seven times**. The in-between leaves show that cell's piece of *other* pictures, so
while the wave passes the wall is a patchwork of fragments. The new picture arrives on the seventh
leaf, and only when the last cell lands does one complete image settle.

Everything runs in your browser. Your photos, videos and music stay on your own computer.

## Run it on your own computer

The live demo above needs no installation, but it needs an internet connection to open. Your own
copy runs without one.

1. Download the latest release (**Releases → Source code (zip)** on GitHub) and unzip it.
2. Double-click the starter in the unzipped folder:
   - **Windows:** `Start Seventh Leaf.bat`. Nothing else is needed.
   - **macOS:** `Start Seventh Leaf.command`. It needs Python 3 (from
     [python.org](https://www.python.org/downloads/) if it is not installed yet).
   - **Linux:** run `sh "Start Seventh Leaf.command"` in a terminal (needs `python3`).
3. Your browser opens Seventh Leaf. Click **Start**: sound can only begin after a click.

A small window stays open while Seventh Leaf runs. **Close it to stop Seventh Leaf.**

The wall opens with a set of demo pictures. Add your own in the **Library** tab. Use Chrome or Edge
for folder mode at its best.

**About the starter**

- It is a tiny web server for this folder, written in PowerShell on Windows and Python elsewhere
  (`tools/launcher/`). It installs nothing, changes no settings and needs no admin rights.
- Only your own computer can reach it (`127.0.0.1`), so the firewall does not ask, and other
  devices on your network cannot see it.
- It always uses the same address, `http://127.0.0.1:41777/`, because the browser keeps your
  library, settings and chosen folders per address. If another program already uses port 41777,
  it takes the next free port up to 41786 and says so; at that address the library starts empty
  until 41777 is free again.
- Double-clicking it while Seventh Leaf is running just opens it again. If a **different copy** is
  running (an older version, or one from another folder), it is stopped and replaced, so you never
  keep using an old version by mistake.
- The first time, Windows may ask whether to run a file downloaded from the internet, and macOS may
  say it is from an unidentified developer. On a Mac, right-click the file, choose **Open**, then
  **Open** again. This is needed once.

Prefer a terminal? Any simple web server works too, for example `python -m http.server 8000` in
the unzipped folder, then open <http://localhost:8000>. (That address keeps a library of its own.)

## What you can do

![The controls next to the wall](docs/controls.jpg)

- **Library.** Import photos and videos with the button, or drop them anywhere on the page.
  Reorder by dragging, delete with ×. For each picture, choose *Fill* (crop, with focus and zoom)
  or *Whole image* (with a blurred surround). Videos play live on the leaves.
- **Folder mode.** For large libraries, show thousands of photos and videos, and play thousands of
  music tracks, straight from folders on your computer, without copying them into the browser.
  See [Folder mode](#folder-mode) below.
- **Three-portrait layout.** Portrait photos are shown three at a time, side by side, so they fill
  the landscape wall. Each one gets exactly four of the twelve columns.
- **Wave patterns.** Diagonal from the top right (as filmed on the real wall), sweeps, top to
  bottom, a ripple from any point, random rain, or all at once.
- **3D view.** Drag to look at the wall from any angle and use the mouse wheel to zoom. The satin
  leaves catch the light as they move. Click a cell to flip just that one; Shift-click for a ripple.
- **Mechanism details.** Axle rings and the small stops along each upper edge can be shown or hidden.
- **Sound.** Separate volumes for flips, room echo, music and video sound. Add your own music. While
  a video has sound, the music can duck, keep playing, or pause. You can also replace the
  built-in flip sound with your own sample.
- **Languages.** English, 中文 and 日本語.
- **Keys.** ← → change picture · Space play/pause · 1–7 patterns · M music · F fullscreen ·
  H hide controls.

## Folder mode

Importing copies each file into the browser's storage. That suits a few hundred pictures, but not
a whole photo library. Folder mode reads pictures, videos and music directly from a folder you
choose instead. Nothing is copied or uploaded.

1. In the **Library** tab, switch to **Folder** and click **Choose folder…**. Subfolders are
   included. For music, do the same in the **Sound** tab under **Music folder**. Pictures and
   music have separate folders.
2. Seventh Leaf scans the folder in the background (*Scanning… 1,240 files*; you can cancel) and
   makes a small thumbnail of each picture and video. The wall can start as soon as the scan ends;
   thumbnails keep coming in while it runs, the ones you can see in the library first.
3. Click **Rescan** after you add, change or delete files. Unchanged files keep their thumbnails.

Hidden files and folders are skipped, and so is anything that is not a picture (jpg, jpeg, png,
webp, gif, avif, bmp), a video (mp4, webm, mov, m4v) or music (mp3, m4a, aac, flac, ogg, opus,
wav). Files that cannot be read are skipped and counted (*12 files could not be read*). If the
folder has been moved, or permission to read it was refused, the panel says so and offers
**Choose again**. Until then the wall shows your imported pictures, and the added music plays.

**Remembering the folder.** Chrome, Edge and other Chromium-based browsers remember the folder.
On a later visit, click **Reconnect folder** to allow reading it again (browsers only ask for this
in answer to a click). Other browsers can open a folder too, but cannot remember it: choose it again
on each visit. The index is kept, so the thumbnails do not have to be made again.

**What is stored.** For each file the browser keeps a small index entry: its path in the folder,
its size and date, its kind, its size in pixels, and a thumbnail about 256 px wide (WebP). Your
crop and focus settings for a picture are kept there too. The files themselves are never stored,
and nothing leaves your computer. **Forget this folder** removes the index.

### How large libraries are handled

- **Nothing is prepared for the whole library.** The wall knows each item only by its index entry.
  A picture's file is read when the picture is about to be shown, or picked as one of the
  in-between leaves. Before each change about ten pictures are loaded, and at most about 18 stay
  on the GPU. The rest are released, with their object URLs. Three-portrait sets are put together
  only when they come up, so shuffle and the three-portrait layout work with any number of
  pictures.
- **Pictures are decoded in a Web Worker**, straight from the file to at most 2560 px on the long
  side (the size imports are stored at), two at a time. The decoded copy is closed as soon as it
  is on the GPU, so full-size phone photos never pass through the main thread and the wall keeps
  flipping smoothly while they load. A portrait in a three-portrait set is decoded only as large
  as its panel.
- **Thumbnails** are made in a Web Worker, two or three at a time, straight from the file at
  reduced size (`createImageBitmap` with `resizeWidth`). Video thumbnails are a frame near 1 s,
  made one at a time when the page is idle.
- **The library grid and the music list are virtual.** Only the rows in view are in the page, so
  10,000 items scroll as smoothly as 10. Search by name to find a picture.
- **Music** is read one track at a time: only the track that is playing has an object URL.

`tools/test-folder-mode.html` tests all of this without a folder picker. It fills the browser's
private file system with a few thousand generated pictures, videos and sounds, then scans, rescans,
flips the wall, scrolls the grid and plays the music, and reports what it measured. With the
starter running, open <http://127.0.0.1:41777/tools/test-folder-mode.html> in Chrome or Edge and
press **Run**.

## Your own picture folder (optional)

Besides importing in the browser and folder mode, you can also list pictures for the wall in a
file. Create `local/deck.json` next to `index.html`:

```json
{ "name": "My pictures", "items": [ { "file": "deck/one.jpg", "name": "One" } ] }
```

Items may also give `"w"` and `"h"` (pixel size) and `"thumb"` (a small preview), which makes the
library open instantly even with hundreds of pictures. When `local/deck.json` exists it replaces
the demo set. The `local/` folder is ignored by git, so pictures you may not redistribute (for
example photos of other people's artwork) never end up in the project by accident.

## How it was made

Seventh Leaf recreates a kinetic split-flap wall seen at an anniversary exhibition: a 12 × 7 wall
of physical cells with artwork printed on the leaves. It was filmed on a phone at 60 frames per
second, and the motion, timing and sound were measured from that recording frame by frame.

| | Measured | In Seventh Leaf |
|---|---|---|
| Clock | 0.185 s per tick, shared by the whole wall | Every leaf drops on a tick; each cell flips every second tick (0.37 s) |
| Wave | Diagonal, ≈0.16 s later per column to the left and per row down | Crosses the wall in about 2.8 s, a little unevenly |
| One change | ≈5.3 s, about 28 audible bursts | The same |
| A leaf's fall | ≈40 ms creep, a one-frame hesitation at the stops, then ≈0.21 s under gravity | Simulated as a 15 cm plate falling about its top edge; air drag is negligible |
| Settling | The landed leaf swings with a 0.63 s period (≈1.6 Hz) | A damped pendulum, different for each cell |
| Sound | A dry rustle, strongest at 1.3–2 kHz and 6–8 kHz, with broadband ticks | Synthesised in the browser (no recordings), with a short room echo |

### Code

No build tools and one dependency, three.js, which is included in `vendor/`.

| File | What it does |
|---|---|
| `src/wall.js` | The 3D wall. Each cell is two fixed halves and one falling leaf whose front and back carry different pictures. |
| `src/sequencer.js` | Timing: a queue of leaves for every cell, the wave patterns, the measured leaf motion and the settling swing. |
| `src/audio.js` | The flip-sound synthesis and the mixer (flips, room echo, music, video). |
| `src/library.js` | Pictures, videos and music stored in the browser (IndexedDB), the picture folder, and loading pictures only when they are needed. |
| `src/folder.js` | Folder mode: choosing and remembering folders, scanning, the index, thumbnails. |
| `src/thumb-worker.js` | Makes folder thumbnails off the main thread. |
| `src/virtual.js` | The virtual list behind the library grid and the music list. |
| `src/main.js` | Interface, slideshow and music player. |
| `src/i18n.js` | Interface text in English, Chinese and Japanese. |
| `tools/demo-pictures.html` | Draws the demo pictures. Open it in a browser to see them. |
| `tools/test-folder-mode.html` | Tests folder mode with a generated library (see [Folder mode](#folder-mode)). |

## Browser support

Developed and tested in Chromium-based browsers (Chrome, Edge). Firefox and Safari are not yet
tested; reports are very welcome. Only Chromium-based browsers can remember a folder between
visits; the others choose it again each time.

## Licence

Seventh Leaf is **source-available and free for non-commercial use**, under the
[PolyForm Noncommercial License 1.0.0](LICENSE). Copyright 2026 Pipbaby.

- **You may** use, copy, change and share it for any non-commercial purpose: personal use,
  hobby projects, study and research, and use by charities, schools and public institutions.
- **You may not** use it for commercial purposes, such as selling it, including it in a paid
  product or service, or using it to run a business. To ask about commercial use, contact Pipbaby
  through GitHub.
- When you share it, include the licence and its `Required Notice` line.

Because it restricts commercial use, Seventh Leaf is not "open source" in the sense of the
Open Source Definition. The demo pictures were generated for this project and are covered by the
same licence.

**Third-party code:** three.js is included in `vendor/three/` under its own MIT licence
(`vendor/three/LICENSE`), which still applies to it.

Built by Pipbaby with Claude.
