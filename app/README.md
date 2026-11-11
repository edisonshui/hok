# Hok (the desktop app)

A desktop app for the learning vault. It puts your tutor's terminal, the live
log, and your progress in one window. It runs your own `claude` (or `codex`)
in your vault folder, so every hook, skill, and record rule works as it does in
a plain terminal. The app writes no learning record; the tutor does.

The code still says `flash` in places (the package name, `window.flash`): that was the old app's working name.

## What you need

- A copy of the learning vault (a folder with `learn/` and `.claude/hooks/`).
- Python 3.
- Claude Code or Codex, installed and signed in once in a terminal.

The app checks all three on first launch and says how to install anything missing.

## Run it from source

```sh
cd app
npm install
npm start
```

If your shell sets `ELECTRON_RUN_AS_NODE` (some agent tools do), unset it first:
`env -u ELECTRON_RUN_AS_NODE npm start`.

## Build an installer

Build each platform on that platform. node-pty, the piece that runs the
terminal, ships prebuilt binaries for macOS and Windows; on Linux, `npm install`
compiles it, which needs `make`, a C++ compiler, and Python. The glass package
(`electron-liquid-glass`) is Mac-only and optional, so `npm install` skips it elsewhere.

| Platform | Command | Output in `dist.noindex/` |
| --- | --- | --- |
| macOS | `npm run dist:mac` | `Hok-<version>-mac-arm64.dmg` and a `.zip` |
| Windows | `npm run dist:win` | `Hok-<version>-win-x64.exe` |
| Linux | `npm run dist:linux` | an `.AppImage` and a `.deb` |

Builds are not signed by a paid developer account (the Mac build is ad-hoc
signed). `INSTALL.md` tells a friend how to get past the warning on each system.

`dist:mac` builds for Apple chips only. `dist:friends` builds one universal app that
runs on Apple chips and Intel (about 250 MB). node-pty and the glass package ship both
chips' builds side by side, so `x64ArchFiles` tells the merge to keep them as they are.
The Intel half has never been opened: this Mac has no Rosetta. The Windows and Linux
apps have never been opened either (11 Nov 2026). Off the Mac the page draws the stone
glass itself, so the design is the same; that was checked only in a simulated run.

### Releases

`.github/workflows/release.yml` builds all three on GitHub's machines, each with a
starter vault made from this repository. Run it from the Actions tab, or push a tag:

```sh
git tag v0.1.0 && git push origin v0.1.0   # builds, then makes a DRAFT release with the installers
```

Nothing is public until you open the draft release and press Publish.

Each build also runs `npm run smoke` on its own system: a friend's first run (setup, Make a
new vault, Home, Settings, Skills) with no tutor started. Its stills are in the run's
`first-run-stills-<system>` artifact. On your own machine it opens the app window.

### A build for friends

A friend has no learning vault, so their build carries a starter vault and setup
offers **Make a new vault**. The starter is made from your own vault's tracked files,
with your name changed to "the learner", and a review file lists every line that
still names you, your school, your courses or your subjects:

```sh
node scripts/make-starter-vault.js ~/Desktop/vault   # writes starter-vault/ and starter-vault-review.md (both git-ignored)
npm run dist:friends                                  # refuses without them; a universal .dmg in dist.friends.noindex/
npm run dist:friends:win                              # the same for Windows, run on Windows (dist:friends:linux on Linux)
```

Read the review before sending the build. `npm run dist:mac` never carries a starter.
`INSTALL.md` is the guide to send with it.

## Tests

```sh
npm test                                  # the log reader, Questions (against a stand-in tutor), the no-dot rule
python3 ../.claude/hooks/test_hooks.py    # learn-status.py --json, with the rest of the hooks
```

To screenshot screens while developing, list steps separated by `;;`:

```sh
FLASH_SHOTS=/tmp/shots FLASH_STEPS="go('dashboard');;go('system')" npm start
```

Each step runs in the window, then a PNG lands in `/tmp/shots` and the app quits.

## How it fits together

- `main.js` owns the window, the terminal process, and every read of the vault.
  It runs `learn-status.py --json` for the screens and watches `learn/` for changes.
- `lib/log.js` reads a subject's `log.md`, the live conversation the vault's hook writes.
- `renderer/` is the window: `app.js` (screens, terminal, log, palette, settings),
  `markdown.js` (replies, math, diagrams), `styles.css`, and a copy of the design
  tokens from `.claude/skills/vault-design/tokens.css`. Update the copy when the tokens change.
- `build/icon.png` is made by `npm run icon` from `scripts/icon.html`.

Fonts are IBM Plex Sans and IBM Plex Mono, under the SIL Open Font License 1.1.
(`renderer/fonts/` still holds four older font files the styles no longer load.)
