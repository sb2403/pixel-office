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
