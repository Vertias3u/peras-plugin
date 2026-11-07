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

export function hasHook(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(hasHook)
  const object = value as Record<string, unknown>
  return (object.type === 'command' && typeof object.command === 'string' &&
    object.command.includes('peras.mjs')) || Object.values(object).some(hasHook)
}

const EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolBatch']

/** Whether all three of Peras's hooks are in these settings' `hooks`. */
export function hasAllHooks(hooks: unknown): boolean {
  const byEvent = hooks && typeof hooks === 'object' ? hooks as Record<string, unknown> : undefined
  return EVENTS.every((event) => hasHook(byEvent?.[event]))
}
