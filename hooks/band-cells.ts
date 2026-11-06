import { MASCOT_COLUMNS, MASCOT_ROWS, breath, fullFrame, miniFrame } from './frames'
import type { BandData, BandStyle, Forecast, Line, Reading } from '../types'

const DEFAULT_COLOR = 0x01000000
const PIXELS: Record<string, number> = { H: 0xf0a184, B: 0xd97757, S: 0xad5a3f, E: 0x17110f, W: 0xffffff }
const LIT = 0xffe3d6
const ASH = 0x6f7075
const LIME = 0xb7f34a
const AMBER = 0xf9a825
const RED = 0xe5484d
const DIM = 0x666666
const TEXT = 0xbbbbbb

const TRACK_START = 10
const RESET_COLUMNS = 18
// Below this width the band falls back to one line of text.
const MIN_COLUMNS = 56

const BAND_ROWS = MASCOT_ROWS

const MINI_ROWS = 2
const MINI_TEXT = 13
const MINI_BAR = 18
const MINI_MAX_TRACK = 40
const MINI_MIN_TRACK = 8
const MINI_RESET_COLUMNS = 17
const LINE_LANE_START = 8
// "week " + the bar + " 100% " + "Sat 18:00" + a gap.
const LINE_LANE_EXTRA = 22
const LINE_MIN_TRACK = 8
const LINE_MAX_TRACK = 24
// "→ 100%" and a gap.
const FORECAST_COLUMNS = 7
// Peras says "on pace for" only when a window is headed at least this far past
// where it is (agent-context.mjs), so the band makes the same cut.
const PACE_GAP = 5
// A forecast belongs to the window it was made in. Reset times drift by seconds
// between readings, so a few minutes either way is still that window.
const SAME_WINDOW_MS = 10 * 60_000

// `under` draws the cell underlined. Only Clawd uses it.
export type Cell = [char: string, color: number, background: number, under?: boolean]
export type Run = { text: string; color?: string; background?: string; under: boolean }
export type BandView = { grid: Cell[][] | null; text: string | null }

const NOTHING: BandView = { grid: null, text: null }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pad = (n: number) => String(n).padStart(2, '0')

/** "resets 19:00" today, "resets Sat 18:00" on another day, in local time. */
export function resetLabel(resetsAt: string, nowMs: number): string {
  const at = new Date(resetsAt)
  if (Number.isNaN(at.getTime())) return ''
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  const sameDay = at.toDateString() === new Date(nowMs).toDateString()
  return sameDay ? `resets ${time}` : `resets ${WEEKDAYS[at.getDay()]} ${time}`
}

const stops = (line: Line) => line.action !== 'warn'
const shown = (reading: Reading) => `${Math.round(reading.percentUsed)}%`

function toneOf(percent: number, lines: readonly Line[]): number {
  const crossed = lines.filter((line) => percent >= line.at)
  if (crossed.some(stops)) return RED
  return crossed.length ? AMBER : LIME
}

/**
 * Where this window is headed by its reset, as Peras worked it out, or null when
 * that's not well past where it is now. A forecast from another window, or one
 * for a paused Claude, is never shown.
 */
export function headedFor(reading: Reading | undefined, data: BandData): number | null {
  if (!reading || data.paused) return null
  const resetMs = new Date(reading.resetsAt).getTime()
  const forecast = data.forecasts?.find((f) => f.kind === reading.kind)
  if (!forecast || !Number.isFinite(resetMs) || Math.abs(forecast.resetsAtMs - resetMs) > SAME_WINDOW_MS) return null
  const projected = Math.min(100, Math.round(forecast.projected))
  return projected >= Math.round(reading.percentUsed) + PACE_GAP ? projected : null
}

const headed = (projected: number) => `→ ${projected}%`
// Grey, unless the window is headed past a line: then that line's colour.
const headedTone = (projected: number, lines: readonly Line[]) =>
  lines.some((line) => projected >= line.at) ? toneOf(projected, lines) : DIM

/** The forecast in one window, if any, and the column it needs. */
function forecastSlot(grid: Cell[][], row: number, column: number, projected: number | null, lines: readonly Line[]) {
  if (projected !== null) write(grid, row, column, headed(projected), headedTone(projected, lines))
  return column + FORECAST_COLUMNS
}

/** Peras's forecasts in `peras usage --json`, for Claude's two windows. Anything else means none. */
export function forecastsFrom(stdout: string): Forecast[] {
  try {
    const claude = JSON.parse(stdout)?.providers?.claude
    return ['five_hour', 'seven_day'].flatMap((kind) => {
      const w = claude?.[kind]
      return Number.isFinite(w?.projected) && Number.isFinite(w?.resetsAtMs)
        ? [{ kind, projected: w.projected as number, resetsAtMs: w.resetsAtMs as number }]
        : []
    })
  } catch {
    return []
  }
}

function write(grid: Cell[][], row: number, column: number, text: string, color: number) {
  const cells = [...text]
  cells.forEach((char, offset) => {
    const at = column + offset
    if (at < grid[row].length) grid[row][at] = [char, color, DEFAULT_COLOR]
  })
}

function drawLane(
  grid: Cell[][],
  row: number,
  label: string,
  reading: Reading | undefined,
  lines: readonly Line[],
  trackColumns: number,
  nowMs: number,
  forecast: { projected: number | null } | null,
) {
  const percent = reading?.percentUsed ?? 0
  write(grid, row, 0, `${label.padEnd(5)}${reading ? shown(reading) : '-'}`, TEXT)

  const filled = Math.min(trackColumns, Math.round((percent / 100) * trackColumns))
  const tone = toneOf(percent, lines)
  for (let i = 0; i < trackColumns; i++) {
    grid[row][TRACK_START + i] = i < filled ? ['█', tone, DEFAULT_COLOR] : ['░', DIM, DEFAULT_COLOR]
  }
  for (const line of lines) {
    const at = Math.min(trackColumns - 1, Math.round((line.at / 100) * trackColumns))
    grid[row][TRACK_START + at] = ['│', stops(line) ? RED : AMBER, DEFAULT_COLOR]
  }
  let column = TRACK_START + trackColumns + 1
  if (forecast) column = forecastSlot(grid, row, column, forecast.projected, lines)
  if (reading?.resetsAt) write(grid, row, column, resetLabel(reading.resetsAt, nowMs), DIM)
}

const mix = (from: number, to: number, amount: number) =>
  [16, 8, 0].reduce((color, shift) => {
    const a = (from >> shift) & 255
    const b = (to >> shift) & 255
    return color | (Math.round(a + (b - a) * amount) << shift)
  }, 0)

/** The colour of a pixel in this pose: drained when paused, lit by the breath when working. */
function pixelColor(pixel: string | undefined, pose: BandData): number | null {
  const color = pixel ? PIXELS[pixel] : undefined
  if (color === undefined) return null
  if (pixel === 'E' || pixel === 'W') return color
  return pose.paused ? mix(color, ASH, 0.85) : mix(color, LIT, 0.3 * breath(pose))
}

function drawMascot(grid: Cell[][], column: number, frame: readonly string[], pose: BandData) {
  const rows = Math.floor(frame.length / 2)
  const width = frame[0].length
  for (let row = 0; row < rows; row++) {
    for (let x = 0; x < width; x++) {
      const top = pixelColor(frame[row * 2][x], pose)
      const bottom = pixelColor(frame[row * 2 + 1][x], pose)
      if (top === null && bottom === null) continue
      const at = column + x
      // Apple Terminal draws blocks from the font: a sixth of a cell too low and a pixel
      // short of the bottom, with the background showing in both gaps. So a pixel at the
      // top of a cell is always the background, which is an exact rectangle, and ▄ is the
      // pixel below it. Its underline fills the gap at the bottom, and has the same colour
      // as ▄, so other terminals look no different. No sprite has a pixel with nothing
      // below it in its cell: ▀ would bring the top gap back.
      if (top === bottom) grid[row][at] = [' ', top as number, top as number]
      else grid[row][at] = ['▄', bottom as number, top ?? DEFAULT_COLOR, true]
    }
  }
}

const emptyGrid = (rows: number, columns: number): Cell[][] =>
  Array.from({ length: rows }, () =>
    Array.from({ length: columns }, (): Cell => [' ', DEFAULT_COLOR, DEFAULT_COLOR]),
  )

/** A thin bar of one row, with a tick at each line. */
function drawThin(grid: Cell[][], row: number, column: number, width: number, percent: number, lines: readonly Line[]) {
  const filled = Math.min(width, Math.round((percent / 100) * width))
  const tone = toneOf(percent, lines)
  for (let i = 0; i < width; i++) {
    grid[row][column + i] = i < filled ? ['━', tone, DEFAULT_COLOR] : ['─', DIM, DEFAULT_COLOR]
  }
  for (const line of lines) {
    const at = Math.min(width - 1, Math.round((line.at / 100) * width))
    grid[row][column + at] = ['│', stops(line) ? RED : AMBER, DEFAULT_COLOR]
  }
}

const lanes = (data: BandData) => [
  { label: '5h', reading: data.readings.find((r) => r.kind === 'five_hour'), lines: data.lines.five_hour },
  { label: 'week', reading: data.readings.find((r) => r.kind === 'seven_day'), lines: data.lines.seven_day },
]

const forecastColumns = (ahead: readonly (number | null)[]) => (ahead.some((p) => p !== null) ? FORECAST_COLUMNS : 0)

/** Mini Clawd beside two thin bars, or null when too narrow. Resets go first, then the forecast. */
export function miniGrid(data: BandData, columns: number, nowMs: number): Cell[][] | null {
  const room = columns - MINI_BAR - 5
  const ahead = lanes(data).map(({ reading }) => headedFor(reading, data))
  const wants = forecastColumns(ahead)
  const hasResets = room - wants - MINI_RESET_COLUMNS >= MINI_MIN_TRACK
  const hasForecast = wants > 0 && room - wants >= MINI_MIN_TRACK
  const track = Math.min(MINI_MAX_TRACK, room - (hasForecast ? wants : 0) - (hasResets ? MINI_RESET_COLUMNS : 0))
  // "paused" takes the first reset's place, so it needs that room. Paused shows no forecast.
  if (track < MINI_MIN_TRACK || (data.paused && !hasResets)) return null
  const grid = emptyGrid(MINI_ROWS, columns)
  drawMascot(grid, 1, miniFrame(data), data)
  lanes(data).forEach(({ label, reading, lines }, row) => {
    write(grid, row, MINI_TEXT, label, TEXT)
    drawThin(grid, row, MINI_BAR, track, reading?.percentUsed ?? 0, lines)
    const after = MINI_BAR + track + 1
    write(grid, row, after, reading ? shown(reading) : '-', TEXT)
    const next = hasForecast ? forecastSlot(grid, row, after + 5, ahead[row] ?? null, lines) : after + 5
    if (data.paused && row === 0) write(grid, row, next, 'paused', RED)
    else if (hasResets && reading?.resetsAt) write(grid, row, next, resetLabel(reading.resetsAt, nowMs), DIM)
  })
  return grid
}

/** Both bars on one row, or null when too narrow. The forecast goes before the bars do. */
export function lineGrid(data: BandData, columns: number, nowMs: number): Cell[][] | null {
  const fit = (extra: number) => Math.min(LINE_MAX_TRACK, Math.floor((columns - LINE_LANE_START) / 2) - extra)
  const ahead = lanes(data).map(({ reading }) => headedFor(reading, data))
  const wants = forecastColumns(ahead)
  const hasForecast = wants > 0 && fit(LINE_LANE_EXTRA + wants) >= LINE_MIN_TRACK
  const extra = LINE_LANE_EXTRA + (hasForecast ? wants : 0)
  const track = fit(extra)
  if (track < LINE_MIN_TRACK) return null
  const grid = emptyGrid(1, columns)
  write(grid, 0, 0, data.paused ? 'paused' : 'Peras', data.paused ? RED : DIM)
  lanes(data).forEach(({ label, reading, lines }, lane) => {
    const start = LINE_LANE_START + lane * (track + extra)
    write(grid, 0, start, label, TEXT)
    drawThin(grid, 0, start + 5, track, reading?.percentUsed ?? 0, lines)
    write(grid, 0, start + 6 + track, reading ? shown(reading) : '-', TEXT)
    const at = hasForecast ? forecastSlot(grid, 0, start + 11 + track, ahead[lane] ?? null, lines) : start + 11 + track
    const reset = reading?.resetsAt ? resetLabel(reading.resetsAt, nowMs).replace('resets ', '') : ''
    write(grid, 0, at, reset, DIM)
  })
  return grid
}

/** What Quiet has to say, or null when nothing has happened. */
export function quietNotice(data: BandData, nowMs: number): { title: string; detail: string; color: number } | null {
  const windows = lanes(data).flatMap(({ label, reading, lines }) => {
    if (!reading) return []
    const crossed = lines.filter((line) => reading.percentUsed >= line.at).sort((a, b) => b.at - a.at)[0]
    return [{ label, reading, lines, crossed }]
  })
  const reset = ({ reading }: (typeof windows)[number]) =>
    reading.resetsAt ? resetLabel(reading.resetsAt, nowMs).replace('resets', 'Resets') + '.' : ''

  if (data.paused) {
    const top = windows.filter((w) => w.crossed && stops(w.crossed))[0] ?? windows[0]
    const where = top ? `: ${top.label} ${shown(top.reading)}` : ''
    const when = top ? `${reset(top)} ` : ''
    return { title: `Peras paused Claude${where}`, detail: `${when}/peras resume lifts it.`, color: RED }
  }

  const passed = windows.filter((w) => w.crossed).sort((a, b) => b.crossed!.at - a.crossed!.at)
  const top = passed.find((w) => stops(w.crossed!)) ?? passed[0]
  if (!top?.crossed) return null
  const title = `${top.label} ${shown(top.reading)}: past your ${top.crossed.at}% line`
  const after = top.lines.filter((line) => stops(line) && line.at > top.reading.percentUsed).sort((a, b) => a.at - b.at)[0]
  const coming = after ? `Peras ${after.action === 'ask' ? 'asks you' : 'pauses Claude'} at ${after.at}%. ` : ''
  const detail = `${coming}${reset(top)}`.trim()
  return { title, detail, color: stops(top.crossed) ? RED : AMBER }
}

function quietView(data: BandData, columns: number, nowMs: number): BandView | null {
  const notice = quietNotice(data, nowMs)
  if (!notice) return null
  const text = [notice.title, notice.detail].filter(Boolean).join('. ')
  if (MINI_TEXT + Math.max(notice.title.length, notice.detail.length) > columns) return { grid: null, text }
  const grid = emptyGrid(MINI_ROWS, columns)
  drawMascot(grid, 1, miniFrame(data), data)
  write(grid, 0, MINI_TEXT, notice.title, notice.color)
  write(grid, 1, MINI_TEXT, notice.detail, DIM)
  return { grid, text }
}

/**
 * What to draw for a style: cells, a line of text for where cells don't fit, or
 * neither. With Peras's status line hidden, Quiet and off keep both numbers on
 * screen as text, because nothing else shows them.
 */
export function bandView(data: BandData, style: BandStyle, columns: number, nowMs: number, lineHidden = false): BandView {
  if (lineHidden && (style === 'off' || style === 'quiet')) return { grid: null, text: bandText(data) }
  if (style === 'off') return NOTHING
  if (style === 'quiet') return quietView(data, columns, nowMs) ?? NOTHING
  const grid = (style === 'mini' ? miniGrid : style === 'line' ? lineGrid : bandGrid)(data, columns, nowMs)
  return { grid, text: bandText(data) }
}

/** The full band as rows of cells, or null when the width is too narrow. */
export function bandGrid(data: BandData, columns: number, nowMs: number): Cell[][] | null {
  if (columns < MIN_COLUMNS) return null
  const grid = emptyGrid(BAND_ROWS, columns)
  const fiveHour = data.readings.find((r) => r.kind === 'five_hour')
  const week = data.readings.find((r) => r.kind === 'seven_day')
  const ahead = [headedFor(fiveHour, data), headedFor(week, data)]
  const wants = forecastColumns(ahead)
  const trackColumns = columns - TRACK_START - RESET_COLUMNS - wants
  const slot = (projected: number | null) => (wants ? { projected } : null)

  write(grid, 0, 0, data.paused ? 'paused' : 'Peras', data.paused ? RED : DIM)
  drawLane(grid, 1, '5h', fiveHour, data.lines.five_hour, trackColumns, nowMs, slot(ahead[0] ?? null))
  drawLane(grid, 2, 'week', week, data.lines.seven_day, trackColumns, nowMs, slot(ahead[1] ?? null))

  // Clawd stands at the end of whichever bar is further along.
  const furthest = Math.max(fiveHour?.percentUsed ?? 0, week?.percentUsed ?? 0)
  const travel = trackColumns - MASCOT_COLUMNS
  const column = TRACK_START + Math.min(travel, Math.round((furthest / 100) * travel))
  drawMascot(grid, column, fullFrame(data), data)
  return grid
}

const hex = (color: number) => (color === DEFAULT_COLOR ? undefined : `#${color.toString(16).padStart(6, '0')}`)
const isBlank = ([char, color, background]: Cell) => char === ' ' && background === DEFAULT_COLOR && color === DEFAULT_COLOR

/** A grid as rows of same-styled runs of text, without the blank cells at the end of a row. */
export function textRuns(grid: Cell[][]): Run[][] {
  return grid.map((row) => {
    const runs: Run[] = []
    const end = row.findLastIndex((cell) => !isBlank(cell)) + 1
    for (const cell of row.slice(0, end)) {
      const [char, color, background, under = false] = cell
      const run: Run = { text: char, color: hex(color), background: hex(background), under }
      const last = runs.at(-1)
      if (last && last.color === run.color && last.background === run.background && last.under === under) last.text += char
      else runs.push(run)
    }
    return runs
  })
}

/** The one line shown where the band's cells can't be drawn or don't fit. */
export function bandText(data: BandData): string {
  const parts = lanes(data).flatMap(({ label, reading }) => {
    if (!reading) return []
    const projected = headedFor(reading, data)
    return [`${label} ${shown(reading)}${projected === null ? '' : ` ${headed(projected)}`}`]
  })
  return ['Peras', ...parts, ...(data.paused ? ['paused'] : [])].join(' · ')
}

// What Peras draws when no config has been saved yet.
const DEFAULT_LINES: BandData['lines'] = {
  five_hour: [{ at: 95, action: 'warn' }],
  seven_day: [{ at: 75, action: 'warn' }, { at: 90, action: 'pause' }],
}

type Rule = {
  kind?: string; window?: string; at?: number; action?: string
  project?: string; during?: unknown; off?: boolean
}

const ruleKey = (r: Rule) => `${r.kind ?? 'window'}:${r.window}:${r.action}:${r.during ?? ''}`

// The same choice as Peras's effectiveRules: global lines, with the overrides of
// the closest folder on top.
function rulesFor(rules: Rule[], cwd: string): Rule[] {
  const global = rules.filter((r) => !r.project)
  const contains = (project: string) =>
    cwd === project || cwd.startsWith(project.endsWith('/') ? project : `${project}/`)
  const closest = rules
    .flatMap((r) => (r.project && contains(r.project) ? [r.project] : []))
    .sort((a, b) => b.length - a.length)[0]
  if (!closest) return global
  const local = rules.filter((r) => r.project === closest)
  const replaced = new Set(local.map(ruleKey))
  return [...global.filter((r) => !replaced.has(ruleKey(r))), ...local]
}

/**
 * The lines to mark in this folder: none unless Peras's hooks are in, because a
 * config left behind enforces nothing. With no saved config, Peras's defaults. Lines that apply only at certain times stay
 * unmarked, so a mark is always a line that's on.
 */
export function linesFrom(config: string | null, cwd: string, hasPeras: boolean): BandData['lines'] {
  const none = (): BandData['lines'] => ({ five_hour: [], seven_day: [] })
  if (!hasPeras) return none()
  if (config === null) return DEFAULT_LINES
  const lines = none()
  try {
    const rules: unknown = JSON.parse(config).rules
    if (!Array.isArray(rules)) return DEFAULT_LINES
    for (const rule of rulesFor(rules, cwd)) {
      if ((rule?.kind ?? 'window') !== 'window' || rule.off || rule.during || typeof rule.at !== 'number') continue
      if (rule.window !== 'five_hour' && rule.window !== 'seven_day') continue
      lines[rule.window].push({ at: rule.at, action: rule.action === 'warn' || rule.action === 'ask' ? rule.action : 'pause' })
    }
  } catch {
    return none()
  }
  return lines
}

/** Whether a PreToolUse refusal is Peras pausing, not some other hook or a subagent hold. */
export const isPerasRefusal = (deny: unknown) =>
  typeof deny === 'string' && deny.includes('usage guard (Peras) has paused')

/** Whether a PostToolBatch stop is Peras pausing. */
export const isPerasStop = (stopReason: unknown) =>
  typeof stopReason === 'string' && stopReason.startsWith('Peras paused')
