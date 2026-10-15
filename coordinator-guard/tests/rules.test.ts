import { describe, expect, test } from 'claude-code/testing'

import { isExempt, normalize, redirectTargets, withoutHeredocBodies, writesFile } from '../hooks/rules'

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

  test('only under the home and temp folders, not any folder that happens to share a name', async () => {
    expect(isExempt('/work/src/scratchpad/a.ts')).toBe(false)
    expect(isExempt('/work/.claude/projects/x/a.md')).toBe(false)
    expect(isExempt('/work/tmp/a.ts')).toBe(false)
    expect(isExempt('D:\\proj\\Temp\\claude\\a.ts')).toBe(false)
  })

  test('a path that climbs out of an exempt folder is judged by where it ends up', async () => {
    expect(isExempt('/tmp/../work/a.ts')).toBe(false)
    expect(isExempt('/tmp/x/../y.txt')).toBe(true)
    expect(isExempt('/Users/me/.claude/projects/../settings.json')).toBe(false)
    expect(isExempt('/tmp/../../etc/passwd')).toBe(false)
    expect(isExempt('/../tmp/a')).toBe(false)
  })

  test('paths are made plain first', async () => {
    expect(normalize('C:\\Users\\me\\.\\a\\..\\b')).toBe('C:/Users/me/b')
    expect(normalize('/a//b/./c/')).toBe('/a/b/c/')
    expect(normalize('/..')).toBeNull()
  })
})

describe('heredocs', () => {
  test("only the body goes: what is on the operator's line and after the body is still a command", async () => {
    expect(withoutHeredocBodies("cat <<'EOF'\nx > y\nEOF\necho done")).toBe('cat  \necho done')
    expect(redirectTargets('cat <<EOF > out.txt\nbody\nEOF')).toEqual(['out.txt'])
    expect(redirectTargets("cat <<'EOF' >> log.txt\nx\nEOF")).toEqual(['log.txt'])
    expect(redirectTargets('cat <<EOF\nx\nEOF\necho hi > after.txt')).toEqual(['after.txt'])
    expect(redirectTargets('cat <<-EOF > t.txt\n\tbody\n\tEOF')).toEqual(['t.txt'])
    expect(redirectTargets('cat <<A > a.txt; cat <<B > b.txt\n1\nA\n2\nB')).toEqual(['a.txt', 'b.txt'])
  })

  test('a here-string or a quoted <<, or no end to the body, does not confuse it', async () => {
    expect(redirectTargets('cat <<< "x" > out.txt')).toEqual(['out.txt'])
    // A here-string is not a heredoc: the lines after it are still commands.
    expect(redirectTargets('cat <<< foo\necho hi > f.txt\nfoo')).toEqual(['f.txt'])
    expect(redirectTargets('grep x <<< EOF\necho hi > f.txt')).toEqual(['f.txt'])
    expect(redirectTargets('cat <<< "a" <<EOF > g.txt\nbody\nEOF')).toEqual(['g.txt'])
    expect(redirectTargets('echo "a <<EOF b" > out.txt')).toEqual(['out.txt'])
    expect(redirectTargets('cat <<EOF > f.txt\nnever ends > g.txt')).toEqual(['f.txt'])
  })

  test('a writer after a heredoc is still seen, and one inside its body is not', async () => {
    expect(writesFile('cat <<EOF | tee out.txt\nx\nEOF')).toBe('tee')
    expect(writesFile("cat <<'EOF'\nsed -i s/a/b/ x\nEOF")).toBeNull()
    expect(writesFile('cat <<EOF > notes.txt\nx\nEOF')).toBe('a redirect to notes.txt')
  })
})

describe('redirects', () => {
  test('finds what a redirect writes, outside quotes and outside heredoc bodies', async () => {
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
    expect(writesFile('echo hi > /tmp/../work/n.txt')).toBe('a redirect to /tmp/../work/n.txt')
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
