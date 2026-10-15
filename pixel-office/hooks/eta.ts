import type { Agent, Scene } from '../types'
import { MAIN } from './model'

// How long a helper of this kind usually takes, from the helpers of the same kind that already handed in a
// report in this office. It is a guess from what happened earlier, so it needs two examples to say anything, and
// it never says when a helper is "due": only how long its predecessors took.
export const MIN_SAMPLES = 2

export type Eta = { typicalMs: number; samples: number; leftMs: number }

const isOut = (a: Agent): boolean => a.phase === 'arriving' || a.phase === 'briefing' || a.phase === 'working'

export function etaOf(scene: Scene, agent: Agent, now: number): Eta | null {
  // A background helper counts: the Agent tool starts helpers in the background by default, and those are the ones
  // worth an estimate. A teammate is a standing colleague, not an errand.
  if (agent.id === MAIN || agent.isTeammate || !isOut(agent)) return null
  const took = Object.values(scene.agents)
    .filter(a => a.id !== agent.id && a.type === agent.type && a.phase === 'gone' && a.outcome === 'reported' && !a.isTeammate && a.goneAt !== null)
    // To the moment it handed its report in: `goneAt` is later by the walk out to the elevator.
    .map(a => (a.goneAt ?? 0) - (a.walk?.durationMs ?? 0) - a.arrivedAt)
    .filter(ms => ms >= 1000)
    .sort((x, y) => x - y)
  if (took.length < MIN_SAMPLES) return null
  const middle = Math.floor(took.length / 2)
  const typicalMs = took.length % 2 === 1 ? (took[middle] as number) : ((took[middle - 1] as number) + (took[middle] as number)) / 2
  return { typicalMs, samples: took.length, leftMs: typicalMs - (now - agent.arrivedAt) }
}

const span = (ms: number): string => {
  const secs = Math.max(1, Math.round(ms / 1000))
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  return secs % 60 === 0 || mins >= 10 ? `${mins}m` : `${mins}m ${secs % 60}s`
}

// "about 20s left", or a plain admission that this one is past what its predecessors took.
export function etaWords(eta: Eta): string {
  return eta.leftMs > 1000 ? `about ${span(eta.leftMs)} left` : 'taking longer than usual'
}

export function etaDetail(eta: Eta): string {
  return `Expected: usually about ${span(eta.typicalMs)} (from ${eta.samples} similar helpers), so ${etaWords(eta)}`
}
