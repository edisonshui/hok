# Installing Hok

Hok (學) is Cantonese for "learn". It used to be called Obsidian Learning.

Hok is a tutor app. You tell it what you want to learn. It figures out what you already know, makes a plan, teaches you one step at a time, and quizzes you on old topics later so they stick. It runs on your own Claude or ChatGPT account, and everything it saves stays in a folder on your computer.

So far Hok has only been tested on Macs with Apple chips. The Intel Mac, Windows and Linux versions haven't been tried on a real computer yet. If you try one, please tell me how it went, even if it just worked.

## Step 1: Install the tutor and Python

Hok needs two programs on your computer first.

### The tutor

Pick one. You'll need a paid plan for either.

**Claude Code** (needs Claude Pro or Max)

- On a Mac or Linux, open Terminal, paste this line, and press Return:
  `curl -fsSL https://claude.ai/install.sh | bash`
- On Windows, open PowerShell, paste this line, and press Enter:
  `irm https://claude.ai/install.ps1 | iex`

When it finishes, type `claude`, press Return, and sign in.

**Codex** (needs a ChatGPT plan)

Install [Node.js](https://nodejs.org) first. Then in Terminal (or PowerShell on Windows), run `npm install -g @openai/codex`, and after that run `codex login` to sign in.

### Python

You need Python 3.8 or newer.

- **Mac:** in Terminal, type `python3 --version` and press Return. If your Mac offers to install developer tools, say yes.
- **Windows:** get **Python 3** from the Microsoft Store. Use the Store version, not the one from python.org, because only the Store version sets things up the way Hok expects.
- **Linux:** you almost certainly have it already. If not, run `sudo apt install python3`.

## Step 2: Install Hok

Download the file for your computer from the [latest release page](https://github.com/edisonshui/hok/releases/latest).

Your computer will warn you the first time you open Hok. That's because I haven't paid Apple or Microsoft to verify it, not because anything is wrong. Here's how to get past the warning.

**Mac** (the `.dmg` file, which works on both Apple and Intel chips)

1. Open the `.dmg` file and drag Hok into your Applications folder.
2. Open Hok. Your Mac says it can't check the app. Click **Done**.
3. Open System Settings and go to Privacy & Security. Scroll down, click **Open Anyway** next to Hok, and confirm.
4. Open Hok again. From now on it opens normally.

**Windows** (the `.exe` file)

1. Run the installer. If Windows says it protected your PC, click **More info**, then **Run anyway**.
2. Open Hok from the Start menu.

**Linux** (the `.deb` or `.AppImage` file)

- On Debian or Ubuntu, run `sudo apt install ./Hok-*.deb`, then open Hok from your apps.
- On anything else, run `chmod +x Hok-*.AppImage`, then open the file. If it won't start, run `sudo apt install libfuse2` (on Ubuntu 24.04, it's `libfuse2t64` instead) and try again.

## Step 3: Set it up

1. Choose where to keep your learning folder: Documents, Desktop, or another folder. Click **Make a new vault**, and Hok makes a folder called *Learning vault* there.
2. Choose your tutor, Claude Code or Codex. Hok checks that everything from step 1 is installed and signed in. If something's missing, it tells you what to do. Once you've fixed it, click **Check again**.
3. On the Home screen, type what you want to learn and why, like "How vaccines work, for Friday's bio exam", and press Return. The tutor asks you a few questions and then makes a plan.
4. The first time, the tutor asks if you trust the folder. Say yes. It's the folder Hok just made.

## Cost and privacy

- Hok is free. The tutor uses your own Claude or ChatGPT plan, the same as if you used it directly.
- Your subjects, plans and progress are saved as files in your learning folder. The only thing sent anywhere is your conversation with the tutor, which goes to Claude or ChatGPT like any other chat.
- On a Mac, if you pick a moving wallpaper you don't already have, it downloads once from Apple.
- You can talk instead of typing by pressing the microphone next to any text box. Your voice is turned into text on your own computer and never leaves it. The first time, Hok downloads the speech model (80 to 140 MB) and your computer asks if Hok can use the microphone. You can delete the model in Settings > Dictation.

## Updating

When a new version is out, a small round arrow shows up next to **Settings** at the bottom of the sidebar.

- On a Mac, click it. Hok downloads the update and restarts. Your learning folder and settings stay the same.
- On Windows and Linux, clicking it opens the download page. Download the new file and install it over the old one.

If you have version 0.1.0 (back when it was called Flash), you'll need to install the new version by hand once. After that, updates come through the arrow.

## If something goes wrong

- **It says Claude Code or Codex isn't signed in.** Run `claude` (or `codex login`) in Terminal, sign in, then click **Check again** in Hok.
- **It says Python 3 isn't installed.** Follow the Python part of step 1, then click **Check again**.
- **It says the claude command isn't installed, even though you just installed it.** Click **Check again**. If that doesn't work, quit Hok and open it again.
- **The tutor seems stuck.** Click the box icon at the top of the window to see what the tutor is doing.
- **Something else.** [Open an issue](https://github.com/edisonshui/hok/issues) and say what kind of computer you're on.
