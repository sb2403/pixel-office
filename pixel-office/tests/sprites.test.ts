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
