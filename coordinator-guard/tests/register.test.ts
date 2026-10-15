import { expect, test } from 'claude-code/testing'

import { WHY } from '../hooks/register'

const EDIT = { tool: 'Edit', tool_use_id: 'tu-1', file_path: '/work/a.ts', old_string: 'a', new_string: 'b' } as const
const WRITE = { tool: 'Write', tool_use_id: 'tu-2', file_path: '/work/b.ts', content: 'x' } as const
const shell = (command: string) => ({ tool: 'PowerShell', tool_use_id: 'tu-3', command }) as never

const ran = () => ({ result: 'ran', text: 'ok' })

test('it is off until it is switched on: Main edits as usual', async ($, on) => {
  on('tool.call', ran)
  expect((await $.tool.call(EDIT)).deny).toBeUndefined()
  expect((await $.tool.call(WRITE)).deny).toBeUndefined()
  expect((await $.command.run({ command: 'coordinator' })).text).toContain('off')
})

test('/coordinator on holds Main to coordinating, /coordinator off lets it go', async ($, on) => {
  on('tool.call', ran)
  expect((await $.command.run({ command: 'coordinator', args: 'on' })).text).toContain('is on')
  expect((await $.tool.call(EDIT)).deny).toBe(WHY)
  expect((await $.tool.call(WRITE)).deny).toBe(WHY)
  expect((await $.command.run({ command: 'coordinator' })).text).toContain('is on')
  expect((await $.command.run({ command: 'coordinator', args: 'off' })).text).toContain('is off')
  expect((await $.tool.call(EDIT)).deny).toBeUndefined()
})

test('a helper may always edit, and Main may still read and write to its own scratch places', async ($, on) => {
  on('tool.call', ran)
  await $.command.run({ command: 'coordinator', args: 'on' })
  expect((await $.tool.call({ ...EDIT, agentId: 'helper-1' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Read', tool_use_id: 'tu-4', file_path: '/work/a.ts' })).deny).toBeUndefined()
  const scratch = { ...WRITE, file_path: 'C:\\Users\\me\\AppData\\Local\\Temp\\claude\\proj\\sess\\scratchpad\\note.txt' }
  expect((await $.tool.call(scratch)).deny).toBeUndefined()
  const memory = { ...WRITE, file_path: 'C:\\Users\\me\\.claude\\projects\\proj\\memory\\a.md' }
  expect((await $.tool.call(memory)).deny).toBeUndefined()
})

test('while it is on, a shell command that writes a file is refused, and one that does not is not', async ($, on) => {
  on('tool.call', ran)
  await $.command.run({ command: 'coordinator', args: 'on' })
  const refused = await $.tool.call(shell('echo hi > notes.txt'))
  expect(refused.deny).toContain('coordinator-guard')
  expect(refused.deny).toContain('notes.txt')
  expect((await $.tool.call(shell('sed -i s/a/b/ src/x.ts'))).deny).toContain('an in-place edit')
  expect((await $.tool.call(shell('git status && npm test 2>&1 | tail -5'))).deny).toBeUndefined()
  expect((await $.tool.call(shell('gh pr merge 3 --merge'))).deny).toBeUndefined()
  // A helper's shell is its own.
  expect((await $.tool.call({ ...shell('echo hi > notes.txt'), agentId: 'helper-1' })).deny).toBeUndefined()
})

test('an unknown argument says how to use it', async ($) => {
  expect((await $.command.run({ command: 'coordinator', args: 'maybe' })).text).toContain('Usage')
})
