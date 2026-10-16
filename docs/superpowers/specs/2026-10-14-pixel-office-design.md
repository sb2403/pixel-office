# Pixel Office — design spec

Date: 2026-10-14
Status: draft, awaiting review

## Purpose

A Claude Code mod, installed at user scope so it loads in every project, that draws a
live pixel-art office showing what every agent in the current session is doing and how
agents work together. The audience is a visual learner: the goal is to make agent
mechanics (spawning, delegating, tool use, waiting on the person, handing results back)
visible and understandable, not to monitor operations.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Scope of one office | This session only: the main agent plus its subagents and teammates |
| Surface | Claude desktop app (Code tab) pane, drawn as SVG. Terminal gets a text fallback |
| How activity shows | Agents walk between stations; each station stands for a group of tools |
| Learning aids | Plain-English ticker, hover details, station legend, org chart strip |
| Art direction | Open plan, richly detailed, idle agents go to a break room |
| Rendering approach | Event-driven SVG with SMIL animation (approach 1 below) |
| Permanent home | `D:\Claude\Pixel Office`, made a local marketplace, installed user scope |

## Platform facts this design relies on

Verified against the mod API declarations shipped with Claude Code 2.1.295.

- A mod is a plugin folder: `.claude-plugin/plugin.json`, `hooks/hooks.json` naming one
  hooks module, the module exporting `register(on, options)`.
- `tool.call` hooks see every tool call in every loop, with `agentId` set inside a
  subagent or teammate loop and absent on the main loop. `await next(e)` returns the
  result, including `isError`.
- `agent.spawn` hooks see each spawn: `parentAgentId` (absent when main spawns),
  `subagentType`, `description`, and teammate fields. The result carries the new
  `agentId`.
- `turn.start` fires for main-loop turns only. `turn.complete` fires for every loop's
  turn, carrying `agentId` for subagents; a subagent's `turn.complete` is its hand-back.
- `/clear` is seen as `session.end` with `reason: 'clear'`: the conversation ends, the
  process goes on, and no `session.start` follows it.
- `$.agent.list()` returns the session's agents with `id`, `type`, `description`,
  `status`, `parentId`, `name`, `teammateId`.
- Settings-hook events are hookable as `classic.<Event>`: `classic.PermissionRequest`
  fires when a permission prompt is raised, which is how "waiting on the person" is seen
  for tools other than AskUserQuestion and ExitPlanMode.
- The desktop surface draws `Svg` (max 131,072 characters). With `isInteractive: true`
  it is drawn in a script-less sandboxed frame where SMIL animation, CSS `:hover` and
  `<title>` tooltips work. No script runs inside it.
- The desktop `Client` element exists, but a client module's element table has no `Svg`,
  which rules it out for pixel art.
- State a drawing reads belongs in `$.state` (declared in `types/index.d.ts`); a write
  redraws only the readers. Module variables reset on hot reload.
- `$.ui.open({ id, title })` opens a pane drawn by a `ui.render` hook on
  `{ component: 'Pane', requestId: id }`. `$.command.register` adds a slash command.

## Rendering approach

Chosen: event-driven SVG with SMIL.

The mod keeps a scene model in `$.state`. Each hooked event updates the model; the pane's
render hook turns the model into one SVG string. The static office is built once from
sprite definitions in `<defs>` reused with `<use>`, which keeps the document well under
the size cap. An agent whose station changed since the last draw gets a one-shot
`animateMotion` walk from its previous slot to its new one; station activities (typing,
LED blink, coffee steam) are looping SMIL animations. Redraws are coalesced to at most
about three per second.

Rejected:

- Timer-driven frames: a `$.clock.every` tick redrawing a ~60 KB SVG several times a
  second, in every session. Heavy, and the frame reload would flicker.
- Client module: smooth local animation, but no `Svg` element, so pixel art would need
  thousands of `Box` cells.

Known risk: replacing the SVG source may reload the sandboxed frame, restarting loops and
possibly flickering. The first implementation step is a spike that measures this in the
desktop pane. If the reload is visibly bad, the mitigation is to raise the coalescing
interval and make walks start from the agent's previous position (already the plan), so
a restart is invisible except for loop phase.

### Spike outcome (2026-10-14)

Observed in the desktop pane: an `isInteractive` SVG whose source changes flickers badly on every
redraw, an image-mode SVG (no `isInteractive`) with a changing source does not, SMIL animates in both,
and hover tooltips never appear on this surface. So the office is drawn in image mode, and the hover
details below become click-for-details: org chart rows are buttons, and pressing one shows that agent's
details under the chart.

## Architecture

Mod folder: `D:\Claude\Pixel Office\pixel-office\`. Each unit has one job and the pure
units take no `$`, so they test without the engine.

| File | Job | Pure |
|---|---|---|
| `.claude-plugin/plugin.json` | manifest, `types`, `userConfig` (`autoOpen`) | — |
| `hooks/hooks.json` | names `./register.tsx` | — |
| `hooks/register.tsx` | wiring: event hooks → reducer, pane open, `/office` command, throttle | no |
| `hooks/model.ts` | reducer: `(scene, officeEvent) → scene`; agent lifecycle state machine | yes |
| `hooks/stations.ts` | tool name → station; station slots and aisle waypoints | yes |
| `hooks/sprites.ts` | pixel sprites as character grids → run-length `<rect>` markup | yes |
| `hooks/office.ts` | static open-plan floor SVG (walls, furniture, decor), cached string | yes |
| `hooks/render.ts` | scene → full SVG document; size guard | yes |
| `hooks/narrate.ts` | office event → plain-English ticker line | yes |
| `hooks/pane.tsx` | `ui.render` tree: SVG, ticker, org chart, legend | no |
| `types/index.d.ts` | `PluginState` contract for the scene | — |
| `hooks/*.test.ts` | tests | — |

### Office events (reducer input)

The hooks translate engine events into a small internal vocabulary so the reducer never
sees engine shapes:

- `spawned { id, parentId?, type, description, name?, isTeammate, at }`
- `toolStarted { agentId, tool, target, callId, at }` (agentId `main` for the main loop)
- `toolEnded { agentId, callId, isError, at }`
- `waiting { agentId, tool, at }` (`agentId` is null when the permission prompt does not
  say whose it is): from `classic.PermissionRequest`, or a `toolStarted` for
  AskUserQuestion or ExitPlanMode. Waiting ends with that call's `toolEnded`.
- There is no separate message event: SendMessage is a `toolStarted` like any other, and
  the reducer special-cases it (the sender walks beside the recipient and back).
- `todos { done, open, at }` (counts from TodoWrite and the Task tools, for the task board)
- `turnStarted { isContinuation, at }` (Main's `turn.start`; `isContinuation` is true when
  the turn began with no typed text, so it carries on from the one before)
- `turnEnded { at }` (Main's `turn.complete`, the one without an `agentId`)
- `handedBack { agentId, reason, at }` (a subagent's `turn.complete`; `reason` is
  `answer`, `aborted`, `refusal` or `error`, which only changes the ticker wording: a
  stopped or failed helper is reported as such instead of as handing in a report)
- `tick { at }` (staleness sweep, from a slow clock)

### Scene model (`$.state`)

```ts
type Scene = {
  agents: Record<string, Agent>    // includes 'main'
  order: string[]                  // arrival order, drives desk assignment
  ticker: TickerLine[]             // last 8
  todos?: { done: number; open: number }
  version: number
}
type Agent = {
  id: string; parentId?: string; type: string; label: string; description: string
  isTeammate: boolean
  phase: 'arriving' | 'briefing' | 'working' | 'waiting' | 'reporting'
       | 'leaving' | 'idle' | 'gone'
  station: StationId; slot: number
  prevStation?: StationId; prevSlot?: number   // walk origin for the next draw
  activity?: { tool: string; target: string; since: number }
  lastErrorAt?: number
  lastEventAt: number; arrivedAt: number
  look: { shirt: string; hair: string; skin: string }   // from type + id hash
}
```

## Scene

### Floor plan

Roughly 240 × 150 art pixels at 4 CSS pixels each; the SVG scales to the pane's width.

| Zone | Position | Stands for | Detail |
|---|---|---|---|
| Corner office | NW | Main's home base; main "thinking" between tools | glass walls, large desk, plant, nameplate |
| Open pods | center, 2 pods × 4 desks | Edit, Write, NotebookEdit | monitor glow; printer outputs a page on Write |
| Records library | NE | Read, Grep, Glob, LSP; Skill pulls a manual from the shelf | filing cabinets, bookshelves |
| Phone booths | E | WebFetch, WebSearch | booth light on while in use |
| Mailroom | E | any `mcp__*` tool | parcel on the counter |
| Server room | SE, glass walled | Bash, PowerShell | racks with LEDs that blink faster while running |
| Meeting room | S | spawn briefings, SendMessage, team chat | whiteboard shows the task description |
| Task board | N wall | TodoWrite and Task* tools | sticky notes reflect real done/open counts |
| Reception and bell | SW | waiting on the person: AskUserQuestion, permission prompts | bell rings, "!" bubble |
| Elevator lobby | SW | arrivals and departures | doors open, ding |
| Break room | W | idle agents | coffee machine steam, couch, water cooler, vending machine |
| Windows | N wall | — | city skyline, day or night by local time |

Any tool not mapped goes to the agent's desk.

### Characters

- Main: clay-orange shirt and tie.
- Subagents by type: Explore purple, Plan teal, general-purpose blue; other types get a
  color hashed from the type name. Teammates wear a lanyard badge.
- Hair and skin vary by a hash of the agent id so agents are told apart at a glance.
- A name tag above each head (type or name). A speech bubble shows a pixel icon for the
  station plus a short target: file base name, or the first ~18 characters of a command
  or query.
- Agents whose ids `$.agent.list()` does not know (workflow agents, engine forks) are
  drawn as a generic "contractor" sprite.

### Lifecycle a subagent acts out

1. `spawned`: arrives at the elevator, walks to the meeting room; the whiteboard shows
   the task description. The parent walks over too unless it is mid-tool. Briefing lasts
   until the subagent's first `toolStarted`, so the usual case needs no timer. If no event
   comes for 60 seconds (`BRIEFING_MAX_MS`), the sweep ends the briefing itself: the agent
   walks to its desk and is `working`, the whiteboard clears when nobody else is being
   briefed, and a parent still waiting in the meeting room with nothing to do walks home,
   exactly as when a first tool ends the briefing.
2. `toolStarted`: walks to the station for the tool; plays that station's loop.
3. `toolEnded` with `isError`: a red puff over the head.
4. `waiting`: walks to reception; the bell rings.
5. `toolStarted` for SendMessage: walks to the recipient's position, then back (to the
   meeting room instead when no live agent has that name).
6. `handedBack`: carries a folder to the parent's desk, then walks to the elevator and
   leaves. Both walks are drawn in one SVG as two `animateMotion` elements, the second
   beginning when the first ends. The agent becomes `gone`; the next `tick` at least
   4 s later removes it from the floor, and the org chart keeps it as done.
7. No events for 10 minutes: walks to the break room (`idle`), detected by `tick`.

`tick` comes from a `$.clock.every` started in `session.start`, every 5 s. It only
writes state when the sweep changes something, so a quiet office causes no redraws.

### Main between turns

Main never leaves, but it rests. `turnStarted` puts it to work in the corner office.
When its turn ends (`turnEnded`) it goes `idle` where it stands, with no walk and no
activity. After a short linger (8 s) the sweep walks an idle Main back to the corner
office if it was elsewhere, and after 10 minutes with no event it walks to the break
room, like any other idle agent. The next `turnStarted` brings it back to the corner
office. An office where nothing has happened yet never sends Main for coffee.

### Starting over with /clear

A `/clear` raises `session.end` with `reason: 'clear'` and no `session.start` after it,
so the `session.end` hook is where the office starts over: the scene becomes an empty
scene (Main alone, empty ticker, empty whiteboard), no agent is selected in the org chart,
and everything from the old conversation that has not been applied yet is dropped: both the
events still queued and any batch an in-flight flush has already taken off the queue. A
flush notes the epoch (a counter raised on every `/clear`) when it takes the queue, and the
scene update checks it before applying the batch or the sweep, so a stale flush leaves the
new, empty scene alone. The flush timer started at `session.start` keeps running, since
nothing will start it again. Any other end reason leaves the office untouched.

### Motion

On each draw, an agent with a `prevStation` different from `station` gets an
`animateMotion` path from the previous slot through the nearest aisle waypoint to the
new slot (L-shaped, about 1.5 s, `fill="freeze"`), with a leg-swap animation during the
walk. The reducer clears `prevStation` once a draw has consumed it. Stations have
numbered slots; when full, agents form a queue line beside the station.

## Pane

Top to bottom:

1. Office SVG, full width, `isInteractive: true`.
2. A row: ticker on the left, org chart on the right.
3. Legend, collapsed behind a button by default.

`/office` toggles the pane. Mod option `autoOpen`:
`on-first-subagent` (default), `session-start`, or `never`.

### Learning aids

- Ticker: last 8 events with time, in plain English, for example
  "Main hired Explore: find auth code", "Explore searched files for login",
  "Plan is waiting on you at reception", "Explore handed its report to Main and left".
- Org chart: tree from `parentId`; each row shows status (working, waiting, idle, done)
  and current station.
- Legend: zone swatch and the tools it stands for.
- Hover over an agent: type, task description, current tool and target, parent, time on
  the job (SVG `<title>`).

## Safety

The mod must never change or block what Claude does.

- Every hook is an observer: it always returns `next(e)` (or the awaited result of it)
  unchanged, wraps its own work in try/catch, and never denies or rewrites.
- Redraws are throttled; state writes are coalesced.
- Size guard: if the SVG exceeds 120,000 characters, decor layers are dropped first, then
  the number of drawn agents is capped with a "+N more" badge.
- Ticker capped at 8 lines; agents marked `gone` are removed from the floor after their
  exit walk and pruned from the model after 50 departures.
- On a terminal surface the pane draws a text version (agents, stations, ticker) instead
  of the SVG.

## Testing

- Unit tests (pure units): reducer sequences per lifecycle step, tool-to-station map,
  narrator lines, sprite run-length encoding, SVG size budget under a 20-agent scene.
- `claude plugin test`: mount the pane on `desktop` and `terminal`, drive simulated tool
  calls and spawns through the hooks, assert agents and ticker lines appear and that
  every `tool.call` result passes through unchanged.
- `claude plugin validate` and `tsc -p` on the mod folder.
- Manual: in the desktop app, run a task that spawns two or three subagents and watch the
  office.

## Install

`D:\Claude\Pixel Office` holds `.claude-plugin/marketplace.json` listing
`pixel-office` with source `./pixel-office`. Install once:

```
claude plugin marketplace add "D:\Claude\Pixel Office"
claude plugin install pixel-office@pixel-office --scope user
```

Others install it from the public repository, from a terminal, in two steps:

```
claude plugin marketplace add sb2403/pixel-office
claude plugin install pixel-office@pixel-office
```

Installed sessions run the installed copy of the mod, not the files in the folder, so an
edit reaches them only as a new version. After changing the mod, raise `version` in
`pixel-office/.claude-plugin/plugin.json`, then:

```
claude plugin marketplace update pixel-office
claude plugin update pixel-office@pixel-office
```

and start a new session. Claude Code 2.1.295 or newer is needed to run the mod at all;
older versions report that it failed to load.

## Build order

1. Spike: an `isInteractive` SVG with SMIL in a desktop pane, redrawn on a timer; observe
   loop restarts and flicker.
2. Reducer, stations, narrator with tests.
3. Static office and sprites.
4. Agents, walks, station animations.
5. Ticker, org chart, legend, hover.
6. Terminal fallback, size guard.
7. Marketplace file and user-scope install; manual verification.

## 0.3.0: roles and collaboration

The office animated collaboration but did not explain it. Names were engine type ids (`general-purpose 2`),
a boss blocked on its helpers looked like it was thinking, and the two things that carry the collaboration,
the brief a boss writes and the report a helper hands back, were dropped although the engine provides both.

- **Roles.** `hooks/roles.ts` maps each agent type to a job title and a one-line blurb: Main is the
  Coordinator, `Explore` the Researcher, `Plan` the Planner, `general-purpose` the Assistant, `fork` the Clone;
  any other type is humanized (`code-reviewer` is "Code reviewer"). An engine-given name is kept as the label
  (capitalized) and stays the address `SendMessage` matches on. Numbering continues from the highest number in
  the scene, so pruning never hands a label out twice.
- **Facts captured.** `spawned` gains `brief` (the first 200 characters of `agent.spawn`'s `prompt`) and
  `isBackground` (its `background`); `handedBack` gains `report` (the first 200 characters of
  `turn.complete`'s `answer`); `toolStarted` gains `detail` (the `description` Claude gives a command, else a
  small table of what common commands are for, or a message's `summary`).
- **Coordinating.** A boss's foreground helpers that are still out are the ones it waits on (`waitingOn`);
  teammates never count, as their spawn is always background. A boss with no tool in hand, not waiting on the
  person and not idle, with at least one, is *coordinating*: a status of its own in the panel, a bubble with the
  meeting-room icon naming who it waits on, and the sweep never sends it to the break room. When the last
  awaited report lands, the feed adds "<boss> has every report back and is reviewing the results".
- **Hand-offs.** A walk can carry an item, handed over when the walk reaches the first agent it visits: a
  folder on a hand-back, an envelope on a `SendMessage`. The SVG hides it with a `<set>` at that moment.
- **Plain words.** One present-tense voice in the feed ("is reading", "is running a command to …"); permission
  prompts say what they are for ("to run a command"); panel rows read name · status · what it is doing now; the
  details box gives role, blurb, job, brief, now, how the boss works with it, report and time on the job.
- **Name tags.** Longer, meaningful names collide where agents sit side by side (a boss briefing its new helper),
  so a tag that would overlap a neighbour's moves under the feet, choosing the placement with less overlap.

Still out of scope: changing what Claude does. The mod stays an observer that uses no model tokens; making Main
delegate more is a job for prompts or agent definitions, not for this mod.

## 0.4.0: cost, recap and the story

- **The feed keeps the story.** Feed lines carry `routineOf`, the agent whose routine work they report. A routine
  line replaces that agent's previous one, so eight lines hold every milestone (hires, hand-backs, messages, waits
  on the person, errors, turns) plus each agent's latest action, however many helpers work at once.
- **Cost.** `handedBack` and `turnEnded` carry `usage` from `turn.complete` (token counts summed over the turn's
  requests, and the model that answered last). Agents keep `{ tokens, reused, model }`, added up over turns.
  Tokens, never money: prices change.
- **Called back.** `spawned` carries `isResume` from `agent.spawn`'s `resume` (the run keeps its agent id). The
  agent comes back by the elevator, or from the break room, and is briefed again; it counts as awaited at once.
- **Whole texts.** Briefs and reports keep up to 2,000 characters with their line breaks; the details box shows a
  200-character excerpt and offers the whole text, drawn as `Markdown`, when the excerpt cut something. Only the
  ten most recently finished helpers keep whole texts.
- **Jobs.** `Scene.job` runs from a message to the next (a continuation turn belongs to the same job); agents keep
  `doneAt`. `hooks/recap.ts` derives the recap: lanes in hire order, helper time, time together (merged spans),
  the peak, tokens, and a speed-up said only for two or more helpers and a ratio of at least 1.2. The swimlane
  colors bars by how an agent worked with Main (Main, waited for, alongside): the three-slot palette is the
  largest the palette validator passes for every pair in light and dark, and role is already the row's name.
- **History** (option `history`, off by default): a record per job under the store key `jobs`, the newest 20,
  saved from the flush that applies a `turnEnded` and checked when read back.
- **Reminders** (option `notify`, off by default): an agent waiting on the person for 30 seconds is said once per
  wait, as a toast and through `$.ui.notify`, which raises a native notification only where there is a terminal.
- **Fixes.** A scene saved by an older version is restored with defaults at every read (`restore`, which returns
  the same object when nothing is missing). An agent waiting on the person is never swept.
- **CI.** GitHub runs the tests and both validations on 2.1.295 and the newest release on every change and every
  Monday, and fails when the README pictures no longer match the drawing code. Type-checking stays local.
- **Animation.** `$.ui.blit` and `Client` cannot help the desktop pane on 2.1.301; see
  `notes/2026-10-15-blit-spike.md`.

## 0.5.0: walks that hold together

Everything merged after 0.4.0 ships with it: the version string had not moved since, so installed copies kept
0.4.0 (`claude plugin update` keeps the cached copy while the version matches).

- **A walk begins when the picture can show it.** The flush applies each batch with
  `reduceAt(scene, ev, now + LEAD_MS)`. Movement is timed from that moment: where a walk starts, when it begins,
  `carry.until` and `goneAt`. The feed, the recap and the clocks keep the event's own time. Before, a walk began at
  the hook's time, and the first picture to show it was drawn a flush (0 to 350 ms) plus `LEAD_MS` later, already
  that far along: every walk opened with a jump, 26 cells median and up to 60 in a simulated three-helper session.
- **A change of course stays on the corridors.** `toCorridor` takes a walker whose destination changes back to the
  corridor along the path it was on, ahead or back, whichever is shorter, instead of straight up or down through a
  wall. A walk redirected before its first step leaves by its room's own door, and one sent back to where it stood
  is no walk at all.
- **A helper called back on its way out turns round where it is**, or when it uses a tool again, instead of jumping
  back to the elevator; one that has ridden away still steps out of it.
- **Still open.** Each redraw of the single picture restarts every walk in it. A picture drawn as of `LEAD_MS`
  ahead but shown after the desktop's own delay is late by the difference, and so was the picture before it, so the
  lead cancels out (corrected in 0.5.1; this said the lead decided the jump). What moves a walker is how much the
  desktop's delay changes from one picture to the next: in the simulation, the same jumps for leads of 0, 250 and
  500 ms, a p90 of 4 cells at ±50 ms of variation and 12 at ±150 ms, at about 1.4 redraws a second with three
  helpers. A picture the desktop mounts again (out of view and back) replays from when it was drawn. Bubbles change
  lanes when a neighbour's bubble comes or goes.

## 0.5.1: a probe for the layered picture

- **Why the layered picture is worth another look.** In the simulation it cuts the walker jumps a person can see by
  about 86% against the single picture (73 against 516 at ±150 ms of variation): a walker's picture is drawn again
  only when its own walk changes. The first layered build (PR #19) showed the scenery but no agents, and its layer
  boxes had no size; PR #21 gave them the whole region two minutes later, but no pane has shown the layered picture
  since, and installed copies stayed on 0.4.0 until 0.5.0.
- **The layer probe.** With `debug` on and the layered picture, a third probe (`probe-layer`) sits in a box laid out
  as an agent's layer is, and reports the room that box gets, so one run tells a layer with no room from a layer
  that has room and still shows nothing.

## 0.5.2: every render draws the picture afresh

- **What a recording showed.** With the layered picture, a helper went back to the first step of its walk again and
  again: at 2.35, 2.55, 3.95, 4.31 and 4.72 s it stood where it had started from at 1.91 s, and walked on from there.
  Its bubble did not change, so no new walk began, and the layers drew its picture once per walk: the text of its
  picture was the same each time. The desktop starts a picture's animations over whenever it draws the pane, not only
  when the picture's text changes. Every earlier fix kept the same text to spare the picture a restart (the cache of
  0.4.x, the redraw on a click in #13 and on a scroll in #16, the layers of #19 to #24), so each restart replayed a
  moment already past: the walker went back and walked the same stretch again.
- **The fix.** `officeSource` and `officeLayers` draw every picture as of the render, `LEAD_MS` ahead, at every
  render. A restart then carries on from where everyone is. What is left is how much the desktop's delay changes
  from one picture to the next.
- **Layered.** Stacking pictures cannot keep one agent's walk apart from another's restarts on this desktop. The
  layers draw afresh like the single picture, and stay only as an experiment. The recording showed their agents, so
  the layer probe of 0.5.1 is gone: it reported one row while the agents' pictures showed, so its rows said nothing
  about the room a layer gets.

## Out of scope

- Other sessions on the machine (a "building" view).
- Terminal pixel rendering (`Raster`).
- Replay or history beyond the ticker.
- Sound.
