import { atom, read, update } from 'claude-code'
import type { EngineInterface, ProcessRunInit, Register } from 'claude-code'

// Every hook, and every function handed `$`, lives in this one file: the plugin
// directory reads a mod's calls only where they are written this way. The other
// files hold plain code that never sees `$`.
import { bandText, bandView, forecastsFrom, isPerasRefusal, isPerasStop, linesFrom, textRuns } from './band-cells'
import {
  HELP, NOT_SETUP, NOT_SETUP_NOTICE, PERAS_CLI_VERSION, RUN_FAILED, SETUP_FAILED, answerFrom, say,
} from './commands'
import type { Answer } from './commands'
import { STEP_MS } from './frames'
import { hasAllHooks, hasHook, parseRuntime } from './runtime'
import type { Runtime } from './runtime'
import type { BandStyle, Forecast, Lines, Reading } from '../types'

const readings = atom({ plugin: 'peras', key: 'readings' } as const, [] as readonly Reading[])
const lines = atom({ plugin: 'peras', key: 'lines' } as const, { five_hour: [], seven_day: [] } as Lines)
const paused = atom({ plugin: 'peras', key: 'paused' } as const, false)
const style = atom({ plugin: 'peras', key: 'style' } as const, 'mini' as BandStyle)
const lineHidden = atom({ plugin: 'peras', key: 'lineHidden' } as const, false)
const hasPeras = atom({ plugin: 'peras', key: 'hasPeras' } as const, false)
const step = atom({ plugin: 'peras', key: 'step' } as const, 0)
const forecasts = atom({ plugin: 'peras', key: 'forecasts' } as const, [] as readonly Forecast[])
const forecastAskedAt = atom({ plugin: 'peras', key: 'forecastAskedAt' } as const, null as number | null)

const MAX_COLUMNS = 512
// Readings come often and each ask starts Node, so Peras is asked once a minute at most.
const FORECAST_EVERY_MS = 60_000
const FORECAST_TIMEOUT_MS = 5_000
const STYLE_KEY = 'bandStyle'
const STYLES: readonly BandStyle[] = ['mini', 'quiet', 'line', 'full', 'off']
const DEFAULT_STYLE: BandStyle = 'mini'
const CHOICES = STYLES.join(', ')
// The whole of what setup writes, so a command with more in it is left alone.
const PERAS_LINE = /peras\.mjs"?\s+statusline(\s+\|\|\s+echo\s+'[^']*could not run[^']*')?\s*$/

const isStyle = (value: unknown): value is BandStyle => STYLES.includes(value as BandStyle)
const replacesLine = (chosen: BandStyle) => chosen !== 'quiet' && chosen !== 'off'

// Peras's status line feeds it the readings, so it keeps running with its text
// dropped. Peras's own "could not run" message still gets through.
const silenced = (command: string) =>
  `out=$( ${command} ); case "$out" in *'could not run'*) printf '%s\n' "$out";; esac`

let noticed = false

// ---- Finding Peras ----

/** Whether all three of Peras's hooks are still in the settings. */
async function hooksComplete($: EngineInterface): Promise<boolean> {
  try {
    const hooks: unknown = await $.settings.read({ key: 'hooks' })
    return hasAllHooks(hooks)
  } catch {
    return false
  }
}

/** Peras's home folder, or an empty string when HOME isn't set either. */
async function perasHome($: EngineInterface): Promise<string> {
  const home = await $.env.get('HOME')
  const folder = await $.env.get('PERAS_HOME') || (home ? `${home}/.peras` : '')
  return folder.replace(/\/$/, '')
}

/** Peras's install record for this Claude config folder, if there is one. */
async function installRecord($: EngineInterface): Promise<Record<string, any> | undefined> {
  try {
    const home = await $.env.get('HOME')
    const peras = await perasHome($)
    const config = await $.env.get('CLAUDE_CONFIG_DIR') || (home ? `${home}/.claude` : '')
    if (!peras || !config) return
    const install = `${peras}/install`
    const settingsPath = `${config.replace(/\/$/, '')}/settings.json`
    const entries = await $.fs.list(install)
    for (const entry of entries) {
      if (!entry.name.endsWith('.json') || entry.kind !== 'file') continue
      try {
        const text = await $.fs.read(`${install}/${entry.name}`)
        const record = JSON.parse(text)
        if (record?.settingsPath === settingsPath) return record
      } catch { /* A broken record must not prevent setup or startup. */ }
    }
  } catch { /* Missing directories, settings, or permissions mean not set up. */ }
  return undefined
}

async function findRuntime($: EngineInterface): Promise<Runtime | undefined> {
  try {
    const record = await installRecord($)
    if (typeof record?.command !== 'string') return
    const runtime = parseRuntime(record.command)
    if (!runtime) return
    const isThere = await $.fs.exists(runtime.argv[1])
    if (!isThere) return
    const hooks: unknown = await $.settings.read({ key: 'hooks' })
    if (hasHook(hooks)) return runtime
  } catch { /* Missing settings or permissions mean not set up. */ }
  return undefined
}

// ---- /peras ----

async function run($: EngineInterface, argv: string[], init: ProcessRunInit, setup = false): Promise<Answer> {
  try {
    const result = await $.process.run(argv, { ...init, stdin: '' })
    return answerFrom(result, setup)
  } catch {
    return say(setup ? SETUP_FAILED : RUN_FAILED)
  }
}

/** Adds /peras, and says once if Peras isn't set up. Runs no process. */
async function startCommands($: EngineInterface, isInteractive: boolean | undefined) {
  await $.command.register({
    name: 'peras', description: 'Peras usage lines, pause and setup. No model call.',
    argumentHint: '[lines | set ... | pause ... | resume ... | doctor | setup | band ... | help]',
    immediate: true,
  })
  if (isInteractive && !noticed) {
    noticed = true
    const runtime = await findRuntime($)
    if (!runtime) $.ui.toast(NOT_SETUP_NOTICE)
  }
}

async function answerCommand($: EngineInterface, args: string, originKind: string): Promise<Answer> {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const [word, ...rest] = words
  if (word === 'help') return say(HELP)
  const runtime = await findRuntime($)
  if (word === 'setup') {
    if (rest.length) return say(HELP)
    if (runtime && await hooksComplete($)) {
      const doctor = await run($, [...runtime.argv, 'doctor'], { env: runtime.env })
      return { ...doctor, text: `Peras is already set up.\n\n${doctor.text}`.slice(0, 4000) }
    }
    if (originKind !== 'composer') return say('Type /peras setup at the prompt to install Peras.')
    // A partial install is repaired by the Peras already there, so it isn't replaced by an older pin.
    if (runtime) return run($, [...runtime.argv, 'setup'], { env: runtime.env, timeoutMs: 180000 }, true)
    const home = await $.env.get('HOME')
    if (!home) return say('Setup needs HOME to be set. Set it, then type /peras setup.')
    return run($, ['npx', '--yes', `peras-cli@${PERAS_CLI_VERSION}`, 'setup'],
      { cwd: home, timeoutMs: 180000 }, true)
  }
  if (!runtime) return say(NOT_SETUP)
  if (!word) return run($, [...runtime.argv, 'status'], { env: runtime.env })
  if (word === 'lines' && !rest.length) return run($, [...runtime.argv, 'why'], { env: runtime.env })
  if (['set', 'pause', 'resume'].includes(word) || (word === 'doctor' && !rest.length)) {
    return run($, [...runtime.argv, ...words], { env: runtime.env })
  }
  return say(HELP)
}

// ---- The band ----

async function savedStyle($: EngineInterface): Promise<BandStyle> {
  const saved = await $.store.get(STYLE_KEY)
  return isStyle(saved) ? saved : DEFAULT_STYLE
}

// Peras prints a status line someone had before it, after its own marker. Hiding
// Peras's output would hide theirs, so a chained line is left alone, and so is any
// install this plugin can't read.
async function hidesLine($: EngineInterface, chosen: BandStyle, command: unknown): Promise<boolean> {
  if (typeof command !== 'string' || !PERAS_LINE.test(command) || !replacesLine(chosen)) return false
  const record = await installRecord($)
  return record !== undefined && !record.statusLine?.command
}

async function lineCommand($: EngineInterface): Promise<unknown> {
  const statusLine: unknown = await $.settings.read({ key: 'statusLine' })
  return (statusLine as { command?: unknown } | undefined)?.command
}

// Without Peras there's no status line and no marks, so Quiet would show nothing
// at all. The numbers go on the plugin's own line under the prompt.
async function syncStatus($: EngineInterface) {
  const seen = await read($, readings)
  const isBare = (await read($, style)) === 'quiet' && !(await read($, hasPeras))
  const shown = isBare && seen.length
    ? bandText({ readings: seen, lines: await read($, lines), paused: false, isWorking: false, step: 0 })
    : undefined
  $.ui.status(shown)
}

// The band marks Peras's lines. They come from Peras's own config file, read as
// it stands; without Peras's hooks the band is a plain meter.
async function refreshLines($: EngineInterface) {
  let config: string | null = null
  try {
    const home = await perasHome($)
    config = await $.fs.read(`${home}/config.json`)
  } catch {
    config = null
  }
  const active = await hooksComplete($)
  const cwd = await $.session.cwd()
  const found = linesFrom(config, cwd, active)
  await update($, hasPeras, () => active)
  await update($, lines, () => found)
}

/**
 * Asks Peras where each window is headed, as its status line used to say. Read-only:
 * `peras usage --json` reads the readings Peras saved. Not set up, a Peras from before
 * 0.4.0, or anything going wrong means no forecast, and nothing said about it.
 */
async function refreshForecasts($: EngineInterface) {
  const now = await $.clock.now()
  let isDue = false
  await update($, forecastAskedAt, (at) => {
    isDue = at === null || now - at >= FORECAST_EVERY_MS
    return isDue ? now : at
  })
  if (!isDue) return
  let fresh: Forecast[] = []
  try {
    const runtime = await findRuntime($)
    if (runtime) {
      const result = await $.process.run([...runtime.argv, 'usage', '--json'],
        { env: runtime.env, stdin: '', timeoutMs: FORECAST_TIMEOUT_MS })
      if (result.exitCode === 0) fresh = forecastsFrom(result.stdout)
    }
  } catch {
    fresh = []
  }
  await update($, forecasts, () => fresh)
}

/** Loads what the band keeps between sessions and Peras's current lines. */
async function startBand($: EngineInterface) {
  try {
    const chosen = await savedStyle($)
    await update($, style, () => chosen)
    await refreshLines($)
  } catch {
    // The band is decoration. Its defaults are fine, and /peras must still work.
  }
}

/** Answers /peras band. Anything else returns null, for the commands to answer. */
async function bandCommand($: EngineInterface, args: string): Promise<string | null> {
  const [word, choice] = args.trim().split(/\s+/)
  if (word !== 'band') return null
  if (!choice) return `Band style: ${await read($, style)}. Choose with /peras band ${STYLES.join('|')}.`
  const chosen = choice === 'on' ? DEFAULT_STYLE : choice
  if (!isStyle(chosen)) return `Choose one of: ${CHOICES}.`
  await $.store.set(STYLE_KEY, chosen)
  await update($, style, () => chosen)
  await syncStatus($)

  const hidden = await read($, lineHidden)
  if (hidden && !replacesLine(chosen)) {
    return `Band style: ${chosen}. The Peras status line comes back next session. Until then the numbers stay above the prompt as one line of text.`
  }
  if (!hidden && replacesLine(chosen) && await hidesLine($, chosen, await lineCommand($))) {
    return `Band style: ${chosen}. The Peras status line goes away next session.`
  }
  return `Band style: ${chosen}.`
}

/** A pause or resume that worked shows at once, without waiting for a tool call. */
async function noteCommand($: EngineInterface, args: string) {
  const [word] = args.trim().split(/\s+/)
  if (word === 'resume') await update($, paused, () => false)
  if (word === 'pause') await update($, paused, () => true)
}

export const register: Register = (on) => {
  let breathing: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await startCommands($, e.isInteractive)
    await startBand($)
    return result
  })

  on('command.run', { command: 'peras' }, async ($, e) => {
    const band = await bandCommand($, e.args)
    if (band !== null) return { text: band }
    const { text, isOk } = await answerCommand($, e.args, e.origin.kind)
    if (isOk) await noteCommand($, e.args)
    return { text }
  })

  on('settings.read', async ($, e, next) => {
    const answer = await next(e)
    if (e.source || !answer.value || next.origin.plugin !== 'engine') return answer
    const statusLine = answer.value.statusLine as { command?: string } | undefined
    const command = statusLine?.command
    // Claude Code can merge settings again mid-session, so this is the one place
    // that knows whether the line is hidden right now.
    const chosen = await savedStyle($)
    const hide = await hidesLine($, chosen, command)
    await update($, lineHidden, () => hide)
    return hide ? { value: { ...answer.value, statusLine: { ...statusLine, command: silenced(command as string) } } } : answer
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const latest = e.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt: resetsAt ?? '' }))
    await update($, readings, () => latest)
    if (latest.length) await refreshLines($)
    await syncStatus($)
    // Not awaited: the reading shows now, the forecast when Peras answers.
    if (latest.length) void refreshForecasts($).catch(() => undefined)
    return next(e)
  })

  // Subagents' turns fire these too. Only the main turn moves the mascot.
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      breathing?.cancel()
      breathing = undefined
      const shown = await read($, style)
      if (shown !== 'line' && shown !== 'off') {
        breathing = $.clock.every(STEP_MS, () => {
          void update($, step, (n) => n + 1)
        })
      }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      breathing?.cancel()
      breathing = undefined
    }
    return next(e)
  })

  // Peras's own answers are the only source for "paused". The band never works a
  // pause out from the percentages, so it can't claim one that isn't there. Peras's
  // PreToolUse refusal reaches tool.call as the call's error. This hook only reads
  // it: it never takes part in the permission decision.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    const refusal = result.deny ?? (result.isError ? result.text : undefined)
    if (isPerasRefusal(refusal)) await update($, paused, () => true)
    else if (result.deny === undefined) await update($, paused, () => false)
    return result
  })

  on('classic.PostToolBatch', async ($, e, next) => {
    const result = await next(e)
    if (isPerasStop((result as { stopReason?: unknown }).stopReason)) await update($, paused, () => true)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const seen = await read($, readings)
    if (e.props.hasSurvey || seen.length === 0) return next(e)

    const data = {
      readings: seen,
      lines: await read($, lines),
      paused: await read($, paused),
      isWorking: e.props.isWorking,
      step: await read($, step),
      forecasts: await read($, forecasts),
    }
    const columns = Math.min(e.props.bodyColumns, MAX_COLUMNS)
    const { grid, text } = bandView(data, await read($, style), columns, await $.clock.now(), await read($, lineHidden))
    if (!grid && !text) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    if (e.surface === 'terminal' && grid) {
      // Text, not a Raster: a Raster's cells can't be underlined, and Clawd needs that.
      return (
        <Box flexDirection="column">
          {textRuns(grid).map((row) => (
            <Text wrap="truncate">
              {row.length === 0 ? ' ' : row.map(({ text: cells, color, background, under }) => (
                <Text color={color} backgroundColor={background} underline={under}>{cells}</Text>
              ))}
            </Text>
          ))}
        </Box>
      )
    }
    return <Text dimColor>{text}</Text>
  })
}
