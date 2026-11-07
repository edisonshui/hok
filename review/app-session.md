# Review: the desktop app's tutor-session move

Scope: commits `6876412..fdf6846` on `vault-app`, read against `docs/app-session.md`.
Files read: `app/lib/session.js`, the parts of `app/renderer/app.js` and `app/main.js`
that call it, and `app/test/session.test.js` and `app/test/closeout.test.js`.

Result: 13 findings. 12 confirmed by a failing test, 1 suspected.
The tests are in `app/test/session-review.test.js` (19 tests, all failing on purpose).
Nothing is fixed.

`cd app && node --test`: 70 tests, 51 pass, 19 fail. The 51 that pass are the
original suite, unchanged.

## How some of the "Not verifiable without a display" items got checked

Claude Code 2.1.318 is installed in this container, so I ran it in a
pseudo-terminal with a screen emulator (`pyte`) in a fresh folder, the way the
app's xterm would see it. I sent no message to the model. What I saw:

| Spec item | Result in 2.1.318 |
| --- | --- |
| Trust question text | Matches `TRUST_ASK` after ANSI and spaces are stripped. The options read `❯ No, exit` (highlighted) then `Yes, I trust this folder`. |
| Return on the trust question | Picks "No, exit". Claude Code quits with exit code 1. |
| Down+Return | Picks "Yes". The banner `Claude Code v2.1.318` follows, so `BANNER` matches. |
| Text typed into the trust question, then Return | Claude Code quits. Test: wrote `Can I have a hint?`, waited 90 ms, wrote `\r`. |
| Bracketed paste | Holds: a pasted block did not send early. A paste of 5 or more lines shows in the input box as `[Pasted text #1 +4 lines]`, not as its text. 2 and 3 lines show as text. |
| Ctrl+U clearing | 60 presses, 30 ms apart, cleared a 40-line paste. One press cleared a typed line. Not checked: whether text that Esc puts back comes back as a paste placeholder or as plain lines, because that needs a model turn. |
| Tab in the input box | `/learn-res` then Tab becomes `/learn-resume`. |

Still not checked: everything painted, focus moves, the close-out button's looks,
and a real `/learn-close` run.

## Findings, most severe first

### 1. A reply sent while the trust question is on screen makes Claude Code quit

- What the learner sees: in a vault Claude Code has not seen before, the learner clicks Resume, then types a message, or clicks Hint, Check me, or End, instead of answering the trust card. The tutor stops at once ("The tutor stopped") and the message is lost.
- Where: `app/lib/session.js:196` (`say()` sends directly) and `app/lib/session.js:156` (`send()` never checks `st.trust`). The only guard is in `flushQueue()` at line 217. `ACTIONS.end` and `ACTIONS.break` call `send()` directly (`app/renderer/app.js:1024-1025`).
- Steps: tutor stopped, on subject A's Session, in a folder Claude Code has not trusted. Click Resume. The trust card appears. With nothing queued, `say()` sees the route already set to A by `start()` and the queue empty, so it types the text and Return into the trust question. Return picks the default, "No, exit". The trust card says "Your message waits until you answer", but the message does not wait.
- Confirmed: `review: a reply sent while the trust question is on screen waits instead of answering it` and `review: End while the trust question is on screen does not answer it`. Checked live on 2.1.318 (table above).

### 2. A reply during a review or a new start gets a `/learn-resume` of another subject pushed in front of it

- What the learner sees: they press Review (or Start, or ask a question in Home's ask box). The tutor asks its first question, and the learner answers in the composer. The answer shows as "Sends when the tutor is ready", and the tutor gets `/learn-resume <some subject>` in the middle of the review. A session on that subject opens, and the review is derailed.
- Where: `app/lib/session.js:189` (`reopen` is true whenever the route differs from the subject on screen) together with `app/renderer/app.js:299-307` and `313-315` (`run()` and `runTyped()` keep `route.slug` on the default subject, so the Session screen shows a subject that `/learn-review` or a bare `/learn-start` never opened).
- Steps: (a) Home, click Review. The Session screen opens on the default subject A, and the tutor runs `/learn-review`, which opens no route. The learner types an answer and sends: `say()` sees route `null` and subject A, so it queues the answer and sends `/learn-resume a`. (b) Type `/learn-start linear algebra` in the composer. The app reads the route as `linear`. The tutor creates `linear-algebra`, and the thread follows its log (`app/renderer/app.js:1791`). The next reply sends `/learn-resume linear-algebra` mid-start. The vault's hook (`.claude/hooks/obsidian-live.py:562`) does not treat the word after `/learn-start` as a slug unless that subject exists, so the app and the hook disagree here.
- Confirmed: `review: a reply during /learn-review is not preceded by /learn-resume for the subject on screen` and `review: a reply during /learn-start of a new subject is not preceded by /learn-resume`.

### 3. A waiting message is delivered to whichever subject is on screen when it flushes, even in another vault

- What the learner sees: they write an answer on subject A's Session and then open subject B before the tutor is ready. The app resumes B and delivers A's answer into B's session. After opening another vault, the pending bubbles from the old vault stay in place, and once the new vault's tutor starts they are sent into it.
- Where: `app/lib/session.js:191` and `204` (the queue stores the message only, not its subject), `app/lib/session.js:218-219` (the flush reads the subject from `io.currentSubject()` at flush time), and `app/lib/session.js:145` (`markStopped()` keeps the queue). The renderer side is `app/renderer/app.js:1661`.
- Steps: (a) Tutor stopped, on A. Send "my answer". The tutor starts with `/learn-resume a`. Switch to B's Session while the tutor is still writing. On the next quiet spell the app sends `/learn-resume b`, then "my answer". (b) A message waits. Open another vault. Start the tutor there: the old message is sent as soon as the terminal goes quiet.
- Confirmed: `review: a queued message goes to the subject it was written for, not the one on screen` and `review: messages queued before a vault switch are not sent into the next vault's tutor`.

### 4. Two sends close together get mixed up in Claude Code's input box

- What the learner sees: they send a message with a screenshot, then a second message within about a third of a second (or click Hint). The tutor receives the second message with the screenshot attached, then the first message's text on its own. After Esc, a quick second send can be erased before it goes, and the tutor gets a fragment or nothing.
- Where: `app/lib/session.js:156-180`. `send()` awaits between writes (Ctrl+U presses at line 163, image saves at lines 166-168) with no lock, so a second `send()` writes while the first is still going.
- Steps: (a) Running, route open. Send `{text: "here is my screen", images: [one]}`, then send "and a second thought" right away. Typed order: `and a second thought`, the image path, Return, ` here is my screen`, Return. (b) Send a long message, press Esc, then send two messages back to back. The first message's Ctrl+U presses run after the second message was typed and erase it.
- Confirmed: `review: two sends in quick succession arrive whole and in order (images)` and `review: two sends in quick succession after Esc: the second is not wiped by the first's Ctrl+U`.

### 5. End or Break while a message waits goes first, and then the app reopens the session it just ended

- What the learner sees: they send a message that waits behind a resume, then click End. The tutor saves and ends the session, then the app sends `/learn-resume` again and delivers the waiting message in a new session. The learner asked to stop and the session came back.
- Where: `app/renderer/app.js:1024-1025` (End and Break call `send()` directly, skipping the queue), `app/lib/session.js:178` (the resume sent from `say()` opens the route before the tutor has run it, so `sessionOpen()` is true), and `app/lib/session.js:219` (the flush reopens because `/learn-end` closed the route).
- Steps: running, route closed after an earlier `/learn-end`, on A. Send "one more thing" (queued, `/learn-resume a` sent). Click End. Typed order: `/learn-end`, `/learn-resume a`, `/learn-end`, `/learn-resume a`, `one more thing`.
- Confirmed: `review: End while a message waits does not jump ahead of it and then reopen`.

### 6. After Esc, a dropped Return is never pressed again for a message of 5 or more lines

- What the learner sees: they stop the tutor with Esc, then send code from the Code runner or any message of 5 or more lines. If Claude Code drops the Return, the message stays unsent in the terminal's input box, and the tutor never answers.
- Where: `app/lib/session.js:175-176`. The retry looks for the message's first 24 characters in the input row, but Claude Code 2.1.318 shows a paste of 5 or more lines as `[Pasted text #1 +N lines]` there (seen live).
- Steps: send a message, press Esc, send a 6-line message. The input row reads `[Pasted text #1 +5 lines]`, the probe `class A {` is not found, and no second Return goes out.
- Confirmed: `review: a dropped Return is retried for a message Claude Code shows as a collapsed paste`. The test stands in for the display with the placeholder seen live.

### 7. A subject can be resumed while its close-out is still running

- What the learner sees: they click Close out twice, and while the spinner says "Closing out" they click Resume on the same subject. Two Claude Code runs (`/learn-close` in the background, `/learn-resume` in the terminal) settle the same open session note and write the same `record.md` at the same time. The subject may end up in Done while a live session on it continues.
- Where: `app/renderer/app.js:1077-1091` and `1447` (the Resume button stays active whatever `CLOSE.pending()` says) and `app/main.js:199` (`tutor:close` does not check the running terminal). Neither `createSession` nor `createCloseout` knows the other exists.
- Steps: tutor stopped, on A. Click Close out, then click it again. While it runs, click Resume.
- Suspected. The guard decision lives in renderer paint code that needs a DOM, and the harm needs two real Claude Code runs writing the same files. I read the code and could not drive it with a test.

### 8. A route command typed in the composer while the tutor is stopped resumes the subject on screen first

- What the learner sees: on A's Session with the tutor stopped, they type `/learn-review` (or `/learn-resume b`) and send. The tutor first resumes A, which opens a session note on A, and only then runs the command. A's session note is left open.
- Where: `app/lib/session.js:202-207`. `submit()` always starts with `startPrompt` and queues the message, even when the message is its own route command.
- Steps: as above. `startProcess` gets `/learn-resume a`.
- Confirmed: `review: a route command typed in the composer while stopped is the start prompt`.

### 9. Commands typed in the terminal are missed after a paste, Tab completion, or Ctrl+U

- What the learner sees: they open the terminal and paste `/learn-resume a`, or type `/learn-res`, press Tab, and add ` a`, or clear the box with Ctrl+U and type the command. The session opens in the terminal, but the app still thinks none is open. The composer says "Message your tutor to resume A", and the next message sends another `/learn-resume a` first.
- Where: `app/lib/session.js:102-114`. Every escape sequence resets the tracked text, including the bracketed-paste end marker `\x1b[201~`, so a paste leaves nothing. Tab and Ctrl+U are dropped as control characters, though Claude Code completes on Tab and clears on Ctrl+U. The spec says escape sequences are skipped and only a bare Esc resets. The code resets on all of them.
- Steps: as above, each followed by Return.
- Confirmed: `review: a command pasted into the terminal moves the route`, `review: Ctrl+U typed in the terminal clears the tracked command, as it clears the input box`, and `review: a command finished with Tab completion in the terminal moves the route` (Tab behavior seen live).

### 10. Check me from the keyboard shortcut runs outside the subject, or vanishes

- What the learner sees: with the tutor stopped, the Check me menu shortcut starts the tutor with a bare `/learn-check` in a fresh conversation, with no subject open, so the check is not filed under the subject. Pressed while the tutor is starting, the shortcut does nothing at all.
- Where: `app/renderer/app.js:1023` (runs when `route.slug` is set even if the tutor is stopped), `app/lib/session.js:159` (falls back to `start(text)`), and `app/lib/session.js:120` (that start is ignored while starting, and the text is dropped).
- Steps: (a) Stopped, on A, press the shortcut. `startProcess` gets `/learn-check`. (b) Click Resume, then press the shortcut during "Starting…".
- Confirmed: `review: Check me while the tutor is stopped runs inside the subject's session` and `review: Check me while the tutor is starting is not dropped`.

### 11. A flush timer from before a restart types into the new tutor before it has drawn anything

- What the learner sees: they pick Restart while a message waits and the tutor was writing less than 1.5 s ago. The app types `/learn-resume a` and Return into the new Claude Code before its first screen appears. If the folder's trust question was never answered, that Return lands on it and Claude Code quits (finding 1). Otherwise the resume goes in before Claude Code is ready, and whether it survives was not checked.
- Where: `app/lib/session.js:87` (the timer is armed) and `app/lib/session.js:140-145` (`stop()` and `markStopped()` do not cancel it). `onExit()` at line 91 does not either.
- Steps: running, route closed, on A. Send "hi" (queued). Output arrives. Within 1.5 s, Restart. The old timer fires after the new start and finds the tutor running.
- Confirmed: `review: a flush timer armed before a restart does not type into the new tutor before it prints`.

### 12. After a host or vault switch, the trust card stays in the thread with buttons that do nothing

- What the learner sees: they switch host or vault while the trust question is up. The tutor stops, but the card "Claude Code asks first: do you trust this folder?" stays in the thread. Its buttons do nothing until the next start.
- Where: `app/lib/session.js:140-145` (`stop()` and `markStopped()` leave `trust` and `route` set) and `app/main.js:127` (`stopTerminal()` clears `term` before `kill()`, so `pty:exit` is never sent and `onExit()` never runs). The spec says these transitions return to idle.
- Steps: trust question showing. Settings, switch host. `st.trust` is still true, and `app/renderer/app.js:1329` paints the card.
- Confirmed: `review: stopping the tutor clears the trust question`.

### 13. "Not now" on the trust card throws away the screenshots of a waiting message

- What the learner sees: they paste a screenshot with a message, the trust card appears, and they click Not now. The words come back into the composer, but the screenshot is gone. If the composer already holds new text, the words are dropped too (`app/renderer/app.js:937`).
- Where: `app/lib/session.js:240-242`. Only `msgText` is kept, and the queue is cleared.
- Steps: tutor stopped. Send a message with an image. The trust question appears. Click Not now.
- Confirmed for the screenshot: `review: declining trust keeps the screenshots of a waiting message`. The composer-not-empty case is renderer code, read but not tested.

## Areas with nothing found

- Behavior changed by the move itself: none beyond the four fixes the commits name. `send()` no longer awaits `ensureTerm()`, which is harmless because `running` implies a terminal exists.
- Close-out machine (`createCloseout`): nothing beyond finding 7.
- `quote`, `tutorEnv`, `tutorArgs`, `closeArgs` on macOS and Linux: nothing. Windows `cmd` quoting was not checked, since there is no `cmd` here.
- The known gaps the spec already lists are not repeated here.
