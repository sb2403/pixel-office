# Pixel Office Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code mod, installed at user scope, that draws a live pixel-art office in a desktop-app pane showing what every agent in the session is doing and how agents hand work to each other.

**Architecture:** Hooks on `tool.call`, `agent.spawn`, `turn.start`, `turn.complete` and `classic.PermissionRequest` translate engine events into a small internal event vocabulary and queue them. A timer started in `session.start` flushes the queue about three times a second through a pure reducer into one `$.state` value (the scene). A `ui.render` hook for the pane turns the scene into one SVG (static office from cached markup, agents as pixel sprites with SMIL walks computed from the current time) plus a ticker, an org chart and a legend drawn with `Box`/`Text`/`Button`.

**Tech Stack:** Claude Code mod API (function hooks, early access) as shipped in Claude Code 2.1.295; TypeScript/TSX compiled by the engine; tests with `claude-code/testing` run by `claude plugin test`.

**Spec:** `docs/superpowers/specs/2026-10-14-pixel-office-design.md`

## Global Constraints

- Engine version: Claude Code 2.1.295. The `claude` on PATH is 2.1.220 and has no `plugin test`; use the desktop-bundled binary: `CC="/c/Users/bar12/AppData/Roaming/Claude/claude-code/2.1.295/d2e29494ec83/claude.exe"`. If the desktop app updated, find the newest `claude.exe` under `/c/Users/bar12/AppData/Roaming/Claude/claude-code/`.
- Run every command from the repo root `D:\Claude\Pixel Office` in Git Bash.
- A hooks module runs with no DOM and no Node; no `import()`; files are `.ts`/`.tsx`; JSX compiles against the global `h`; elements come from `$.ui.resolve(e)`.
- The mod must never change or block what Claude does: every hook returns `next(e)` (or the awaited result of it) unchanged, wraps its own work so it cannot throw, and is registered with `.catch(($, e, next) => next(e))`.
- `Svg` source is at most 131,072 characters; the renderer's size guard is 120,000.
- Redraws at most about three per second (flush every 350 ms); staleness sweep about every 5 s.
- Ticker keeps the last 8 lines. Departed agents are pruned past 50. No events for 10 minutes → break room. An agent lingers 8 s at a station after its last tool before walking home.
- Names: plugin `pixel-office`; pane id `pixel-office`, title `Office`; slash command `office`; state keys `pixel-office`/`scene` and `pixel-office`/`legendOpen`; option `autoOpen` ∈ `on-first-subagent` (default), `session-start`, `never`.
- Art grid 240 × 150 art pixels drawn at 4 CSS pixels each (`viewBox="0 0 240 150"`, `width="960" height="600"`).
- Copy is sentence case, plain English, no exclamation marks.
- Git: the repo has no author identity yet. Before the first commit, the person must set `user.name`/`user.email` for this repo (`git config user.name ...` without `--global`). Never touch global git config. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A subagent's first tool calls can reach `tool.call` before its `agent.spawn` hook has recorded it → the office must show one agent (a "contractor" that becomes the named agent), never two. Test: Task 4, "a contractor becomes the named agent when its spawn lands late".
2. Bursts: many parallel tool calls or many agents at one station → each agent gets a distinct spot (queue line), the ticker stays at 8 lines. Tests: Task 4, "crowded stations give everyone their own spot" and "the ticker keeps only the last 8 lines".
3. Odd text in tool inputs (markup characters, quotes, newlines, very long commands) → bubble and tooltip text is escaped and clipped, the SVG stays well formed. Tests: Task 2, "targetOf flattens and clips long commands"; Task 6, "markup in targets is escaped".
4. Very long sessions with hundreds of subagents → model and SVG stay bounded. Tests: Task 4, "departed agents are pruned past 50"; Task 6, "twenty agents fit the budget" and "a tiny budget drops decor and caps agents".
5. Events about agents the office never saw (session resumed, mod hot reloaded mid-turn, a finished agent resumed by SendMessage) and tool calls that are denied → ignored or revived safely, tool results returned unchanged. Tests: Task 4, "events for unknown agents leave the scene alone" and "a departed agent that works again comes back through the elevator"; Task 7, "a denied call passes through unchanged".

## Refinements from the spec

Decided while planning; each keeps the spec's behavior:

- Phases are `arriving | briefing | working | waiting | idle | gone`. "Reporting" and "leaving" are one walk (via the parent's desk to the elevator) and `gone` carries `goneAt`; the renderer hides the agent with SMIL `<set visibility>` when the walk ends instead of waiting for a tick.
- SendMessage is a `toolStarted` the reducer special-cases (walk to the recipient and back), not a separate `messaged` event.
- `Scene` has no `version` field; `$.state` versions values itself.
- Walks are recomputed at render time from `walk.startedAt` and the current time, so a redraw mid-walk continues from where the agent is instead of restarting.
- Extra files: `hooks/state.ts` (atoms shared by the hooks), tests live in `pixel-office/tests/`.

## File Structure

```
D:\Claude\Pixel Office\
  .claude-plugin/marketplace.json        Task 8  local marketplace listing the mod
  .gitignore                             Task 2
  README.md                              Task 8
  docs/superpowers/notes/2026-10-14-svg-spike.md   Task 1  spike findings
  pixel-office/
    .claude-plugin/plugin.json           Task 2  manifest, types, userConfig
    hooks/hooks.json                     Task 2  names ./register.tsx
    hooks/register.tsx                   Task 2 stub, Task 7 real  wiring only
    hooks/stations.ts                    Task 2  zones, slots, doors, routing, tool→zone, targets
    hooks/sprites.ts                     Task 3  RLE pixel sprites, icons, looks
    hooks/narrate.ts                     Task 4  event → ticker sentence
    hooks/model.ts                       Task 4  pure reducer, walking, sweep
    hooks/office.ts                      Task 5  static office SVG (cached)
    hooks/render.ts                      Task 6  scene → SVG; org rows; labels
    hooks/state.ts                       Task 7  atoms, pane id
    hooks/pane.tsx                       Task 7  ui.render for the pane
    types/index.d.ts                     Task 2  scene types + PluginState contract
    tests/*.test.ts                      Tasks 2–7
```

---

### Task 1: Spike — animated SVG in a desktop pane (throwaway)

Answers the spec's open risk: what happens to SMIL animation and the pane when the SVG source is replaced. Nothing from this task is kept except the notes file.

**Files:**
- Create (throwaway): `C:\Users\bar12\.claude\dev-mods\<session-id>\office-spike\.claude-plugin\plugin.json`
- Create (throwaway): `C:\Users\bar12\.claude\dev-mods\<session-id>\office-spike\hooks\hooks.json`
- Create (throwaway): `C:\Users\bar12\.claude\dev-mods\<session-id>\office-spike\hooks\register.tsx`
- Create (kept): `docs/superpowers/notes/2026-10-14-svg-spike.md`

**Interfaces:**
- Consumes: nothing.
- Produces: findings that set `FLUSH_MS` in Task 7 (350 by default; 1000 if redraws flicker).

- [ ] **Step 1: Load the plugin-authoring skill**

Invoke the `plugin-authoring` skill. Its "WHERE TO WRITE IT" section names this session's mods folder (`C:\Users\bar12\.claude\dev-mods\<session-id>\`); use that exact path below. Loading it starts the engine's watch on that folder.

- [ ] **Step 2: Write the spike manifest and hooks list**

`office-spike/.claude-plugin/plugin.json`:
```json
{ "name": "office-spike", "version": "0.0.1", "description": "Throwaway: SMIL animation in a desktop pane across redraws" }
```

`office-spike/hooks/hooks.json`:
```json
{ "modules": ["./register.tsx"] }
```

- [ ] **Step 3: Write the spike hooks module**

`office-spike/hooks/register.tsx`:
```tsx
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const ticks = atom({ plugin: 'office-spike', key: 'ticks' } as const, 0)
const PANE = 'office-spike'

function scene(count: number): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60" width="480" height="240" shape-rendering="crispEdges">' +
    '<rect width="120" height="60" fill="#c9a36b"/>' +
    '<g><title>Looping walker</title><rect x="-3" y="-6" width="6" height="6" fill="#7f77dd"/>' +
    '<animateMotion dur="4s" repeatCount="indefinite" path="M10,20 L110,20 L10,20"/></g>' +
    '<g><title>One-shot walker</title><rect x="-3" y="-6" width="6" height="6" fill="#1d9e75"/>' +
    '<animateMotion dur="6s" fill="freeze" path="M10,45 L110,45"/></g>' +
    '<rect x="4" y="4" width="3" height="3" fill="#97c459">' +
    '<animate attributeName="fill" values="#97c459;#27500a;#97c459" dur="0.6s" repeatCount="indefinite"/></rect>' +
    `<text x="60" y="8" font-size="5" text-anchor="middle" font-family="monospace">redraw ${count}</text>` +
    '</svg>'
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'spike', description: 'Open the office spike pane' })
    $.clock.every(2000, () => {
      void update($, ticks, n => n + 1)
    })
    void $.ui.open({ id: PANE, title: 'Spike' })
    return next(e)
  })

  on('command.run', { command: 'spike' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Spike' })
    return { text: `Spike pane: ${JSON.stringify(opened)}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const count = await read($, ticks)
    if (e.surface === 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text>Spike redraw {count} (the terminal has no Svg)</Text>
    }
    const { Box, Text, Svg } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Svg source={scene(count)} alt="Spike scene" isInteractive={true} />
        <Text>Redraws: {count}</Text>
      </Box>
    )
  })
}
```

- [ ] **Step 4: Validate the spike**

Run: `CC="/c/Users/bar12/AppData/Roaming/Claude/claude-code/2.1.295/d2e29494ec83/claude.exe"; "$CC" plugin validate "/c/Users/bar12/.claude/dev-mods/<session-id>/office-spike"`
Expected: no errors; it lists hooks `session.start`, `command.run`, `ui.render`.

- [ ] **Step 5: Hand over to the person to observe**

End the turn. The engine asks "Enable hot reloading for this session?"; the person picks "Enable for this session"; the mod loads when the turn ends and the Spike pane opens (or the person runs `/spike`). Ask the person to watch the pane for 20 seconds and answer:

1. Does the SVG show at all, and at what size?
2. Purple looping square: smooth, or does it jump back to the left every 2 s (each redraw)?
3. Green one-shot square: does it restart from the left every 2 s?
4. Does the pane flicker or blank on each redraw?
5. Hovering a square: does a tooltip appear?
6. Does the "Redraws" counter keep counting (timer started in `session.start` works)?

- [ ] **Step 6: Record findings and decide**

Write `docs/superpowers/notes/2026-10-14-svg-spike.md` with the six answers and these decisions:
- (1) no SVG → stop; the rendering approach needs rethinking with the person before Task 5.
- (2)/(3) restarts → expected; Task 6 already resumes walks from the current time.
- (4) visible flicker → set `FLUSH_MS = 1000` in Task 7 instead of 350.
- (5) no tooltips → keep `<title>` anyway (cheap) and note hover details rely on the org chart.
- (6) counter stuck → stop; Task 7's timer-driven flush needs another trigger (flush inline in each hook instead).

- [ ] **Step 7: Remove the spike mod**

Run: `rm -rf "/c/Users/bar12/.claude/dev-mods/<session-id>/office-spike"`

- [ ] **Step 8: Commit the notes**

```bash
git add docs/superpowers/notes/2026-10-14-svg-spike.md
git commit -m "docs: record SVG pane spike findings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Mod scaffold, scene types, stations and routing

**Files:**
- Create: `.gitignore`
- Create: `pixel-office/.claude-plugin/plugin.json`
- Create: `pixel-office/hooks/hooks.json`
- Create: `pixel-office/hooks/register.tsx` (stub, replaced in Task 7)
- Create: `pixel-office/types/index.d.ts`
- Create: `pixel-office/hooks/stations.ts`
- Test: `pixel-office/tests/stations.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (types, `pixel-office/types/index.d.ts`): `Point`, `StationId`, `Phase`, `Look`, `Walk`, `Activity`, `Agent`, `TickerLine`, `Scene`, `OfficeEvent`, and `PluginState['pixel-office'] = { scene: Scene; legendOpen: boolean }`.
- Produces (`hooks/stations.ts`): `WIDTH = 240`, `HEIGHT = 150`, `CORRIDOR_Y = 88`, `DESK_COUNT = 8`, `type StationDef`, `STATIONS: Record<StationId, StationDef>`, `STATION_ORDER: readonly StationId[]`, `WAITING_TOOLS: ReadonlySet<string>`, `clamp(v, lo, hi): number`, `clip(text, max = 24): string`, `slotPoint(station, slot): Point`, `doorOf(station, slot): Point`, `route(from, fromDoor, to, toDoor): Point[]`, `pathLength(points): number`, `splitAt(points, fraction): Point[]`, `pointAlong(points, fraction): Point`, `stationFor(tool): StationId`, `targetOf(tool, input: Record<string, unknown>): string`, `todoCounts(input): { done: number; open: number } | null`.

- [ ] **Step 1: Write the scaffold files**

`.gitignore`:
```
pixel-office/.claude-plugin/types/
node_modules/
```

`pixel-office/.claude-plugin/plugin.json`:
```json
{
  "name": "pixel-office",
  "version": "0.1.0",
  "description": "A live pixel-art office showing what every agent in the session is doing",
  "types": "./types/index.d.ts",
  "userConfig": {
    "autoOpen": {
      "type": "string",
      "title": "Open the office",
      "description": "When the office pane opens by itself",
      "default": "on-first-subagent",
      "options": ["on-first-subagent", "session-start", "never"]
    }
  }
}
```

`pixel-office/hooks/hooks.json`:
```json
{ "modules": ["./register.tsx"] }
```

`pixel-office/hooks/register.tsx` (stub so the mod loads for tests):
```tsx
import type { Register } from 'claude-code'

export const register: Register = () => {}
```

`pixel-office/types/index.d.ts`:
```ts
export type Point = { x: number; y: number }

export type StationId =
  | 'office'
  | 'desk'
  | 'library'
  | 'phone'
  | 'mailroom'
  | 'server'
  | 'meeting'
  | 'taskboard'
  | 'reception'
  | 'elevator'
  | 'breakroom'

export type Phase = 'arriving' | 'briefing' | 'working' | 'waiting' | 'idle' | 'gone'

export type Look = { shirt: string; hair: string; skin: string }

export type Walk = { points: Point[]; startedAt: number; durationMs: number }

export type Activity = { tool: string; target: string; callId: string; since: number }

export type Agent = {
  id: string
  parentId: string | null
  type: string
  label: string
  description: string
  isTeammate: boolean
  phase: Phase
  station: StationId
  slot: number
  desk: number
  pos: Point
  walk: Walk | null
  activity: Activity | null
  lastErrorAt: number | null
  lastEventAt: number
  arrivedAt: number
  goneAt: number | null
  look: Look
}

export type TickerLine = { at: number; text: string }

export type Scene = {
  agents: Record<string, Agent>
  order: string[]
  ticker: TickerLine[]
  todos: { done: number; open: number } | null
  briefing: string | null
}

export type OfficeEvent =
  | {
      kind: 'spawned'
      id: string
      parentId: string
      type: string
      description: string
      name: string | null
      isTeammate: boolean
      at: number
    }
  | { kind: 'toolStarted'; agentId: string; tool: string; target: string; callId: string; at: number }
  | { kind: 'toolEnded'; agentId: string; callId: string; isError: boolean; at: number }
  | { kind: 'waiting'; agentId: string | null; tool: string; at: number }
  | { kind: 'turnStarted'; at: number }
  | { kind: 'handedBack'; agentId: string; at: number }
  | { kind: 'todos'; done: number; open: number; at: number }
  | { kind: 'tick'; at: number }

declare module 'claude-code' {
  interface PluginState {
    'pixel-office': { scene: Scene; legendOpen: boolean }
  }
}
```

- [ ] **Step 2: Check the scaffold loads**

Run: `CC="/c/Users/bar12/AppData/Roaming/Claude/claude-code/2.1.295/d2e29494ec83/claude.exe"; "$CC" plugin validate pixel-office`
Expected: valid. If it rejects a `userConfig` field name, change only that field to what the message asks and re-run.

- [ ] **Step 3: Write the failing stations tests**

`pixel-office/tests/stations.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import {
  CORRIDOR_Y,
  HEIGHT,
  STATIONS,
  STATION_ORDER,
  WIDTH,
  doorOf,
  pathLength,
  pointAlong,
  route,
  slotPoint,
  splitAt,
  stationFor,
  targetOf,
  todoCounts,
} from '../hooks/stations'

describe('stationFor', () => {
  test('maps tools to the zones the legend promises', async () => {
    expect(stationFor('Edit')).toBe('desk')
    expect(stationFor('Write')).toBe('desk')
    expect(stationFor('Read')).toBe('library')
    expect(stationFor('Grep')).toBe('library')
    expect(stationFor('Skill')).toBe('library')
    expect(stationFor('Bash')).toBe('server')
    expect(stationFor('PowerShell')).toBe('server')
    expect(stationFor('WebSearch')).toBe('phone')
    expect(stationFor('WebFetch')).toBe('phone')
    expect(stationFor('SendMessage')).toBe('meeting')
    expect(stationFor('AskUserQuestion')).toBe('reception')
    expect(stationFor('TodoWrite')).toBe('taskboard')
    expect(stationFor('mcp__ccd_turn__update_plan')).toBe('taskboard')
    expect(stationFor('mcp__github__create_issue')).toBe('mailroom')
    expect(stationFor('SomethingNew')).toBe('desk')
  })
})

describe('targetOf', () => {
  test('uses the file name of a path on either slash style', async () => {
    expect(targetOf('Read', { file_path: 'D:\\Claude\\x\\src\\auth.ts' })).toBe('auth.ts')
    expect(targetOf('Edit', { file_path: '/work/src/login.tsx' })).toBe('login.tsx')
  })

  test('flattens and clips long commands', async () => {
    const t = targetOf('Bash', { command: 'npm run build && npm test -- --watch=false' })
    expect(t).toBe('npm run build && npm te…')
    expect(t).toHaveLength(24)
    expect(targetOf('Bash', { command: 'echo a\n  echo b' })).toBe('echo a echo b')
  })

  test('reads patterns, queries, hosts and outside services', async () => {
    expect(targetOf('Grep', { pattern: 'login' })).toBe('login')
    expect(targetOf('WebSearch', { query: 'pixel art' })).toBe('pixel art')
    expect(targetOf('WebFetch', { url: 'https://docs.anthropic.com/en/x' })).toBe('docs.anthropic.com')
    expect(targetOf('mcp__github__create_issue', { title: 'Bug' })).toBe('github')
    expect(targetOf('Mystery', {})).toBe('')
  })
})

describe('todoCounts', () => {
  test('counts done and open items from todos or items', async () => {
    const list = [{ status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }]
    expect(todoCounts({ todos: list })).toEqual({ done: 1, open: 2 })
    expect(todoCounts({ items: list })).toEqual({ done: 1, open: 2 })
    expect(todoCounts({ other: 1 })).toBeNull()
  })
})

describe('geometry', () => {
  test('every station has a name, tools, a color and at least one slot', async () => {
    for (const id of STATION_ORDER) {
      expect(STATIONS[id].name.length).toBeGreaterThan(0)
      expect(STATIONS[id].tools.length).toBeGreaterThan(0)
      expect(STATIONS[id].slots.length).toBeGreaterThan(0)
    }
  })

  test('slots past the last one form a queue inside the floor', async () => {
    const first = slotPoint('elevator', 0)
    const queued = slotPoint('elevator', 3)
    expect(queued).not.toEqual(first)
    expect(queued.x).toBeGreaterThanOrEqual(4)
    expect(queued.x).toBeLessThanOrEqual(WIDTH - 4)
    expect(queued.y).toBeLessThanOrEqual(HEIGHT - 2)
  })

  test('routes run along the corridor in straight lines', async () => {
    const from = slotPoint('desk', 0)
    const to = slotPoint('server', 0)
    const pts = route(from, doorOf('desk', 0), to, doorOf('server', 0))
    expect(pts[0]).toEqual(from)
    expect(pts[pts.length - 1]).toEqual(to)
    expect(pts.some(p => p.y === CORRIDOR_Y)).toBe(true)
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!
      const b = pts[i]!
      expect(a.x === b.x || a.y === b.y).toBe(true)
    }
  })

  test('splitAt and pointAlong walk a path by fraction', async () => {
    const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }]
    expect(pathLength(line)).toBe(10)
    expect(splitAt(line, 0.5)).toEqual([{ x: 5, y: 0 }, { x: 10, y: 0 }])
    expect(pointAlong(line, 1)).toEqual({ x: 10, y: 0 })
    expect(pointAlong(line, 0)).toEqual({ x: 0, y: 0 })
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `CC="/c/Users/bar12/AppData/Roaming/Claude/claude-code/2.1.295/d2e29494ec83/claude.exe"; "$CC" plugin test pixel-office`
Expected: FAIL, `stations.test.ts` cannot resolve `../hooks/stations`. (If the failure is instead that test files cannot import plugin files at all, stop and report: every later task's unit tests rely on it.)

- [ ] **Step 5: Implement stations.ts**

`pixel-office/hooks/stations.ts`:
```ts
import type { Point, StationId } from '../types'

export const WIDTH = 240
export const HEIGHT = 150
export const CORRIDOR_Y = 88
export const DESK_COUNT = 8

export type StationDef = {
  name: string
  tools: string
  color: string
  slots: readonly Point[]
  door: Point | null
  slotDoors?: readonly Point[]
}

export const clamp = (value: number, lo: number, hi: number): number => Math.min(Math.max(value, lo), hi)

export function clip(text: string, max = 24): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const DESK_SEATS: Point[] = Array.from({ length: DESK_COUNT }, (_, i) => ({
  x: 86 + 22 * (i % 4),
  y: 42 + 30 * Math.floor(i / 4),
}))

const MEETING_SEATS: Point[] = [
  { x: 98, y: 140 },
  { x: 110, y: 140 },
  { x: 122, y: 140 },
  { x: 98, y: 114 },
  { x: 110, y: 114 },
  { x: 122, y: 114 },
  { x: 134, y: 140 },
]

export const STATIONS: Record<StationId, StationDef> = {
  office: {
    name: 'Corner office',
    tools: "Main's home base, thinking",
    color: '#d97757',
    slots: [{ x: 27, y: 50 }],
    door: { x: 55, y: 62 },
  },
  desk: {
    name: 'Desks',
    tools: 'Edit, Write, NotebookEdit',
    color: '#378add',
    slots: DESK_SEATS,
    door: null,
    slotDoors: DESK_SEATS.map(p => ({ x: p.x + 11, y: p.y })),
  },
  library: {
    name: 'Records library',
    tools: 'Read, Grep, Glob, LSP, Skill, ToolSearch',
    color: '#7f77dd',
    slots: [
      { x: 184, y: 44 },
      { x: 194, y: 44 },
      { x: 204, y: 44 },
      { x: 216, y: 44 },
      { x: 228, y: 44 },
    ],
    door: { x: 172, y: 44 },
  },
  phone: {
    name: 'Phone booths',
    tools: 'WebFetch, WebSearch',
    color: '#e24b4a',
    slots: [
      { x: 220, y: 78 },
      { x: 234, y: 78 },
    ],
    door: null,
  },
  mailroom: {
    name: 'Mailroom',
    tools: 'Outside services (mcp__ tools)',
    color: '#ba7517',
    slots: [
      { x: 186, y: 80 },
      { x: 198, y: 80 },
    ],
    door: null,
  },
  server: {
    name: 'Server room',
    tools: 'Bash, PowerShell, background shells',
    color: '#639922',
    slots: [
      { x: 191, y: 142 },
      { x: 207, y: 142 },
      { x: 223, y: 142 },
    ],
    door: { x: 184, y: 94 },
  },
  meeting: {
    name: 'Meeting room',
    tools: 'Briefings, SendMessage',
    color: '#1d9e75',
    slots: MEETING_SEATS,
    door: null,
    slotDoors: MEETING_SEATS.map(p => ({ x: 68, y: p.y })),
  },
  taskboard: {
    name: 'Task board',
    tools: 'TodoWrite, Task tools, plan updates',
    color: '#ef9f27',
    slots: [
      { x: 82, y: 20 },
      { x: 92, y: 20 },
    ],
    door: { x: 97, y: 20 },
  },
  reception: {
    name: 'Reception',
    tools: 'Waiting on you: questions, permissions, plan approval',
    color: '#d4537e',
    slots: [
      { x: 44, y: 144 },
      { x: 56, y: 144 },
    ],
    door: { x: 66, y: 144 },
  },
  elevator: {
    name: 'Elevator',
    tools: 'Agents arrive and leave',
    color: '#888780',
    slots: [{ x: 16, y: 138 }],
    door: { x: 32, y: 138 },
  },
  breakroom: {
    name: 'Break room',
    tools: 'Idle agents',
    color: '#5dcaa5',
    slots: [
      { x: 26, y: 82 },
      { x: 40, y: 84 },
      { x: 10, y: 102 },
      { x: 18, y: 102 },
      { x: 26, y: 102 },
    ],
    door: null,
  },
}

export const STATION_ORDER: readonly StationId[] = [
  'office',
  'desk',
  'library',
  'phone',
  'mailroom',
  'server',
  'meeting',
  'taskboard',
  'reception',
  'elevator',
  'breakroom',
]

const TOOL_STATIONS: Readonly<Record<string, StationId>> = {
  Edit: 'desk',
  MultiEdit: 'desk',
  Write: 'desk',
  NotebookEdit: 'desk',
  Read: 'library',
  Grep: 'library',
  Glob: 'library',
  LSP: 'library',
  Skill: 'library',
  ToolSearch: 'library',
  Bash: 'server',
  PowerShell: 'server',
  BashOutput: 'server',
  KillShell: 'server',
  Monitor: 'server',
  TaskStop: 'server',
  WebFetch: 'phone',
  WebSearch: 'phone',
  SendMessage: 'meeting',
  TodoWrite: 'taskboard',
  TaskCreate: 'taskboard',
  TaskUpdate: 'taskboard',
  TaskList: 'taskboard',
  TaskGet: 'taskboard',
  AskUserQuestion: 'reception',
  ExitPlanMode: 'reception',
}

export const WAITING_TOOLS: ReadonlySet<string> = new Set(['AskUserQuestion', 'ExitPlanMode'])

export function stationFor(tool: string): StationId {
  const known = TOOL_STATIONS[tool]
  if (known !== undefined) return known
  if (/^mcp__.+__(update_plan|wrap_up)$/.test(tool)) return 'taskboard'
  if (tool.startsWith('mcp__')) return 'mailroom'
  return 'desk'
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export function targetOf(tool: string, input: Record<string, unknown>): string {
  const str = (key: string): string => {
    const value = input[key]
    return typeof value === 'string' ? value : ''
  }
  if (str('file_path')) return clip(baseName(str('file_path')))
  if (str('notebook_path')) return clip(baseName(str('notebook_path')))
  if (str('command')) return clip(str('command'))
  if (str('pattern')) return clip(str('pattern'))
  if (str('query')) return clip(str('query'))
  if (str('url')) {
    try {
      return clip(new URL(str('url')).host)
    } catch {
      return clip(str('url'))
    }
  }
  if (str('skill')) return clip(str('skill'))
  if (str('to')) return clip(str('to'))
  if (str('description')) return clip(str('description'))
  if (tool.startsWith('mcp__')) return clip(tool.split('__')[1] ?? tool)
  return ''
}

export function todoCounts(input: Record<string, unknown>): { done: number; open: number } | null {
  const list = Array.isArray(input.todos) ? input.todos : Array.isArray(input.items) ? input.items : null
  if (list === null) return null
  let done = 0
  let open = 0
  for (const item of list) {
    if ((item as { status?: unknown } | null)?.status === 'completed') done += 1
    else open += 1
  }
  return { done, open }
}

export function slotPoint(station: StationId, slot: number): Point {
  const { slots } = STATIONS[station]
  const exact = slots[slot]
  if (exact !== undefined) return exact
  const last = slots[slots.length - 1] as Point
  const k = slot - slots.length + 1
  return { x: clamp(last.x - 7 * k, 4, WIDTH - 4), y: clamp(last.y + 3 * k, 16, HEIGHT - 2) }
}

export function doorOf(station: StationId, slot: number): Point {
  const def = STATIONS[station]
  return def.slotDoors?.[slot] ?? def.door ?? slotPoint(station, slot)
}

function dedupe(points: readonly Point[]): Point[] {
  const out: Point[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last === undefined || Math.abs(last.x - p.x) > 0.01 || Math.abs(last.y - p.y) > 0.01) out.push(p)
  }
  return out
}

export function route(from: Point, fromDoor: Point, to: Point, toDoor: Point): Point[] {
  return dedupe([
    from,
    { x: fromDoor.x, y: from.y },
    fromDoor,
    { x: fromDoor.x, y: CORRIDOR_Y },
    { x: toDoor.x, y: CORRIDOR_Y },
    toDoor,
    { x: toDoor.x, y: to.y },
    to,
  ])
}

const dist = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y)

export function pathLength(points: readonly Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1] as Point, points[i] as Point)
  return total
}

export function splitAt(points: readonly Point[], fraction: number): Point[] {
  if (points.length === 0) return []
  let remaining = pathLength(points) * clamp(fraction, 0, 1)
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point
    const b = points[i] as Point
    const seg = dist(a, b)
    if (remaining <= seg) {
      const t = seg === 0 ? 0 : remaining / seg
      return [{ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, ...points.slice(i)]
    }
    remaining -= seg
  }
  return [points[points.length - 1] as Point]
}

export function pointAlong(points: readonly Point[], fraction: number): Point {
  return splitAt(points, fraction)[0] ?? { x: 0, y: 0 }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `CC="/c/Users/bar12/AppData/Roaming/Claude/claude-code/2.1.295/d2e29494ec83/claude.exe"; "$CC" plugin test pixel-office`
Expected: PASS, all tests in `stations.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add .gitignore pixel-office
git commit -m "feat: scaffold pixel-office mod with scene types and stations

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pixel sprites, icons and agent looks

**Files:**
- Create: `pixel-office/hooks/sprites.ts`
- Test: `pixel-office/tests/sprites.test.ts`

**Interfaces:**
- Consumes: `Look`, `StationId` from `../types`.
- Produces: `type Grid = readonly string[]`, `type Variant = 'main' | 'teammate' | 'plain'`, `rle(grid, colors, ox = 0, oy = 0): string`, `personSvg(look: Look, variant: Variant, walkMs: number): string` (origin at the feet, 8 × 12 sprite), `iconSvg(station: StationId, x: number, y: number, color: string): string` (5 × 5), `hash(text: string): number`, `lookFor(type: string, id: string): Look`.

- [ ] **Step 1: Write the failing tests**

`pixel-office/tests/sprites.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'

import { hash, iconSvg, lookFor, personSvg, rle } from '../hooks/sprites'

test('rle merges runs and skips transparent cells', async () => {
  expect(rle(['aab.'], { a: '#111', b: '#222' })).toBe(
    '<rect x="0" y="0" width="2" height="1" fill="#111"/><rect x="2" y="0" width="1" height="1" fill="#222"/>',
  )
  expect(rle(['.a'], { a: '#111' }, 5, 7)).toBe('<rect x="6" y="7" width="1" height="1" fill="#111"/>')
})

test('a person wears its look and only animates legs while walking', async () => {
  const look = { shirt: '#7f77dd', hair: '#412402', skin: '#f5c4b3' }
  const still = personSvg(look, 'plain', 0)
  expect(still).toContain('#7f77dd')
  expect(still).toContain('#412402')
  expect(still).toContain('#f5c4b3')
  expect(still).toContain('translate(-4,-12)')
  expect(still.includes('animateTransform')).toBe(false)
  expect(personSvg(look, 'plain', 1200)).toContain('repeatDur="1200ms"')
})

test('main wears a tie and teammates a lanyard', async () => {
  const look = { shirt: '#d97757', hair: '#412402', skin: '#f5c4b3' }
  expect(personSvg(look, 'main', 0)).toContain('#791f1f')
  expect(personSvg(look, 'teammate', 0)).toContain('#fac775')
})

test('icons draw in the given color at the given place', async () => {
  const icon = iconSvg('library', 2, 3, '#7f77dd')
  expect(icon).toContain('fill="#7f77dd"')
  expect(icon).toContain('<rect x="3" y="3" width="2" height="1"')
})

test('looks follow the agent type and stay stable per id', async () => {
  expect(lookFor('main', 'main').shirt).toBe('#d97757')
  expect(lookFor('Explore', 'a1').shirt).toBe('#7f77dd')
  expect(lookFor('Plan', 'a2').shirt).toBe('#1d9e75')
  expect(lookFor('general-purpose', 'a3').shirt).toBe('#378add')
  expect(lookFor('contractor', 'x').hair).toBe('#ef9f27')
  expect(lookFor('custom-type', 'z')).toEqual(lookFor('custom-type', 'z'))
  expect(hash('abc')).toBe(hash('abc'))
  expect(hash('abc')).toBeGreaterThanOrEqual(0)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `CC="/c/Users/bar12/AppData/Roaming/Claude/claude-code/2.1.295/d2e29494ec83/claude.exe"; "$CC" plugin test pixel-office`
Expected: FAIL, `sprites.test.ts` cannot resolve `../hooks/sprites`.

- [ ] **Step 3: Implement sprites.ts**

`pixel-office/hooks/sprites.ts`:
```ts
import type { Look, StationId } from '../types'

export type Grid = readonly string[]
export type Variant = 'main' | 'teammate' | 'plain'

export function rle(grid: Grid, colors: Readonly<Record<string, string>>, ox = 0, oy = 0): string {
  let out = ''
  grid.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x] as string
      let end = x + 1
      while (end < row.length && row[end] === ch) end += 1
      const fill = colors[ch]
      if (fill !== undefined) out += `<rect x="${ox + x}" y="${oy + y}" width="${end - x}" height="1" fill="${fill}"/>`
      x = end
    }
  })
  return out
}

const HEAD: Grid = ['..hhhh..', '.hhhhhh.', '.hssssh.', '.sesses.', '.ssssss.', '..ssss..']

const BODY: Record<Variant, Grid> = {
  plain: [...HEAD, '.cccccc.', 'cccccccc', 's.cccc.s', '..pppp..'],
  main: [...HEAD, '.ccttcc.', 'cccttccc', 's.cttc.s', '..pppp..'],
  teammate: [...HEAD, '.cccccc.', 'ccccyccc', 's.ccyc.s', '..pppp..'],
}

const EYES = '#2c2c2a'
const TIE = '#791f1f'
const LANYARD = '#fac775'
const PANTS = '#444441'
const SHOES = '#2c2c2a'

export function personSvg(look: Look, variant: Variant, walkMs: number): string {
  const colors = { h: look.hair, s: look.skin, e: EYES, c: look.shirt, t: TIE, y: LANYARD, p: PANTS }
  const leg = (x: number, begin: number): string => {
    const rects =
      `<rect x="${x}" y="10" width="1" height="1" fill="${PANTS}"/>` +
      `<rect x="${x}" y="11" width="1" height="1" fill="${SHOES}"/>`
    if (walkMs <= 0) return rects
    return (
      `<g>${rects}<animateTransform attributeName="transform" type="translate" ` +
      `values="0,0;0,-1;0,0" dur="0.3s" begin="${begin}s" repeatDur="${walkMs}ms"/></g>`
    )
  }
  return `<g transform="translate(-4,-12)">${rle(BODY[variant], colors)}${leg(2, 0)}${leg(5, 0.15)}</g>`
}

const ICONS: Record<StationId, Grid> = {
  office: ['.....', '.....', 'x.x.x', '.....', '.....'],
  desk: ['....x', '...x.', '..x..', '.x...', 'x....'],
  library: ['.xx..', 'x..x.', 'x..x.', '.xx..', '....x'],
  phone: ['.xxx.', 'x.x.x', 'xxxxx', 'x.x.x', '.xxx.'],
  mailroom: ['xxxxx', 'x.x.x', 'xxxxx', 'x...x', 'xxxxx'],
  server: ['x....', '.x...', 'x....', '.....', '..xxx'],
  meeting: ['xxxxx', 'x...x', 'xxxxx', '.x...', 'x....'],
  taskboard: ['....x', '...x.', 'x.x..', '.x...', '.....'],
  reception: ['..x..', '..x..', '..x..', '.....', '..x..'],
  elevator: ['..x..', '.xxx.', 'x.x.x', '..x..', '..x..'],
  breakroom: ['xxxx.', 'x..xx', 'x..xx', 'xxxx.', '.....'],
}

export function iconSvg(station: StationId, x: number, y: number, color: string): string {
  return rle(ICONS[station], { x: color }, x, y)
}

export function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

const TYPE_SHIRTS: Readonly<Record<string, string>> = {
  main: '#d97757',
  Explore: '#7f77dd',
  Plan: '#1d9e75',
  'general-purpose': '#378add',
  fork: '#888780',
  contractor: '#5f5e5a',
}
const SHIRT_POOL = ['#d4537e', '#ba7517', '#639922', '#185fa5', '#993c1d', '#534ab7', '#0f6e56', '#a32d2d']
const HAIR = ['#412402', '#2c2c2a', '#854f0b', '#ef9f27', '#712b13', '#888780']
const SKIN = ['#f5c4b3', '#f0997b', '#c8875e', '#8d5a3b']

const pick = (list: readonly string[], n: number): string => list[n % list.length] as string

export function lookFor(type: string, id: string): Look {
  const shirt = TYPE_SHIRTS[type] ?? pick(SHIRT_POOL, hash(type))
  const hair = type === 'contractor' ? '#ef9f27' : pick(HAIR, hash(id))
  const skin = pick(SKIN, hash(id) >>> 8)
  return { shirt, hair, skin }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `CC="/c/Users/bar12/AppData/Roaming/Claude/claude-code/2.1.295/d2e29494ec83/claude.exe"; "$CC" plugin test pixel-office`
Expected: PASS (stations and sprites).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/hooks/sprites.ts pixel-office/tests/sprites.test.ts
git commit -m "feat: add pixel sprites, station icons and agent looks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Scene reducer and narrator

**Files:**
- Create: `pixel-office/hooks/narrate.ts`
- Create: `pixel-office/hooks/model.ts`
- Test: `pixel-office/tests/narrate.test.ts`
- Test: `pixel-office/tests/model.test.ts`

**Interfaces:**
- Consumes: types from `../types`; from `./stations`: `DESK_COUNT`, `WAITING_TOOLS`, `WIDTH`, `clamp`, `doorOf`, `pathLength`, `pointAlong`, `route`, `slotPoint`, `stationFor`; from `./sprites`: `lookFor`.
- Produces (`narrate.ts`): `narrate(scene: Scene, ev: OfficeEvent): string | null`.
- Produces (`model.ts`): `MAIN = 'main'`, `TICKER_MAX = 8`, `GONE_KEEP = 50`, `LINGER_MS = 8000`, `IDLE_MS = 600000`, `WALK_SPEED = 120`, `emptyScene(): Scene`, `isWalkingAt(agent, at): boolean`, `positionAt(agent, at): Point`, `homeOf(agent): StationId`, `reduce(scene: Scene, ev: OfficeEvent): Scene`, `needsSweep(scene: Scene, now: number): boolean`.

- [ ] **Step 1: Write the failing narrator tests**

`pixel-office/tests/narrate.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'

import { emptyScene } from '../hooks/model'
import { narrate } from '../hooks/narrate'

const started = (tool: string, target: string, agentId = 'main') =>
  ({ kind: 'toolStarted', agentId, tool, target, callId: 'c', at: 1 }) as const

test('tool lines read as plain English', async () => {
  const s = emptyScene()
  expect(narrate(s, started('Read', 'auth.ts'))).toBe('Main is reading auth.ts')
  expect(narrate(s, started('Edit', 'login.tsx'))).toBe('Main is editing login.tsx')
  expect(narrate(s, started('Grep', 'login'))).toBe('Main searched files for login')
  expect(narrate(s, started('Bash', 'npm test'))).toBe('Main ran a command: npm test')
  expect(narrate(s, started('WebSearch', 'pixel art'))).toBe('Main searched the web for pixel art')
  expect(narrate(s, started('Skill', 'commit'))).toBe('Main pulled the commit manual')
  expect(narrate(s, started('AskUserQuestion', ''))).toBe('Main is waiting on you with a question')
  expect(narrate(s, started('mcp__ccd_turn__update_plan', ''))).toBe('Main updated the task board')
  expect(narrate(s, started('mcp__github__create_issue', 'github'))).toBe('Main called an outside service: github')
  expect(narrate(s, started('Frobnicate', ''))).toBe('Main used Frobnicate')
})

test('unknown agents are named generically', async () => {
  expect(narrate(emptyScene(), started('Read', 'x', 'zz'))).toBe('An agent is reading x')
})

test('quiet events have no line', async () => {
  const s = emptyScene()
  expect(narrate(s, { kind: 'toolEnded', agentId: 'main', callId: 'c', isError: false, at: 1 })).toBeNull()
  expect(narrate(s, { kind: 'tick', at: 1 })).toBeNull()
  expect(narrate(s, { kind: 'todos', done: 1, open: 1, at: 1 })).toBeNull()
  expect(narrate(s, { kind: 'toolEnded', agentId: 'main', callId: 'c', isError: true, at: 1 })).toBe('Main hit an error')
  expect(narrate(s, { kind: 'turnStarted', at: 1 })).toBe('You gave Main a new task')
  expect(narrate(s, { kind: 'waiting', agentId: 'main', tool: 'Bash', at: 1 })).toBe('Main needs your permission to use Bash')
})
```

- [ ] **Step 2: Write the failing reducer tests**

`pixel-office/tests/model.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import { GONE_KEEP, IDLE_MS, LINGER_MS, MAIN, emptyScene, needsSweep, positionAt, reduce } from '../hooks/model'
import { slotPoint } from '../hooks/stations'
import type { OfficeEvent, Scene } from '../types'

const spawn = (id: string, at: number, extra: Partial<Extract<OfficeEvent, { kind: 'spawned' }>> = {}): OfficeEvent => ({
  kind: 'spawned',
  id,
  parentId: MAIN,
  type: 'Explore',
  description: 'find auth code',
  name: null,
  isTeammate: false,
  at,
  ...extra,
})
const start = (agentId: string, tool: string, target: string, callId: string, at: number): OfficeEvent => ({
  kind: 'toolStarted',
  agentId,
  tool,
  target,
  callId,
  at,
})
const end = (agentId: string, callId: string, at: number, isError = false): OfficeEvent => ({
  kind: 'toolEnded',
  agentId,
  callId,
  isError,
  at,
})
const run = (events: OfficeEvent[], from: Scene = emptyScene()): Scene => events.reduce(reduce, from)
const lastLine = (s: Scene): string | undefined => s.ticker[s.ticker.length - 1]?.text

describe('arrivals and briefings', () => {
  test('the office starts with Main idle in the corner office', async () => {
    const main = emptyScene().agents[MAIN]!
    expect(main.station).toBe('office')
    expect(main.phase).toBe('idle')
    expect(main.label).toBe('Main')
  })

  test('a new subagent arrives by elevator and is briefed in the meeting room', async () => {
    const s = run([spawn('a1', 1000)])
    const a1 = s.agents.a1!
    expect(a1.label).toBe('Explore')
    expect(a1.phase).toBe('briefing')
    expect(a1.station).toBe('meeting')
    expect(a1.walk?.points[0]).toEqual(slotPoint('elevator', 0))
    expect(a1.walk?.startedAt).toBe(1000)
    expect(s.briefing).toBe('find auth code')
    expect(s.agents[MAIN]!.station).toBe('meeting')
    expect(lastLine(s)).toBe('Main hired Explore: find auth code')
  })

  test('a second agent of the same type gets a numbered label and its own desk', async () => {
    const s = run([spawn('a1', 1000), spawn('a2', 1000)])
    expect(s.agents.a2!.label).toBe('Explore 2')
    expect(s.agents.a2!.desk).not.toBe(s.agents.a1!.desk)
  })

  test('the first tool ends the briefing and sends the parent home', async () => {
    const s = run([spawn('a1', 1000), start('a1', 'Read', 'auth.ts', 'c1', 3000)])
    expect(s.agents.a1!.phase).toBe('working')
    expect(s.agents.a1!.station).toBe('library')
    expect(s.agents.a1!.activity?.tool).toBe('Read')
    expect(s.briefing).toBeNull()
    expect(s.agents[MAIN]!.station).toBe('office')
    expect(lastLine(s)).toBe('Explore is reading auth.ts')
  })

  test('a walk that changes course starts where the agent is now', async () => {
    const before = run([spawn('a1', 1000)])
    const after = reduce(before, start('a1', 'Read', 'auth.ts', 'c1', 1200))
    expect(after.agents.a1!.walk?.points[0]).toEqual(positionAt(before.agents.a1!, 1200))
    expect(after.agents.a1!.walk?.points[0]).not.toEqual(slotPoint('elevator', 0))
  })
})

describe('work, errors and waiting', () => {
  test('an error marks the agent and clears its activity', async () => {
    const s = run([spawn('a1', 1000), start('a1', 'Bash', 'npm test', 'c1', 3000), end('a1', 'c1', 4000, true)])
    expect(s.agents.a1!.lastErrorAt).toBe(4000)
    expect(s.agents.a1!.activity).toBeNull()
    expect(lastLine(s)).toBe('Explore hit an error')
  })

  test('ending an older call keeps the newer activity', async () => {
    const s = run([
      spawn('a1', 1000),
      start('a1', 'Read', 'a.ts', 'c1', 3000),
      start('a1', 'Read', 'b.ts', 'c2', 3100),
      end('a1', 'c1', 3200),
    ])
    expect(s.agents.a1!.activity?.callId).toBe('c2')
  })

  test('a question sends the agent to reception until it is answered', async () => {
    const waiting = run([start(MAIN, 'AskUserQuestion', '', 'q1', 5000)])
    expect(waiting.agents[MAIN]!.phase).toBe('waiting')
    expect(waiting.agents[MAIN]!.station).toBe('reception')
    const answered = reduce(waiting, end(MAIN, 'q1', 9000))
    expect(answered.agents[MAIN]!.phase).toBe('working')
    expect(answered.agents[MAIN]!.station).toBe('office')
  })

  test('a permission prompt finds the agent using that tool, else Main', async () => {
    const s = run([spawn('a1', 1000), start('a1', 'Bash', 'rm -rf build', 'c1', 3000)])
    const asked = reduce(s, { kind: 'waiting', agentId: null, tool: 'Bash', at: 3100 })
    expect(asked.agents.a1!.phase).toBe('waiting')
    expect(asked.agents.a1!.station).toBe('reception')
    expect(lastLine(asked)).toBe('Explore needs your permission to use Bash')
    const other = reduce(s, { kind: 'waiting', agentId: null, tool: 'Edit', at: 3100 })
    expect(other.agents[MAIN]!.station).toBe('reception')
  })

  test('SendMessage walks to the recipient and back', async () => {
    const s = run([spawn('a1', 1000), spawn('a2', 1000, { type: 'Plan' })])
    const plan = s.agents.a2!
    const sent = reduce(s, start('a1', 'SendMessage', 'Plan', 'm1', 5000))
    const walk = sent.agents.a1!.walk!
    expect(walk.points).toContainEqual({ x: plan.pos.x + 9, y: plan.pos.y })
    expect(walk.points[walk.points.length - 1]).toEqual(sent.agents.a1!.pos)
    expect(sent.agents.a1!.station).toBe(s.agents.a1!.station)
  })

  test('todos update the task board counts', async () => {
    const s = reduce(emptyScene(), { kind: 'todos', done: 2, open: 3, at: 1 })
    expect(s.todos).toEqual({ done: 2, open: 3 })
    expect(s.ticker).toHaveLength(0)
  })

  test('a new task puts Main to work in the corner office', async () => {
    const s = reduce(emptyScene(), { kind: 'turnStarted', at: 1 })
    expect(s.agents[MAIN]!.phase).toBe('working')
    expect(s.agents[MAIN]!.station).toBe('office')
    expect(lastLine(s)).toBe('You gave Main a new task')
  })
})

describe('hand-backs and departures', () => {
  test('a finished subagent reports to its parent and leaves by elevator', async () => {
    const s = run([spawn('a1', 1000), start('a1', 'Read', 'auth.ts', 'c1', 3000), end('a1', 'c1', 4000)])
    const main = s.agents[MAIN]!
    const done = reduce(s, { kind: 'handedBack', agentId: 'a1', at: 20000 })
    const a1 = done.agents.a1!
    expect(a1.phase).toBe('gone')
    expect(a1.station).toBe('elevator')
    expect(a1.walk?.points).toContainEqual({ x: main.pos.x + 9, y: main.pos.y })
    expect(a1.goneAt).toBe(20000 + a1.walk!.durationMs)
    expect(lastLine(done)).toBe('Explore handed its report to Main and left')
  })

  test('a teammate reports and takes a break instead of leaving', async () => {
    const s = run([spawn('t1', 1000, { name: 'scout', isTeammate: true }), { kind: 'handedBack', agentId: 't1', at: 9000 }])
    expect(s.agents.t1!.label).toBe('scout')
    expect(s.agents.t1!.phase).toBe('idle')
    expect(s.agents.t1!.station).toBe('breakroom')
    expect(lastLine(s)).toBe('scout reported to Main and took a break')
  })

  test('a departed agent that works again comes back through the elevator', async () => {
    const s = run([spawn('a1', 1000), { kind: 'handedBack', agentId: 'a1', at: 2000 }])
    const back = reduce(s, start('a1', 'Read', 'again.ts', 'c9', 60000))
    expect(back.agents.a1!.phase).toBe('working')
    expect(back.agents.a1!.goneAt).toBeNull()
    expect(back.agents.a1!.walk?.points[0]).toEqual(slotPoint('elevator', 0))
  })

  test('departed agents are pruned past 50', async () => {
    let s = emptyScene()
    for (let i = 0; i < 60; i++) {
      s = reduce(s, spawn(`x${i}`, i))
      s = reduce(s, { kind: 'handedBack', agentId: `x${i}`, at: i + 0.5 })
    }
    const gone = Object.values(s.agents).filter(a => a.phase === 'gone')
    expect(gone.length).toBe(GONE_KEEP)
    expect(s.order.length).toBe(GONE_KEEP + 1)
  })
})

describe('sweeps', () => {
  test('agents linger, then walk home, then go for coffee', async () => {
    const s = run([spawn('a1', 1000), start('a1', 'Read', 'auth.ts', 'c1', 3000), end('a1', 'c1', 3500)])
    expect(needsSweep(s, 3500 + LINGER_MS - 1)).toBe(false)
    expect(needsSweep(s, 3500 + LINGER_MS)).toBe(true)
    const home = reduce(s, { kind: 'tick', at: 3500 + LINGER_MS })
    expect(home.agents.a1!.station).toBe('desk')
    const coffee = reduce(home, { kind: 'tick', at: 3500 + IDLE_MS })
    expect(coffee.agents.a1!.station).toBe('breakroom')
    expect(coffee.agents.a1!.phase).toBe('idle')
  })

  test('a tick with nothing to do returns the same scene', async () => {
    const s = run([spawn('a1', 1000), start('a1', 'Read', 'auth.ts', 'c1', 3000)])
    expect(reduce(s, { kind: 'tick', at: 3600 })).toBe(s)
  })
})

describe('review focus', () => {
  test('a contractor becomes the named agent when its spawn lands late', async () => {
    const early = run([start('x9', 'Grep', 'login', 'c1', 1000)])
    expect(early.agents.x9!.type).toBe('contractor')
    expect(early.agents.x9!.label).toBe('Contractor')
    const named = reduce(early, spawn('x9', 1100, { type: 'Plan' }))
    expect(named.agents.x9!.label).toBe('Plan')
    expect(named.agents.x9!.type).toBe('Plan')
    expect(named.agents.x9!.station).toBe('library')
    expect(named.agents.x9!.desk).toBe(early.agents.x9!.desk)
    expect(named.order).toHaveLength(early.order.length)
  })

  test('crowded stations give everyone their own spot', async () => {
    let s = emptyScene()
    for (let i = 0; i < 12; i++) s = reduce(s, spawn(`r${i}`, 1000))
    for (let i = 0; i < 12; i++) s = reduce(s, start(`r${i}`, 'Read', 'f.ts', `c${i}`, 2000))
    const spots = new Set(
      Object.values(s.agents)
        .filter(a => a.station === 'library')
        .map(a => `${a.pos.x},${a.pos.y}`),
    )
    expect(spots.size).toBe(12)
  })

  test('the ticker keeps only the last 8 lines', async () => {
    let s = emptyScene()
    for (let i = 0; i < 20; i++) s = reduce(s, start(MAIN, 'Read', `f${i}.ts`, `c${i}`, i))
    expect(s.ticker).toHaveLength(8)
    expect(lastLine(s)).toBe('Main is reading f19.ts')
  })

  test('events for unknown agents leave the scene alone', async () => {
    const s = emptyScene()
    expect(reduce(s, end('nobody', 'c1', 1))).toBe(s)
    expect(reduce(s, { kind: 'handedBack', agentId: 'nobody', at: 1 })).toBe(s)
    expect(reduce(s, { kind: 'handedBack', agentId: MAIN, at: 1 })).toBe(s)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `CC="/c/Users/bar12/AppData/Roaming/Claude/claude-code/2.1.295/d2e29494ec83/claude.exe"; "$CC" plugin test pixel-office`
Expected: FAIL, `narrate.test.ts` and `model.test.ts` cannot resolve `../hooks/model` / `../hooks/narrate`.

- [ ] **Step 4: Implement narrate.ts**

`pixel-office/hooks/narrate.ts`:
```ts
import type { OfficeEvent, Scene } from '../types'
import { stationFor } from './stations'

function nameOf(scene: Scene, id: string | null): string {
  if (id === null) return 'An agent'
  return scene.agents[id]?.label ?? 'An agent'
}

function toolLine(who: string, tool: string, target: string): string {
  const t = target === '' ? '' : ` ${target}`
  switch (tool) {
    case 'Read':
      return `${who} is reading${t}`
    case 'Edit':
    case 'MultiEdit':
      return `${who} is editing${t}`
    case 'Write':
      return `${who} is writing${t}`
    case 'NotebookEdit':
      return `${who} is editing notebook${t}`
    case 'Grep':
      return `${who} searched files for${t}`
    case 'Glob':
      return `${who} looked for files matching${t}`
    case 'Bash':
    case 'PowerShell':
      return `${who} ran a command:${t}`
    case 'WebSearch':
      return `${who} searched the web for${t}`
    case 'WebFetch':
      return `${who} opened a web page:${t}`
    case 'SendMessage':
      return `${who} sent a message to${t}`
    case 'Skill':
      return `${who} pulled the${t} manual`
    case 'AskUserQuestion':
      return `${who} is waiting on you with a question`
    case 'ExitPlanMode':
      return `${who} is waiting for you to approve a plan`
  }
  const station = stationFor(tool)
  if (station === 'taskboard') return `${who} updated the task board`
  if (station === 'mailroom') return `${who} called an outside service:${t}`
  return t === '' ? `${who} used ${tool}` : `${who} used ${tool}:${t}`
}

export function narrate(scene: Scene, ev: OfficeEvent): string | null {
  switch (ev.kind) {
    case 'spawned': {
      const who = nameOf(scene, ev.id)
      const boss = nameOf(scene, ev.parentId)
      return ev.isTeammate ? `${boss} added teammate ${who}: ${ev.description}` : `${boss} hired ${who}: ${ev.description}`
    }
    case 'toolStarted':
      return toolLine(nameOf(scene, ev.agentId), ev.tool, ev.target)
    case 'toolEnded':
      return ev.isError ? `${nameOf(scene, ev.agentId)} hit an error` : null
    case 'waiting':
      return `${nameOf(scene, ev.agentId)} needs your permission to use ${ev.tool}`
    case 'turnStarted':
      return 'You gave Main a new task'
    case 'handedBack': {
      const agent = scene.agents[ev.agentId]
      if (agent === undefined) return null
      const boss = nameOf(scene, agent.parentId)
      return agent.isTeammate
        ? `${agent.label} reported to ${boss} and took a break`
        : `${agent.label} handed its report to ${boss} and left`
    }
    case 'todos':
    case 'tick':
      return null
  }
}
```

- [ ] **Step 5: Implement model.ts**

`pixel-office/hooks/model.ts`:
```ts
import type { Agent, OfficeEvent, Point, Scene, StationId, Walk } from '../types'
import { narrate } from './narrate'
import { lookFor } from './sprites'
import {
  DESK_COUNT,
  WAITING_TOOLS,
  WIDTH,
  clamp,
  doorOf,
  pathLength,
  pointAlong,
  route,
  slotPoint,
  stationFor,
} from './stations'

export const MAIN = 'main'
export const TICKER_MAX = 8
export const GONE_KEEP = 50
export const LINGER_MS = 8_000
export const IDLE_MS = 600_000
export const WALK_SPEED = 120

type Ev<K extends OfficeEvent['kind']> = Extract<OfficeEvent, { kind: K }>
type Stop = { point: Point; door: Point }

export function emptyScene(): Scene {
  const main: Agent = {
    id: MAIN,
    parentId: null,
    type: 'main',
    label: 'Main',
    description: 'Your main agent',
    isTeammate: false,
    phase: 'idle',
    station: 'office',
    slot: 0,
    desk: -1,
    pos: slotPoint('office', 0),
    walk: null,
    activity: null,
    lastErrorAt: null,
    lastEventAt: 0,
    arrivedAt: 0,
    goneAt: null,
    look: lookFor('main', MAIN),
  }
  return { agents: { [MAIN]: main }, order: [MAIN], ticker: [], todos: null, briefing: null }
}

export function isWalkingAt(agent: Agent, at: number): boolean {
  return agent.walk !== null && at < agent.walk.startedAt + agent.walk.durationMs
}

export function positionAt(agent: Agent, at: number): Point {
  if (agent.walk === null || !isWalkingAt(agent, at)) return agent.pos
  return pointAlong(agent.walk.points, (at - agent.walk.startedAt) / agent.walk.durationMs)
}

export function homeOf(agent: Agent): StationId {
  return agent.desk < 0 ? 'office' : 'desk'
}

const put = (scene: Scene, agent: Agent): Scene => ({ ...scene, agents: { ...scene.agents, [agent.id]: agent } })

const addAgent = (scene: Scene, agent: Agent): Scene => ({ ...put(scene, agent), order: [...scene.order, agent.id] })

function withLine(scene: Scene, at: number, text: string | null): Scene {
  if (text === null) return scene
  return { ...scene, ticker: [...scene.ticker, { at, text }].slice(-TICKER_MAX) }
}

function freeSlot(scene: Scene, station: StationId, selfId: string): number {
  const taken = new Set(
    Object.values(scene.agents)
      .filter(a => a.id !== selfId && a.phase !== 'gone' && a.station === station)
      .map(a => a.slot),
  )
  let slot = 0
  while (taken.has(slot)) slot += 1
  return slot
}

const walkMs = (length: number): number => clamp(Math.round((length / WALK_SPEED) * 1000), 400, 5000)

function moveTo(scene: Scene, agent: Agent, target: StationId, at: number, via: readonly Stop[] = []): Agent {
  const station: StationId = target === 'desk' && agent.desk < 0 ? 'office' : target
  if (via.length === 0 && station === agent.station) return agent
  const slot =
    station === agent.station
      ? agent.slot
      : station === 'desk'
        ? agent.desk
        : station === 'office'
          ? 0
          : freeSlot(scene, station, agent.id)
  const dest = slotPoint(station, slot)
  const walking = isWalkingAt(agent, at)
  const start = positionAt(agent, at)
  const stops: Stop[] = [
    { point: start, door: walking ? start : doorOf(agent.station, agent.slot) },
    ...via,
    { point: dest, door: doorOf(station, slot) },
  ]
  let points: Point[] = [start]
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1] as Stop
    const b = stops[i] as Stop
    points = points.concat(route(a.point, a.door, b.point, b.door).slice(1))
  }
  const length = pathLength(points)
  const walk: Walk | null = length < 0.5 ? null : { points, startedAt: at, durationMs: walkMs(length) }
  return { ...agent, station, slot, pos: dest, walk }
}

function beside(agent: Agent): Stop {
  return {
    point: { x: clamp(agent.pos.x + 9, 4, WIDTH - 4), y: agent.pos.y },
    door: doorOf(agent.station, agent.slot),
  }
}

function uniqueLabel(scene: Scene, base: string): string {
  const taken = Object.values(scene.agents).filter(a => a.label === base || a.label.startsWith(`${base} `)).length
  return taken === 0 ? base : `${base} ${taken + 1}`
}

function nextDesk(scene: Scene): number {
  const used = new Set(
    Object.values(scene.agents)
      .filter(a => a.phase !== 'gone' && a.desk >= 0)
      .map(a => a.desk),
  )
  for (let desk = 0; desk < DESK_COUNT; desk++) if (!used.has(desk)) return desk
  return scene.order.length % DESK_COUNT
}

function arrive(scene: Scene, id: string, type: string, label: string, at: number): Agent {
  return {
    id,
    parentId: MAIN,
    type,
    label,
    description: '',
    isTeammate: false,
    phase: 'arriving',
    station: 'elevator',
    slot: 0,
    desk: nextDesk(scene),
    pos: slotPoint('elevator', 0),
    walk: null,
    activity: null,
    lastErrorAt: null,
    lastEventAt: at,
    arrivedAt: at,
    goneAt: null,
    look: lookFor(type, id),
  }
}

function endBriefing(scene: Scene, agent: Agent, at: number): Scene {
  const stillBriefing = Object.values(scene.agents).some(a => a.phase === 'briefing')
  let out: Scene = stillBriefing ? scene : { ...scene, briefing: null }
  const parent = agent.parentId === null ? undefined : out.agents[agent.parentId]
  if (parent !== undefined && parent.station === 'meeting' && parent.activity === null && parent.phase !== 'gone') {
    out = put(out, { ...moveTo(out, parent, homeOf(parent), at), lastEventAt: at })
  }
  return out
}

function spawned(scene: Scene, ev: Ev<'spawned'>): Scene {
  const existing = scene.agents[ev.id]
  let s = scene
  if (existing === undefined) {
    const fresh = {
      ...arrive(s, ev.id, ev.type, uniqueLabel(s, ev.name ?? ev.type), ev.at),
      parentId: ev.parentId,
      description: ev.description,
      isTeammate: ev.isTeammate,
    }
    s = addAgent(s, { ...moveTo(s, fresh, 'meeting', ev.at), phase: 'briefing' })
    const parent = s.agents[ev.parentId]
    if (parent !== undefined && parent.activity === null && parent.phase !== 'gone') {
      s = put(s, { ...moveTo(s, parent, 'meeting', ev.at), phase: 'working', lastEventAt: ev.at })
    }
    s = { ...s, briefing: ev.description }
  } else {
    const label = existing.type === 'contractor' ? uniqueLabel(s, ev.name ?? ev.type) : existing.label
    s = put(s, {
      ...existing,
      type: ev.type,
      label,
      parentId: ev.parentId,
      description: ev.description,
      isTeammate: ev.isTeammate,
      look: lookFor(ev.type, ev.id),
      lastEventAt: ev.at,
    })
  }
  return withLine(s, ev.at, narrate(s, ev))
}

function findByName(scene: Scene, name: string, selfId: string): Agent | undefined {
  const wanted = name.toLowerCase()
  return Object.values(scene.agents).find(
    a => a.id !== selfId && a.phase !== 'gone' && (a.label.toLowerCase() === wanted || a.id === name),
  )
}

function toolStarted(scene: Scene, ev: Ev<'toolStarted'>): Scene {
  let s = scene
  let agent = s.agents[ev.agentId]
  if (agent === undefined) {
    agent = arrive(s, ev.agentId, 'contractor', uniqueLabel(s, 'Contractor'), ev.at)
    s = addAgent(s, agent)
  } else if (agent.phase === 'gone') {
    agent = {
      ...agent,
      phase: 'arriving',
      station: 'elevator',
      slot: 0,
      pos: slotPoint('elevator', 0),
      walk: null,
      goneAt: null,
      desk: nextDesk(s),
      arrivedAt: ev.at,
    }
  }
  const wasBriefing = agent.phase === 'briefing'
  let moved: Agent
  if (ev.tool === 'SendMessage') {
    const recipient = findByName(s, ev.target, agent.id)
    moved = recipient !== undefined ? moveTo(s, agent, agent.station, ev.at, [beside(recipient)]) : moveTo(s, agent, 'meeting', ev.at)
  } else {
    moved = moveTo(s, agent, stationFor(ev.tool), ev.at)
  }
  s = put(s, {
    ...moved,
    phase: WAITING_TOOLS.has(ev.tool) ? 'waiting' : 'working',
    activity: { tool: ev.tool, target: ev.target, callId: ev.callId, since: ev.at },
    lastEventAt: ev.at,
  })
  if (wasBriefing) s = endBriefing(s, agent, ev.at)
  return withLine(s, ev.at, narrate(s, ev))
}

function toolEnded(scene: Scene, ev: Ev<'toolEnded'>): Scene {
  const agent = scene.agents[ev.agentId]
  if (agent === undefined || agent.phase === 'gone') return scene
  const isCurrent = agent.activity?.callId === ev.callId
  let next: Agent = {
    ...agent,
    activity: isCurrent ? null : agent.activity,
    lastErrorAt: ev.isError ? ev.at : agent.lastErrorAt,
    lastEventAt: ev.at,
  }
  if (isCurrent && agent.phase === 'waiting') next = { ...moveTo(scene, next, homeOf(next), ev.at), phase: 'working' }
  return withLine(put(scene, next), ev.at, narrate(scene, ev))
}

function latestUser(scene: Scene, tool: string): string {
  let best: Agent | undefined
  for (const a of Object.values(scene.agents)) {
    if (a.phase === 'gone' || a.activity?.tool !== tool) continue
    if (best === undefined || a.activity.since > (best.activity?.since ?? -1)) best = a
  }
  return best?.id ?? MAIN
}

function waiting(scene: Scene, ev: Ev<'waiting'>): Scene {
  const id = ev.agentId !== null && scene.agents[ev.agentId] !== undefined ? ev.agentId : latestUser(scene, ev.tool)
  const agent = scene.agents[id]
  if (agent === undefined || agent.phase === 'gone') return scene
  const s = put(scene, { ...moveTo(scene, agent, 'reception', ev.at), phase: 'waiting', lastEventAt: ev.at })
  return withLine(s, ev.at, narrate(s, { ...ev, agentId: id }))
}

function turnStarted(scene: Scene, ev: Ev<'turnStarted'>): Scene {
  const main = scene.agents[MAIN]
  if (main === undefined) return scene
  const s = put(scene, { ...moveTo(scene, main, 'office', ev.at), phase: 'working', lastEventAt: ev.at })
  return withLine(s, ev.at, narrate(s, ev))
}

function prune(scene: Scene): Scene {
  const gone = scene.order.filter(id => scene.agents[id]?.phase === 'gone')
  if (gone.length <= GONE_KEEP) return scene
  const drop = new Set(gone.slice(0, gone.length - GONE_KEEP))
  const agents = { ...scene.agents }
  for (const id of drop) delete agents[id]
  return { ...scene, agents, order: scene.order.filter(id => !drop.has(id)) }
}

function handedBack(scene: Scene, ev: Ev<'handedBack'>): Scene {
  const agent = scene.agents[ev.agentId]
  if (agent === undefined || agent.id === MAIN || agent.phase === 'gone') return scene
  const parent = agent.parentId === null ? undefined : scene.agents[agent.parentId]
  const via = parent !== undefined && parent.phase !== 'gone' ? [beside(parent)] : []
  let next: Agent
  if (agent.isTeammate) {
    next = { ...moveTo(scene, agent, 'breakroom', ev.at, via), phase: 'idle' }
  } else {
    const moved = moveTo(scene, agent, 'elevator', ev.at, via)
    next = { ...moved, phase: 'gone', goneAt: ev.at + (moved.walk?.durationMs ?? 0) }
  }
  let s = put(scene, { ...next, activity: null, lastEventAt: ev.at })
  if (agent.phase === 'briefing') s = endBriefing(s, agent, ev.at)
  s = prune(s)
  return withLine(s, ev.at, narrate(s, ev))
}

function sweepTarget(agent: Agent, now: number): StationId | null {
  if (agent.activity !== null || agent.phase === 'gone' || agent.phase === 'idle' || agent.phase === 'briefing') return null
  const quiet = now - agent.lastEventAt
  if (quiet >= IDLE_MS) return 'breakroom'
  if (quiet >= LINGER_MS && agent.station !== homeOf(agent)) return homeOf(agent)
  return null
}

export function needsSweep(scene: Scene, now: number): boolean {
  return Object.values(scene.agents).some(a => sweepTarget(a, now) !== null)
}

function tick(scene: Scene, at: number): Scene {
  let s = scene
  for (const id of scene.order) {
    const agent = s.agents[id]
    if (agent === undefined) continue
    const target = sweepTarget(agent, at)
    if (target === null) continue
    s = put(s, { ...moveTo(s, agent, target, at), phase: target === 'breakroom' ? 'idle' : 'working' })
  }
  return s
}

export function reduce(scene: Scene, ev: OfficeEvent): Scene {
  switch (ev.kind) {
    case 'spawned':
      return spawned(scene, ev)
    case 'toolStarted':
      return toolStarted(scene, ev)
    case 'toolEnded':
      return toolEnded(scene, ev)
    case 'waiting':
      return waiting(scene, ev)
    case 'turnStarted':
      return turnStarted(scene, ev)
    case 'handedBack':
      return handedBack(scene, ev)
    case 'todos':
      return { ...scene, todos: { done: ev.done, open: ev.open } }
    case 'tick':
      return tick(scene, ev.at)
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `CC="/c/Users/bar12/AppData/Roaming/Claude/claude-code/2.1.295/d2e29494ec83/claude.exe"; "$CC" plugin test pixel-office`
Expected: PASS (stations, sprites, narrate, model).

- [ ] **Step 7: Commit**

```bash
git add pixel-office/hooks/narrate.ts pixel-office/hooks/model.ts pixel-office/tests/narrate.test.ts pixel-office/tests/model.test.ts
git commit -m "feat: add scene reducer and plain-English narrator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Static office art

**Files:**
- Create: `pixel-office/hooks/office.ts`
- Test: `pixel-office/tests/office.test.ts`

**Interfaces:**
- Consumes: `WIDTH`, `HEIGHT` from `./stations`.
- Produces: `rect(x, y, w, h, fill, extra = ''): string`, `OFFICE_DEFS: string` (patterns `po-wood`, `po-carpet`, `po-tile`, `po-grate`; shapes `po-desk`, `po-cab`, `po-shelf`, `po-rack`, `po-plant`), `officeBase(isNight: boolean): string` (zones wrapped in `<g id="po-zone-<StationId>">`), `officeDecor(): string` (wrapped in `<g id="po-decor">`, droppable under the size guard).

- [ ] **Step 1: Write the failing tests**

`pixel-office/tests/office.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'

import { OFFICE_DEFS, officeBase, officeDecor, rect } from '../hooks/office'
import { STATION_ORDER } from '../hooks/stations'

test('every zone is drawn and labelled by id', async () => {
  const base = officeBase(false)
  for (const id of STATION_ORDER) expect(base).toContain(`id="po-zone-${id}"`)
})

test('defs carry the floor patterns and furniture', async () => {
  for (const id of ['po-wood', 'po-carpet', 'po-tile', 'po-grate', 'po-desk', 'po-cab', 'po-shelf', 'po-rack', 'po-plant']) {
    expect(OFFICE_DEFS).toContain(`id="${id}"`)
  }
})

test('night changes the windows', async () => {
  expect(officeBase(true)).not.toBe(officeBase(false))
  expect(officeBase(true)).toContain('#26215c')
  expect(officeBase(false).includes('#26215c')).toBe(false)
})

test('the static office stays well under the SVG budget', async () => {
  expect((OFFICE_DEFS + officeBase(true) + officeDecor()).length).toBeLessThan(60_000)
  expect(officeDecor()).toContain('id="po-decor"')
})

test('rect rounds coordinates to two decimals', async () => {
  expect(rect(1.234, 2, 3, 4, '#fff')).toBe('<rect x="1.23" y="2" width="3" height="4" fill="#fff"/>')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `CC="/c/Users/bar12/AppData/Roaming/Claude/claude-code/2.1.295/d2e29494ec83/claude.exe"; "$CC" plugin test pixel-office`
Expected: FAIL, `office.test.ts` cannot resolve `../hooks/office`.

- [ ] **Step 3: Implement office.ts**

`pixel-office/hooks/office.ts`:
```ts
import { HEIGHT, WIDTH } from './stations'

const C = {
  wall: '#6b6658',
  wallTrim: '#444441',
  wood: '#c9a36b',
  woodDark: '#a8834f',
  carpet: '#7a8fa8',
  carpetDark: '#6d8199',
  tile: '#e6e1d3',
  tileLine: '#d3cdbb',
  grate: '#3d3a35',
  grateLine: '#4a4740',
  glass: '#b5d4f4',
  frame: '#5f5e5a',
  deskTop: '#8a5a36',
  deskEdge: '#6b4428',
  monitor: '#2c2c2a',
  screen: '#5dcaa5',
  screenMain: '#f0997b',
  chair: '#444441',
  partition: '#b4b2a9',
  printer: '#d3d1c7',
  printerTop: '#888780',
  shelf: '#6b4428',
  shelfBack: '#4a2e1a',
  cabinet: '#888780',
  cabinetFace: '#b4b2a9',
  handle: '#444441',
  counter: '#a8834f',
  cubby: '#d3c3a3',
  boothFrame: '#a32d2d',
  boothTop: '#791f1f',
  rack: '#2c2c2a',
  rackFace: '#444441',
  rug: '#3c6e8f',
  rugInner: '#4f86a8',
  board: '#ffffff',
  cork: '#c08a4f',
  couch: '#993556',
  couchDark: '#72243e',
  vending: '#185fa5',
  steel: '#b4b2a9',
  steelDark: '#5f5e5a',
  reception: '#d4537e',
  receptionTop: '#f4c0d1',
  daySky: '#85b7eb',
  nightSky: '#26215c',
  city: '#5f5e5a',
  cityNight: '#2c2c2a',
  leaf: '#3b6d11',
  leafLight: '#639922',
  pot: '#993c1d',
} as const

const n = (v: number): number => Math.round(v * 100) / 100

export const rect = (x: number, y: number, w: number, h: number, fill: string, extra = ''): string =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}"${extra}/>`

const use = (id: string, x: number, y: number): string => `<use href="#${id}" x="${x}" y="${y}"/>`
const GLASS = ' fill-opacity="0.6"'
const BOOKS = ['#a32d2d', '#185fa5', '#3b6d11', '#ba7517', '#534ab7', '#993556']

function shelf(): string {
  let out = rect(0, 0, 8, 22, C.shelf)
  for (let row = 0; row < 3; row++) {
    const y = 1 + row * 7
    out += rect(1, y, 6, 6, C.shelfBack)
    for (let b = 0; b < 3; b++) {
      out += rect(1 + b * 2, y + 1 + (b % 2), 2, 5 - (b % 2), BOOKS[(row * 3 + b) % BOOKS.length] as string)
    }
  }
  return out
}

export const OFFICE_DEFS =
  '<defs>' +
  `<pattern id="po-wood" width="8" height="4" patternUnits="userSpaceOnUse">${rect(0, 0, 8, 4, C.wood)}${rect(0, 3, 8, 1, C.woodDark)}${rect(5, 0, 1, 3, C.woodDark)}</pattern>` +
  `<pattern id="po-carpet" width="4" height="4" patternUnits="userSpaceOnUse">${rect(0, 0, 4, 4, C.carpet)}${rect(0, 0, 2, 2, C.carpetDark)}${rect(2, 2, 2, 2, C.carpetDark)}</pattern>` +
  `<pattern id="po-tile" width="6" height="6" patternUnits="userSpaceOnUse">${rect(0, 0, 6, 6, C.tile)}${rect(0, 0, 6, 1, C.tileLine)}${rect(0, 0, 1, 6, C.tileLine)}</pattern>` +
  `<pattern id="po-grate" width="4" height="4" patternUnits="userSpaceOnUse">${rect(0, 0, 4, 4, C.grate)}${rect(0, 0, 4, 1, C.grateLine)}${rect(0, 0, 1, 4, C.grateLine)}</pattern>` +
  `<g id="po-desk">${rect(0, 0, 16, 6, C.deskTop)}${rect(0, 6, 16, 1, C.deskEdge)}${rect(1, 7, 1, 3, C.deskEdge)}${rect(14, 7, 1, 3, C.deskEdge)}${rect(5, -5, 6, 5, C.monitor)}${rect(6, -4, 4, 3, C.screen)}${rect(7, 0, 2, 1, C.monitor)}${rect(2, 2, 4, 1, '#d3d1c7')}</g>` +
  `<g id="po-cab">${rect(0, 0, 6, 20, C.cabinet)}${rect(1, 1, 4, 5, C.cabinetFace)}${rect(1, 7, 4, 5, C.cabinetFace)}${rect(1, 13, 4, 6, C.cabinetFace)}${rect(2, 3, 2, 1, C.handle)}${rect(2, 9, 2, 1, C.handle)}${rect(2, 15, 2, 1, C.handle)}</g>` +
  `<g id="po-shelf">${shelf()}</g>` +
  `<g id="po-rack">${rect(0, 0, 10, 26, C.rack)}${rect(1, 1, 8, 24, C.rackFace)}${[3, 7, 11, 15, 19].map(y => rect(2, y, 6, 2, C.rack)).join('')}</g>` +
  `<g id="po-plant">${rect(1, 8, 4, 4, C.pot)}${rect(0, 2, 6, 6, C.leaf)}${rect(1, 0, 2, 3, C.leafLight)}${rect(3, 1, 2, 3, C.leaf)}${rect(2, 4, 1, 2, C.leafLight)}</g>` +
  '</defs>'

function floors(): string {
  return (
    rect(0, 10, WIDTH, HEIGHT - 10, 'url(#po-wood)') +
    rect(0, 10, 62, 48, 'url(#po-carpet)') +
    rect(0, 62, 62, 44, 'url(#po-tile)') +
    rect(0, 108, 70, 42, 'url(#po-tile)') +
    rect(176, 96, 64, 54, 'url(#po-grate)')
  )
}

function walls(isNight: boolean): string {
  const city = isNight ? C.cityNight : C.city
  let out = rect(0, 0, WIDTH, 9, C.wall) + rect(0, 9, WIDTH, 1, C.wallTrim)
  for (const x of [112, 128, 144, 160]) {
    out += rect(x, 1, 14, 7, C.frame) + rect(x + 1, 2, 12, 5, isNight ? C.nightSky : C.daySky)
    out += rect(x + 2, 5, 3, 2, city) + rect(x + 6, 4, 2, 3, city) + rect(x + 9, 5, 3, 2, city)
    if (isNight) out += rect(x + 6, 5, 1, 1, '#fac775') + rect(x + 10, 6, 1, 1, '#fac775')
  }
  out += `<g id="po-zone-taskboard">${rect(72, 1, 32, 8, C.frame)}${rect(73, 2, 30, 6, C.cork)}</g>`
  out += rect(62, 10, 2, 48, C.glass, GLASS) + rect(0, 58, 48, 2, C.glass, GLASS) + rect(48, 58, 1, 2, C.frame)
  out += rect(176, 98, 2, 52, C.glass, GLASS) + rect(190, 96, 50, 2, C.glass, GLASS) + rect(189, 96, 1, 2, C.frame)
  out += rect(0, 106, 28, 2, C.partition) + rect(37, 106, 25, 2, C.partition) + rect(76, 47, 86, 2, C.partition)
  return out
}

function cornerOffice(): string {
  return (
    '<g id="po-zone-office">' +
    use('po-shelf', 3, 12) +
    rect(14, 34, 28, 6, C.deskTop) +
    rect(14, 40, 28, 1, C.deskEdge) +
    rect(15, 41, 1, 4, C.deskEdge) +
    rect(40, 41, 1, 4, C.deskEdge) +
    rect(24, 28, 9, 6, C.monitor) +
    rect(25, 29, 7, 4, C.screenMain) +
    rect(27, 34, 3, 1, C.monitor) +
    rect(17, 35, 5, 2, '#fac775') +
    rect(34, 35, 4, 3, '#ffffff') +
    use('po-plant', 52, 12) +
    '</g>'
  )
}

function desks(): string {
  let out = '<g id="po-zone-desk">'
  for (let i = 0; i < 8; i++) {
    const x = 78 + 22 * (i % 4)
    const y = 26 + 30 * Math.floor(i / 4)
    out += use('po-desk', x, y) + rect(x + 5, y + 9, 6, 2, C.chair)
  }
  out += rect(164, 24, 9, 10, C.printer) + rect(165, 25, 7, 2, C.printerTop) + rect(166, 33, 5, 1, '#ffffff')
  return `${out}</g>`
}

function library(): string {
  let out = '<g id="po-zone-library">'
  for (const x of [178, 187, 196]) out += use('po-shelf', x, 12)
  for (const x of [208, 214, 220, 226, 232]) out += use('po-cab', x, 14)
  return `${out}</g>`
}

function mailroom(): string {
  let out = `<g id="po-zone-mailroom">${rect(178, 52, 28, 9, C.cubby)}`
  for (const x of [185, 192, 199]) out += rect(x, 52, 1, 9, C.woodDark)
  out += rect(178, 56, 28, 1, C.woodDark)
  out += rect(178, 62, 28, 6, C.counter) + rect(178, 68, 28, 1, C.woodDark)
  out += rect(181, 59, 4, 3, '#d3a36b') + rect(194, 60, 3, 2, '#ffffff')
  return `${out}</g>`
}

function phoneBooths(): string {
  let out = '<g id="po-zone-phone">'
  for (const x of [214, 228]) {
    out +=
      rect(x, 52, 12, 28, C.boothFrame) +
      rect(x + 1, 55, 10, 24, C.glass, GLASS) +
      rect(x + 1, 53, 10, 2, C.boothTop) +
      rect(x + 8, 62, 2, 3, C.monitor)
  }
  return `${out}</g>`
}

function serverRoom(): string {
  let out = '<g id="po-zone-server">'
  ;[186, 202, 218].forEach((x, i) => {
    out += use('po-rack', x, 102)
    for (let k = 0; k < 4; k++) {
      const dur = (0.5 + ((i * 4 + k) % 5) * 0.23).toFixed(2)
      out +=
        `<rect x="${x + 7}" y="${104 + k * 4}" width="1" height="1" fill="#97c459">` +
        `<animate attributeName="fill" values="#97c459;#27500a;#97c459" dur="${dur}s" repeatCount="indefinite"/></rect>`
    }
  })
  out += rect(230, 99, 8, 4, C.steel) + rect(231, 100, 6, 1, C.steelDark)
  return `${out}</g>`
}

function meetingRoom(): string {
  let out = `<g id="po-zone-meeting">${rect(80, 100, 70, 46, C.rug)}${rect(82, 102, 66, 42, C.rugInner)}`
  out += rect(94, 98, 38, 8, C.frame) + rect(95, 99, 36, 6, C.board) + rect(96, 106, 1, 4, C.frame) + rect(129, 106, 1, 4, C.frame)
  for (const x of [96, 108, 120]) out += rect(x, 109, 4, 3, C.chair)
  for (const x of [96, 108, 120, 132]) out += rect(x, 128, 4, 3, C.chair)
  out += rect(92, 116, 42, 10, C.deskTop) + rect(92, 126, 42, 1, C.deskEdge)
  return `${out}</g>`
}

function breakRoom(): string {
  let out = '<g id="po-zone-breakroom">'
  out += rect(2, 64, 10, 18, C.vending) + rect(3, 66, 8, 10, C.glass)
  for (const [x, y, fill] of [
    [4, 67, '#e24b4a'],
    [7, 67, '#fac775'],
    [4, 71, '#639922'],
    [7, 71, '#d4537e'],
  ] as const) {
    out += rect(x, y, 2, 2, fill)
  }
  out += rect(16, 68, 24, 6, C.counter) + rect(16, 74, 24, 1, C.woodDark)
  out += rect(21, 61, 8, 7, C.monitor) + rect(23, 63, 4, 2, '#e24b4a') + rect(24, 66, 2, 2, '#ffffff')
  out += rect(34, 60, 6, 14, C.steel) + rect(35, 60, 4, 5, '#85b7eb')
  out += rect(4, 90, 26, 3, C.couchDark) + rect(4, 93, 26, 6, C.couch) + rect(3, 91, 2, 8, C.couchDark) + rect(29, 91, 2, 8, C.couchDark)
  return `${out}</g>`
}

function lobby(): string {
  return (
    '<g id="po-zone-elevator">' +
    rect(3, 110, 26, 26, C.steelDark) +
    rect(5, 112, 11, 24, C.steel) +
    rect(16, 112, 11, 24, C.steel) +
    rect(15, 112, 2, 24, C.steelDark) +
    rect(12, 108, 8, 2, C.monitor) +
    rect(15, 108, 2, 1, '#97c459') +
    rect(29, 122, 1, 2, '#fac775') +
    '</g>' +
    '<g id="po-zone-reception">' +
    rect(36, 123, 26, 2, C.receptionTop) +
    rect(36, 125, 26, 7, C.reception) +
    rect(46, 120, 4, 3, '#ef9f27') +
    rect(47, 119, 2, 1, '#fac775') +
    '</g>'
  )
}

const baseCache = new Map<boolean, string>()

export function officeBase(isNight: boolean): string {
  const hit = baseCache.get(isNight)
  if (hit !== undefined) return hit
  const svg = [
    floors(),
    walls(isNight),
    cornerOffice(),
    desks(),
    library(),
    mailroom(),
    phoneBooths(),
    serverRoom(),
    meetingRoom(),
    breakRoom(),
    lobby(),
  ].join('')
  baseCache.set(isNight, svg)
  return svg
}

let decorCache: string | null = null

export function officeDecor(): string {
  if (decorCache !== null) return decorCache
  let out = '<g id="po-decor">'
  for (const [x, y] of [
    [66, 12],
    [152, 102],
    [169, 100],
    [0, 138],
  ] as const) {
    out += use('po-plant', x, y)
  }
  out += rect(4, 2, 10, 6, '#f1efe8') + rect(5, 3, 8, 4, '#d85a30') + rect(6, 4, 3, 2, '#fac775')
  out += rect(106, 2, 4, 4, '#ffffff') + rect(107, 3, 1, 2, '#2c2c2a') + rect(108, 4, 1, 1, '#2c2c2a')
  out +=
    `<g>${rect(24, 58, 1, 2, '#ffffff', ' fill-opacity="0.8"')}${rect(26, 57, 1, 2, '#ffffff', ' fill-opacity="0.6"')}` +
    '<animateTransform attributeName="transform" type="translate" values="0,1;0,-2" dur="1.2s" repeatCount="indefinite"/>' +
    '<animate attributeName="opacity" values="1;0" dur="1.2s" repeatCount="indefinite"/></g>'
  out +=
    '<rect x="36" y="64" width="1" height="1" fill="#ffffff">' +
    '<animate attributeName="y" values="64;60" dur="2s" repeatCount="indefinite"/></rect>'
  decorCache = `${out}</g>`
  return decorCache
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `CC="/c/Users/bar12/AppData/Roaming/Claude/claude-code/2.1.295/d2e29494ec83/claude.exe"; "$CC" plugin test pixel-office`
Expected: PASS (all files so far).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/hooks/office.ts pixel-office/tests/office.test.ts
git commit -m "feat: draw the static open-plan office

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Scene renderer

**Files:**
- Create: `pixel-office/hooks/render.ts`
- Test: `pixel-office/tests/render.test.ts`

**Interfaces:**
- Consumes: from `./model`: `MAIN`, `isWalkingAt`, `positionAt`; from `./office`: `OFFICE_DEFS`, `officeBase`, `officeDecor`, `rect`; from `./sprites`: `iconSvg`, `personSvg`, `type Variant`; from `./stations`: `HEIGHT`, `STATIONS`, `WIDTH`, `clamp`, `clip`, `splitAt`.
- Produces: `SVG_BUDGET = 120000`, `PUFF_MS = 2500`, `escapeXml(text): string`, `isNight(now): boolean`, `renderOffice(scene: Scene, now: number, budget = SVG_BUDGET): string`, `type OrgRow = { id: string; depth: number; label: string; status: 'working' | 'waiting' | 'idle' | 'done'; place: string }`, `statusOf(agent): OrgRow['status']`, `orgRows(scene): OrgRow[]`, `clockLabel(at): string` (`HH:MM`, local time), `altText(scene): string`.

- [ ] **Step 1: Write the failing tests**

`pixel-office/tests/render.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import { MAIN, emptyScene, reduce } from '../hooks/model'
import { PUFF_MS, SVG_BUDGET, altText, clockLabel, escapeXml, isNight, orgRows, renderOffice } from '../hooks/render'
import type { OfficeEvent, Scene } from '../types'

const spawnEv = (id: string, at: number): OfficeEvent => ({
  kind: 'spawned',
  id,
  parentId: MAIN,
  type: 'Explore',
  description: 'find auth code',
  name: null,
  isTeammate: false,
  at,
})
const readEv = (id: string, target: string, at: number): OfficeEvent => ({
  kind: 'toolStarted',
  agentId: id,
  tool: 'Read',
  target,
  callId: `c-${id}`,
  at,
})
const run = (events: OfficeEvent[]): Scene => events.reduce(reduce, emptyScene())
const groupOf = (svg: string, id: string): string => {
  const start = svg.indexOf(`<g id="agent-${id}"`)
  const next = svg.indexOf('<g id="agent-', start + 1)
  return start < 0 ? '' : svg.slice(start, next < 0 ? undefined : next)
}

describe('renderOffice', () => {
  test('draws a complete svg with Main in it', async () => {
    const svg = renderOffice(emptyScene(), 1000)
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
    expect(svg).toContain('viewBox="0 0 240 150"')
    expect(svg).toContain('id="agent-main"')
  })

  test('a walking agent continues its walk for the time left', async () => {
    const s = run([spawnEv('a1', 1000), readEv('a1', 'auth.ts', 1100)])
    const walk = s.agents.a1!.walk!
    const now = walk.startedAt + 100
    const group = groupOf(renderOffice(s, now), 'a1')
    expect(group).toContain(`<animateMotion dur="${walk.startedAt + walk.durationMs - now}ms"`)
  })

  test('an agent at work stands still with a bubble naming its target', async () => {
    const s = run([spawnEv('a1', 1000), readEv('a1', 'auth.ts', 1100)])
    const group = groupOf(renderOffice(s, 60_000), 'a1')
    expect(group.includes('animateMotion')).toBe(false)
    expect(group).toContain(`translate(${s.agents.a1!.pos.x},${s.agents.a1!.pos.y})`)
    expect(group).toContain('>auth.ts</text>')
    expect(group).toContain('#7f77dd')
  })

  test('markup in targets is escaped', async () => {
    const s = run([spawnEv('a1', 1000), readEv('a1', '<b>&"x"', 1100)])
    const svg = renderOffice(s, 60_000)
    expect(svg).toContain('&lt;b&gt;&amp;&quot;x&quot;')
    expect(svg.includes('<b>')).toBe(false)
  })

  test('a departing agent hides when its walk ends and is gone after', async () => {
    const s = reduce(run([spawnEv('a1', 1000)]), { kind: 'handedBack', agentId: 'a1', at: 2000 })
    const goneAt = s.agents.a1!.goneAt!
    expect(groupOf(renderOffice(s, 2001), 'a1')).toContain('<set attributeName="visibility" to="hidden"')
    expect(renderOffice(s, goneAt + 1).includes('id="agent-a1"')).toBe(false)
  })

  test('an error puffs red for a moment', async () => {
    const s = run([
      spawnEv('a1', 1000),
      readEv('a1', 'x.ts', 1100),
      { kind: 'toolEnded', agentId: 'a1', callId: 'c-a1', isError: true, at: 5000 },
    ])
    expect(groupOf(renderOffice(s, 5100), 'a1')).toContain('#e8453c')
    expect(groupOf(renderOffice(s, 5000 + PUFF_MS + 1), 'a1').includes('#e8453c')).toBe(false)
  })

  test('twenty agents fit the budget', async () => {
    let s = emptyScene()
    for (let i = 0; i < 20; i++) s = reduce(s, spawnEv(`a${i}`, 1000 + i))
    for (let i = 0; i < 20; i++) s = reduce(s, readEv(`a${i}`, `file-${i}.ts`, 2000 + i))
    const svg = renderOffice(s, 120_000)
    expect(svg.length).toBeLessThan(SVG_BUDGET)
    expect(svg).toContain('id="po-decor"')
  })

  test('a tiny budget drops decor and caps agents', async () => {
    let s = emptyScene()
    for (let i = 0; i < 20; i++) s = reduce(s, spawnEv(`a${i}`, 1000 + i))
    const svg = renderOffice(s, 120_000, 1)
    expect(svg.includes('id="po-decor"')).toBe(false)
    expect(svg).toContain('+20 more')
    expect(svg).toContain('id="agent-main"')
  })

  test('night and day differ', async () => {
    expect(isNight(new Date(2026, 9, 14, 22).getTime())).toBe(true)
    expect(isNight(new Date(2026, 9, 14, 12).getTime())).toBe(false)
  })
})

describe('labels', () => {
  test('org rows nest subagents under their parent', async () => {
    const s = run([spawnEv('a1', 1000), readEv('a1', 'x.ts', 1100)])
    const rows = orgRows(s)
    expect(rows[0]).toEqual({ id: MAIN, depth: 0, label: 'Main', status: 'working', place: 'Corner office' })
    expect(rows[1]).toEqual({ id: 'a1', depth: 1, label: 'Explore', status: 'working', place: 'Records library' })
    const done = reduce(s, { kind: 'handedBack', agentId: 'a1', at: 9000 })
    expect(orgRows(done)[1]).toMatchObject({ status: 'done', place: 'left' })
  })

  test('clock labels are HH:MM in local time', async () => {
    expect(clockLabel(new Date(2026, 9, 14, 9, 5).getTime())).toBe('09:05')
  })

  test('alt text lists who is where', async () => {
    expect(altText(emptyScene())).toBe('Pixel office with 1 agent: Main at Corner office')
  })

  test('escapeXml escapes the five XML characters', async () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `CC="/c/Users/bar12/AppData/Roaming/Claude/claude-code/2.1.295/d2e29494ec83/claude.exe"; "$CC" plugin test pixel-office`
Expected: FAIL, `render.test.ts` cannot resolve `../hooks/render`.

- [ ] **Step 3: Implement render.ts**

`pixel-office/hooks/render.ts`:
```ts
import type { Agent, Scene, StationId } from '../types'
import { MAIN, isWalkingAt, positionAt } from './model'
import { OFFICE_DEFS, officeBase, officeDecor, rect } from './office'
import { iconSvg, personSvg } from './sprites'
import type { Variant } from './sprites'
import { HEIGHT, STATIONS, WIDTH, clamp, clip, splitAt } from './stations'

export const SVG_BUDGET = 120_000
export const PUFF_MS = 2500

const PUFF = '#e8453c'
const BOB: Partial<Record<StationId, number>> = {
  office: 0.8,
  desk: 0.4,
  library: 0.7,
  server: 0.35,
  mailroom: 0.6,
  phone: 1,
  taskboard: 0.6,
  meeting: 0.9,
}

const XML: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

export const escapeXml = (text: string): string => text.replace(/[&<>"']/g, ch => XML[ch] ?? ch)

const n = (v: number): number => Math.round(v * 100) / 100

export function isNight(now: number): boolean {
  const hour = new Date(now).getHours()
  return hour < 7 || hour >= 19
}

export type OrgRow = {
  id: string
  depth: number
  label: string
  status: 'working' | 'waiting' | 'idle' | 'done'
  place: string
}

export function statusOf(agent: Agent): OrgRow['status'] {
  switch (agent.phase) {
    case 'waiting':
      return 'waiting'
    case 'idle':
      return 'idle'
    case 'gone':
      return 'done'
    default:
      return 'working'
  }
}

export function orgRows(scene: Scene): OrgRow[] {
  const children = new Map<string, string[]>()
  for (const id of scene.order) {
    const agent = scene.agents[id]
    if (agent === undefined || agent.parentId === null) continue
    const parent = scene.agents[agent.parentId] !== undefined ? agent.parentId : MAIN
    children.set(parent, [...(children.get(parent) ?? []), id])
  }
  const rows: OrgRow[] = []
  const seen = new Set<string>()
  const visit = (id: string, depth: number): void => {
    if (seen.has(id)) return
    seen.add(id)
    const agent = scene.agents[id]
    if (agent === undefined) return
    rows.push({
      id,
      depth,
      label: agent.label,
      status: statusOf(agent),
      place: agent.phase === 'gone' ? 'left' : STATIONS[agent.station].name,
    })
    for (const child of children.get(id) ?? []) visit(child, depth + 1)
  }
  visit(MAIN, 0)
  for (const id of scene.order) visit(id, 1)
  return rows
}

const pad = (v: number): string => String(v).padStart(2, '0')

export function clockLabel(at: number): string {
  const d = new Date(at)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function altText(scene: Scene): string {
  const here = Object.values(scene.agents).filter(a => a.phase !== 'gone')
  const noun = here.length === 1 ? 'agent' : 'agents'
  return `Pixel office with ${here.length} ${noun}: ${here.map(a => `${a.label} at ${STATIONS[a.station].name}`).join(', ')}`
}

function tooltip(agent: Agent, scene: Scene, now: number): string {
  const boss = agent.parentId === null ? undefined : scene.agents[agent.parentId]?.label
  const lines = [agent.id === MAIN ? 'Main (your main agent)' : `${agent.label} (${agent.type})`]
  if (agent.description !== '') lines.push(`Task: ${agent.description}`)
  lines.push(
    agent.activity !== null
      ? `Doing: ${agent.activity.tool}${agent.activity.target === '' ? '' : ` ${agent.activity.target}`}`
      : `Status: ${statusOf(agent)}`,
  )
  if (boss !== undefined) lines.push(`Reports to: ${boss}`)
  if (agent.id !== MAIN) {
    const secs = Math.max(0, Math.round((now - agent.arrivedAt) / 1000))
    lines.push(`On the job: ${Math.floor(secs / 60)}m ${secs % 60}s`)
  }
  return lines.join('\n')
}

function bubble(agent: Agent): string {
  const isWaiting = agent.phase === 'waiting'
  if (agent.activity === null && !isWaiting) return ''
  const station: StationId = isWaiting ? 'reception' : agent.station
  const text = agent.activity?.target ?? ''
  const width = 9 + Math.ceil(text.length * 2.4)
  const left = clamp(-Math.round(width / 2), 2 - agent.pos.x, WIDTH - 2 - agent.pos.x - width)
  const top = Math.max(-27, 1 - agent.pos.y)
  const blink = isWaiting ? '<animate attributeName="opacity" values="1;0.35;1" dur="0.8s" repeatCount="indefinite"/>' : ''
  const words = text === '' ? '' : `<text x="8.5" y="6" font-size="4" fill="#2c2c2a">${escapeXml(text)}</text>`
  return (
    `<g transform="translate(${n(left)},${n(top)})">${blink}` +
    rect(0, 0, width, 8, '#ffffff', ' stroke="#2c2c2a" stroke-width="0.5"') +
    rect(-left - 1, 8, 2, 2, '#ffffff') +
    iconSvg(station, 2, 1.5, STATIONS[station].color) +
    `${words}</g>`
  )
}

function errorPuff(ms: number): string {
  return (
    `<g transform="translate(5,-16)">${rect(-2, -2, 4, 4, PUFF)}${rect(-1, -4, 2, 2, '#f09595')}${rect(2, -1, 2, 2, '#f09595')}` +
    `<animate attributeName="opacity" values="1;0" dur="${Math.round(ms)}ms" fill="freeze"/></g>`
  )
}

function leaveAt(agent: Agent, now: number): string {
  if (agent.phase !== 'gone' || agent.goneAt === null) return ''
  return `<set attributeName="visibility" to="hidden" begin="${Math.max(0, Math.round(agent.goneAt - now))}ms"/>`
}

function drawAgent(agent: Agent, scene: Scene, now: number): string {
  const variant: Variant = agent.id === MAIN ? 'main' : agent.isTeammate ? 'teammate' : 'plain'
  const head = `<title>${escapeXml(tooltip(agent, scene, now))}</title>${leaveAt(agent, now)}`
  const tag =
    '<text x="0" y="-14" font-size="3.5" text-anchor="middle" fill="#ffffff" stroke="#2c2c2a" ' +
    `stroke-width="0.8" paint-order="stroke">${escapeXml(agent.label)}</text>`
  const puff = agent.lastErrorAt !== null && now - agent.lastErrorAt < PUFF_MS ? errorPuff(PUFF_MS - (now - agent.lastErrorAt)) : ''
  const id = `agent-${escapeXml(agent.id)}`
  if (agent.walk !== null && isWalkingAt(agent, now)) {
    const rest = splitAt(agent.walk.points, (now - agent.walk.startedAt) / agent.walk.durationMs)
    const ms = Math.max(1, Math.round(agent.walk.startedAt + agent.walk.durationMs - now))
    const path = `M${rest.map(p => `${n(p.x)},${n(p.y)}`).join(' L')}`
    return `<g id="${id}">${head}<animateMotion dur="${ms}ms" fill="freeze" path="${path}"/>${personSvg(agent.look, variant, ms)}${tag}${puff}</g>`
  }
  const period = agent.activity !== null ? BOB[agent.station] : undefined
  const body = personSvg(agent.look, variant, 0)
  const working =
    period === undefined
      ? body
      : `<g>${body}<animateTransform attributeName="transform" type="translate" values="0,0;0,-0.6;0,0" dur="${period}s" repeatCount="indefinite"/></g>`
  return `<g id="${id}" transform="translate(${n(agent.pos.x)},${n(agent.pos.y)})">${head}${working}${tag}${bubble(agent)}${puff}</g>`
}

function overlays(scene: Scene, now: number): string {
  const all = Object.values(scene.agents)
  const here = all.filter(a => a.phase !== 'gone')
  const busy = (station: StationId): Agent[] =>
    here.filter(a => a.station === station && a.activity !== null && !isWalkingAt(a, now))
  let out = ''
  if (scene.briefing !== null) {
    out += `<text x="113" y="103.5" font-size="3.5" text-anchor="middle" fill="#2c2c2a">${escapeXml(clip(scene.briefing, 18))}</text>`
  }
  if (scene.todos !== null) {
    const notes = [
      ...Array<string>(Math.min(scene.todos.done, 6)).fill('#97c459'),
      ...Array<string>(Math.min(scene.todos.open, 6)).fill('#fac775'),
    ]
    notes.forEach((fill, i) => {
      out += rect(74 + (i % 6) * 5, 2.5 + Math.floor(i / 6) * 3, 4, 2.5, fill)
    })
  }
  if (busy('server').length > 0) {
    for (const x of [188, 204, 220]) {
      out +=
        `<rect x="${x}" y="124" width="6" height="1" fill="#ef9f27">` +
        '<animate attributeName="opacity" values="1;0.2;1" dur="0.25s" repeatCount="indefinite"/></rect>'
    }
  }
  for (const agent of busy('phone')) out += rect(agent.slot === 0 ? 219 : 233, 53, 2, 1, '#fac775')
  if (busy('mailroom').length > 0) out += rect(196, 57, 5, 4, '#d3a36b') + rect(198, 57, 1, 4, '#854f0b')
  if (here.some(a => a.activity?.tool === 'Write')) {
    out +=
      '<rect x="166" y="34" width="5" height="1" fill="#ffffff">' +
      '<animate attributeName="height" values="1;5;1" dur="1s" repeatCount="indefinite"/></rect>'
  }
  const isElevatorBusy = all.some(
    a =>
      (a.id !== MAIN && now - a.arrivedAt < 2000) ||
      (a.phase === 'gone' && a.goneAt !== null && now < a.goneAt + 1500),
  )
  if (isElevatorBusy) out += rect(9, 112, 14, 24, '#2c2c2a')
  if (here.some(a => a.phase === 'waiting')) {
    out +=
      '<rect x="45" y="117" width="6" height="1" fill="#fac775">' +
      '<animate attributeName="opacity" values="1;0;1" dur="0.5s" repeatCount="indefinite"/></rect>'
  }
  return out
}

function badge(extra: number): string {
  return `<g>${rect(196, 1, 42, 7, '#2c2c2a')}<text x="217" y="6.3" font-size="4.5" text-anchor="middle" fill="#ffffff">+${extra} more</text></g>`
}

export function renderOffice(scene: Scene, now: number, budget = SVG_BUDGET): string {
  const ranked = Object.values(scene.agents)
    .filter(a => !(a.phase === 'gone' && a.goneAt !== null && now >= a.goneAt))
    .sort((a, b) => (a.id === MAIN ? -1 : b.id === MAIN ? 1 : b.lastEventAt - a.lastEventAt))
  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH * 4}" height="${HEIGHT * 4}" ` +
    `shape-rendering="crispEdges" font-family="monospace">${OFFICE_DEFS}${officeBase(isNight(now))}`
  const props = overlays(scene, now)
  const build = (withDecor: boolean, count: number): string => {
    const people = ranked
      .slice(0, count)
      .map(a => ({ a, y: positionAt(a, now).y }))
      .sort((p, q) => p.y - q.y)
      .map(p => drawAgent(p.a, scene, now))
      .join('')
    const extra = ranked.length - count
    return `${head}${withDecor ? officeDecor() : ''}${props}${people}${extra > 0 ? badge(extra) : ''}</svg>`
  }
  let svg = build(true, ranked.length)
  if (svg.length <= budget) return svg
  let count = ranked.length
  svg = build(false, count)
  while (svg.length > budget && count > 1) {
    count -= 1
    svg = build(false, count)
  }
  return svg
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `CC="/c/Users/bar12/AppData/Roaming/Claude/claude-code/2.1.295/d2e29494ec83/claude.exe"; "$CC" plugin test pixel-office`
Expected: PASS (all files so far).

- [ ] **Step 5: Commit**

```bash
git add pixel-office/hooks/render.ts pixel-office/tests/render.test.ts
git commit -m "feat: render the scene as an animated pixel SVG

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Pane, hooks and wiring

**Files:**
- Create: `pixel-office/hooks/state.ts`
- Create: `pixel-office/hooks/pane.tsx`
- Modify: `pixel-office/hooks/register.tsx` (replace the stub entirely)
- Test: `pixel-office/tests/plugin.test.ts`

**Interfaces:**
- Consumes: `emptyScene`, `MAIN`, `needsSweep`, `reduce` from `./model`; `altText`, `clockLabel`, `orgRows`, `renderOffice` from `./render`; `STATIONS`, `STATION_ORDER`, `stationFor`, `targetOf`, `todoCounts` from `./stations`.
- Produces (`state.ts`): `PANE = 'pixel-office'`, `PANE_TITLE = 'Office'`, `sceneAtom`, `legendAtom`.
- Produces (`pane.tsx`): `registerPane(on: On): void`.
- Produces (`register.tsx`): `FLUSH_MS` (350, or 1000 if Task 1 found flicker), `register: Register`.

- [ ] **Step 1: Write the failing integration tests**

`pixel-office/tests/plugin.test.ts`:
```ts
import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const SCENE = { plugin: 'pixel-office', key: 'scene' } as const
const PANE_PROPS = {
  title: 'Office',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const
const FLUSH = 1100

function world(on: On) {
  const clock = mock.clock(on, { now: new Date(2026, 9, 14, 12, 0).getTime() })
  mock.store(on)
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { isPlaced: true }
  })
  on('ui.panes', () => [])
  on('ui.close', () => undefined)
  on('command.register', () => undefined)
  on('tool.call', ($, e) => (String(e.tool) === 'Bash' ? { deny: 'not allowed' } : { result: `ran ${String(e.tool)}`, text: 'ok' }))
  on('agent.spawn', () => ({ model: 'test-model', agentId: 'agent-1' }))
  return { clock, opened }
}

const SPAWN = {
  tool_use_id: 'tu-spawn',
  prompt: 'find auth code',
  description: 'find auth code',
  subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' } as never,
  parentModel: 'test-model',
  background: false,
  fork: false,
}

test('a Read call shows in the ticker and passes through unchanged', async ($, on) => {
  const { clock } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const ran = await $.tool.call({ tool: 'Read', tool_use_id: 'tu-1', file_path: '/work/src/auth.ts' })
  expect(ran).toEqual({ result: 'ran Read', text: 'ok' })
  await clock.advance(FLUSH)
  const { value } = await $.state.get(SCENE)
  expect(value?.ticker.map(line => line.text)).toContain('Main is reading auth.ts')
})

test('a denied call passes through unchanged', async ($, on) => {
  const { clock } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const ran = await $.tool.call({ tool: 'Bash', tool_use_id: 'tu-2', command: 'rm -rf build' })
  expect(ran).toEqual({ deny: 'not allowed' })
  await clock.advance(FLUSH)
  const { value } = await $.state.get(SCENE)
  expect(value?.agents.main?.lastErrorAt).toBeNull()
})

test('a spawned subagent opens the office and appears in the drawing', async ($, on) => {
  const { clock, opened } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await clock.advance(FLUSH)
  expect(opened).toContain('pixel-office')
  const ui = await $.ui.mount({ plugin: 'pixel-office', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  const svg = await ui.find({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('id="agent-agent-1"')
  expect(await ui.find({ type: 'Text', text: /Main hired Explore: find auth code/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Explore · working · Meeting room/ })).toBeDefined()
})

test('a subagent works, hands back and leaves', async ($, on) => {
  const { clock } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await $.tool.call({ tool: 'Grep', tool_use_id: 'tu-3', pattern: 'login', agentId: 'agent-1' })
  await $.turn.complete({ answer: 'found it', durationMs: 5, isAborted: false, turnId: 'turn-1', agentId: 'agent-1', reason: 'answer' })
  await clock.advance(FLUSH)
  const { value } = await $.state.get(SCENE)
  const lines = value?.ticker.map(line => line.text) ?? []
  expect(lines).toContain('Explore searched files for login')
  expect(lines).toContain('Explore handed its report to Main and left')
  expect(value?.agents['agent-1']?.phase).toBe('gone')
})

test('a permission prompt sends Main to reception', async ($, on) => {
  const { clock } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })
  await clock.advance(FLUSH)
  const { value } = await $.state.get(SCENE)
  expect(value?.agents.main?.phase).toBe('waiting')
  expect(value?.agents.main?.station).toBe('reception')
})

test('the office command opens the pane', async ($, on) => {
  const { opened } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const ran = await $.command.run({
    command: 'office',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  expect(ran.text).toBe('Office opened.')
  expect(opened).toContain('pixel-office')
})

test('the legend opens and closes', async ($, on) => {
  world(on)
  const ui = await $.ui.mount({ plugin: 'pixel-office', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  expect(await ui.find({ type: 'Text', text: /Records library: Read/ })).toBeUndefined()
  await ui.press({ key: 'legend' })
  expect(await ui.find({ type: 'Text', text: /Records library: Read/ })).toBeDefined()
})

test('the terminal gets a text office', async ($, on) => {
  world(on)
  const ui = await $.ui.mount({ plugin: 'pixel-office', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'pixel-office' })
  expect(await ui.find({ type: 'Text', text: /desktop app/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Main: idle, Corner office/ })).toBeDefined()
})
```

Note: `FLUSH = 1100` advances past one flush even if Task 1 set `FLUSH_MS = 1000`. If the kit refuses `agentId` inside `$.tool.call`'s input, drop that test's Grep call and instead assert the hand-back lines only; record the limitation in the commit message.

- [ ] **Step 2: Run tests to verify they fail**

Run: `CC="/c/Users/bar12/AppData/Roaming/Claude/claude-code/2.1.295/d2e29494ec83/claude.exe"; "$CC" plugin test pixel-office`
Expected: FAIL in `plugin.test.ts` (the stub registers no hooks: no ticker lines, no pane drawing, no `office` command).

- [ ] **Step 3: Implement state.ts**

`pixel-office/hooks/state.ts`:
```ts
import { atom } from 'claude-code'

import { emptyScene } from './model'

export const PANE = 'pixel-office'
export const PANE_TITLE = 'Office'

export const sceneAtom = atom({ plugin: 'pixel-office', key: 'scene' } as const, emptyScene())
export const legendAtom = atom({ plugin: 'pixel-office', key: 'legendOpen' } as const, false)
```

- [ ] **Step 4: Implement pane.tsx**

`pixel-office/hooks/pane.tsx`:
```tsx
import { read, update } from 'claude-code'
import type { On } from 'claude-code'

import { altText, clockLabel, orgRows, renderOffice } from './render'
import { PANE, legendAtom, sceneAtom } from './state'
import { STATIONS, STATION_ORDER } from './stations'

const ORG_MAX = 14
const STATUS_COLOR = { working: 'green', waiting: 'yellow', idle: 'gray', done: 'gray' } as const

export function registerPane(on: On): void {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const scene = await read($, sceneAtom)
    const isLegendOpen = await read($, legendAtom)
    const now = await $.clock.now()
    const rows = orgRows(scene)
    const shown = rows.slice(0, ORG_MAX)
    const hidden = rows.length - shown.length

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text dimColor>Open this session in the Claude desktop app to see the pixel office.</Text>
          {shown.map(row => (
            <Text>
              {'  '.repeat(row.depth)}
              {row.label}: {row.status}, {row.place}
            </Text>
          ))}
          {scene.ticker.map(line => (
            <Text dimColor>
              {clockLabel(line.at)} {line.text}
            </Text>
          ))}
        </Box>
      )
    }

    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    const orgWidth = Math.max(24, Math.min(40, Math.floor(e.props.bodyColumns / 2)))
    return (
      <Box flexDirection="column" gap={1}>
        <Svg source={renderOffice(scene, now)} alt={altText(scene)} isInteractive={true} />
        <Box flexDirection="row" gap={2}>
          <Box key="ticker" flexDirection="column" flexGrow={1}>
            <Text bold>What's happening</Text>
            {scene.ticker.length === 0 && <Text dimColor>Quiet so far. Agents appear as they start working.</Text>}
            {scene.ticker.map(line => (
              <Text wrap="truncate-end">
                {clockLabel(line.at)} {line.text}
              </Text>
            ))}
          </Box>
          <Box key="org" flexDirection="column" width={orgWidth}>
            <Text bold>Who reports to whom</Text>
            {shown.map(row => (
              <Text color={STATUS_COLOR[row.status]} dimColor={row.status === 'done'} wrap="truncate-end">
                {'  '.repeat(row.depth)}
                {row.label} · {row.status} · {row.place}
              </Text>
            ))}
            {hidden > 0 && <Text dimColor>+{hidden} more</Text>}
          </Box>
        </Box>
        <Button
          key="legend"
          label={isLegendOpen ? 'Hide legend' : 'Show legend'}
          onPress={() => update($, legendAtom, isOpen => !isOpen)}
        />
        {isLegendOpen && (
          <Box key="legend-list" flexDirection="column">
            {STATION_ORDER.map(id => (
              <Text color={STATIONS[id].color}>
                ■ {STATIONS[id].name}: {STATIONS[id].tools}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
```

- [ ] **Step 5: Implement register.tsx**

Replace `pixel-office/hooks/register.tsx` entirely:
```tsx
import { read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { OfficeEvent } from '../types'
import { MAIN, needsSweep, reduce } from './model'
import { registerPane } from './pane'
import { PANE, PANE_TITLE, sceneAtom } from './state'
import { stationFor, targetOf, todoCounts } from './stations'

export const FLUSH_MS = 350
const SWEEP_EVERY = 15
const QUEUE_MAX = 500
const UNTRACKED = new Set(['Agent', 'Task'])

const quietly = async (work: () => Promise<void> | void): Promise<void> => {
  try {
    await work()
  } catch {
    // The office is best effort: it never disturbs the session it watches.
  }
}

export const register: Register = (on, options) => {
  const autoOpen = String(options.autoOpen ?? 'on-first-subagent')
  let queue: OfficeEvent[] = []
  let isFlushing = false
  let flushes = 0
  let isOpened = false

  const push = (ev: OfficeEvent): void => {
    queue.push(ev)
    if (queue.length > QUEUE_MAX) queue = queue.slice(-QUEUE_MAX)
  }

  const openPane = async ($: EngineInterface): Promise<void> => {
    isOpened = true
    await $.ui.open({ id: PANE, title: PANE_TITLE })
  }

  const flush = async ($: EngineInterface): Promise<void> => {
    if (isFlushing) return
    isFlushing = true
    await quietly(async () => {
      flushes += 1
      const now = await $.clock.now()
      const batch = queue
      queue = []
      const isSweepTurn = flushes % SWEEP_EVERY === 0
      if (batch.length === 0 && !(isSweepTurn && needsSweep(await read($, sceneAtom), now))) return
      await update($, sceneAtom, scene => {
        const applied = batch.reduce(reduce, scene)
        return isSweepTurn && needsSweep(applied, now) ? reduce(applied, { kind: 'tick', at: now }) : applied
      })
    })
    isFlushing = false
  }

  on('session.start', async ($, e, next) => {
    await quietly(async () => {
      await $.command.register({ name: 'office', description: 'Show or hide the pixel office' })
      $.clock.every(FLUSH_MS, () => {
        void flush($)
      })
      if (autoOpen === 'session-start') await openPane($)
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const agentId = (e as unknown as { agentId?: string }).agentId ?? MAIN
    const callId = e.tool_use_id
    const isTracked = !UNTRACKED.has(tool)
    if (isTracked) {
      await quietly(async () => {
        const input = e as unknown as Record<string, unknown>
        const at = await $.clock.now()
        push({ kind: 'toolStarted', agentId, tool, target: targetOf(tool, input), callId, at })
        const counts = stationFor(tool) === 'taskboard' ? todoCounts(input) : null
        if (counts !== null) push({ kind: 'todos', ...counts, at })
      })
    }
    const ran = await next(e)
    if (isTracked) {
      await quietly(async () => {
        const isError = ran.deny === undefined && ran.isError === true
        push({ kind: 'toolEnded', agentId, callId, isError, at: await $.clock.now() })
      })
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    await quietly(async () => {
      if (spawned.deny !== undefined || spawned.agentId === undefined) return
      push({
        kind: 'spawned',
        id: spawned.agentId,
        parentId: e.parentAgentId ?? MAIN,
        type: e.subagentType,
        description: e.description,
        name: e.name ?? null,
        isTeammate: e.isTeammate === true,
        at: await $.clock.now(),
      })
      if (autoOpen === 'on-first-subagent' && !isOpened) await openPane($)
    })
    return spawned
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    await quietly(async () => push({ kind: 'turnStarted', at: await $.clock.now() }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    await quietly(async () => {
      if (e.agentId !== undefined) push({ kind: 'handedBack', agentId: e.agentId, at: await $.clock.now() })
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PermissionRequest', async ($, e, next) => {
    await quietly(async () => {
      const agentId = (e as unknown as { agent_id?: string }).agent_id ?? null
      push({ kind: 'waiting', agentId, tool: e.tool_name, at: await $.clock.now() })
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'office' }, async $ => {
    const panes = await $.ui.panes()
    if (panes.some(pane => pane.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: 'Office closed.' }
    }
    await openPane($)
    return { text: 'Office opened.' }
  })

  registerPane(on)
}
```

If Task 1 found visible flicker, change `FLUSH_MS` to `1000` and `SWEEP_EVERY` to `5`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `CC="/c/Users/bar12/AppData/Roaming/Claude/claude-code/2.1.295/d2e29494ec83/claude.exe"; "$CC" plugin test pixel-office`
Expected: PASS, all test files.

- [ ] **Step 7: Validate the mod**

Run: `CC="/c/Users/bar12/AppData/Roaming/Claude/claude-code/2.1.295/d2e29494ec83/claude.exe"; "$CC" plugin validate --strict pixel-office`
Expected: valid; hooks listed: `session.start`, `tool.call`, `agent.spawn`, `turn.start`, `turn.complete`, `classic.PermissionRequest`, `command.run`, `ui.render`; state keys `pixel-office/scene` and `pixel-office/legendOpen`; `command.run` reported as answering its own command. Gating hooks listed "with .catch" are expected.

- [ ] **Step 8: Commit**

```bash
git add pixel-office/hooks/state.ts pixel-office/hooks/pane.tsx pixel-office/hooks/register.tsx pixel-office/tests/plugin.test.ts
git commit -m "feat: wire hooks, pane and office command

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Install at user scope, README, manual verification

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Create: `README.md`
- Create (outside the mod, not committed): `tsconfig.typecheck.json`

**Interfaces:**
- Consumes: the finished `pixel-office/` mod.
- Produces: an installed `pixel-office@pixel-office-local` that loads in every new session.

- [ ] **Step 1: Type-check the whole mod**

Find this build's declaration file: load the `plugin-authoring` skill and read its "WHERE THE TYPES ARE" path (it looks like `C:/Users/bar12/AppData/Local/Temp/claude/bundled-skills/2.1.295/<hash>/plugin-authoring/types/claude-code.d.ts`). Write `tsconfig.typecheck.json` at the repo root with that path:
```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023"],
    "types": [],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "jsx": "react",
    "jsxFactory": "h",
    "jsxFragmentFactory": "Fragment"
  },
  "files": ["<the claude-code.d.ts path from the skill>"],
  "include": ["pixel-office/hooks", "pixel-office/types", "pixel-office/tests"]
}
```
Run: `npx -y -p typescript@5.6.3 tsc -p tsconfig.typecheck.json`
Expected: no errors. Fix real type errors in the mod's code; for an engine shape the plan guessed wrong (for example a bottom-hook return type in `plugin.test.ts`), match the declaration and re-run tests. Add `tsconfig.typecheck.json` to `.gitignore` (its path is machine- and session-specific).

- [ ] **Step 2: Write the marketplace file**

`.claude-plugin/marketplace.json`:
```json
{
  "name": "pixel-office-local",
  "owner": { "name": "local" },
  "plugins": [{ "name": "pixel-office", "source": "./pixel-office" }]
}
```

Run: `CC="/c/Users/bar12/AppData/Roaming/Claude/claude-code/2.1.295/d2e29494ec83/claude.exe"; "$CC" plugin validate "D:/Claude/Pixel Office"`
Expected: the marketplace, manifest and hooks module all valid.

- [ ] **Step 3: Write the README**

`README.md`:
````markdown
# Pixel Office

A Claude Code mod that draws a live pixel-art office in the Claude desktop app. Every agent in the session is a character: Main works from the corner office, subagents arrive by elevator, get briefed in the meeting room, walk to the station that matches the tool they are using, hand their report back and leave.

## Stations

| Zone | Stands for |
|---|---|
| Corner office | Main's home base; thinking between tools |
| Desks | Edit, Write, NotebookEdit |
| Records library | Read, Grep, Glob, LSP, Skill, ToolSearch |
| Phone booths | WebFetch, WebSearch |
| Mailroom | Outside services (`mcp__` tools) |
| Server room | Bash, PowerShell, background shells |
| Meeting room | Briefings, SendMessage |
| Task board | TodoWrite, Task tools, plan updates |
| Reception | Waiting on you: questions, permissions, plan approval |
| Elevator | Agents arrive and leave |
| Break room | Idle agents |

Below the office: a plain-English feed of what just happened, an org chart of who reports to whom, and a legend. Hover a character for its task, current tool and time on the job.

## Install

From a terminal, once:

```bash
claude plugin marketplace add "D:\Claude\Pixel Office"
claude plugin install pixel-office@pixel-office-local
```

Then start a new session. The office opens the first time a subagent is hired, or any time with `/office`.

## Options

`autoOpen`: `on-first-subagent` (default), `session-start`, or `never`. Change it in `/config`.

## Develop

```bash
claude plugin test pixel-office
claude plugin validate --strict pixel-office
```

Use Claude Code 2.1.295 or newer for `plugin test`. Because the marketplace is this folder, edits reach new sessions without reinstalling; run `/reload-plugins` in a terminal session to pick them up there.
````

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/marketplace.json README.md .gitignore
git commit -m "feat: make the repo a local marketplace and document install

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Install at user scope**

Run: `CC="/c/Users/bar12/AppData/Roaming/Claude/claude-code/2.1.295/d2e29494ec83/claude.exe"; "$CC" plugin marketplace add "D:/Claude/Pixel Office"`
Expected: marketplace `pixel-office-local` added.

Run: `CC="/c/Users/bar12/AppData/Roaming/Claude/claude-code/2.1.295/d2e29494ec83/claude.exe"; "$CC" plugin install --help`, then install with the user scope it offers (user is the default), for example: `"$CC" plugin install pixel-office@pixel-office-local`
Expected: `Installed pixel-office`. Then `"$CC" plugin list` shows it with `Read from: D:\Claude\Pixel Office\pixel-office`.

- [ ] **Step 6: Manual verification with the person**

The person starts a new desktop Code session in any project folder and sends:

> Use two Explore subagents in parallel: one lists the files in this folder, the other reads the README if there is one. Then summarize what you found.

Checklist to confirm with the person:
1. The office pane opens when the first subagent is hired.
2. Two characters come out of the elevator and walk to the meeting room; the whiteboard shows a task description; Main walks over.
3. The subagents walk to the records library; bubbles show file names; Main returns to the corner office.
4. Each subagent walks to Main's desk and then back to the elevator and disappears.
5. The feed shows lines such as "Main hired Explore: …", "Explore is reading …", "Explore handed its report to Main and left".
6. The org chart shows both under Main, ending as "done · left".
7. Hovering a character shows its tooltip.
8. A prompt that makes Claude run a command needing permission sends Main to reception with a blinking bubble until the prompt is answered.
9. `/office` closes and reopens the pane.

Record anything that did not match as follow-up notes in `docs/superpowers/notes/2026-10-14-svg-spike.md` under a "Manual verification" heading and commit:

```bash
git add docs/superpowers/notes/2026-10-14-svg-spike.md
git commit -m "docs: record manual verification of the installed office

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
