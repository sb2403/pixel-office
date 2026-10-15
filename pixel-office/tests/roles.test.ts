import { expect, test } from 'claude-code/testing'

import { COORDINATOR, asName, humanize, modelName, roleFor, tokenCount } from '../hooks/roles'

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

test('a model id reads as the model people know', async () => {
  expect(modelName('claude-haiku-5-5')).toBe('Haiku 5.5')
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
  expect(modelName('claude-fable-5-1')).toBe('Fable 5.1')
  expect(modelName('claude-3-5-haiku-20241022')).toBe('Haiku')
  expect(modelName('us.anthropic.claude-sonnet-4-20250514-v1:0')).toBe('Sonnet 4')
  expect(modelName('some-other-model')).toBe('some-other-model')
})

test('token counts are short', async () => {
  expect([850, 3400, 3000, 38_400, 999_499, 1_250_000, 2_000_000].map(tokenCount)).toEqual(['850', '3.4k', '3k', '38k', '999k', '1.3M', '2M'])
})
