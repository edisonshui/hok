# The desktop app's tutor session

How the app in `app/` tracks a tutor session. The logic lives in
`app/lib/session.js`; `app/renderer/app.js` paints from its state and calls
into it, and `app/main.js` builds the terminal's command and environment with
its helpers. Tests: `app/test/session.test.js` and `app/test/closeout.test.js`.

## States

The terminal process has one lifecycle state. Three more facts ride along
while it runs: whether a trust question is on screen, which subject's session
is open (the route), and whether messages are waiting in the queue.

| State | Meaning | Stored as |
| --- | --- | --- |
| idle | No tutor process. Nothing started yet, or the vault changed. | `running: false`, `starting: false`, `ended: null` |
| starting | `pty.start` was called and has not answered. | `starting: true` |
| running | The process is up. | `running: true` |
| running, busy | Output arrived in the last 1.2 s: the tutor is writing. | `busy()` |
| running, trust | Claude Code's folder-trust question is on screen. Messages wait. | `trust: true` |
| running, route open | `/learn-start`, `-resume`, or `-practice` named a subject; replies land in its log. | `route: "<slug>"` |
| running, route closed | `/learn-end` ran, or no route command was ever sent. | `route: null` (`routeEnded` says which) |
| ended | The process exited. | `running: false`, `ended: <date>` |
| failed | `pty.start` answered with an error. | `failed: <message>` |

The close-out flow is a second, independent machine per subject:
unarmed → armed (first click, 4 s window) → queued → closing → done.
One close-out runs at a time; the rest wait in a queue.

## Events and transitions

| From | Event | To / effect |
| --- | --- | --- |
| idle, ended, failed | Send, Resume, Practice, Start | starting; the message waits in the queue, the resume command rides as the CLI prompt |
| starting | `pty.start` ok | running |
| starting | `pty.start` error | failed, toast |
| starting | another start | ignored (`starting` guard) |
| running | terminal output | busy; trust question detected (ANSI stripped, matched without spaces); queue flush armed for 1.5 s of quiet |
| running | 1.2 s without output | quiet (`busy()` false) |
| running, quiet, no trust, no waiting question | flush timer | oldest queued message is sent |
| running, trust | "Trust this folder" | Down+Return into the terminal; trust cleared |
| running, trust | "Not now" | Return (Claude Code exits); queue dropped, plain text restored to the composer |
| running, trust | Claude Code's banner in output | trust cleared (answered in the terminal) |
| running | send, route matches | text (+ pasted images as file paths) typed into the terminal, Return pressed, dropped Return retried at 1.5 s |
| running | send, route differs | message queued; `/learn-resume <slug>` (or `-practice` when done) sent first |
| running | `/learn-start\|resume\|practice <slug>` sent or typed | route opens for that slug |
| running | `/learn-end` sent or typed | route closes, `routeEnded` |
| running | Esc / stop button | `\x1b` written; Ctrl+U presses counted from the last sent message, pressed before the next send |
| running | process exit | ended; trust and route cleared (queue kept for a restart) |
| running | Restart, host switch, vault switch | process stopped, state back to idle |
| any | subject close-out finished | subject re-read from the records; no session state changes |

## Transitions the code handled badly (each has a test; fixed ones note the commit)

1. **Send while stopped, with messages already pending.** `ACTIONS.send` set
   `T.queue = [message]`, so pending bubbles from before the tutor exited were
   silently discarded. Fixed: the queue is appended to.
2. **Start while already running.** The palette's "Open with no command" called
   `startTutor` with no `running` guard; `pty:start` answers `{running: true}`
   for the existing process, so the renderer wiped the visible terminal and
   reset route, trust, and `startedAt` while the real session kept running.
   Fixed: a start while running is a no-op.
3. **Arrow keys and Esc pollute typed-command tracking.** Keystrokes in the
   terminal were accumulated byte by byte; `\x1b[A` left `[A` in the buffer and
   Esc (which clears Claude Code's input box) left stale text, so a
   `/learn-resume` typed afterwards never moved the route. Fixed: escape
   sequences are skipped and Esc resets the buffer.
4. **A second message jumps the queue.** `say()` queued the first message and
   sent the resume command, which optimistically opened the route, so a second
   message sent before the flush went straight to the terminal, ahead of the
   first. Fixed: while messages wait, new ones join the back of the queue;
   the flush keeps order by peeking instead of shift-and-requeue.

## Known gaps, left as they are

- The queue flush is armed only by terminal output. A flush blocked by a
  waiting question or the trust card is retried only when more output arrives.
  In practice answering either produces output, so it self-heals.
- A route command keeps the case the learner typed: `/learn-resume CS124`
  never matches the subject `cs124`, so the app resumes it once more.
- If a message with pasted images had to start the tutor from `send()`'s
  fallback path, the images would be dropped (only the text can ride as the
  CLI prompt). No UI path reaches this today: sends while stopped go through
  the queue.
- Trust detection stops scanning after the first match (`trustSeen`), so a
  second trust question in one process (say `/add-dir` to a new folder) gets
  no card and must be answered in the terminal.

## Not verifiable without a display

Checked by the tests only up to the module boundary; the real behavior needs a
window and a live Claude Code:

- Whether Ctrl+U really deletes one screen line per press in Claude Code's
  input box, and whether the press count (lines + 4, max 60) always clears it.
- `inputLine()`: reading the ❯ input row from the xterm buffer, and the
  dropped-Return retry built on it.
- The trust question's exact on-screen text surviving future Claude Code
  releases, and Down+Return still selecting "Yes".
- Bracketed paste keeping multi-line messages and image paths from sending
  early.
- Everything painted: pending bubbles, the trust card, the Working row, focus
  moves, and the close-out button's four looks.
- `/learn-close` runs (`claude -p --model sonnet`) finishing and the record
  moving to done; the tests fake `closeOut`.
