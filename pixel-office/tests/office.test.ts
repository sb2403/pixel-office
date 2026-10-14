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
