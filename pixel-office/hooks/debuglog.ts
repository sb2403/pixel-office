// An opt-in log of what the office does, kept in memory as JSON lines and written to a file by the flush.
// Off by default: every function below is a boolean check and nothing more until `debugOn(true)`.
export const LOG_MAX = 3000

let isOn = false
let lines: string[] = []
let isDirty = false

export function debugOn(enabled: boolean): void {
  isOn = enabled
}

// Values are plain numbers, booleans and short strings: agent ids, event kinds, tool names, never text of the work.
export function note(kind: string, data: Record<string, unknown> = {}, at?: number): void {
  if (!isOn) return
  lines.push(JSON.stringify({ t: at ?? Date.now(), kind, ...data }))
  if (lines.length > LOG_MAX) lines = lines.slice(lines.length - LOG_MAX)
  isDirty = true
}

export function logText(): string {
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

export function takeDirty(): boolean {
  const was = isDirty
  isDirty = false
  return was
}

export function clearLog(): void {
  lines = []
  isDirty = false
}
