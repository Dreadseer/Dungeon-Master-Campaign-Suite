# DMCS Release Guide — Windows Installer

How to build, test, and ship the Windows installer for **Dungeon Master's Campaign Suite**.

> **Scope:** This covers **Milestone 1 — a working installer**. The first-run setup wizard,
> in-app Ollama model downloads, and auto-update are planned follow-up milestones (see
> *Deferred* at the bottom).

---

## 1. What Milestone 1 delivered

| Change | File | Why |
|---|---|---|
| `BrowserRouter` → `HashRouter` | `src/App.jsx` | A packaged Electron app loads the renderer from disk (`file://`). Path-based routing can't resolve deep routes like `/player` from `file://`; hash routing (`index.html#/player`) does. **Without this, Player View and the pop-out Map window open the wrong screen in the installed app.** |
| Dev URLs → hash form | `electron/main.js` | Keep the dev server consistent with `HashRouter` (`localhost:5173/#/player?...`). |
| `asarUnpack` better-sqlite3 | `package.json` | Native `.node` binaries can't be loaded from inside an asar archive — they must sit unpacked on disk. Without this the installed app white-screens on database access. |
| `npmRebuild: false` | `package.json` | `better-sqlite3` is already built for Electron 33 by the `postinstall` step. Skipping electron-builder's rebuild avoids a `node-gyp` failure caused by the space in the project path, and avoids file-lock errors when the app is open. |
| NSIS shortcut/uninstall options | `package.json` | Desktop + Start Menu shortcuts, friendly name, and **`deleteAppDataOnUninstall: false`** so uninstalling never deletes campaigns. |
| `artifactName` | `package.json` | Installer is named `DMCS-Setup-<version>.exe`. |
| Version `0.1.0` → `1.0.0` | `package.json` | Matches the documented 1.0 release. |
| `author` field | `package.json` | Populates the Windows "Publisher" field. |

**Verified:** `dist/app/win-unpacked/` builds correctly, including the unpacked
`better_sqlite3.node` and the bundled player resource. Only the final installer-wrapping step
needs the one-time setup in §3.

---

## 2. Prerequisites (build machine)

- **Node.js 20+** and **npm 10+**
- Native build tools for the one-time `npm install` (Python 3 + Visual Studio Build Tools on
  Windows) — see the root `README.md`. The **packaging** step does not rebuild native modules
  (`npmRebuild: false`), so end users never need these.
- ⚠️ **Path-with-spaces caveat:** `node-gyp` (used only during `npm install`'s native rebuild)
  can fail on paths containing spaces. If `npm install` fails on `better-sqlite3`, move the
  repo to a space-free path (e.g. `C:\dev\dmcs`) for the install, or ensure the prebuilt
  binary is already present. Packaging itself tolerates spaces.

---

## 3. One-time setup: allow symlink extraction

electron-builder downloads a `winCodeSign` toolchain that contains macOS symlinks. Extracting
symlinks on Windows requires elevated rights **or** Developer Mode. Do **one** of these once:

- **Enable Developer Mode** (recommended): Settings → System → For developers → **Developer
  Mode = On**. No per-build elevation needed afterward. **or**
- **Build from an elevated terminal**: right-click PowerShell → *Run as administrator*, then
  run the build command.

Symptom if you skip this: `Cannot create symbolic link : A required privilege is not held by
the client` during `winCodeSign` extraction, and no installer is produced (you'll still get
`dist/app/win-unpacked/`).

This is a one-time cost — once `winCodeSign` is extracted into the electron-builder cache,
later builds reuse it.

---

## 4. Build commands

```bash
# From the project root:
npm install            # first time only (builds better-sqlite3 for Electron)
npm run build:win      # builds renderer + player, then the NSIS installer
```

`build:win` = `vite build` (DM renderer) + `vite build` (player) + `electron-builder --win nsis --x64`.

**Before building:** close the DMCS app if it's running, or the packaging copy step can hit a
file lock on `better_sqlite3.node`.

---

## 5. Expected output

```
dist/app/DMCS-Setup-1.0.0.exe      ← the installer to distribute
dist/app/win-unpacked/             ← the raw unpacked app (for local testing)
```

You can smoke-test without installing by running
`dist/app/win-unpacked/DM Campaign Suite.exe` directly.

---

## 6. App icon (release polish)

The build auto-discovers the icon from `assets/` (see `assets/README.md`). Drop a **square**
`assets/icon.png` (1024×1024, just the shield/phoenix emblem — not the full name lockup) and
rebuild; electron-builder generates the Windows `.ico` automatically. Until then the build
ships the default Electron icon. **Not a blocker for a working installer — just cosmetic.**

---

## 7. Installer test checklist (clean machine / VM)

Test on Windows **without** Node.js, npm, Python, build tools, or the DMCS source:

- [ ] `DMCS-Setup-1.0.0.exe` runs without administrator rights (per-user install)
- [ ] Installer lets you choose the install directory
- [ ] Desktop shortcut and Start Menu entry are created
- [ ] App launches after install (and from the shortcut)
- [ ] No white screen; Campaign Manager appears
- [ ] Create a campaign → it persists after quitting and reopening
- [ ] Compendium loads (SRD or a clear status)
- [ ] Settings opens; API key can be saved and removed
- [ ] **Player View opens and shows the player UI** (verifies the HashRouter fix)
- [ ] **Pop-out combat Map window opens the map** (also HashRouter)
- [ ] Player window receives DM broadcasts (map push / notes)
- [ ] Uninstall via Windows "Add or Remove Programs" works
- [ ] After uninstall, campaign data still exists under `%APPDATA%` (not deleted)

### SmartScreen note (unsigned build)

The installer is **not code-signed**, so Windows SmartScreen shows *"Windows protected your
PC."* Testers click **More info → Run anyway**. This is expected until a code-signing
certificate is added (see *Deferred*). It does not indicate a problem with the app.

---

## 8. Upgrade test checklist

1. Install `1.0.0`, create a campaign, add entities and a saved API key.
2. Build a `1.0.1` (bump `version` in `package.json`), install it over `1.0.0`.
3. Confirm: campaigns still present, migrations ran, shortcuts still work, settings retained.

> **Data location:** user data lives at `%APPDATA%\DM Campaign Suite\` (derived from
> `productName`). **Do not change `productName`** across releases — doing so moves the userData
> folder and orphans existing campaigns.

---

## 9. Known limitations / deferred

- **Unsigned** → SmartScreen warning (decision: accept for now; add a cert later).
- **Icon** is a placeholder until `assets/icon.png` is added.
- **Milestone 2 (deferred):** first-run setup wizard + more visible SRD seeding.
- **Milestone 3 (deferred):** in-app Ollama model-pull UI, `electron-updater` auto-update
  (needs a publish target + signing to be useful).
- Ollama remains **optional and separately installed** — DMCS never bundles or auto-installs
  it, and the base app works with AI disabled.

---

## 10. Future: code signing (when ready)

To remove the SmartScreen warning, acquire a Windows code-signing certificate (OV or EV) and
configure electron-builder to sign during CI. **Never commit signing certificates or
passwords** — inject them via CI secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`). This is a business
decision (cert cost + reputation warm-up), not a code change, and is intentionally out of
scope for Milestone 1.
