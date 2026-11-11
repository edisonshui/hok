# Installing Obsidian Learning

*Draft for friends trying the app. Steps marked (unverified) haven't been tried on a fresh Mac yet.*

Obsidian Learning is a tutor that runs on your own Claude Code or Codex account. You pick something to learn, it finds where you're starting from, builds a plan, teaches it one step at a time, and brings old skills back for review so they stick. Everything it records stays in a folder on your Mac.

## What you need

- A Mac, with an Apple chip or Intel. The same app runs on both (Intel unverified).
- One of these, signed in on this Mac:
  - **Claude Code** with a Claude Pro or Max plan. Install it from claude.com/claude-code, then run `claude` once in Terminal and sign in.
  - **Codex** with a ChatGPT plan. Install it with `npm install -g @openai/codex`, then run `codex login` once in Terminal.
- Python 3. Most Macs ask to install Apple's command line tools the first time `python3` runs; say yes (unverified).

## Install

1. Open the `.dmg` and drag Obsidian Learning into Applications.
2. Open it. The first time, macOS says it can't check the app for malicious software, because it isn't notarized by Apple. Click Done.
3. Open System Settings, then Privacy & Security. Scroll down, click **Open Anyway** next to Obsidian Learning, and confirm with your password (unverified on every macOS version).
4. Open the app again.

## First run

1. Under *Your learning vault*, click **Make a new vault** and pick where it goes, like Documents. The app makes a folder called *Learning vault* there.
2. Under *Your tutor*, pick Claude Code or Codex. The app checks that it's installed and signed in, and tells you what to do if not.
3. On Home, type anything you're curious about, or press **Start something new** to begin a subject with a plan.
4. The first time the tutor opens your vault, it asks whether you trust the folder. Click **Trust this folder**. It's the folder the app just made.

## What it costs and where your data goes

- The tutor runs on your own subscription, the same way it does in Terminal. Questions from Home run as short one-off requests on that account.
- Your subjects, plans and progress are plain files in your vault folder. Nothing is sent anywhere except to Claude or ChatGPT, as with any chat you have with them.

## If something goes wrong

- **"Claude Code isn't signed in" or "Codex isn't signed in":** run `claude` (or `codex login`) in Terminal, sign in, then click Check again.
- **"Python 3 is not installed":** run `python3` in Terminal and accept the install, or install it from python.org.
- **The tutor seems stuck:** open the terminal from the header (the box icon) to see what it's doing.
