# Flash

A desktop app for the learning vault. It puts your tutor's terminal, the live
log, and your progress in one window. Flash runs your own `claude` (or `codex`)
in your vault folder, so every hook, skill, and record rule works as it does in
a plain terminal. Flash writes no learning record; the tutor does.

Flash is the working name.

## What you need

- A copy of the learning vault (a folder with `learn/` and `.claude/hooks/`).
- Python 3.
- Claude Code or Codex, installed and signed in once in a terminal.

Flash checks all three on first launch and says how to install anything missing.

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
compiles it, which needs `make`, a C++ compiler, and Python.

| Platform | Command | Output in `dist/` |
| --- | --- | --- |
| macOS | `npm run dist:mac` | `Obsidian Learning-<version>-arm64.dmg` and a `.zip` (in `dist.noindex/`) |
| Windows | `npm run dist:win` | `Flash Setup <version>.exe` |
| Linux | `npm run dist:linux` | `.AppImage` and `.deb` |

Builds are not signed by a paid developer account (the Mac build is ad-hoc
signed). The first time a friend opens Flash:

- macOS 15 or later: open it once and macOS blocks it. Then System Settings >
  Privacy & Security, scroll down, Open Anyway, and confirm. Later opens are normal.
- Windows: SmartScreen says it protected the PC. Choose More info > Run anyway.
- Linux: `chmod +x Flash-*.AppImage` and run it, or `sudo apt install ./flash_*.deb`.

`dist:mac` builds for Apple chips only. `dist:friends` builds one universal app that
runs on Apple chips and Intel (about 250 MB). node-pty ships both chips' builds side
by side, so `x64ArchFiles` tells the merge to keep them as they are. The Intel half
built on 9 Nov but hasn't been opened: this Mac has no Rosetta.

### A build for friends

A friend has no learning vault, so their build carries a starter vault and setup
offers **Make a new vault**. The starter is made from your own vault's tracked files,
with your name changed to "the learner", and a review file lists every line that
still names you, your school, your courses or your subjects:

```sh
node scripts/make-starter-vault.js ~/Desktop/vault   # writes starter-vault/ and starter-vault-review.md (both git-ignored)
npm run dist:friends                                  # refuses without them; a universal .dmg in dist.friends.noindex/
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

Fonts are Bricolage Grotesque, Atkinson Hyperlegible Next, and Atkinson
Hyperlegible Mono, all under the SIL Open Font License 1.1.
