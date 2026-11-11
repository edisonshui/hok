# Hok, a learning vault

A one-to-one AI tutor that runs in Claude Code or Codex. You chat with it in the terminal. Everything it learns about you, such as what you have been taught, what you got right, and what to do next session, is saved as Markdown notes that you read in Obsidian. A new session picks up where the last one stopped, because the notes carry the state, not the chat history.

## Get the app

The easiest way in is the desktop app, Hok. It runs the same tutor in one window, makes your vault for you, and needs no Obsidian or git.

1. Install [Claude Code](https://claude.com/claude-code) (or Codex) and sign in, and make sure you have Python 3.
2. Download the installer for your Mac, Windows PC or Linux machine from the [latest release](https://github.com/edisonshui/hok/releases/latest).
3. Open it, click **Make a new vault**, and start a subject.

[The install guide](app/INSTALL.md) has every step, including how to get past the "unverified app" warning. The app is tested on Macs with Apple chips; the Intel Mac, Windows and Linux builds are new and untested, so tell me what you find.

## Set it up by hand

This is the terminal and Obsidian route, without the app.


You need [Claude Code](https://claude.com/claude-code) with your own Claude account, [Obsidian](https://obsidian.md), Python 3, and git.

1. Clone this repo: `git clone https://github.com/edisonshui/hok.git`
2. In Obsidian, choose **Open folder as vault** and pick the cloned folder. When Obsidian asks, trust the vault so its `learn-live` plugin can run.
3. Install **Dataview** from **Settings > Community plugins > Browse**.
4. In a terminal, `cd` into the folder and run `claude`. Accept the trust prompt when Claude Code asks, so the project hooks can run. They keep the live log, the session clock, and the dashboard up to date.
5. The first session copies a preferences template to `learn/me/preferences.md` and asks how you like to learn.
6. Start a subject with `/learn-start <topic>`.

Obsidian is optional, but without it you lose the diagrams, the math rendering, the live log, and the **Run** button for code.

## Commands

In Codex, type `$` instead of `/`, for example `$learn-start`.

| Command | What it does |
| --- | --- |
| `/learn-start <topic>` | Starts a new subject. Asks what done looks like and when it is due, tests what you already know, builds a lesson plan, and waits for your OK before teaching. |
| `/learn-resume <topic>` | Continues a subject. Recaps where you are, re-checks the last topics to see what stuck, then keeps teaching from the plan. |
| `/learn-check` | Quizzes you on the topics from this session plus one older one. The tutor also runs a check on its own every 2 to 3 topics. |
| `/learn-practice <topic>` | Gives you problems on topics you have already been taught, without saying which idea each one needs. Gives hints one step at a time and retests every miss. You can point it at an old exam or a problem set. |
| `/learn-review` | Quizzes you across all subjects on the topics that have gone longest without a check. Use it to keep finished subjects fresh. |
| `/learn-end` | Saves the session: updates your notes, writes the hand-off for next time, and prints a plain-English summary. Use `/learn-end break` if you are coming back the same day. |

When you open the vault, the tutor shows what it recommends doing next and asks before it starts anything.

## How a session works

`/learn-start` first asks up to three questions about your goal. It then gives you one problem that represents the goal and asks a few short follow-up questions to find where your knowledge stops. From that, it writes a lesson plan as a graph of small topics, each resting on the ones before it. Two helper agents read the plan before you see it. `fact-checker` checks its facts against sources, and `plan-reviewer` looks for steps that are too big or that skip something you have not shown you know.

Teaching goes one topic at a time and one reasoning step per message, with a question after each step. Every topic gets written into the session note before the next one starts. After about 45 minutes of active time, the tutor suggests a break.

The tutor marks a topic as known only after you answer a question about it. Each topic moves through these stages:

| Stage | Meaning |
| --- | --- |
| Introduced | Taught, but you have not passed a check on it yet. |
| Passed | You answered a check right without a hint, in the session it was taught. |
| Remembered on a later day | You got it right again in a later session. |
| Slipped | You missed it in a later session. The tutor re-teaches it briefly. |

What you enjoyed and what you actually got right are kept separate, and the tutor teaches from the second.

## What you see in Obsidian

- `learn/Home.md` shows what to do now.
- `learn/Dashboard.md` lists every subject with its progress.
- `learn/subjects/<topic>/progress.md` shows a skill tree for one subject.
- `learn/subjects/<topic>/log.md` is the live chat. Keep it open while you work, and it updates as the tutor types.
- Session notes in `learn/subjects/<topic>/sessions/` hold each lesson, its diagrams, and quiz results.
- Code exercises get a **Run** button. It opens a code pane where you edit, run, and press **Send to tutor**.

Home, the dashboard, the progress pages, and the logs are rebuilt from your notes, so don't edit them by hand.

## Where things live

| Folder | What is in it |
| --- | --- |
| `learn/system/` | How the tutor teaches. Edit `tutor.md` to change its style. |
| `learn/me/preferences.md` | How you like to learn. You edit the *Stated* section. The tutor adds to *Observed* only when it has seen something twice. |
| `learn/subjects/<topic>/` | One subject: `record.md` (what you know, with evidence), `plan.md` (the lesson graph), `resume.md` (the hand-off), and `sessions/`. |
| `learn/reviews/` | Notes from `/learn-review` passes. |
| `.claude/` | Claude Code skills, helper agents, and hooks. Codex uses `.agents/` and `.codex/`. |

Your subjects, preferences, reviews, and chat logs stay on your computer. `.gitignore` keeps them out of git.

For why it is built this way, see [how the learning system fits together](learn/README.md).
