// The one value the guard keeps for the session: whether Main is being held to coordinating.
export type Switch = boolean

declare module 'claude-code' {
  interface PluginState {
    'coordinator-guard': { enabled: boolean }
  }
}
