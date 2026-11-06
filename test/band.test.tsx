import { expect, mock, test } from 'claude-code/testing'

import {
  bandGrid, bandText, bandView, forecastsFrom, headedFor, isPerasRefusal, isPerasStop, lineGrid, linesFrom, miniGrid,
  quietNotice, resetLabel, textRuns,
} from '../hooks/band-cells'
import { fullFrame, miniFrame } from '../hooks/frames'

const NOW = new Date(2026, 10, 2, 17, 0).getTime()
const data = {
  readings: [
    { kind: 'five_hour', percentUsed: 14, resetsAt: new Date(2026, 10, 2, 19, 0).toISOString() },
    { kind: 'seven_day', percentUsed: 91, resetsAt: new Date(2026, 10, 7, 18, 0).toISOString() },
  ],
  lines: { five_hour: [], seven_day: [{ at: 75, action: 'warn' as const }, { at: 90, action: 'pause' as const }] },
  paused: false,
  isWorking: false,
  step: 0,
}
const text = (row: [string, number, number][]) => row.map((cell) => cell[0]).join('')

test('reset times read in local time', () => {
  expect(resetLabel(data.readings[0].resetsAt, NOW)).toBe('resets 19:00')
  expect(resetLabel(data.readings[1].resetsAt, NOW)).toBe('resets Sat 18:00')
  expect(resetLabel('not a date', NOW)).toBe('')
})

test('the band shows both bars and their percentages', () => {
  const grid = bandGrid(data, 80, NOW)
  expect(grid?.length).toBe(4)
  expect(text(grid![1]).startsWith('5h   14%')).toBe(true)
  expect(text(grid![2]).startsWith('week 91%')).toBe(true)
  expect(text(grid![1])).toContain('resets 19:00')
})

test('every row is as wide as the band', () => {
  for (const columns of [56, 80, 200]) {
    const grid = bandGrid(data, columns, NOW)
    expect(grid!.every((row) => row.length === columns)).toBe(true)
  }
})

test('a full bar stays inside the band', () => {
  const full = { ...data, readings: data.readings.map((r) => ({ ...r, percentUsed: 100 })) }
  expect(bandGrid(full, 56, NOW)!.every((row) => row.length === 56)).toBe(true)
})

test('it says paused only when told', () => {
  expect(text(bandGrid(data, 80, NOW)![0])).not.toContain('paused')
  expect(text(bandGrid({ ...data, paused: true }, 80, NOW)![0])).toContain('paused')
})

test('too narrow means no grid, and one line of text instead', () => {
  expect(bandGrid(data, 55, NOW)).toBe(null)
  expect(bandText({ ...data, paused: true })).toBe('Peras · 5h 14% · week 91% · paused')
})

test('mini is two rows with a small Clawd, and stays inside the band at any width', () => {
  const grid = miniGrid(data, 100, NOW)
  expect(grid?.length).toBe(2)
  expect(text(grid![0])).toContain('5h')
  expect(text(grid![0])).toContain('14%')
  expect(text(grid![1])).toContain('week')
  expect(text(grid![1])).toContain('resets Sat 18:00')
  for (const columns of [31, 45, 80, 512]) expect(miniGrid(data, columns, NOW)!.every((row) => row.length === columns)).toBe(true)
})

test('a narrow mini drops resets first, then falls back to text', () => {
  expect(text(miniGrid(data, 36, NOW)![0])).not.toContain('resets')
  expect(miniGrid(data, 30, NOW)).toBe(null)
  expect(bandView(data, 'mini', 30, NOW)).toEqual({ grid: null, text: bandText(data) })
})

const workingAt = (step: number) => ({ isWorking: true, paused: false, step })
const idle = { isWorking: false, paused: false, step: 0 }
const asleep = { isWorking: true, paused: true, step: 1 }
const outline = (frame: readonly string[]) => frame.map((row) => row.replace(/[^.]/g, '#')).join()
const BREATH = Array.from({ length: 200 }, (_, step) => workingAt(step))

test('Clawd never changes outline while working', () => {
  for (const frame of [miniFrame, fullFrame]) {
    expect(new Set(BREATH.map((pose) => outline(frame(pose)))).size).toBe(1)
  }
})

test('every frame is a clean rectangle, and Clawd is symmetrical at rest', () => {
  for (const frame of [miniFrame, fullFrame]) {
    for (const pose of [...BREATH, idle, asleep]) {
      expect(new Set(frame(pose).map((row) => row.length)).size).toBe(1)
      expect(frame(pose).length).toBe(frame(idle).length)
    }
    const shape = frame(idle).map((row) => row.replaceAll('W', 'E'))
    expect(shape.every((row) => row === [...row].reverse().join(''))).toBe(true)
  }
})

test('Clawd blinks and glances now and then, and only while working', () => {
  for (const frame of [miniFrame, fullFrame]) {
    const seen = new Set(BREATH.map((pose) => frame(pose).join()))
    expect(seen.size).toBe(3)
    expect(frame(workingAt(0))).toEqual(frame(idle))
    expect(frame(workingAt(41)).join('')).not.toContain('E')
    const atRest = BREATH.filter((pose) => frame(pose) === frame(idle)).length
    expect(atRest / BREATH.length).toBeGreaterThan(0.75)
    expect(frame({ ...idle, step: 41 })).toEqual(frame(idle))
  }
})

test('Clawd sinks down with closed eyes when paused', () => {
  for (const frame of [miniFrame, fullFrame]) {
    const sleeping = frame(asleep)
    expect(sleeping[0]).toBe('.'.repeat(sleeping[0].length))
    expect(sleeping.join('')).toContain('E')
    expect(sleeping.join('')).not.toContain('W')
  }
})

const colors = (pose: Partial<typeof data>, column: number) => miniGrid({ ...data, ...pose }, 100, NOW)![1][column]

test('Clawd brightens with each breath and the eyes stay dark', () => {
  const body = 2
  const rest = colors({ isWorking: true, step: 0 }, body)
  const full = colors({ isWorking: true, step: 16 }, body)
  expect(full[1]).not.toBe(rest[1])
  expect(colors({ isWorking: true, step: 32 }, body)).toEqual(rest)
  expect(colors({ isWorking: false, step: 16 }, body)).toEqual(rest)
  const eye = 4
  expect(colors({ isWorking: true, step: 16 }, eye)[2]).toBe(colors({ isWorking: true, step: 0 }, eye)[2])
})

test('mini draws each pixel in its own colour, with the glint above the eye', () => {
  const [top, bottom] = miniGrid(data, 100, NOW)!
  expect(top[3]).toEqual(['▄', 0xffffff, 0xf0a184, true])
  expect(top[4]).toEqual(['▄', 0x17110f, 0xf0a184, true])
  expect(bottom[3]).toEqual(['▄', 0xd97757, 0x17110f, true])
  expect(bottom[6]).toEqual([' ', 0xd97757, 0xd97757])
  expect(top.slice(2, 11).every(([char]) => char === '▄')).toBe(true)
  expect(text(bottom).slice(1, 12).trim().length).toBe(11)
})

test('paused drains the colour', () => {
  const [, r, g, b] = [0, ...[16, 8, 0].map((shift) => (colors({ paused: true }, 7)[1] >> shift) & 255)]
  expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(40)
})

test('mini says paused', () => {
  expect(text(miniGrid({ ...data, paused: true }, 100, NOW)![0])).toContain('paused')
})

test('one line is one row with both windows, and text when too narrow', () => {
  const grid = lineGrid(data, 100, NOW)
  expect(grid?.length).toBe(1)
  for (const word of ['5h', '14%', '19:00', 'week', '91%', 'Sat 18:00']) expect(text(grid![0])).toContain(word)
  expect(text(grid![0])).not.toContain('resets')
  expect(lineGrid(data, 67, NOW)).toBe(null)
  expect(lineGrid(data, 68, NOW)!.every((row) => row.length === 68)).toBe(true)
})

const calm = { ...data, readings: [{ ...data.readings[0], percentUsed: 24 }, { ...data.readings[1], percentUsed: 15 }] }
const warned = { ...data, readings: [data.readings[0], { ...data.readings[1], percentUsed: 78 }] }

test('quiet shows nothing until a line is crossed', () => {
  expect(quietNotice(calm, NOW)).toBe(null)
  expect(bandView(calm, 'quiet', 100, NOW)).toEqual({ grid: null, text: null })
})

test('past a warn line, quiet names the line and the pause to come', () => {
  const notice = quietNotice(warned, NOW)
  expect(notice?.title).toBe('week 78%: past your 75% line')
  expect(notice?.detail).toBe('Peras pauses Claude at 90%. Resets Sat 18:00.')
  expect(bandView(warned, 'quiet', 100, NOW).grid?.length).toBe(2)
  expect(bandView(warned, 'quiet', 30, NOW)).toEqual({
    grid: null, text: 'week 78%: past your 75% line. Peras pauses Claude at 90%. Resets Sat 18:00.',
  })
})

test('an ask line is described as asking, never as a pause', () => {
  const lines = { five_hour: [], seven_day: [{ at: 75, action: 'warn' as const }, { at: 90, action: 'ask' as const }] }
  expect(quietNotice({ ...warned, lines }, NOW)?.detail).toBe('Peras asks you at 90%. Resets Sat 18:00.')
})

test('quiet falls back to text before it would clip a word', () => {
  const paused = { ...data, paused: true }
  expect(bandView(paused, 'quiet', 54, NOW).grid?.length).toBe(2)
  const view = bandView(paused, 'quiet', 53, NOW)
  expect(view.grid).toBe(null)
  expect(view.text).toContain('/peras resume lifts it.')
})

test('decimal readings fit and paused never covers a number', () => {
  const fine = { ...data, paused: true, readings: data.readings.map((r) => ({ ...r, percentUsed: 99.9 })) }
  expect(text(miniGrid(fine, 48, NOW)![0])).toContain('100%')
  expect(text(miniGrid(fine, 48, NOW)![0])).toContain('paused')
  expect(miniGrid(fine, 47, NOW)).toBe(null)
  expect(bandText(fine)).toBe('Peras · 5h 100% · week 100% · paused')
})

test('when paused, quiet says so and how to lift it', () => {
  const notice = quietNotice({ ...data, paused: true }, NOW)
  expect(notice?.title).toBe('Peras paused Claude: week 91%')
  expect(notice?.detail).toBe('Resets Sat 18:00. /peras resume lifts it.')
})

test('a pause from /peras pause with no line crossed still reads', () => {
  expect(quietNotice({ ...calm, paused: true }, NOW)?.title).toBe('Peras paused Claude: 5h 24%')
})

test('off shows nothing', () => {
  expect(bandView(warned, 'off', 100, NOW)).toEqual({ grid: null, text: null })
})

test('with the status line hidden, quiet and off keep the numbers as text', () => {
  expect(bandView(calm, 'off', 100, NOW, true).text).toBe('Peras · 5h 24% · week 15%')
  expect(bandView(calm, 'quiet', 100, NOW, true).text).toBe('Peras · 5h 24% · week 15%')
  expect(bandView(warned, 'quiet', 100, NOW, true)).toEqual({ grid: null, text: 'Peras · 5h 14% · week 78%' })
})

test('full is the four-row band', () => {
  expect(bandView(data, 'full', 80, NOW).grid?.length).toBe(4)
})

test('lines come from window rules only, and bad config means none', () => {
  const config = JSON.stringify({
    rules: [
      { kind: 'window', window: 'seven_day', at: 90, action: 'pause' },
      { kind: 'pace', window: 'seven_day', at: 50, action: 'warn' },
    ],
  })
  expect(linesFrom(config, '/w', true).seven_day).toEqual([{ at: 90, action: 'pause' }])
  expect(linesFrom('{nope', '/w', true).seven_day).toEqual([])
})

test('no saved config means Peras defaults if it is set up, and none if not', () => {
  expect(linesFrom(null, '/w', true).seven_day).toEqual([{ at: 75, action: 'warn' }, { at: 90, action: 'pause' }])
  expect(linesFrom(null, '/w', false)).toEqual({ five_hour: [], seven_day: [] })
})

test('a config left behind after Peras is removed marks nothing', () => {
  const config = JSON.stringify({ rules: [{ kind: 'window', window: 'seven_day', at: 90, action: 'pause' }] })
  expect(linesFrom(config, '/w', false).seven_day).toEqual([])
})

test('a rule saved before kinds existed still counts as a window line', () => {
  const config = JSON.stringify({ rules: [{ window: 'seven_day', at: 90, action: 'pause' }] })
  expect(linesFrom(config, '/w', true).seven_day).toEqual([{ at: 90, action: 'pause' }])
})

test('a folder override turns a line off here and nowhere else', () => {
  const line = { kind: 'window', window: 'seven_day', at: 90, action: 'pause' }
  const config = JSON.stringify({ rules: [line, { ...line, project: '/w/a', off: true }] })
  expect(linesFrom(config, '/w/a/src', true).seven_day).toEqual([])
  expect(linesFrom(config, '/w/ab', true).seven_day).toEqual([{ at: 90, action: 'pause' }])
})

test('a folder line replaces the global one of the same action', () => {
  const line = { kind: 'window', window: 'seven_day', at: 90, action: 'pause' }
  const config = JSON.stringify({ rules: [line, { ...line, at: 50, project: '/w/a' }] })
  expect(linesFrom(config, '/w/a', true).seven_day).toEqual([{ at: 50, action: 'pause' }])
})

test('a line for one folder or for certain hours stays unmarked elsewhere', () => {
  const line = { kind: 'window', window: 'five_hour', at: 80, action: 'ask' }
  const config = JSON.stringify({ rules: [{ ...line, project: '/w/a' }, { ...line, at: 60, during: 'work' }] })
  expect(linesFrom(config, '/w/b', true).five_hour).toEqual([])
  expect(linesFrom(config, '/w/a', true).five_hour).toEqual([{ at: 80, action: 'ask' }])
})

test('only Peras pausing counts, in the words the hooks really send', () => {
  expect(isPerasRefusal("PreToolUse:Bash hook error: The user's usage guard (Peras) has paused tool use: weekly 90%.")).toBe(true)
  expect(isPerasRefusal("The user's usage guard (Peras) is not starting new subagents: 5 running.")).toBe(false)
  expect(isPerasRefusal('some other hook said no')).toBe(false)
  expect(isPerasStop('Peras paused Claude Code: weekly 90%. Resets Sat 18:00')).toBe(true)
  expect(isPerasStop(undefined)).toBe(false)
})

const BAND = {
  plugin: 'peras',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const PERAS = {
  type: 'command',
  command: `"/n/node" "/h/.peras/app/bin/peras.mjs" statusline || echo '🍐 Peras could not run (is node still where setup found it?): run peras setup again'`,
}

function engine(on: any, preToolUse: unknown = {}, options: { statusLine?: unknown; store?: Record<string, unknown>; install?: unknown } = {}) {
  const store = options.store ?? {}
  on('settings.read', (_$: unknown, e: any) => e.key === 'statusLine' ? { value: options.statusLine } : { value: { statusLine: options.statusLine, model: 'm' } })
  on('fs.list', () => ({ value: [{ name: 'other.json', kind: 'file' }, { name: 'a.json', kind: 'file' }, { name: 'folder.json', kind: 'dir' }] }))
  on('session.start', (_$: unknown, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/h' }))
  on('session.cwd', () => ({ value: '/w' }))
  on('fs.read', (_$: unknown, e: any) => ({ value: JSON.stringify(String(e.path).endsWith('/a.json') ? { settingsPath: '/h/settings.json', ...options.install as object } : String(e.path).endsWith('/other.json') ? { settingsPath: '/x/settings.json', statusLine: { command: 'someone-else' } } : {}) }))
  on('store.get', (_$: unknown, e: any) => ({ value: store[e.key] }))
  on('store.set', (_$: unknown, e: any) => { store[e.key] = e.value; return { value: undefined } })
  on('session.measure', () => ({ changed: [] }))
  on('classic.PreToolUse', () => preToolUse)
  on('tool.call', () => ({ result: {} }))
  on('clock.now', () => ({ value: 0 }))
  on('classic.PostToolBatch', () => ({ preventContinuation: true, stopReason: 'Peras paused Claude Code: test' }))
}

const REFUSED = { deny: "PreToolUse:Bash hook error: The user's usage guard (Peras) has paused tool use: test" }

async function bandLine($: any) {
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const text = (await ui.find({ type: 'Text' }))?.text
  await ui.unmount()
  return text
}

const measure = ($: any, rateLimits: unknown[] = data.readings) =>
  $.session.measure({ changed: ['rateLimits'], rateLimits } as never)

const START = { cwd: '/w', surface: 'terminal', isInteractive: false }
const band = async ($: any, words: string) =>
  (await $.command.run({ command: 'peras', args: words, origin: { kind: 'composer' } })).text

test('the default style is mini, and a choice is saved', async ($, on) => {
  const store: Record<string, unknown> = {}
  engine(on, {}, { store })
  expect(await band($, 'band')).toContain('Band style: mini')
  expect(await band($, 'band full')).toBe('Band style: full.')
  expect(store.bandStyle).toBe('full')
  expect(await band($, 'band on')).toBe('Band style: mini.')
  expect(await band($, 'band huge')).toBe('Choose one of: mini, quiet, line, full, off.')
  expect(store.bandStyle).toBe('mini')
})

test('picking a style that replaces the status line says when it goes', async ($, on) => {
  engine(on, {}, { statusLine: PERAS, store: { bandStyle: 'quiet' } })
  await $.session.start(START as never)
  expect(await band($, 'band mini')).toBe('Band style: mini. The Peras status line goes away next session.')
})

test('a status line chained behind Peras is left alone', async ($, on) => {
  engine(on, {}, { statusLine: PERAS, install: { statusLine: { command: 'ccstatusline' } }, store: { bandStyle: 'quiet' } })
  await $.session.start(START as never)
  expect(await band($, 'band mini')).toBe('Band style: mini.')
})

test('a command with more in it than setup writes is left alone', async ($, on) => {
  engine(on, {}, { statusLine: { type: 'command', command: `${PERAS.command}; my-status` }, store: { bandStyle: 'quiet' } })
  await $.session.start(START as never)
  expect(await band($, 'band mini')).toBe('Band style: mini.')
})

test('no install record for this Claude folder leaves the line alone', async ($, on) => {
  engine(on, {}, { statusLine: PERAS, install: { settingsPath: '/x/settings.json' }, store: { bandStyle: 'quiet' } })
  await $.session.start(START as never)
  expect(await band($, 'band mini')).toBe('Band style: mini.')
})

test('another status line is left alone', async ($, on) => {
  engine(on, {}, { statusLine: { type: 'command', command: 'ccstatusline' } })
  await $.session.start(START as never)
  expect(await band($, 'band off')).toBe('Band style: off.')
})

test('a Peras refusal shows paused on the text band', async ($, on) => {
  engine(on, REFUSED)
  await measure($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(await bandLine($)).toBe('Peras · 5h 14% · week 91% · paused')
})

test('a stop after a batch shows paused too', async ($, on) => {
  engine(on)
  await measure($)
  await $.classic.PostToolBatch({} as never)
  expect(await bandLine($)).toBe('Peras · 5h 14% · week 91% · paused')
})

test('a tool that goes through clears it', async ($, on) => {
  engine(on)
  await measure($)
  await $.classic.PostToolBatch({} as never)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(await bandLine($)).toBe('Peras · 5h 14% · week 91%')
})

test('another hook refusing does not claim a pause', async ($, on) => {
  engine(on, { deny: 'not this file' })
  await measure($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(await bandLine($)).toBe('Peras · 5h 14% · week 91%')
})

test('no reading means no band', async ($, on) => {
  engine(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  expect(await bandLine($)).toBe('engine')
})

test('readings that go away take the band with them', async ($, on) => {
  engine(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await measure($)
  await measure($, [])
  expect(await bandLine($)).toBe('engine')
})

test('a very wide terminal still gets a band it can draw', async ($, on) => {
  engine(on)
  await measure($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 600 } })
  expect(await ui.find({ type: 'Box' })).toBeTruthy()
  await ui.unmount()
})

test('runs join cells of one style and leave off the blank end of a row', () => {
  const blank = 0x01000000
  const runs = textRuns([[
    ['a', 0xbbbbbb, blank],
    ['b', 0xbbbbbb, blank],
    ['▄', 0xd97757, 0x17110f, true],
    [' ', blank, blank],
    ['c', 0xbbbbbb, blank],
    [' ', blank, blank],
  ]])
  expect(runs[0].map((run) => run.text)).toEqual(['ab', '▄', ' ', 'c'])
  expect(runs[0][1]).toEqual({ text: '▄', color: '#d97757', background: '#17110f', under: true })
  expect(runs[0][2]).toEqual({ text: ' ', color: undefined, background: undefined, under: false })
})

test('no sprite has a pixel with nothing below it in its cell', () => {
  const poses = [
    { isWorking: false, paused: false, step: 0 },
    { isWorking: true, paused: false, step: 35 },
    { isWorking: true, paused: false, step: 41 },
    { isWorking: false, paused: true, step: 0 },
  ]
  for (const frame of poses.flatMap((pose) => [miniFrame(pose), fullFrame(pose)])) {
    for (let row = 0; row < frame.length; row += 2) {
      expect([...frame[row]].every((pixel, x) => pixel === '.' || frame[row + 1][x] !== '.')).toBe(true)
    }
  }
})

// Peras's forecast for each window, as `peras usage --json` gives it.
const ms = (reading: { resetsAt: string }) => new Date(reading.resetsAt).getTime()
const forecasts = [
  { kind: 'five_hour', projected: 40, resetsAtMs: ms(data.readings[0]) },
  { kind: 'seven_day', projected: 100, resetsAtMs: ms(data.readings[1]) },
]
const headed = { ...data, forecasts }

test('the band says where each window is headed', () => {
  expect(bandText(headed)).toBe('Peras · 5h 14% → 40% · week 91% → 100%')
  const mini = miniGrid(headed, 100, NOW)!
  expect(text(mini[0])).toContain('14%  → 40%  resets 19:00')
  expect(text(mini[1])).toContain('91%  → 100% resets Sat 18:00')
  const line = text(lineGrid(headed, 120, NOW)![0])
  expect(line).toContain('14%  → 40%  19:00')
  expect(line).toContain('91%  → 100% Sat 18:00')
  const full = bandGrid(headed, 80, NOW)!
  expect(text(full[1])).toContain('→ 40%  resets 19:00')
  expect(text(full[2])).toContain('→ 100% resets Sat 18:00')
})

test('a forecast past a line takes its colour, and grey otherwise', () => {
  const mini = miniGrid(headed, 100, NOW)!
  const arrow = (row: number) => mini[row].find((cell) => cell[0] === '→')!
  expect(arrow(0)[1]).toBe(0x666666)
  expect(arrow(1)[1]).toBe(0xe5484d)
})

test('a forecast close to where the window is, or for another window, is left off', () => {
  const near = { ...data, forecasts: [{ ...forecasts[0], projected: 18 }, { ...forecasts[1], projected: 95 }] }
  expect(bandText(near)).toBe('Peras · 5h 14% · week 91%')
  expect(headedFor(data.readings[0], { ...data, forecasts: [{ ...forecasts[0], projected: 19 }] })).toBe(19)
  const old = { ...data, forecasts: forecasts.map((f) => ({ ...f, resetsAtMs: f.resetsAtMs - 5 * 3600_000 })) }
  expect(bandText(old)).toBe('Peras · 5h 14% · week 91%')
  expect(headedFor({ ...data.readings[0], resetsAt: '' }, headed)).toBe(null)
  expect(headedFor(data.readings[0], { ...headed, forecasts: [{ ...forecasts[0], projected: 250 }] })).toBe(100)
})

test('paused shows no forecast', () => {
  expect(bandText({ ...headed, paused: true })).toBe('Peras · 5h 14% · week 91% · paused')
  expect(text(miniGrid({ ...headed, paused: true }, 100, NOW)![1])).not.toContain('→')
})

test('one window headed somewhere keeps both rows lined up', () => {
  const one = { ...data, forecasts: [forecasts[1]] }
  const mini = miniGrid(one, 100, NOW)!
  expect(text(mini[0]).indexOf('resets')).toBe(text(mini[1]).indexOf('resets'))
  expect(text(mini[0])).not.toContain('→')
})

test('with a forecast every style stays inside the band, and narrow mini drops resets first', () => {
  for (const columns of [31, 38, 45, 52, 80, 512]) {
    const grid = miniGrid(headed, columns, NOW)
    if (grid) expect(grid.every((row) => row.length === columns)).toBe(true)
  }
  for (const columns of [56, 80, 200]) expect(bandGrid(headed, columns, NOW)!.every((row) => row.length === columns)).toBe(true)
  for (const columns of [68, 82, 96, 200]) expect(lineGrid(headed, columns, NOW)!.every((row) => row.length === columns)).toBe(true)
  const narrow = text(miniGrid(headed, 40, NOW)![1])
  expect(narrow).toContain('→ 100%')
  expect(narrow).not.toContain('resets')
  expect(text(lineGrid(headed, 68, NOW)![0])).not.toContain('→')
  expect(miniGrid(headed, 30, NOW)).toBe(null)
})

test('forecasts are read from Peras usage JSON, and anything else means none', () => {
  const json = JSON.stringify({ providers: {
    claude: { five_hour: { used: 14, resetsAtMs: 1, projected: 40 }, seven_day: { used: 91, resetsAtMs: 2, projected: null } },
    codex: { five_hour: { used: 1, resetsAtMs: 3, projected: 90 } },
  } })
  expect(forecastsFrom(json)).toEqual([{ kind: 'five_hour', projected: 40, resetsAtMs: 1 }])
  expect(forecastsFrom('{')).toEqual([])
  expect(forecastsFrom('null')).toEqual([])
  expect(forecastsFrom('{"providers":{}}')).toEqual([])
})

const USAGE = JSON.stringify({ providers: { claude: {
  five_hour: { used: 14, resetsAtMs: forecasts[0].resetsAtMs, projected: 40 },
  seven_day: { used: 91, resetsAtMs: forecasts[1].resetsAtMs, projected: 100 },
} } })
const HOOKS = Object.fromEntries(['UserPromptSubmit', 'PreToolUse', 'PostToolBatch']
  .map((event) => [event, [{ hooks: [{ type: 'command', command: '"/n/node" "/h/.peras/app/bin/peras.mjs" hook' }] }]]))

function perasEngine(on: any, options: { installed?: boolean; stdout?: string; exitCode?: number; fail?: boolean } = {}) {
  const calls: { argv: readonly string[]; init?: any }[] = []
  const clock = mock.clock(on)
  on('settings.read', () => ({ value: options.installed === false ? {} : { hooks: HOOKS } }))
  on('fs.list', () => ({ value: [{ name: 'a.json', kind: 'file' }] }))
  on('fs.read', (_$: unknown, e: any) => {
    if (!String(e.path).endsWith('/a.json')) throw new Error('missing')
    return { value: JSON.stringify({ settingsPath: '/h/.claude/settings.json', command: '"/n/node" "/h/.peras/app/bin/peras.mjs"' }) }
  })
  on('fs.exists', () => ({ value: true }))
  on('env.get', (_$: unknown, e: any) => ({ value: e.name === 'HOME' ? '/h' : undefined }))
  on('session.cwd', () => ({ value: '/w' }))
  on('store.get', () => ({ value: undefined }))
  on('session.measure', () => ({ changed: [] }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', (_$: unknown, e: any) => {
    calls.push({ argv: e.argv, init: e.init })
    if (options.fail) throw new Error('timed out')
    return { value: { exitCode: options.exitCode ?? 0, stdout: options.stdout ?? USAGE, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { calls, clock, options }
}

const measured = async ($: any, peras: ReturnType<typeof perasEngine>) => {
  await measure($)
  await peras.clock.settle()
}

test('Peras is asked where the windows are headed, once a minute at most', async ($, on) => {
  const peras = perasEngine(on)
  await measured($, peras)
  expect(await bandLine($)).toBe('Peras · 5h 14% → 40% · week 91% → 100%')
  expect(peras.calls).toEqual([{ argv: ['/n/node', '/h/.peras/app/bin/peras.mjs', 'usage', '--json'], init: { env: {}, stdin: '', timeoutMs: 5000 } }])
  await peras.clock.advance(59_000)
  await measured($, peras)
  expect(peras.calls.length).toBe(1)
  await peras.clock.advance(1_000)
  await measured($, peras)
  expect(peras.calls.length).toBe(2)
})

for (const [name, options] of [
  ['fails to run', { fail: true }],
  ['exits with an error', { exitCode: 1 }],
  ['is too old for usage', { stdout: 'Unknown command: usage' }],
] as const) {
  test(`a Peras that ${name} shows no forecast`, async ($, on) => {
    const peras = perasEngine(on, options)
    await measured($, peras)
    expect(peras.calls.length).toBe(1)
    expect(await bandLine($)).toBe('Peras · 5h 14% · week 91%')
  })
}

test('without Peras set up nothing is run', async ($, on) => {
  const peras = perasEngine(on, { installed: false })
  await measured($, peras)
  expect(peras.calls.length).toBe(0)
  expect(await bandLine($)).toBe('Peras · 5h 14% · week 91%')
})

test('a failed ask clears a forecast from before', async ($, on) => {
  const peras = perasEngine(on)
  await measured($, peras)
  expect(await bandLine($)).toContain('→')
  peras.options.exitCode = 1
  await peras.clock.advance(60_000)
  await measured($, peras)
  expect(await bandLine($)).toBe('Peras · 5h 14% · week 91%')
})
