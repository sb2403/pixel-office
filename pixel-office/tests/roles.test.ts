import { expect, test } from 'claude-code/testing'

import { COORDINATOR, asName, humanize, roleFor } from '../hooks/roles'

test('the built-in kinds of agent have job titles a person would use', async () => {
  expect(roleFor('Explore').title).toBe('Researcher')
  expect(roleFor('Plan').title).toBe('Planner')
  expect(roleFor('general-purpose').title).toBe('Assistant')
  expect(roleFor('contractor').title).toBe('Contractor')
  expect(roleFor('main')).toBe(COORDINATOR)
})

test('every role explains itself in one line', async () => {
  for (const type of ['main', 'Explore', 'Plan', 'general-purpose', 'fork', 'contractor', 'something-new']) {
    expect(roleFor(type).blurb.length).toBeGreaterThan(10)
  }
})

test('a custom kind of agent is named from its type', async () => {
  expect(humanize('code-reviewer')).toBe('Code reviewer')
  expect(humanize('my-plugin:code-reviewer')).toBe('Code reviewer')
  expect(humanize('securityAuditor')).toBe('Security auditor')
  expect(humanize('db_migrator')).toBe('Db migrator')
  expect(humanize('')).toBe('Helper')
  expect(roleFor('code-reviewer').title).toBe('Code reviewer')
})

test('a name the engine gave reads as a name', async () => {
  expect(asName('scout')).toBe('Scout')
  expect(asName('Alice')).toBe('Alice')
  expect(asName('')).toBe('')
})
