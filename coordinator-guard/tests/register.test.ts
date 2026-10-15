import { expect, test } from 'claude-code/testing'

import { WHY } from '../hooks/register'

const EDIT = { tool: 'Edit', tool_use_id: 'tu-1', file_path: '/work/a.ts', old_string: 'a', new_string: 'b' } as const

test('Main may not edit or write files', async ($, on) => {
  on('tool.call', () => ({ result: 'ran', text: 'ok' }))
  const edit = await $.tool.call(EDIT)
  expect(edit.deny).toBe(WHY)
  const write = await $.tool.call({ tool: 'Write', tool_use_id: 'tu-2', file_path: '/work/b.ts', content: 'x' })
  expect(write.deny).toBe(WHY)
})

test('a helper may edit files', async ($, on) => {
  on('tool.call', () => ({ result: 'ran', text: 'ok' }))
  const edit = await $.tool.call({ ...EDIT, agentId: 'helper-1' })
  expect(edit.deny).toBeUndefined()
})

test('Main may still read, search and run commands', async ($, on) => {
  on('tool.call', () => ({ result: 'ran', text: 'ok' }))
  const read = await $.tool.call({ tool: 'Read', tool_use_id: 'tu-3', file_path: '/work/a.ts' })
  expect(read.deny).toBeUndefined()
})
