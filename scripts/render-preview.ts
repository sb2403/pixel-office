// Regenerates the pictures in the README (docs/images/*.svg) from the mod's own drawing code.
//
//   npx -y tsx scripts/render-preview.ts        (run from the repository root)
//
// It replays a made-up session through the same pure modules the mod uses (model, narrate, render,
// stations), so the pictures cannot drift from what the mod really draws. Nothing here is loaded by the
// plugin, because it lives outside pixel-office/. The output is deterministic: a fixed local date and
// time, no randomness. Run it again and commit the changed images whenever the drawing code or the demo
// story changes.
//
// Files written:
//   docs/images/office.svg        the animated office, exactly as the mod draws it
//   docs/images/office-map.svg    the same office with a label on every zone
//   docs/images/pane-preview.svg  the whole pane: office, feed, org chart, details box, legend button

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { MAIN, emptyScene, isWalkingAt, reduce } from '../pixel-office/hooks/model'
import { agentDetails, clockLabel, escapeXml, objectiveLine, orgRows, renderOffice } from '../pixel-office/hooks/render'
import { HEIGHT, STATIONS, STATION_ORDER, WIDTH, clip, slotPoint } from '../pixel-office/hooks/stations'
import type { OfficeEvent, Scene, StationId } from '../pixel-office/types'

// ---------------------------------------------------------------------------------------------------
// The demo story. Daytime, so the windows show sky. Times are seconds after 11:00 local time.
// ---------------------------------------------------------------------------------------------------

const T0 = new Date(2026, 9, 14, 11, 0, 0).getTime()
const at = (seconds: number): number => T0 + Math.round(seconds * 1000)

const EXPLORE = 'explore-1'
const PLAN = 'plan-1'
const TESTER = 'tester-1'
const FIXER = 'fixer-1'

const spawn = (id: string, type: string, description: string, seconds: number): OfficeEvent => ({
  kind: 'spawned',
  id,
  parentId: MAIN,
  type,
  description,
  name: null,
  isTeammate: false,
  at: at(seconds),
})
const begin = (agentId: string, tool: string, target: string, callId: string, seconds: number): OfficeEvent => ({
  kind: 'toolStarted',
  agentId,
  tool,
  target,
  callId,
  at: at(seconds),
})
const finish = (agentId: string, callId: string, seconds: number): OfficeEvent => ({
  kind: 'toolEnded',
  agentId,
  callId,
  isError: false,
  at: at(seconds),
})

const STORY: OfficeEvent[] = [
  { kind: 'turnStarted', isContinuation: false, at: at(0) },
  // Main plans the work on the task board, then the sweep sends it back to the corner office.
  begin(MAIN, 'TodoWrite', '', 'todo-1', 3),
  { kind: 'todos', done: 2, open: 3, at: at(3) },
  finish(MAIN, 'todo-1', 5),
  { kind: 'tick', at: at(15) },
  // Three helpers, each hired with a clear objective, each briefed and then sent to the right station.
  spawn(EXPLORE, 'Explore', 'find the login code', 20),
  begin(EXPLORE, 'Read', 'auth.ts', 'read-1', 24),
  // Main reads a file of its own in the library while the next helper is hired. It still has that tool
  // open, so it stays put instead of walking to the meeting room, and the helper that arrives next queues
  // one place further along (two speech bubbles do not sit on top of each other). The sweep sends Main
  // home afterwards.
  begin(MAIN, 'Read', 'package.json', 'read-2', 30),
  spawn(PLAN, 'Plan', 'design the fix', 40),
  begin(PLAN, 'Grep', 'session', 'grep-1', 44),
  finish(MAIN, 'read-2', 52),
  { kind: 'tick', at: at(62) },
  spawn(TESTER, 'general-purpose', 'run the test suite', 70),
  begin(TESTER, 'Bash', 'npm test', 'bash-1', 74),
  // Main writes up notes at its own desk (the printer in the desk area starts to print).
  begin(MAIN, 'Write', 'notes.md', 'write-1', 100),
  // A fourth helper has just been hired. It is still walking in from the elevator, so the whiteboard already
  // shows its objective. Main is busy, so it does not walk over.
  spawn(FIXER, 'general-purpose', 'fix the login bug', 125),
]

// A moment 0.6 seconds after the last hire, while that walk is still under way.
const NOW = at(125.6)

const scene: Scene = STORY.reduce(reduce, emptyScene())

function expect(isTrue: boolean, message: string): void {
  if (!isTrue) throw new Error(`The demo scene no longer shows what the README describes: ${message}`)
}

function checkScene(s: Scene): void {
  const agent = (id: string) => {
    const found = s.agents[id]
    if (found === undefined) throw new Error(`The demo scene has no agent ${id}`)
    return found
  }
  const explore = agent(EXPLORE)
  const plan = agent(PLAN)
  const tester = agent(TESTER)
  const fixer = agent(FIXER)
  const main = agent(MAIN)
  expect(explore.station === 'library' && explore.activity?.target === 'auth.ts', 'Explore reads auth.ts in the library')
  expect(plan.station === 'library' && plan.activity?.target === 'session', 'Plan searches in the library')
  expect(tester.station === 'server' && tester.activity?.target === 'npm test', 'the tester runs npm test in the server room')
  expect([explore, plan, tester].every(a => !isWalkingAt(a, NOW)), 'the three working helpers are settled at their stations')
  expect(fixer.phase === 'briefing' && fixer.station === 'meeting' && isWalkingAt(fixer, NOW), 'the newest helper is walking to the meeting room')
  expect(main.station === 'office' && main.activity?.target === 'notes.md' && !isWalkingAt(main, NOW), 'Main is working at the corner office')
  expect(plan.slot - explore.slot >= 2, 'the two library helpers stand far enough apart for both speech bubbles to read')
  expect(s.briefing === 'fix the login bug', 'the whiteboard shows the newest objective')
  expect(s.todos !== null && s.todos.done > 0 && s.todos.open > 0, 'the task board has done and open notes')
  expect(s.ticker.length >= 6, 'the feed has a few lines')
}

checkScene(scene)

// ---------------------------------------------------------------------------------------------------
// Checks that a generated file is well-formed XML: tags balance, attributes are quoted, no stray `&` or
// control characters, no duplicate ids. Not a full parser, but enough to catch what a drawing bug produces.
// ---------------------------------------------------------------------------------------------------

function assertWellFormed(name: string, xml: string): void {
  const problems: string[] = []
  if (!xml.startsWith('<svg ')) problems.push('does not start with <svg')
  if (!xml.endsWith('</svg>')) problems.push('does not end with </svg>')
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/.test(xml)) problems.push('contains a character XML does not allow')
  const tag = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[A-Za-z_:][\w:.-]*="[^"<]*")*)\s*(\/?)>/y
  const badAmp = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/
  const stack: string[] = []
  const ids = new Set<string>()
  let i = 0
  while (i < xml.length && problems.length === 0) {
    if (xml[i] === '<') {
      tag.lastIndex = i
      const m = tag.exec(xml)
      if (m === null) {
        problems.push(`unreadable tag near: ${xml.slice(i, i + 60)}`)
        break
      }
      const [whole, closing = '', tagName = '', attrs = '', selfClosing = ''] = m
      if (badAmp.test(attrs)) problems.push(`stray & in attributes of <${tagName}>`)
      for (const id of attrs.matchAll(/\sid="([^"]*)"/g)) {
        const value = id[1] ?? ''
        if (ids.has(value)) problems.push(`duplicate id ${value}`)
        ids.add(value)
      }
      if (closing === '/') {
        if (stack.pop() !== tagName) problems.push(`</${tagName}> closes the wrong element`)
      } else if (selfClosing === '') {
        stack.push(tagName)
      }
      i += whole.length
    } else {
      const next = xml.indexOf('<', i)
      const text = xml.slice(i, next === -1 ? xml.length : next)
      if (badAmp.test(text)) problems.push(`stray & in text near: ${text.slice(0, 40)}`)
      i += text.length
    }
  }
  if (problems.length === 0 && stack.length > 0) problems.push(`unclosed elements: ${stack.join(', ')}`)
  if (problems.length > 0) throw new Error(`${name} is not well-formed: ${problems.join('; ')}`)
}

// ---------------------------------------------------------------------------------------------------
// office-map.svg: the office with one small label per zone, placed near that zone's slots.
// ---------------------------------------------------------------------------------------------------

const LABEL_FONT = 4.4
const LABEL_CHAR = LABEL_FONT * 0.6
const LABEL_PAD = 2.6
const LABEL_HEIGHT = 7.2

// Where each label sits, as a shift from the middle of the zone's slots. The shifts keep a label on bare
// floor or on the furniture that names the zone, and clear of the labels beside it.
const LABEL_SHIFT: Record<StationId, { dx: number; dy: number }> = {
  office: { dx: 4, dy: -28 },
  desk: { dx: 0, dy: 23 },
  library: { dx: 2, dy: -20 },
  phone: { dx: -6, dy: -5 },
  mailroom: { dx: 0, dy: -19 },
  server: { dx: 0, dy: -27 },
  meeting: { dx: 0, dy: -8 },
  taskboard: { dx: 1, dy: -6 },
  reception: { dx: 0, dy: -16 },
  elevator: { dx: 0, dy: -16 },
  breakroom: { dx: 0, dy: 0.6 },
}

type Box = { id: StationId; x: number; y: number; w: number; h: number; text: string; color: string }

function labelBoxes(): Box[] {
  return STATION_ORDER.map(id => {
    const { name, color, slots } = STATIONS[id]
    const points = slots.map((_, slot) => slotPoint(id, slot))
    const mid = {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    }
    const shift = LABEL_SHIFT[id]
    const w = name.length * LABEL_CHAR + 2 * LABEL_PAD
    const cx = Math.min(Math.max(mid.x + shift.dx, 3 + w / 2), WIDTH - 3 - w / 2)
    const cy = mid.y + shift.dy
    return { id, x: cx - w / 2, y: cy - LABEL_HEIGHT / 2, w, h: LABEL_HEIGHT, text: name, color }
  })
}

function checkLabels(boxes: Box[]): void {
  for (const [i, a] of boxes.entries()) {
    expect(a.x >= 0 && a.y >= 10 && a.x + a.w <= WIDTH && a.y + a.h <= HEIGHT, `the ${a.text} label stays inside the office`)
    for (const b of boxes.slice(i + 1)) {
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
      expect(apart, `the ${a.text} and ${b.text} labels do not overlap`)
    }
  }
}

const r2 = (v: number): number => Math.round(v * 100) / 100

function labelSvg(box: Box): string {
  const cx = box.x + box.w / 2
  const baseline = box.y + box.h / 2 + LABEL_FONT * 0.35
  return (
    `<g><rect x="${r2(box.x)}" y="${r2(box.y)}" width="${r2(box.w)}" height="${r2(box.h)}" rx="1.8" ` +
    `fill="${box.color}" stroke="#2c2c2a" stroke-width="0.7"/>` +
    `<text x="${r2(cx)}" y="${r2(baseline)}" font-size="${LABEL_FONT}" font-weight="bold" text-anchor="middle" ` +
    `fill="#ffffff" stroke="#2c2c2a" stroke-width="0.9" stroke-linejoin="round" paint-order="stroke">${escapeXml(box.text)}</text></g>`
  )
}

function withTitle(svg: string, title: string, description: string): string {
  const result = svg.replace(/^(<svg [^>]*>)/, `$1<title>${escapeXml(title)}</title><desc>${escapeXml(description)}</desc>`)
  expect(result !== svg, 'the picture has a root <svg> tag to put a title on')
  return result
}

function officeMap(now: number): string {
  const boxes = labelBoxes()
  checkLabels(boxes)
  const labels =
    '<g shape-rendering="geometricPrecision" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">' +
    boxes.map(labelSvg).join('') +
    '</g>'
  // Only Main is in the office, resting in the corner office, so the zones are easy to see.
  const base = renderOffice(emptyScene(), now)
  expect(base.endsWith('</svg>'), 'the office drawing ends with </svg>')
  return withTitle(
    `${base.slice(0, -'</svg>'.length)}${labels}</svg>`,
    'Map of the Pixel Office',
    `The office with each zone labelled: ${boxes.map(b => b.text).join(', ')}.`,
  )
}

// ---------------------------------------------------------------------------------------------------
// pane-preview.svg: what the whole pane looks like, drawn as one picture.
// ---------------------------------------------------------------------------------------------------

const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"

const INK = '#2c2c2a'
const DIM = '#77736a'
const FAINT = '#a39f93'
const LINE = '#d8d4c8'
const ACCENT = '#d97757'
const STATUS_INK = { working: '#2f7d32', waiting: '#a06a00', idle: DIM, done: FAINT } as const

const W = 880
const PAD = 16
const OFFICE_W = W - PAD * 2
const OFFICE_H = Math.round((OFFICE_W * HEIGHT) / WIDTH)
const OFFICE_Y = 52
const COLS_Y = OFFICE_Y + OFFICE_H + 26
const RIGHT_X = 440
const INDENT = 16

const txt = (x: number, y: number, body: string, attrs = ''): string =>
  `<text x="${r2(x)}" y="${r2(y)}"${attrs}>${escapeXml(body)}</text>`

// A numbered marker that the README's "Reading the panel" list refers to.
const badge = (n: number, x: number, y: number): string =>
  `<g><circle cx="${x}" cy="${y}" r="10.5" fill="${ACCENT}" stroke="#ffffff" stroke-width="1.5"/>` +
  `<text x="${x}" y="${y + 4.3}" font-family="${SANS}" font-size="12" font-weight="bold" text-anchor="middle" fill="#ffffff">${n}</text></g>`

function panePreview(s: Scene, now: number, selectedId: string): string {
  const office = renderOffice(s, now)
  const sized = office.replace(/^<svg /, `<svg x="${PAD}" y="${OFFICE_Y}" `).replace(/ width="\d+" height="\d+"/, ` width="${OFFICE_W}" height="${OFFICE_H}"`)
  expect(sized !== office && sized.includes(`width="${OFFICE_W}"`), 'the office drawing can be placed inside the pane picture')

  let out = ''
  // Title bar
  out += `<g font-family="${SANS}">${txt(PAD, 25, 'Office', ` font-size="14" font-weight="bold" fill="${INK}"`)}`
  out += `<line x1="0" y1="38" x2="${W}" y2="38" stroke="${LINE}"/></g>`
  // The office picture, with a thin frame
  out += sized
  out += `<rect x="${PAD - 0.5}" y="${OFFICE_Y - 0.5}" width="${OFFICE_W + 1}" height="${OFFICE_H + 1}" fill="none" stroke="${LINE}"/>`
  out += badge(1, PAD + 2, OFFICE_Y + 2)

  // Left column: the feed
  const headY = COLS_Y + 14
  out += `<g font-family="${SANS}">${txt(PAD + 28, headY, "What's happening", ` font-size="14" font-weight="bold" fill="${INK}"`)}</g>`
  out += badge(2, PAD + 11, headY - 5)
  let y = COLS_Y + 44
  out += `<g font-family="${MONO}" font-size="12">`
  for (const line of s.ticker) {
    out += `<text x="${PAD}" y="${y}" fill="${INK}"><tspan fill="${DIM}">${escapeXml(clockLabel(line.at))}</tspan> ${escapeXml(clip(line.text, 56))}</text>`
    y += 20
  }
  out += '</g>'

  // Right column: the org chart
  out += `<g font-family="${SANS}">${txt(RIGHT_X + 28, headY, 'Who reports to whom', ` font-size="14" font-weight="bold" fill="${INK}"`)}</g>`
  out += badge(3, RIGHT_X + 11, headY - 5)
  y = COLS_Y + 44
  const orgWidth = 40
  for (const row of orgRows(s)) {
    const x = RIGHT_X + 10 + row.depth * INDENT
    if (row.id === selectedId) {
      out += `<rect x="${RIGHT_X}" y="${y - 15}" width="${W - PAD - RIGHT_X}" height="22" rx="4" fill="#f1ece0"/>`
      out += `<rect x="${RIGHT_X}" y="${y - 15}" width="3" height="22" rx="1.5" fill="${ACCENT}"/>`
    }
    out += `<g font-family="${MONO}" font-size="12">${txt(x, y, `${row.label} · ${row.status} · ${row.place}`, ` fill="${STATUS_INK[row.status]}"`)}</g>`
    const objective = objectiveLine(s, row.id, row.depth, orgWidth).trim()
    if (objective !== '') {
      y += 17
      out += `<g font-family="${MONO}" font-size="11.5">${txt(x, y, objective, ` fill="${DIM}"`)}</g>`
    }
    y += 22
  }

  // The details box for the selected helper, as it opens when you click a name
  const lines = agentDetails(s, selectedId, now)
  expect(lines.some(line => line.startsWith('On the job')), 'the details box shows the On the job line')
  const boxY = y + 6
  const boxH = 18 * lines.length + 20
  out += `<rect x="${RIGHT_X}" y="${boxY}" width="330" height="${boxH}" rx="8" fill="#ffffff" stroke="${LINE}"/>`
  out += `<g font-family="${MONO}" font-size="12">`
  lines.forEach((line, i) => {
    out += txt(RIGHT_X + 16, boxY + 26 + i * 18, line, i === 0 ? ` font-weight="bold" fill="${INK}"` : ` fill="#55524a"`)
  })
  out += '</g>'
  out += badge(4, RIGHT_X + 2, boxY + 2)

  // The legend button
  const buttonY = boxY + boxH + 24
  out += `<rect x="${PAD}" y="${buttonY}" width="124" height="30" rx="6" fill="#ffffff" stroke="#bdb8aa"/>`
  out += `<g font-family="${SANS}">${txt(PAD + 62, buttonY + 20, 'Show legend', ` font-size="13" text-anchor="middle" fill="${INK}"`)}</g>`
  out += badge(5, PAD + 140, buttonY + 15)

  const height = Math.max(buttonY + 30, y) + PAD + 8
  const caption = 'The Pixel Office pane: the animated office, a feed of what just happened, an org chart with a details box, and a legend button.'
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}">` +
    `<title>The Pixel Office pane</title><desc>${escapeXml(caption)}</desc>` +
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${height - 1}" rx="12" fill="#faf9f5" stroke="${LINE}"/>` +
    `${out}</svg>`
  )
}

// ---------------------------------------------------------------------------------------------------
// Write the files.
// ---------------------------------------------------------------------------------------------------

const root = resolve(dirname(process.argv[1] ?? 'scripts/render-preview.ts'), '..')
const outDir = join(root, 'docs', 'images')
mkdirSync(outDir, { recursive: true })

const FILES: Record<string, string> = {
  'office.svg': renderOffice(scene, NOW),
  'office-map.svg': officeMap(NOW),
  'pane-preview.svg': panePreview(scene, NOW, EXPLORE),
}

for (const [name, svg] of Object.entries(FILES)) {
  assertWellFormed(name, svg)
  writeFileSync(join(outDir, name), svg, 'utf8')
  console.log(`${name}: ${(Buffer.byteLength(svg, 'utf8') / 1024).toFixed(1)} KB`)
}
console.log(`Written to ${outDir}`)
