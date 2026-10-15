import { HEIGHT, WIDTH } from './stations'

// The office cat. It has nothing to do with the session: it patrols the corridor, sits for a while at a few
// favourite spots, and naps on the break-room couch, on a loop of about a minute and a half. The whole loop is
// drawn as animations inside the picture, so the cat costs no redraws, and it picks the loop up at the same moment
// whenever the picture is drawn again, so it never jumps back to the start.

type Stop = { x: number; y: number; stay?: number; pose?: 'sit' | 'nap' }

// Where it goes, in order, then back to the first. Everything is on open floor: the corridor, the break room's
// floor and the rug, never behind a desk or a wall.
export const ROUTE: readonly Stop[] = [
  { x: 74, y: 84 },
  { x: 108, y: 83, stay: 6 },
  { x: 146, y: 83 },
  { x: 168, y: 91, stay: 4 },
  { x: 146, y: 93 },
  { x: 116, y: 90, stay: 3 },
  { x: 90, y: 88 },
  { x: 66, y: 86 },
  { x: 46, y: 86 },
  { x: 30, y: 88 },
  { x: 17, y: 94, stay: 30, pose: 'nap' },
  { x: 30, y: 88 },
  { x: 50, y: 86 },
]

// Units a second.
export const PACE = 14

const FUR = '#d9822b'
const STRIPE = '#a85a1a'
const LIGHT = '#f5d9a8'
const EYE = '#2c2c2a'
const NOSE = '#e8a0a0'

const n = (v: number): number => Math.round(v * 1000) / 1000
const px = (x: number, y: number, w: number, h: number, fill: string): string => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`

// Facing right, its feet at the origin. A leg pair lifts a pixel on alternate beats.
function walking(): string {
  const leg = (x: number, begin: number): string =>
    `<g>${px(x, -1, 1, 1, STRIPE)}<animateTransform attributeName="transform" type="translate" calcMode="discrete" values="0,0;0,-1" keyTimes="0;0.5" dur="0.4s" begin="${begin}s" repeatCount="indefinite"/></g>`
  return (
    px(-5, -9, 1, 5, STRIPE) +
    px(-4, -5, 8, 3, FUR) +
    px(-3, -5, 1, 2, STRIPE) +
    px(-1, -5, 1, 2, STRIPE) +
    px(1, -5, 1, 2, STRIPE) +
    px(3, -7, 4, 4, FUR) +
    px(3, -8, 1, 1, FUR) +
    px(6, -8, 1, 1, FUR) +
    px(5, -6, 1, 1, EYE) +
    px(7, -5, 1, 1, NOSE) +
    px(3, -4, 2, 1, LIGHT) +
    leg(-4, 0) +
    leg(-2, 0.2) +
    leg(2, 0.2) +
    leg(4, 0)
  )
}

function sitting(): string {
  return (
    px(-1, -6, 5, 6, FUR) +
    px(0, -6, 1, 3, STRIPE) +
    px(2, -6, 1, 3, STRIPE) +
    px(0, -10, 4, 4, FUR) +
    px(0, -11, 1, 1, FUR) +
    px(3, -11, 1, 1, FUR) +
    px(1, -9, 1, 1, EYE) +
    px(3, -9, 1, 1, EYE) +
    px(2, -8, 1, 1, NOSE) +
    px(1, -3, 3, 3, LIGHT) +
    px(4, -1, 4, 1, STRIPE) +
    px(7, -2, 1, 1, STRIPE)
  )
}

// Curled up on the couch, with a few z's that float up and fade.
function napping(): string {
  const z = (x: number, begin: number): string =>
    `<text x="${x}" y="-5" font-size="3" fill="#ffffff" stroke="#2c2c2a" stroke-width="0.4" paint-order="stroke" opacity="0">z` +
    `<animate attributeName="opacity" values="0;1;0" dur="2.4s" begin="${begin}s" repeatCount="indefinite"/>` +
    `<animateTransform attributeName="transform" type="translate" values="0,0;1,-5" dur="2.4s" begin="${begin}s" repeatCount="indefinite"/></text>`
  return (
    px(-5, -4, 10, 4, FUR) +
    px(-3, -4, 1, 2, STRIPE) +
    px(0, -4, 1, 2, STRIPE) +
    px(-5, -1, 4, 1, STRIPE) +
    px(3, -4, 4, 3, FUR) +
    px(3, -5, 1, 1, FUR) +
    px(6, -5, 1, 1, FUR) +
    px(5, -3, 1, 1, EYE) +
    px(4, -1, 3, 1, LIGHT) +
    z(6, 0) +
    z(8, 0.8)
  )
}

type Phase = { start: number; kind: 'walk' | 'sit' | 'nap'; dir: 1 | -1 }

// The loop: when each stretch of walking or resting begins, which way the cat faces, and how far along its path
// it is at each of those moments.
export function timeline(): { phases: Phase[]; points: Array<{ at: number; along: number }>; cycle: number; length: number } {
  const phases: Phase[] = []
  const points: Array<{ at: number; along: number }> = [{ at: 0, along: 0 }]
  const legs = ROUTE.map((from, i) => {
    const to = ROUTE[(i + 1) % ROUTE.length] as Stop
    return { from, to, length: Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2) }
  })
  const length = legs.reduce((sum, l) => sum + l.length, 0)
  let at = 0
  let along = 0
  for (const leg of legs) {
    const dir = leg.to.x >= leg.from.x ? 1 : -1
    phases.push({ start: at, kind: 'walk', dir })
    at += leg.length / PACE
    along += leg.length
    points.push({ at, along })
    if (leg.to.stay !== undefined) {
      phases.push({ start: at, kind: leg.to.pose ?? 'sit', dir })
      at += leg.to.stay
      points.push({ at, along })
    }
  }
  return { phases, points, cycle: at, length }
}

export function petSvg(now: number): string {
  const { phases, points, cycle, length } = timeline()
  const fraction = (t: number): number => n(t / cycle)
  const motionTimes = points.map((p, i) => (i === points.length - 1 ? 1 : fraction(p.at))).join(';')
  const motionPoints = points.map((p, i) => (i === points.length - 1 ? 1 : n(p.along / length))).join(';')
  const path = `M${ROUTE.map(s => `${s.x},${s.y}`).join(' L')} L${(ROUTE[0] as Stop).x},${(ROUTE[0] as Stop).y}`
  const starts = phases.map(p => fraction(p.start)).join(';')
  // Where in the loop it is, from the local time of day: the same moment gives the same picture in any time zone,
  // and the loop runs on unbroken through the day.
  const day = new Date(now)
  const sinceMidnight = ((day.getHours() * 60 + day.getMinutes()) * 60 + day.getSeconds()) * 1000 + day.getMilliseconds()
  const begin = `-${n((sinceMidnight % (cycle * 1000)) / 1000)}s`
  const loop = `dur="${n(cycle)}s" begin="${begin}" repeatCount="indefinite"`
  const shown = (kind: Phase['kind']): string =>
    `<animate attributeName="opacity" calcMode="discrete" keyTimes="${starts}" values="${phases.map(p => (p.kind === kind ? 1 : 0)).join(';')}" ${loop}/>`
  return (
    '<g id="po-pet"><title>The office cat</title>' +
    `<g><animateMotion path="${path}" keyPoints="${motionPoints}" keyTimes="${motionTimes}" calcMode="linear" ${loop}/>` +
    `<g><animateTransform attributeName="transform" type="scale" calcMode="discrete" keyTimes="${starts}" values="${phases.map(p => (p.dir === 1 ? '1 1' : '-1 1')).join(';')}" ${loop}/>` +
    `<g opacity="0">${shown('walk')}${walking()}</g>` +
    `<g opacity="0">${shown('sit')}${sitting()}</g>` +
    `<g opacity="0">${shown('nap')}${napping()}</g>` +
    '</g></g></g>'
  )
}

// The floor the cat may walk on, for the tests: inside the picture and below the top wall.
export const FLOOR = { x0: 0, x1: WIDTH, y0: 10, y1: HEIGHT }
