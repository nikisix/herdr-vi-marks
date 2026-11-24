// A mark points at one transcript row: a message uuid or a tool_use id
export type Mark = { id: string; label: string }

declare module 'claude-code' {
  interface PluginState {
    'vi-marks': {
      marks: Shaped<Record<string, Mark>>
      back: Shaped<Mark | null>
    }
  }
}
