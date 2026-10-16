# Other sessions on this computer: plan

Goal: the office shows, under the team, the other Claude Code sessions running on the same computer for the same
person: which project each is in, whether it is working, coordinating, idle or waiting on you, what it is doing
now, and the job it is on. One person, one machine. Other people, other machines, any network relay and Claude
Code's own transcript files are out of scope.

## What the engine gives us (2.1.301, checked)

- Each session loads its own copy of the mod; hooks fire for that session only. No API lists other sessions.
- `$.fs.write(path, text)` writes a whole file anywhere the process can (spiked: a write under `~/.claude/` from a
  `--plugin-dir` mod landed). No append, no rename, no delete, no lock. A read can see a half-written file.
- `$.fs.list(dir)` returns `{ name, kind, size, mtimeMs }` per entry in one call: cheap to poll.
- `$.store` is one JSON file per plugin with no locking: not used for this.
- `$.env.get('HOME' | 'USERPROFILE' | 'CLAUDE_CONFIG_DIR')` reads the folder; `crypto.randomUUID()` exists.
- `session.end` with `reason: 'clear'` keeps the process under a new session id; other reasons end it. A crash or
  a killed process fires nothing.

## Design

**Option.** `otherSessions`: `off` (default) or `on`. Off writes and reads nothing, as `history` does: anything
the mod keeps on disk across sessions is opt-in. With it on a session both publishes itself and shows the others;
a session with it off neither appears nor sees.

**Folder.** `<config>/pixel-office/sessions/`, where `<config>` is `CLAUDE_CONFIG_DIR`, else `$HOME/.claude`, else
`%USERPROFILE%/.claude` (the folder `$.store` already lives under). No folder found: the feature stays off.

**Slots, not one file per session id.** There is no delete, so a file per session would pile up forever (thousands a
year for a heavy user, all listed every poll). Instead a session claims one of 32 slot files, `slot-00.json` to
`slot-31.json`, and overwrites only its own. A slot is free when it is missing, unreadable, ended (tombstone) or
stale (its `beatAt` older than 20 s). With every slot held, the session reads but does not publish.

**Snapshot, not events** (schema `v: 1`, under 2 KB):

```
{ v, instance, sessionId, beatAt, startedAt, endedAt, project, status, now, task, helpers, needsYou }
```

- `instance` is a `crypto.randomUUID()` per load of the module: two processes on one session id, or a hot reload,
  never mistake each other's slot for their own.
- `project` is the base name of `$.session.root()`; never the full path.
- `status` is Main's panel status (`working`, `coordinating`, `idle`), or `waiting` when any agent waits on you.
- `now` is Main's "doing now" words and `task` the start of the job's message, each cut to 60 characters. Nothing
  else from the session is written: no briefs, reports, commands, file lists or helper names.
- `endedAt` set and the rest blank is a tombstone, written on `session.end` (not `clear`).

**Timing**, on the existing 350 ms flush, so no new timer:

- Every 6th flush (~2.1 s): publish when the snapshot changed, or at least every 18th flush (~6.3 s) as a
  heartbeat; then list the folder and read the slots that changed (by `mtimeMs` and `size`), at most 32, each at
  most 8 KB.
- Before each publish the session reads its own slot: a fresh foreign `instance` there means two sessions claimed
  one slot at once, and the one that sees it moves to another free slot, picked at random among the free ones, so
  two that both move do not collide again.
- A peer is shown while its `beatAt` is within 20 s of now (and not more than 20 s ahead, against a clock change).
- `/clear`: the slot is kept; the new session id and the emptied scene are published at the next beat.

**Reading.** Parse defensively: a file that fails to parse, has the wrong `v`, or fields of the wrong type is skipped
and the last good copy of that slot is used for up to the stale window. Drop this process's own `instance` and its
current session id (a hot reload's old slot). Two slots with one session id keep the fresher. Sort by `startedAt`.

**Redraws.** A state write redraws the pane, and a redraw restarts the picture's walks, so the `others` atom is
written only when what the panel shows changes, and a change only in the "now" words at most every 4 s.

**Display.** Under the feed and the team, an **Other sessions on this computer** list, up to 6 rows and "+N more":
`project · status · now` in the panel's status colours, with a dim line under it for the job and the helper count.
The terminal text view gets the same rows. The picture itself is unchanged: the floor is already full.

## Code

- `hooks/peers.ts` (pure, tested): types, constants, `configDirOf`, `snapshotOf`, `parsePeer`, `livePeers`,
  `freeSlots`, `peerLines`, `isTombstone`.
- `hooks/register.tsx`: `publishPeer` and `readPeers` beside the other `$` helpers; one more step at the end of
  `flush`; the tombstone in `session.end`; the `others` atom.
- `hooks/pane.tsx`: the list.
- `types/index.d.ts`: `PeerSession` and `others` in `PluginState`; `plugin.json`: the option; README, spec.

## Risks

- Half-written files: a reader keeps the last good copy, and a writer's next beat repairs it.
- Two sessions taking one stale slot at once: the one that later sees a foreign owner moves; random choice.
- Crash: shown for up to 20 s more, then the slot is free.
- Machine asleep: all peers go stale and come back on the next beat after waking.
- More than 32 sessions: the extra ones are not shown anywhere; said in the README.
- Cost: one `list` and at most a few small reads every 2 s; writes only on change or every 6 s.
- Privacy: project base name, Main's status line and 60 characters of the job's message sit in a file under the
  person's own Claude config folder until the slot is reused. Off by default, and the README says what is written.

## Tests

- `peers.test.ts`: snapshot redaction and cutting, parsing junk, staleness both ways, self and duplicate filtering,
  slot choice, tombstones, the rows.
- `plugin.test.ts`: with the option off nothing is written; on, the slot is written with the snapshot; a peer file
  shows in the pane; a stale one does not; a foreign owner in our slot moves us; `session.end` writes a tombstone;
  a `/clear` keeps the slot; a full folder publishes nothing; the atom is not rewritten when nothing changed.

## Changes after the plan review

Three reviewers (engine fit, adversarial, product) read the plan above before any code. What changed, and why:

- **"now" became `doing`, a kind of work in fixed words** ("running a command"), never Main's own line, which names
  files and commands. A reader drops any `doing` words the office does not write itself.
- **The look has its own loop and busy flag** beside the flush, so a slow or stuck disk (a network home folder, a
  FIFO planted at a slot) cannot freeze this session's own office. Timing is by the clock, not by flush counts.
- **One redraw limit for the whole list**: at once when a session comes, goes or starts waiting on you; any other change
  at most every 10 s (not 4 s for the words alone), so many peers cannot keep restarting the walks.
- **Tombstone**: written only for an end that stops the process (not `clear`, and not `resume`, which also goes on
  under a new id); the copy is marked ended first, every write checks it, the look under way finishes first, and the
  tombstone goes only into a slot the copy saw as its own within the stale window, in one write with no read (the
  end of a session has a short bound).
- **Slot rules**: a half-written slot is free only after it stays unreadable for the stale window; a heartbeat more
  than 20 s ahead is stale too, for slot choice as for display; a link, a folder or a big file in a slot is never
  read, written or taken; the first claim is random among the free slots, or takes back this session's own slot from
  a hot reload's older copy (first claim only, so two processes on one session cannot swap for ever); the cache keeps
  only parsed snapshots, and the copy's own slot is always read afresh.
- **Parsing**: built field by field, finite times only, C1 controls and bidi marks removed as well as the rest.
- **Display**: "Your other sessions (3, 1 needs you)", waiting first, then working, coordinating, idle; how long a
  session has waited or been idle; a "(2)" for two projects of one name; plain rows, as a row cannot switch sessions;
  hidden when there are none. No helper count.
- **Reminders**: with `notify` on, another session waiting on you for 30 s is said once as a toast only, since that
  session raises its own notification.
