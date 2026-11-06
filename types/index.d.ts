export type Reading = { kind: string; percentUsed: number; resetsAt: string }
export type Line = { at: number; action: 'warn' | 'ask' | 'pause' }
export type Lines = { five_hour: Line[]; seven_day: Line[] }
/** Where Peras says a window is headed by its reset, from `peras usage --json`. */
export type Forecast = { kind: string; projected: number; resetsAtMs: number }

export type BandStyle = 'mini' | 'quiet' | 'line' | 'full' | 'off'

export type BandData = {
  readings: readonly Reading[]
  lines: Lines
  paused: boolean
  isWorking: boolean
  step: number
  forecasts?: readonly Forecast[]
}

declare module 'claude-code' {
  interface PluginState {
    peras: {
      readings: readonly Reading[]
      lines: Lines
      paused: boolean
      style: BandStyle
      lineHidden: boolean
      hasPeras: boolean
      step: number
      forecasts: readonly Forecast[]
      forecastAskedAt: number | null
    }
  }
}
