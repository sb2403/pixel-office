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
- `waiting { agentId, reason, at }`: from `classic.PermissionRequest`, or a
  `toolStarted` for AskUserQuestion or ExitPlanMode. Waiting ends with that call's
  `toolEnded`.
- `messaged { from, to, at }` (SendMessage)
- `turnStarted { agentId: 'main', at }`
- `handedBack { agentId, at }` (a subagent's `turn.complete`)
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
   until the subagent's first `toolStarted`, so no timer is involved.
2. `toolStarted`: walks to the station for the tool; plays that station's loop.
3. `toolEnded` with `isError`: a red puff over the head.
4. `waiting`: walks to reception; the bell rings.
5. `messaged`: walks to the recipient's position, then back.
6. `handedBack`: carries a folder to the parent's desk, then walks to the elevator and
   leaves. Both walks are drawn in one SVG as two `animateMotion` elements, the second
   beginning when the first ends. The agent becomes `gone`; the next `tick` at least
   4 s later removes it from the floor, and the org chart keeps it as done.
7. No events for 10 minutes: walks to the break room (`idle`), detected by `tick`.

`tick` comes from a `$.clock.every` started in `session.start`, every 5 s. It only
writes state when the sweep changes something, so a quiet office causes no redraws.

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

Others install it from the public repository, from a terminal Claude Code session:

```
/plugin install pixel-office --marketplace sb2403/pixel-office
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

## Out of scope

- Other sessions on the machine (a "building" view).
- Terminal pixel rendering (`Raster`).
- Replay or history beyond the ticker.
- Sound.
