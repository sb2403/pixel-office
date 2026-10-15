import type { Carry, Look, StationId } from '../types'

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
  // A stride: each leg swings forward lifted, plants, swings back, and the other leg does the same half a step
  // later, in whole pixels so it stays crisp. The body rises a pixel on each step.
  const leg = (x: number, begin: number): string => {
    const rects =
      `<rect x="${x}" y="10" width="1" height="1" fill="${PANTS}"/>` +
      `<rect x="${x}" y="11" width="1" height="1" fill="${SHOES}"/>`
    if (walkMs <= 0) return rects
    return (
      `<g>${rects}<animateTransform attributeName="transform" type="translate" calcMode="discrete" ` +
      `values="0,0;1,-1;1,0;0,0;-1,0;-1,0" keyTimes="0;0.17;0.34;0.5;0.67;0.84" dur="0.6s" begin="${begin}s" repeatDur="${walkMs}ms"/></g>`
    )
  }
  const body = (inner: string): string =>
    walkMs <= 0
      ? inner
      : `<g>${inner}<animateTransform attributeName="transform" type="translate" calcMode="discrete" values="0,0;0,-1" keyTimes="0;0.5" dur="0.3s" repeatDur="${walkMs}ms"/></g>`
  const ground = '<rect x="-4" y="-1" width="8" height="2" fill="#000000" fill-opacity="0.22"/><rect x="-3" y="1" width="6" height="1" fill="#000000" fill-opacity="0.14"/>'
  return `${ground}<g transform="translate(-4,-12)">${body(rle(BODY[variant], colors))}${leg(2, 0)}${leg(5, 0.3)}</g>`
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

// What an agent carries to another agent, held in front of its body: a manila folder for a report, an
// envelope for a message.
const ITEMS: Record<Carry['item'], { grid: Grid; colors: Readonly<Record<string, string>> }> = {
  report: { grid: ['tt...', 'fffff', 'fffff', 'fffff'], colors: { t: '#ba7517', f: '#fac775' } },
  message: { grid: ['wwwww', 'gwwwg', 'wgwgw', 'wwgww'], colors: { w: '#ffffff', g: '#888780' } },
}

export function itemSvg(item: Carry['item'], x: number, y: number): string {
  return rle(ITEMS[item].grid, ITEMS[item].colors, x, y)
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
