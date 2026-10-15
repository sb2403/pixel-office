import { describe, expect, test } from 'claude-code/testing'

import { isExempt, redirectTargets, writesFile } from '../hooks/rules'

describe('the places Main may always write', () => {
  test('its memory, its plans, and scratch space', async () => {
    expect(isExempt('C:\\Users\\me\\.claude\\projects\\x\\memory\\a.md')).toBe(true)
    expect(isExempt('/home/me/.claude/plans/p.md')).toBe(true)
    expect(isExempt('C:\\Users\\me\\AppData\\Local\\Temp\\claude\\p\\s\\scratchpad\\a.ts')).toBe(true)
    expect(isExempt('/tmp/out.txt')).toBe(true)
  })

  test('not the work, not even under a .claude folder of a worktree', async () => {
    expect(isExempt('/work/src/a.ts')).toBe(false)
    expect(isExempt('D:\\Claude\\Pixel Office\\.claude\\worktrees\\w\\pixel-office\\hooks\\a.ts')).toBe(false)
    expect(isExempt('/home/me/.claude/settings.json')).toBe(false)
  })
})

describe('redirects', () => {
  test('finds what a redirect writes, outside quotes and before a heredoc', async () => {
    expect(redirectTargets('echo hi > out.txt')).toEqual(['out.txt'])
    expect(redirectTargets('echo hi >> "a b.log"')).toEqual(['a b.log'])
    expect(redirectTargets('cmd 1> a.txt 2> b.txt')).toEqual(['a.txt', 'b.txt'])
    expect(redirectTargets('cmd &> all.txt')).toEqual(['all.txt'])
    expect(redirectTargets("cat > f.ts <<'EOF'\nx > y\nEOF")).toEqual(['f.ts'])
  })

  test('ignores descriptor copies, /dev/null, quoted arrows and comparisons in text', async () => {
    expect(redirectTargets('npm test 2>&1 | tail -5')).toEqual([])
    expect(redirectTargets('cmd > /dev/null 2>&1')).toEqual([])
    expect(redirectTargets('cmd >$null')).toEqual([])
    expect(redirectTargets('grep ">" file.txt')).toEqual([])
    expect(redirectTargets("echo 'a > b'")).toEqual([])
  })
})

describe('what counts as writing a file', () => {
  test('a redirect anywhere but a scratch place', async () => {
    expect(writesFile('echo hi > notes.txt')).toBe('a redirect to notes.txt')
    expect(writesFile('cat > "$SP/bar.ts" <<EOF\nx\nEOF')).toBe('a redirect to $SP/bar.ts')
    expect(writesFile('echo hi > /tmp/note.txt')).toBeNull()
    expect(writesFile('echo hi > C:/Users/me/AppData/Local/Temp/claude/x/scratchpad/n.txt')).toBeNull()
  })

  test('tee, in-place edits, PowerShell writers and patches', async () => {
    expect(writesFile('ls | tee list.txt')).toBe('tee')
    expect(writesFile('sed -i s/a/b/ x.ts')).toBe('an in-place edit')
    expect(writesFile("sed -i.bak 's/a/b/' x.ts")).toBe('an in-place edit')
    expect(writesFile('perl -pi -e s/a/b/ x.ts')).toBe('an in-place edit')
    expect(writesFile("Set-Content -Path a.txt -Value 'x'")).toBe('a PowerShell file writer')
    expect(writesFile('git apply fix.patch')).toBe('a patch')
  })

  test('reading, searching, testing and git are not writing', async () => {
    for (const command of [
      'git status -sb',
      'git commit -m "fix: x > y"',
      'npm test 2>&1 | tail -3',
      'grep -rn "a > b" src',
      'sed -n 1,5p x.ts',
      'cat x.ts | head -5',
      'gh pr merge 3 --merge',
      'python -c "print(1)"',
      'ls -la',
    ]) {
      expect(writesFile(command)).toBeNull()
    }
  })
})
