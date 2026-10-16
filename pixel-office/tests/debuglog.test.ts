import { expect, test } from 'claude-code/testing'

import { LOG_MAX, clearLog, debugOn, logText, note, takeDirty } from '../hooks/debuglog'

// The log is module state, so each test starts from a known state (and leaves it off).
const fresh = (on: boolean): void => {
  clearLog()
  debugOn(on)
}

test('it is off by default: a note records nothing', () => {
  fresh(false)
  note('render', { scroll: 1 })
  expect(logText()).toBe('')
  expect(takeDirty()).toBe(false)
})

test('when on, a note is one JSON line with its time, its kind and its data', () => {
  fresh(true)
  note('event', { ev: 'toolStarted', agent: 'main', tool: 'Read' }, 1234)
  note('flush', { batch: 2 })
  const lines = logText().split('\n')
  expect(lines).toHaveLength(3)
  expect(lines[2]).toBe('')
  expect(JSON.parse(lines[0]!)).toEqual({ t: 1234, kind: 'event', ev: 'toolStarted', agent: 'main', tool: 'Read' })
  const second = JSON.parse(lines[1]!) as { t: number; kind: string; batch: number }
  expect(second.kind).toBe('flush')
  expect(second.batch).toBe(2)
  expect(typeof second.t).toBe('number')
  fresh(false)
})

test('the ring keeps only the newest lines', () => {
  fresh(true)
  for (let i = 0; i < LOG_MAX + 50; i++) note('n', { i }, i)
  const lines = logText().trimEnd().split('\n')
  expect(LOG_MAX).toBe(3000)
  expect(lines).toHaveLength(3000)
  expect(JSON.parse(lines[0]!).i).toBe(50)
  expect(JSON.parse(lines[2999]!).i).toBe(LOG_MAX + 49)
  fresh(false)
})

test('takeDirty is true once after a note, then false', () => {
  fresh(true)
  expect(takeDirty()).toBe(false)
  note('a')
  expect(takeDirty()).toBe(true)
  expect(takeDirty()).toBe(false)
  note('b')
  note('c')
  expect(takeDirty()).toBe(true)
  expect(takeDirty()).toBe(false)
  fresh(false)
})

test('clearLog empties the log', () => {
  fresh(true)
  note('a')
  clearLog()
  expect(logText()).toBe('')
  expect(takeDirty()).toBe(false)
  fresh(false)
})
