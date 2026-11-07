// What /peras says. The calls that run Peras live in register.tsx, the one file
// that holds the plugin's hooks, as the plugin directory asks.

export const PERAS_CLI_VERSION = '0.5.0'
export const NOT_SETUP = "Peras isn't set up yet. Type /peras setup."
export const NOT_SETUP_NOTICE = "Peras isn't set up yet, so nothing is being stopped. Type /peras setup."
export const HELP = [
  '/peras: usage, resets and pauses',
  '/peras lines: which lines are active and why',
  '/peras set ...: change a line, as in /peras set weekly 90 pause',
  '/peras pause [1h|18:00]: pause Claude now',
  '/peras resume: lift a pause',
  '/peras doctor: check that Peras is working',
  '/peras setup: install Peras',
  '/peras band mini|quiet|line|full|off: choose the band above the prompt',
].join('\n')
export const SETUP_FAILED =
  'Setup could not start or finish. Install Node.js (including npx), then type /peras setup again. If setup timed out, check your connection and retry.'
export const RUN_FAILED =
  'Peras could not start or finish. Type /peras setup to check the installation, or retry if it timed out.'
const RESTART = 'Restart Claude Code to turn Peras on.'

function output(text: string): string {
  // CSI (including colors), OSC (including terminal links), and simple escapes.
  const clean = text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[ -/]*[@-Z\\-_]/g, '')
  return clean.slice(0, 4000)
}

export type Answer = { text: string; isOk: boolean }

export const say = (text: string): Answer => ({ text, isOk: false })

/** What a finished Peras run says: its output, or its error when it failed. */
export function answerFrom(result: { exitCode: number; stdout: string; stderr: string }, setup: boolean): Answer {
  const isOk = result.exitCode === 0
  const text = [result.stdout, ...(isOk ? [] : [result.stderr])]
    .filter(Boolean).join('\n') || (isOk ? 'Done.' : `Peras exited with code ${result.exitCode}.`)
  const suffix = setup && isOk ? `\n\n${RESTART}` : ''
  return { text: output(text).slice(0, 4000 - suffix.length) + suffix, isOk }
}
