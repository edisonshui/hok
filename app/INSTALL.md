# Installing Obsidian Learning

Obsidian Learning is a tutor that runs on your own Claude Code or Codex account. You pick something to learn. It finds where you're starting from, builds a plan, teaches one step at a time, and brings old skills back for review so they stick. Everything it records stays in a folder on your computer.

**Tested so far:** Macs with Apple chips. The Intel Mac, Windows and Linux builds have not been opened on a real machine yet. If you try one, tell me what happened, even if it's "it worked".

## 1. Get the two things it needs

**A tutor, signed in.** Pick one:

- **Claude Code**, with a Claude Pro or Max plan. Install it:
  - Mac or Linux, in Terminal: `curl -fsSL https://claude.ai/install.sh | bash`
  - Windows, in PowerShell: `irm https://claude.ai/install.ps1 | iex`

  Then run `claude` once and sign in.
- **Codex**, with a ChatGPT plan. Install [Node.js](https://nodejs.org), then run `npm install -g @openai/codex` and `codex login`.

**Python 3.8 or newer.**

- Mac: run `python3 --version` in Terminal. If macOS offers to install the command line developer tools, say yes.
- Windows: install **Python 3** from the Microsoft Store. That version adds the `python3` command the tutor's helpers use. The python.org installer does not.
- Linux: it is almost always there already. If not, `sudo apt install python3`.

## 2. Install the app

Download the file for your computer from the [latest release](https://github.com/edisonshui/obsidian-learning/releases/latest).

**Mac** (`.dmg`, one file for Apple and Intel chips)

1. Open the `.dmg` and drag Obsidian Learning into Applications.
2. Open it. macOS says it can't check the app, because it isn't notarized by Apple. Click **Done**.
3. Open System Settings, then Privacy & Security. Scroll down, click **Open Anyway** next to Obsidian Learning, and confirm.
4. Open the app again. From now on it opens normally.

**Windows** (`.exe`)

1. Run the installer. Windows SmartScreen says it protected your PC, because the app isn't signed. Click **More info**, then **Run anyway**.
2. Open Obsidian Learning from the Start menu.

**Linux** (`.deb` or `.AppImage`)

- Debian or Ubuntu: `sudo apt install ./Obsidian-Learning-*.deb`, then open it from your apps.
- Anything else: `chmod +x Obsidian-Learning-*.AppImage`, then run it. If it won't start, it needs FUSE 2: `sudo apt install libfuse2` (`libfuse2t64` on Ubuntu 24.04).

## 3. First run

1. Under *Your learning vault*, pick where it goes: Documents (the default), Desktop, or **Other folder…**. The line under your choice shows the exact folder. Click **Make a new vault** and the app makes a folder called *Learning vault* there.
2. Under *Your tutor*, pick Claude Code or Codex. The app checks that it and Python are installed and that you're signed in, and says what to do if not. After you fix something, click **Check again**.
3. Home asks what you want to learn. Type a topic and what it's for, like "How vaccines work, for Friday's bio exam", and press Return. The tutor asks a few questions, then builds a plan.
4. The first time the tutor opens your vault, it asks whether you trust the folder. Say yes. It's the folder the app just made.

## What it costs and where your data goes

- The tutor runs on your own subscription, the same way it does in a terminal. Questions from Home run as short one-off requests on that account.
- Your subjects, plans and progress are plain files in your vault folder. Nothing is sent anywhere except to Claude or ChatGPT, as with any chat you have with them.
- On a Mac, an Aerial wallpaper you pick that isn't on your Mac yet downloads once from Apple.

## If something goes wrong

- **"Claude Code isn't signed in" or "Codex isn't signed in":** run `claude` (or `codex login`) in a terminal, sign in, then click **Check again**.
- **"Python 3 is not installed":** follow step 1 for your system, then click **Check again**.
- **"The claude command is not installed" right after installing it:** click **Check again**. If it still says so, quit the app and open it again.
- **The tutor seems stuck:** open the terminal from the header (the box icon) to see what it's doing.
- **Anything else:** [open an issue](https://github.com/edisonshui/obsidian-learning/issues) and say which system you're on.
