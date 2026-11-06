import type { EngineInterface, ProcessRunInit } from 'claude-code'
import { findRuntime, hooksComplete } from './runtime'

export const PERAS_CLI_VERSION = '0.5.0'
const NOT_SETUP = "Peras isn't set up yet. Type /peras setup."
const HELP = [
  '/peras: usage, resets and pauses',
  '/peras lines: which lines are active and why',
  '/peras set ...: change a line, as in /peras set weekly 90 pause',
  '/peras pause [1h|18:00]: pause Claude now',
  '/peras resume: lift a pause',
  '/peras doctor: check that Peras is working',
  '/peras setup: install Peras',
  '/peras band mini|quiet|line|full|off: choose the band above the prompt',
].join('\n')
const RESTART = 'Restart Claude Code to turn Peras on.'

function output(text: string): string {
  // CSI (including colors), OSC (including terminal links), and simple escapes.
  const clean = text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[ -/]*[@-Z\\-_]/g, '')
  return clean.slice(0, 4000)
}

export type Answer = { text: string; isOk: boolean }

async function run($: EngineInterface, argv: string[], init: ProcessRunInit, setup = false): Promise<Answer> {
  try {
    const result = await $.process.run(argv, { ...init, stdin: '' })
    const isOk = result.exitCode === 0
    const text = [result.stdout, ...(isOk ? [] : [result.stderr])]
      .filter(Boolean).join('\n') || (isOk ? 'Done.' : `Peras exited with code ${result.exitCode}.`)
    const suffix = setup && isOk ? `\n\n${RESTART}` : ''
    return { text: output(text).slice(0, 4000 - suffix.length) + suffix, isOk }
  } catch {
    return {
      text: setup
        ? 'Setup could not start or finish. Install Node.js (including npx), then type /peras setup again. If setup timed out, check your connection and retry.'
        : 'Peras could not start or finish. Type /peras setup to check the installation, or retry if it timed out.',
      isOk: false,
    }
  }
}

let noticed = false

/** Adds /peras, and says once if Peras isn't set up. Runs no process. */
export async function startCommands($: EngineInterface, e: { isInteractive?: boolean }) {
  await $.command.register({
    name: 'peras', description: 'Peras usage lines, pause and setup. No model call.',
    argumentHint: '[lines | set ... | pause ... | resume ... | doctor | setup | band ... | help]',
    immediate: true,
  })
  if (e.isInteractive && !noticed) {
    noticed = true
    if (!await findRuntime($)) {
      $.ui.toast("Peras isn't set up yet, so nothing is being stopped. Type /peras setup.")
    }
  }
}

const say = (text: string): Answer => ({ text, isOk: false })

export async function answerCommand($: EngineInterface, e: { args: string; origin: { kind: string } }): Promise<Answer> {
  const words = e.args.trim().split(/\s+/).filter(Boolean)
  const [word, ...rest] = words
  if (word === 'help') return say(HELP)
  const runtime = await findRuntime($)
  if (word === 'setup') {
    if (rest.length) return say(HELP)
    if (runtime && await hooksComplete($)) {
      const doctor = await run($, [...runtime.argv, 'doctor'], { env: runtime.env })
      return { ...doctor, text: `Peras is already set up.\n\n${doctor.text}`.slice(0, 4000) }
    }
    if (e.origin.kind !== 'composer') return say('Type /peras setup at the prompt to install Peras.')
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
