import { describe, expect, test } from 'claude-code/testing'

import { commandIntent, explainCommand, stepsOf } from '../hooks/commands'

describe('stepsOf', () => {
  test('splits at the usual separators, keeping quoted text whole', async () => {
    expect(stepsOf('a && b || c; d\ne')).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(stepsOf('python -c "a; b && c" && d')).toEqual(['python -c "a; b && c"', 'd'])
  })

  test('keeps the first command of a pipe, and drops a heredoc body', async () => {
    expect(stepsOf('git log | head -5 && echo done')).toEqual(['git log', 'echo done'])
    expect(stepsOf("cat > f.ts <<'EOF'\nimport x; y && z\nEOF")).toEqual(['cat > f.ts'])
  })
})

describe('what a command is for', () => {
  const said = (command: string): string => commandIntent(command).phrase

  test('the command from the screenshot is about its real work, not its setup', async () => {
    const command = 'SP="C:/Users/bar12/AppData/Local/Temp/x/scratchpad" && mkdir -p "$SP" && cat > "$SP/bar.ts" <<EOF\nimport x\nEOF\nnpx tsx@4.19.2 scripts/bar.ts "$SP/bar.svg"'
    const intent = commandIntent(command)
    expect(intent.phrase).toBe('Write bar.ts')
    expect(intent.step).toBe('cat > "$SP/bar.ts"')
  })

  test('a variable set from another command is setup, and the step after it is the work', async () => {
    expect(stepsOf('C=$(ls a | head -1); "$C" plugin test x')).toEqual(['C=$(ls a | head -1)', '"$C" plugin test x'])
    expect(said('C=$(ls "$A/x"/*.exe | head -1); "$C" plugin test pixel-office 2>&1 | grep fail')).toBe('Test the code')
    expect(said('V=$(date) && echo $V')).toBe('Print a message')
  })

  test('git and GitHub', async () => {
    expect(said('git -C /repo status')).toBe('See what has changed')
    expect(said('git add -A && git commit -m x')).toBe('Stage the changes')
    expect(said('git push -u origin feat/x')).toBe('Upload the work')
    expect(said('git stash pop')).toBe('Set changes aside')
    expect(said('gh pr create --title x')).toBe('Open a pull request')
    expect(said('gh pr checks 4 --watch')).toBe('Check on a pull request')
    expect(said('gh pr merge 4 --merge')).toBe('Merge a pull request')
    expect(said('gh run view 1')).toBe('Check a CI run')
    expect(said('gh api repos/x/y')).toBe('Call the GitHub API')
  })

  test('programs that run through a variable or a runner', async () => {
    expect(said('"$C" plugin test pixel-office')).toBe('Test the code')
    expect(said('"$C" plugin validate --strict pixel-office')).toBe('Check the plugin')
    expect(said('claude plugin marketplace update x')).toBe('Update a plugin marketplace')
    expect(said('npx -y tsx@4.19.2 scripts/render-preview.ts')).toBe('Run render-preview.ts')
    expect(said('CI=1 sudo npm run build')).toBe('Build the project')
    expect(said('npm run storybook')).toBe('Run the storybook script')
  })

  test('scripts, snippets and files', async () => {
    expect(said('python scripts/gen.py --all')).toBe('Run gen.py')
    expect(said("python - <<'EOF'\nprint(1)\nEOF")).toBe('Run a Python snippet')
    expect(said('python -m http.server')).toBe('Run the http.server module')
    expect(said('node -e "console.log(1)"')).toBe('Run a Node snippet')
    expect(said('cat src/auth.ts | head -20')).toBe('Read auth.ts')
    expect(said('ls -la src')).toBe('Look through src')
    expect(said('grep -rn "sceneTimeOf" pixel-office')).toBe('Search for sceneTimeOf')
    expect(said('rm -rf build')).toBe('Delete build')
    expect(said('mv a.ts b.ts')).toBe('Move a.ts')
    expect(said('mkdir -p out/images')).toBe('Make the images folder')
    expect(said('sed -i s/a/b/ x.ts')).toBe('Edit a file in place')
    expect(said('echo hi > out.txt')).toBe('Write out.txt')
    expect(said('python gen.py > out.json')).toBe('Run gen.py')
  })

  test('the network, waiting and the system', async () => {
    expect(said('curl -s https://api.github.com/repos/x')).toBe('Fetch from api.github.com')
    expect(said('sleep 5')).toBe('Wait 5 seconds')
    expect(said('timeout 170 gh pr checks 4')).toBe('Wait 170 seconds')
    expect(said('docker compose up -d')).toBe('Run the containers')
    expect(said('kill 123')).toBe('Stop a process')
  })

  test('PowerShell', async () => {
    expect(said('Get-ChildItem -Recurse src')).toBe('Look through src')
    expect(said('Get-Content .\\notes.md')).toBe('Read notes.md')
    expect(said("Set-Content -Path out.txt -Value 'x'")).toBe('Write out.txt')
    expect(said('$files = Get-ChildItem src')).toBe('Look through src')
    expect(said("$ErrorActionPreference = 'Stop'; Remove-Item old.log")).toBe('Delete old.log')
    expect(said('Start-Sleep -Seconds 3')).toBe('Wait 3 seconds')
    expect(said('Invoke-WebRequest https://example.com/a')).toBe('Fetch from example.com')
  })

  test('setup alone, and programs it does not know', async () => {
    expect(commandIntent('cd /work')).toEqual({ step: 'cd /work', phrase: '', more: 0 })
    expect(commandIntent('SP="x"')).toEqual({ step: 'SP="x"', phrase: '', more: 0 })
    expect(commandIntent('cd /work && zzzcli --go')).toEqual({ step: 'zzzcli --go', phrase: '', more: 0 })
    expect(explainCommand('')).toBe('')
    expect(explainCommand('makefile-lint')).toBe('')
  })
})
