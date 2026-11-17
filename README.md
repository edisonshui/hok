# Hok, a learning vault

Hok is an AI tutor that teaches you one-on-one. It runs on Claude Code or Codex. It keeps notes on what it's taught you, what you got right, and what to do next time, so each session picks up where the last one left off. Those notes are plain files on your computer that you can open and read.

## Get the app

The easiest way to use Hok is the desktop app. It sets everything up for you.

1. Install [Claude Code](https://claude.com/claude-code) (or Codex) and sign in. You'll also need Python 3.
2. Download Hok for Mac, Windows or Linux from the [latest release](https://github.com/edisonshui/hok/releases/latest).
3. Open it, click **Make a new vault**, and pick something to learn.

The [install guide](app/INSTALL.md) walks through every step, including how to get past the warning your computer shows the first time. So far the app has only been tested on Macs with Apple chips. The Intel Mac, Windows and Linux versions are new and untested, so please tell me how they go.

## What you can ask it to do

These are the commands you can give the tutor. In Codex, type `$` instead of `/`, like `$learn-start`.

| Command | What it does |
| --- | --- |
| `/learn-start <topic>` | Starts a new subject. It asks what you're aiming for and when it's due, checks what you already know, and makes a lesson plan. It waits for your OK before teaching. |
| `/learn-resume <topic>` | Picks a subject back up. It reminds you where you left off, checks whether the last few topics stuck, and keeps going. |
| `/learn-check` | Quizzes you on today's topics plus one older one. The tutor also does this on its own every 2 or 3 topics. |
| `/learn-practice <topic>` | Gives you practice problems on things you've already learned, without telling you which idea each one needs. It gives hints one at a time and has you redo anything you missed. You can give it an old exam or homework to work from. |
| `/learn-review` | Quizzes you across all your subjects on whatever you haven't been checked on in the longest time. Good for keeping old subjects fresh. |
| `/learn-end` | Saves the session and gives you a short summary. Use `/learn-end break` if you're coming back later the same day. |

When you open Hok, the tutor suggests what to do next and asks before starting anything.

## How a session works

When you start a subject, the tutor asks up to three questions about your goal. Then it gives you one problem like the ones you're aiming to solve, plus a few short follow-ups, to find out what you already know. From that, it makes a lesson plan made of small topics, where each one builds on the ones before it. Before you see the plan, two helpers check it. One checks the facts. The other looks for steps that are too big or that assume something you haven't learned yet.

The tutor teaches one topic at a time, one idea per message, and asks you a question after each one. After about 45 minutes, it suggests a break.

A topic only counts as learned once you've answered a question about it. Each topic goes through these stages:

| Stage | What it means |
| --- | --- |
| Introduced | You've been taught it but haven't passed a question on it yet. |
| Passed | You got a question right without a hint, the same day you learned it. |
| Remembered on a later day | You got it right again in a later session. |
| Slipped | You missed it in a later session, so the tutor goes over it again. |

The tutor keeps track of what you enjoyed separately from what you actually got right, and it plans your lessons around what you got right.

## Set it up without the app

This part is for people comfortable with a terminal and git. You'll need [Claude Code](https://claude.com/claude-code) with your own Claude account, [Obsidian](https://obsidian.md) (a free notes app), Python 3, and git.

1. Download this project: `git clone https://github.com/edisonshui/hok.git`
2. In Obsidian, choose **Open folder as vault** and pick the folder you just downloaded. When Obsidian asks if you trust it, say yes, so the live-chat plugin can run.
3. In Obsidian, go to **Settings > Community plugins > Browse** and install **Dataview**.
4. In a terminal, go into the folder and run `claude`. When Claude Code asks if you trust the folder, say yes. That lets it keep the live chat, the session timer, and the dashboard up to date.
5. In your first session, the tutor asks how you like to learn and saves your answers to `learn/me/preferences.md`.
6. Start a subject with `/learn-start <topic>`.

You can skip Obsidian, but then you won't see the diagrams, the math, the live chat, or the **Run** button for code.

### What you'll see in Obsidian

- `learn/Home.md` shows what to do next.
- `learn/Dashboard.md` lists all your subjects and how far along each one is.
- `learn/subjects/<topic>/progress.md` shows a skill tree for one subject.
- `learn/subjects/<topic>/log.md` is the live chat. Keep it open while you work, and it fills in as the tutor types.
- `learn/subjects/<topic>/sessions/` has a note for each lesson, with its diagrams and quiz results.
- Code exercises have a **Run** button. It opens a panel where you can edit the code, run it, and click **Send to tutor**.

Home, the dashboard, the progress pages and the chat logs are rebuilt from your notes automatically, so don't edit them yourself.

### Where things are

| Folder | What's in it |
| --- | --- |
| `learn/system/` | How the tutor teaches. Edit `tutor.md` to change its style. |
| `learn/me/preferences.md` | How you like to learn. You write the *Stated* part. The tutor only adds to the *Observed* part, and only after it's noticed something twice. |
| `learn/subjects/<topic>/` | Everything about one subject: `record.md` (what you know, and how it knows), `plan.md` (the lesson plan), `resume.md` (where to pick up next time), and `sessions/` (one note per lesson). |
| `learn/reviews/` | Notes from `/learn-review`. |
| `.claude/` | The tutor's commands, helpers and background scripts for Claude Code. Codex uses `.agents/` and `.codex/`. |

Your subjects, preferences, reviews and chat logs stay on your computer. Git is set to ignore them, so they never get pushed anywhere.

To read about why it's built this way, see [how the learning system fits together](learn/README.md).
