export type Tick = number

declare module 'claude-code' {
  interface PluginState {
    'progress-pane': { tick: Tick }
  }
}
