import type { EngineInterface } from 'claude-code'

export type Runtime = { argv: string[]; env: Record<string, string> }

// Read the quoted command written by setup, without evaluating any shell syntax.
// Quotes preserve spaces; environment assignments become process options.
export function parseRuntime(command: string): Runtime | undefined {
  const words: string[] = []
  let word = '', quote = '', started = false
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (c === '\\' && quote !== "'") {
      const following = command[i + 1]
      if (following === undefined) return
      if (quote === '"' && !['"', '\\', '$', '`', '\n'].includes(following)) word += c
      else { word += following; i++ }
      started = true
    } else if (quote) {
      if (c === quote) quote = ''
      else word += c
    } else if (c === '"' || c === "'") {
      quote = c
      started = true
    } else if (/\s/.test(c)) {
      if (started) { words.push(word); word = ''; started = false }
    } else {
      if (/[;&|<>`$()]/.test(c)) return
      word += c
      started = true
    }
  }
  if (quote) return
  if (started) words.push(word)
  let env: Record<string, string> = {}
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? '')) {
    const assignment = words.shift()!
    const at = assignment.indexOf('=')
    env = { ...env, [assignment.slice(0, at)]: assignment.slice(at + 1) }
  }
  // setup writes exactly a Node executable and the stable script entrypoint.
  if (words.length !== 2 || !words[0] || !/[/\\]peras\.mjs$/.test(words[1])) return
  return { argv: words, env }
}

function hasHook(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(hasHook)
  const object = value as Record<string, unknown>
  return (object.type === 'command' && typeof object.command === 'string' &&
    object.command.includes('peras.mjs')) || Object.values(object).some(hasHook)
}

const EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolBatch']

/** Whether all three of Peras's hooks are still in the settings. */
export async function hooksComplete($: EngineInterface): Promise<boolean> {
  try {
    const hooks = await $.settings.read({ key: 'hooks' }) as Record<string, unknown> | undefined
    return EVENTS.every((event) => hasHook(hooks?.[event]))
  } catch {
    return false
  }
}

/** Peras's home folder, or an empty string when HOME isn't set either. */
export async function perasHome($: EngineInterface): Promise<string> {
  const home = await $.env.get('HOME')
  const folder = await $.env.get('PERAS_HOME') || (home ? `${home}/.peras` : '')
  return folder.replace(/\/$/, '')
}

/** Peras's install record for this Claude config folder, if there is one. */
export async function installRecord($: EngineInterface): Promise<Record<string, any> | undefined> {
  try {
    const home = await $.env.get('HOME')
    const peras = await perasHome($)
    const config = await $.env.get('CLAUDE_CONFIG_DIR') || (home ? `${home}/.claude` : '')
    if (!peras || !config) return
    const install = `${peras}/install`
    const settingsPath = `${config.replace(/\/$/, '')}/settings.json`
    for (const entry of await $.fs.list(install)) {
      if (!entry.name.endsWith('.json') || entry.kind !== 'file') continue
      try {
        const record = JSON.parse(await $.fs.read(`${install}/${entry.name}`))
        if (record?.settingsPath === settingsPath) return record
      } catch { /* A broken record must not prevent setup or startup. */ }
    }
  } catch { /* Missing directories, settings, or permissions mean not set up. */ }
  return undefined
}

export async function findRuntime($: EngineInterface): Promise<Runtime | undefined> {
  try {
    const record = await installRecord($)
    if (typeof record?.command !== 'string') return
    const runtime = parseRuntime(record.command)
    if (runtime && await $.fs.exists(runtime.argv[1]) &&
      hasHook(await $.settings.read({ key: 'hooks' }))) return runtime
  } catch { /* Missing settings or permissions mean not set up. */ }
  return undefined
}
