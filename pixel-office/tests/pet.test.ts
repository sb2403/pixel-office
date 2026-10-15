import { describe, expect, test } from 'claude-code/testing'

import { FLOOR, PACE, ROUTE, petSvg, timeline } from '../hooks/pet'
import { emptyScene } from '../hooks/model'
import { renderOffice } from '../hooks/render'

describe('the office cat', () => {
  test('its route stays on open floor inside the picture', async () => {
    for (const stop of ROUTE) {
      expect(stop.x).toBeGreaterThan(FLOOR.x0)
      expect(stop.x).toBeLessThan(FLOOR.x1)
      expect(stop.y).toBeGreaterThan(FLOOR.y0)
      expect(stop.y).toBeLessThan(FLOOR.y1)
    }
    // Never across the desks (x 70 to 170, y 12 to 74), nor into the library, mailroom or server room.
    for (const stop of ROUTE) {
      const isAtDesks = stop.x > 70 && stop.x < 170 && stop.y > 12 && stop.y < 76
      const isAtRightRooms = stop.x > 172 && stop.y < 150 && stop.y > 10 && stop.y < 100
      expect(isAtDesks || isAtRightRooms).toBe(false)
    }
  })

  test('the loop walks at a steady pace and rests where it stays', async () => {
    const { phases, points, cycle, length } = timeline()
    expect(cycle).toBeGreaterThan(60)
    expect(cycle).toBeLessThan(180)
    // The walking alone takes the length of the path at its pace.
    const stays = ROUTE.reduce((sum, s) => sum + (s.stay ?? 0), 0)
    expect(Math.abs(cycle - stays - length / PACE)).toBeLessThan(1e-6)
    expect(points[0]).toEqual({ at: 0, along: 0 })
    expect(Math.abs(points[points.length - 1]!.along - length)).toBeLessThan(1e-6)
    // A rest holds still: the same distance along the path before and after.
    for (let i = 1; i < points.length; i++) expect(points[i]!.at).toBeGreaterThanOrEqual(points[i - 1]!.at)
    expect(phases.filter(p => p.kind === 'nap')).toHaveLength(1)
    expect(phases.filter(p => p.kind === 'sit')).toHaveLength(ROUTE.filter(s => s.stay !== undefined && s.pose !== 'nap').length)
  })

  test('the drawing is well formed: matching key times and values, starting at 0 and ending at 1', async () => {
    const svg = petSvg(0)
    const motion = /<animateMotion path="[^"]+" keyPoints="([^"]+)" keyTimes="([^"]+)"/.exec(svg)!
    const points = motion[1]!.split(';').map(Number)
    const times = motion[2]!.split(';').map(Number)
    expect(points).toHaveLength(times.length)
    expect(times[0]).toBe(0)
    expect(times[times.length - 1]).toBe(1)
    expect(points[points.length - 1]).toBe(1)
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!)
    // Three poses, each shown only in its own stretch, and a flip for each stretch.
    const shown = [...svg.matchAll(/<animate attributeName="opacity" calcMode="discrete" keyTimes="([^"]+)" values="([^"]+)"/g)]
    expect(shown).toHaveLength(3)
    for (const m of shown) expect(m[1]!.split(';')).toHaveLength(m[2]!.split(';').length)
    for (let i = 0; i < shown[0]![2]!.split(';').length; i++) {
      expect(shown.map(m => Number(m[2]!.split(';')[i])).reduce((a, b) => a + b, 0)).toBe(1)
    }
  })

  test('it carries on from the same moment when the picture is drawn again', async () => {
    const { cycle } = timeline()
    const offset = (now: number): number => Number(/begin="-([\d.]+)s"/.exec(petSvg(now))![1])
    expect(offset(0)).toBe(0)
    expect(offset(5000)).toBe(5)
    // A whole loop later it is back where it started.
    expect(Math.abs(offset(cycle * 1000 + 5000) - 5)).toBeLessThan(0.01)
  })

  test('it is in the picture, with the people but under their bubbles', async () => {
    const svg = renderOffice(emptyScene(), 10_000)
    expect(svg).toContain('id="po-pet"')
    expect(svg.indexOf('id="po-pet"')).toBeLessThan(svg.indexOf('id="agent-main"'))
  })
})
