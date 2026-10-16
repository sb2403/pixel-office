import type { ClientModule } from 'claude-code'

type ProbeState = { at: number; ticks: number }

// Runs inside the app, not in the hooks module: it draws nothing visible and tells the hooks when the app mounts it
// (again after the app unmounts it and mounts it fresh) and, once a second, how big its region is.
const Probe: ClientModule<{ where?: string }, ProbeState> = (props, surface) => {
  const where = props.where ?? ''
  const say = (kind: string): void => {
    try {
      surface.post({ kind, where, columns: surface.columns, rows: surface.rows })
    } catch {
      // A thrown error would unmount the instance.
    }
  }
  // `state` is undefined on the first call of an instance, and only then: the one place to start things.
  if (surface.state === undefined) {
    surface.setState({ at: 1, ticks: 0 })
    say('mounted')
    surface.every(1000, () => say('tick'))
  }
  return surface.elements.Text({ children: ' ' })
}

export default Probe
