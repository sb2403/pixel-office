import { HEIGHT, WIDTH } from './stations'

const C = {
  wall: '#6b6658',
  wallTrim: '#444441',
  wood: '#bf9d6c',
  woodDark: '#ad8d60',
  carpet: '#7a8fa8',
  carpetDark: '#6d8199',
  tile: '#dfe8e3',
  tileLine: '#c9d6cf',
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
  shadow: '#2a2018',
  officeCarpet: '#a7a89f',
  officeCarpetLine: '#9b9c92',
  libraryCarpet: '#70805f',
  libraryCarpetDark: '#667555',
  concrete: '#bdb7a6',
  marble: '#e9e3d1',
  marbleDark: '#d6cfb9',
  wallCap: '#8c8676',
  baseboard: '#3a3830',
  sill: '#a8a291',
  threshold: '#ece0c4',
  deskLit: '#a46f45',
} as const

const n = (v: number): number => Math.round(v * 100) / 100

export const rect = (x: number, y: number, w: number, h: number, fill: string, extra = ''): string =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}"${extra}/>`

const use = (id: string, x: number, y: number): string => `<use href="#${id}" x="${x}" y="${y}"/>`
const GLASS = ' fill-opacity="0.6"'
// Everything is lit from the top left, so a shadow falls down and to the right of what casts it.
const SHADE = ' fill-opacity="0.22"'
const shade = (x: number, y: number, w: number, h: number): string => rect(x, y, w, h, C.shadow, SHADE)
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
  `<pattern id="po-officefloor" width="8" height="8" patternUnits="userSpaceOnUse">${rect(0, 0, 8, 8, C.officeCarpet)}${rect(0, 7, 8, 1, C.officeCarpetLine)}${rect(7, 0, 1, 8, C.officeCarpetLine)}</pattern>` +
  `<pattern id="po-libraryfloor" width="4" height="4" patternUnits="userSpaceOnUse">${rect(0, 0, 4, 4, C.libraryCarpet)}${rect(0, 0, 2, 2, C.libraryCarpetDark)}${rect(2, 2, 2, 2, C.libraryCarpetDark)}</pattern>` +
  `<pattern id="po-marble" width="8" height="8" patternUnits="userSpaceOnUse">${rect(0, 0, 8, 8, C.marble)}${rect(0, 0, 4, 4, C.marbleDark)}${rect(4, 4, 4, 4, C.marbleDark)}</pattern>` +
  `<pattern id="po-grate" width="4" height="4" patternUnits="userSpaceOnUse">${rect(0, 0, 4, 4, C.grate)}${rect(0, 0, 4, 1, C.grateLine)}${rect(0, 0, 1, 4, C.grateLine)}</pattern>` +
  `<g id="po-desk">${shade(1, 8, 16, 3)}${rect(0, 0, 16, 6, C.deskTop)}${rect(0, 0, 16, 1, C.deskLit)}${rect(0, 6, 16, 2, C.deskEdge)}${rect(1, 7, 1, 3, C.deskEdge)}${rect(14, 7, 1, 3, C.deskEdge)}${rect(5, -5, 6, 5, C.monitor)}${rect(6, -4, 4, 3, C.screen)}${rect(7, 0, 2, 1, C.monitor)}${rect(2, 2, 4, 1, '#d3d1c7')}</g>` +
  `<g id="po-cab">${shade(1, 20, 6, 2)}${shade(6, 2, 1, 19)}${rect(0, 0, 6, 20, C.cabinet)}${rect(0, 0, 6, 1, C.cabinetFace)}${rect(1, 1, 4, 5, C.cabinetFace)}${rect(1, 7, 4, 5, C.cabinetFace)}${rect(1, 13, 4, 6, C.cabinetFace)}${rect(2, 3, 2, 1, C.handle)}${rect(2, 9, 2, 1, C.handle)}${rect(2, 15, 2, 1, C.handle)}</g>` +
  `<g id="po-shelf">${shade(1, 22, 8, 2)}${shade(8, 2, 1, 21)}${shelf()}${rect(0, 0, 8, 1, C.wood)}</g>` +
  `<g id="po-rack">${shade(1, 26, 10, 2)}${shade(10, 2, 1, 25)}${rect(0, 0, 10, 26, C.rack)}${rect(0, 0, 10, 1, C.steelDark)}${rect(1, 1, 8, 24, C.rackFace)}${[3, 7, 11, 15, 19].map(y => rect(2, y, 6, 2, C.rack)).join('')}</g>` +
  `<g id="po-plant">${shade(1, 11, 7, 2)}${rect(1, 8, 4, 4, C.pot)}${rect(0, 8, 6, 1, C.deskEdge)}${rect(0, 2, 6, 6, C.leaf)}${rect(1, 0, 2, 3, C.leafLight)}${rect(3, 1, 2, 3, C.leaf)}${rect(2, 4, 1, 2, C.leafLight)}</g>` +
  '</defs>'

function floors(): string {
  return (
    rect(0, 10, WIDTH, HEIGHT - 10, 'url(#po-wood)') +
    rect(0, 10, 62, 48, 'url(#po-carpet)') +
    rect(0, 62, 62, 44, 'url(#po-tile)') +
    rect(0, 108, 70, 42, 'url(#po-marble)') +
    rect(70, 12, 100, 62, 'url(#po-officefloor)') +
    rect(172, 10, 68, 40, 'url(#po-libraryfloor)') +
    rect(172, 50, 40, 26, C.concrete) +
    rect(176, 96, 64, 54, 'url(#po-grate)')
  )
}

function walls(isNight: boolean): string {
  const city = isNight ? C.cityNight : C.city
  let out = rect(0, 0, WIDTH, 9, C.wall) + rect(0, 0, WIDTH, 1, C.wallCap) + rect(0, 8, WIDTH, 1, C.baseboard) + rect(0, 9, WIDTH, 1, C.wallTrim)
  out += rect(0, 10, WIDTH, 2, C.shadow, ' fill-opacity="0.2"')
  for (const x of [112, 128, 144, 160]) {
    out += rect(x, 1, 14, 7, C.frame) + rect(x + 1, 2, 12, 5, isNight ? C.nightSky : C.daySky)
    out += rect(x - 1, 8, 16, 1, C.sill)
    out += rect(x + 2, 5, 3, 2, city) + rect(x + 6, 4, 2, 3, city) + rect(x + 9, 5, 3, 2, city)
    if (isNight) out += rect(x + 6, 5, 1, 1, '#fac775') + rect(x + 10, 6, 1, 1, '#fac775')
  }
  out += `<g id="po-zone-taskboard">${rect(72, 1, 32, 8, C.frame)}${rect(73, 2, 30, 6, C.cork)}</g>`
  out += shade(64, 12, 2, 46) + shade(0, 60, 48, 2) + shade(178, 98, 2, 52) + shade(190, 98, 50, 2)
  out += rect(62, 10, 2, 48, C.glass, GLASS) + rect(0, 58, 48, 2, C.glass, GLASS) + rect(48, 58, 1, 2, C.frame)
  out += rect(176, 98, 2, 52, C.glass, GLASS) + rect(190, 96, 50, 2, C.glass, GLASS) + rect(189, 96, 1, 2, C.frame)
  out += rect(48, 58, 14, 2, C.threshold) + rect(176, 96, 14, 2, C.threshold) + rect(28, 106, 9, 2, C.threshold)
  out += rect(0, 106, 28, 2, C.partition) + rect(37, 106, 25, 2, C.partition) + rect(76, 47, 18, 2, C.partition) + rect(100, 47, 16, 2, C.partition) + rect(122, 47, 16, 2, C.partition) + rect(144, 47, 18, 2, C.partition)
  return out
}

function cornerOffice(): string {
  return (
    '<g id="po-zone-office">' +
    use('po-shelf', 3, 12) +
    shade(15, 41, 28, 5) +
    rect(14, 34, 28, 6, C.deskTop) +
    rect(14, 34, 28, 1, C.deskLit) +
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
  let out = `<g id="po-zone-mailroom">${shade(179, 69, 28, 2)}${rect(178, 52, 28, 9, C.cubby)}`
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
      shade(x + 1, 80, 12, 2) +
      shade(x + 12, 54, 1, 27) +
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

// Everything here is centred on x = 116, the middle of the seats: the rug, the whiteboard, the table and the chairs.
// The whiteboard sits at the rug's north edge, above the heads of those standing at the top seats.
function meetingRoom(): string {
  let out = '<g id="po-zone-meeting">'
  out += rect(80, 92, 72, 56, C.rug) + rect(82, 94, 68, 52, C.rugInner) + rect(84, 96, 64, 48, C.rug, ' fill-opacity="0.35"') + rect(86, 98, 60, 44, C.rugInner)
  // The whiteboard: a frame on two feet, a marker tray and a few lines of writing.
  out += shade(98, 101, 38, 2) + rect(97, 93, 38, 8, C.frame) + rect(98, 94, 36, 6, C.board)
  out += rect(100, 95, 14, 1, '#d85a30', ' fill-opacity="0.45"') + rect(100, 97, 20, 1, '#378add', ' fill-opacity="0.45"') + rect(100, 98, 9, 1, '#3b6d11', ' fill-opacity="0.45"') + rect(124, 95, 8, 3, '#fac775', ' fill-opacity="0.6"')
  out += rect(99, 101, 1, 3, C.frame) + rect(133, 101, 1, 3, C.frame) + rect(104, 101, 24, 1, '#8a8474')
  // Four chairs a side, one at each seat.
  for (const x of [96, 108, 120, 132]) out += rect(x, 111, 4, 3, C.chair) + rect(x, 128, 4, 3, C.chair)
  // The table, with what a meeting leaves on it.
  out += shade(95, 127, 44, 3) + rect(94, 116, 44, 10, C.deskTop) + rect(94, 116, 44, 1, C.deskLit) + rect(94, 126, 44, 2, C.deskEdge)
  out += rect(99, 118, 5, 4, '#f1efe8') + rect(100, 119, 3, 1, '#b4b2a9') + rect(112, 119, 6, 4, C.monitor) + rect(113, 120, 4, 2, C.screen)
  out += rect(124, 119, 2, 2, '#d85a30') + rect(129, 118, 4, 5, '#f1efe8') + rect(130, 119, 2, 1, '#b4b2a9')
  return `${out}</g>`
}

// A runner down the middle of the corridor, so the open floor between the desks and the meeting room reads as a
// place rather than as left-over space.
function runner(): string {
  return (
    '<g id="po-runner">' +
    shade(71, 88, 96, 2) +
    rect(70, 78, 96, 10, '#8b4a3c') +
    rect(71, 79, 94, 8, '#a45a47') +
    rect(73, 81, 90, 4, '#8b4a3c') +
    rect(74, 82, 88, 2, '#c98a62') +
    '</g>'
  )
}

function breakRoom(): string {
  let out = '<g id="po-zone-breakroom">'
  out += shade(3, 82, 10, 2) + shade(12, 66, 1, 17) + shade(17, 75, 24, 2) + rect(2, 64, 10, 18, C.vending) + rect(3, 66, 8, 10, C.glass)
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
  out += shade(5, 99, 27, 2) + rect(4, 90, 26, 3, C.couchDark) + rect(4, 93, 26, 6, C.couch) + rect(3, 91, 2, 8, C.couchDark) + rect(29, 91, 2, 8, C.couchDark)
  return `${out}</g>`
}

function lobby(): string {
  return (
    '<g id="po-zone-elevator">' +
    shade(4, 136, 26, 2) +
    rect(3, 110, 26, 26, C.steelDark) +
    rect(5, 112, 11, 24, C.steel) +
    rect(16, 112, 11, 24, C.steel) +
    rect(15, 112, 2, 24, C.steelDark) +
    rect(12, 108, 8, 2, C.monitor) +
    rect(15, 108, 2, 1, '#97c459') +
    rect(29, 122, 1, 2, '#fac775') +
    '</g>' +
    '<g id="po-zone-reception">' +
    shade(37, 132, 26, 2) +
    rect(36, 123, 26, 2, C.receptionTop) +
    rect(36, 125, 26, 7, C.reception) +
    rect(46, 120, 4, 3, '#ef9f27') +
    rect(47, 119, 2, 1, '#fac775') +
    '</g>'
  )
}

// Small stencils on the floor, so each zone is named without a click.
function labels(): string {
  const tag = (text: string, x: number, y: number): string =>
    `<text x="${x}" y="${y}" font-size="3" text-anchor="middle" fill="#000000" fill-opacity="0.45">${text}</text>`
  return (
    '<g id="po-labels">' +
    tag('DESKS', 120, 20) +
    tag('LIBRARY', 206, 46) +
    tag('MAIL', 192, 74) +
    tag('SERVERS', 215, 147) +
    tag('MEETING', 115, 148) +
    tag('BREAK ROOM', 31, 104) +
    tag('LOBBY', 35, 147) +
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
    runner(),
    desks(),
    library(),
    mailroom(),
    phoneBooths(),
    serverRoom(),
    meetingRoom(),
    breakRoom(),
    lobby(),
    labels(),
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
