# The desktop app's tutor session

How the app in `app/` tracks a tutor session. The logic lives in
`app/lib/session.js`; `app/renderer/app.js` paints from its state and calls
into it, and `app/main.js` builds the terminal's command and environment with
its helpers. Tests: `app/test/session.test.js`, `app/test/closeout.test.js`,
and `app/test/session-review.test.js` (the review in `review/app-session.md`).

## States

The terminal process has one lifecycle state. Four more facts ride along
while it runs: whether a trust question is on screen, which subject's session
is open (the route), whether a review or start owns the conversation, and
whether messages are waiting in the queue. Each waiting message remembers the
subject that was on screen when it was written (`queueFor`, index for index
with `queue`).

| State | Meaning | Stored as |
| --- | --- | --- |
| idle | No tutor process. Nothing started yet, or the vault changed. | `running: false`, `starting: false`, `ended: null` |
| starting | `pty.start` was called and has not answered. | `starting: true` |
| running | The process is up. | `running: true` |
| running, busy | Output arrived in the last 1.2 s: the tutor is writing. | `busy()` |
| running, trust | Claude Code's folder-trust question is on screen. Messages wait. | `trust: true` |
| running, route open | `/learn-start`, `-resume`, or `-practice` named a subject; replies land in its log. | `route: "<slug>"` |
| running, route closed | `/learn-end` ran, or no route command was ever sent. | `route: null` (`routeEnded` says which) |
| running, free | `/learn-review` or any `/learn-start` owns the conversation: replies go straight to it, with no reopen. Cleared by `/learn-end`, `/learn-resume`, `/learn-practice`, or a stop. | `free: true` |
| ended | The process exited. | `running: false`, `ended: <date>` |
| failed | `pty.start` answered with an error. | `failed: <message>` |

The close-out flow is a second, independent machine per subject:
unarmed → armed (first click, 4 s window) → queued → closing → done.
One close-out runs at a time; the rest wait in a queue.

## Events and transitions

| From | Event | To / effect |
| --- | --- | --- |
| idle, ended, failed | Send, Resume, Practice, Start | starting; the message waits in the queue, the resume command rides as the CLI prompt |
| idle, ended, failed | the learner's own route command sent from the composer (`/learn-review`, `/learn-resume b`) | starting, with that command as the CLI prompt; nothing is queued for it |
| idle, ended, failed | Check me or Hint on a subject's Session (`say()`) | starting with the subject's reopen command as the prompt; the message waits in the queue |
| starting | `pty.start` ok | running |
| starting | `pty.start` error | failed, toast |
| starting | another start | ignored (`starting` guard) |
| starting | send or say | the message waits in the queue (it is not passed to the ignored start) |
| running | terminal output | busy; trust question detected (ANSI stripped, matched without spaces); queue flush armed for 1.5 s of quiet |
| running | 1.2 s without output | quiet (`busy()` false) |
| running, quiet, no trust, no waiting question | flush timer | oldest queued message is sent; if its own subject's session is not open (and nothing owns the conversation), that subject's reopen goes instead and the queue holds |
| running, trust | any send, say, End, or Break | the message waits in the queue; nothing is typed, since Return picks "No, exit" |
| running, trust | "Trust this folder" | Down+Return into the terminal; trust cleared |
| running, trust | "Not now" | Return (Claude Code exits); queue dropped, the learner's words and pasted screenshots restored to the composer, ahead of any words already there |
| running, trust | Claude Code's banner in output | trust cleared (answered in the terminal) |
| running, queue not empty | any send, say, End, or Break | the message joins the back of the queue |
| running | send, route matches or free | text (+ pasted images as file paths) typed into the terminal, Return pressed, dropped Return retried at 1.5 s (matched by the text's first line, or by `[Pasted text #N` for 4 or more lines) |
| running | a send while another is still being typed | waits until the first one's Return; one message is typed at a time, the route moves in send order |
| running | send, route differs, not free | message queued; `/learn-resume <slug>` (or `-practice` when done) sent first |
| running | `/learn-resume\|practice <slug>` sent or typed | route opens for that slug, free cleared |
| running | `/learn-start <words>` sent or typed | route set to the first word, free set (the tutor may create a subject with another slug; the thread follows its log) |
| running | `/learn-start` or `/learn-review` with no slug | free set, route unchanged |
| running | `/learn-end` sent or typed | route closes, `routeEnded`, free cleared |
| running | keystrokes typed in the terminal | tracked as the command being typed: escape sequences skipped, bracketed paste keeps its text, Up/Down/Esc/Ctrl+U reset it, Backspace deletes one character, Tab completes a `/learn-` skill name when only one fits, Return checks it for a route command |
| running | Esc / stop button | `\x1b` written; Ctrl+U presses counted from the last sent message, pressed before the next send |
| running | process exit | ended; trust, route, and free cleared; flush timer cancelled (queue kept for a restart) |
| running | Restart, host switch | process stopped, state back to idle: trust, route, and free cleared, flush timer cancelled, a half-typed send stops; queue kept for the next start |
| running | vault switch | as Restart, and the queue is dropped: its messages were written for the old vault |
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
5. **A send while the trust question is up quit Claude Code.** `say()` and
   `send()` typed straight into the trust question, so Return picked "No,
   exit". Only the flush checked `trust`. Fixed in b6197bb: every send waits
   in the queue while the trust question is on screen. Review finding 1.
6. **A reply during a review or a new start resumed the subject on screen.**
   `/learn-review` and a `/learn-start` of a new subject open no route the app
   can match, so the next reply sent `/learn-resume <subject>` first and
   derailed the command. Fixed in 8d157ea: those commands set `free`, and no
   reopen happens until `/learn-end` or another route command. Review
   finding 2.
7. **A waiting message went to whichever subject was on screen at flush
   time, even in another vault.** The queue held only the message. Fixed in
   30b9b54: each message remembers its subject (`queueFor`), and a vault
   switch drops the queue. Review finding 3.
8. **Two sends close together were typed into each other.** `send()` awaited
   between its writes with no lock. Fixed in 9032b5f: sends are typed one at a
   time, each finished by its Return. Review finding 4.
9. **End or Break while a message waited jumped ahead, then the session
   reopened.** End and Break call `send()` directly, which skipped the queue.
   Fixed in 3ef4722: a send made while messages wait joins the back of the
   queue. Review finding 5.
10. **A dropped Return after Esc was never retried for 5 or more lines.**
    Claude Code shows such a paste as `[Pasted text #1 +N lines]`, so the
    retry's text probe missed. Fixed in 209a537: the placeholder counts as
    unsent for 4 or more lines. Review finding 6.
11. **A route command typed in the composer while stopped resumed the subject
    on screen first.** Fixed in 5795528: the command is the start prompt
    itself. Review finding 8.
12. **Commands pasted, Tab-completed, or typed after Ctrl+U in the terminal
    were missed.** Every escape sequence, including the paste markers, reset
    the tracked text, and Tab and Ctrl+U were dropped. Fixed in e4797da.
    Review finding 9.
13. **Check me from the shortcut ran outside the subject, or vanished.**
    Stopped, it started a bare `/learn-check`; while starting, the ignored
    start dropped it. Fixed in 096a062: `say()` while stopped starts with the
    subject's reopen command, and a send while starting waits in the queue.
    Review finding 10.
14. **A flush timer from before a restart typed into the new tutor.** Stop,
    start, and exit did not cancel it. Fixed in c88f993: each process gets a
    generation, and old timers and half-typed sends check it and stop. Review
    finding 11.
15. **The trust card outlived a host or vault switch.** The main process
    sends no exit for a stop it made, and `stop()` and `markStopped()` left
    `trust` and `route` set. Fixed in 38f8ce5: both clear them, as an exit
    does. Review finding 12.
16. **"Not now" threw away a waiting message's screenshots,** and its words
    when the composer held new text. Fixed in 26dea81: both come back, the
    words ahead of what the composer holds. Review finding 13.

## Known gaps, left as they are

- The queue flush is armed only by terminal output. A flush blocked by a
  waiting question or the trust card is retried only when more output arrives.
  In practice answering either produces output, so it self-heals.
- A route command keeps the case the learner typed: `/learn-resume CS124`
  never matches the subject `cs124`, so the app resumes it once more.
- If a message with pasted images had to start the tutor from `send()`'s
  fallback path, the images would be dropped (only the text can ride as the
  CLI prompt). No UI path reaches this today: sends while stopped go through
  the queue, and a send while starting waits in it.
- `free` has no end the app can see when a review finishes on its own. Until
  `/learn-end` or a route command, a message on a subject's Session goes into
  the same conversation with no reopen, and the vault's hook files it under
  whatever route it last saw.
- A vault switch drops waiting messages without telling the learner.
- End or Break queued behind a waiting message shows nothing in the thread
  (queued `/learn-` commands get no pending bubble) until it is sent.
- A subject can be resumed while its close-out is still running (review
  finding 7, suspected, not fixed). The Resume button ignores
  `CLOSE.pending()`, and `tutor:close` does not check the running terminal, so
  `/learn-close` and `/learn-resume` could write the same `record.md`. The
  guard lives in renderer paint code and needs a DOM to test.
- Trust detection stops scanning after the first match (`trustSeen`), so a
  second trust question in one process (say `/add-dir` to a new folder) gets
  no card and must be answered in the terminal.

## Not verifiable without a display

Checked by the tests only up to the module boundary; the real behavior needs a
window and a live Claude Code:

- Whether Ctrl+U really deletes one screen line per press in Claude Code's
  input box, and whether the press count (lines + 4, max 60) always clears it.
- Whether a 4-line paste shows as `[Pasted text #N` (5 or more lines do and 2
  and 3 do not, on 2.1.318), and whether Tab completes `/learn-` names exactly
  as the app's tracking assumes.
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
