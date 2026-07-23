# Build Resources — App Icon

This folder is the `electron-builder` **buildResources** directory. `electron-builder`
auto-discovers the app icon here at packaging time — you do **not** need to reference it in
`package.json`.

## What to drop here

Save the app icon as:

```
assets/icon.png
```

Requirements:

- **Square** (e.g. 1024×1024). A landscape image will be squashed and look wrong.
- **Just the emblem** — the shield / phoenix "CC" mark, *not* the full
  "Christopher Clarke · Builder · Protector · Creator" lockup. Text is unreadable at
  32×32 taskbar size.
- PNG, ideally on a transparent background (white also works).

From that single `icon.png`, `electron-builder` generates the Windows `.ico` automatically
during `npm run build:win`.

## If the auto-generated icon looks wrong

Some source images don't convert cleanly. If the taskbar/installer icon looks blurry or
clipped, supply a purpose-built multi-resolution `assets/icon.ico` (16/32/48/64/128/256 px)
instead — that takes precedence over `icon.png`. Tools like https://icoconvert.com or
ImageMagick (`magick icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico`) work.

## Optional: other platforms

- macOS: `assets/icon.icns`
- Linux: `assets/icon.png` (the same square PNG is reused)

Until `icon.png` is added, the build still succeeds — it just ships the default Electron
icon and prints a warning. Adding the real icon is a **release-polish** step, not a blocker
for producing a working installer.
