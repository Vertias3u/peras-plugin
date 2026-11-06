import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, ProcessRunInit, PromptOrigin } from 'claude-code'
import { PERAS_CLI_VERSION } from '../hooks/commands'

const NOTICE = "Peras isn't set up yet, so nothing is being stopped. Type /peras setup."
const MISSING = "Peras isn't set up yet. Type /peras setup."
const NODE = '/h/.local/bin/node'
const SCRIPT = '/h/.peras/app/bin/peras.mjs'

function fixture(on: On, options: {
  installed?: boolean; hooks?: boolean; exists?: boolean; codex?: boolean
  command?: string; stdout?: string; stderr?: string; exitCode?: number
  fail?: boolean; broken?: boolean; customHome?: boolean; partial?: boolean
} = {}) {
  const calls: { argv: readonly string[]; init?: ProcessRunInit }[] = []
  const notices: string[] = []
  const registrations: unknown[] = []
  const reads: string[] = []
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/h' :
    options.customHome ? ({ PERAS_HOME: '/data/peras', CLAUDE_CONFIG_DIR: '/data/claude' } as Record<string, string>)[e.name] : undefined }))
  on('fs.list', (_, e) => {
    reads.push(e.path)
    return { value: options.installed === false ? [] :
      [{ name: 'record.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }
  })
  on('fs.read', (_, e) => {
    reads.push(e.path)
    return { value: options.broken ? '{' : JSON.stringify({
      ...(options.codex ? { hooksPath: '/h/.codex/hooks.json' } :
        { settingsPath: options.customHome ? '/data/claude/settings.json' : '/h/.claude/settings.json' }),
      command: options.command ?? `"${NODE}" "${SCRIPT}"`, version: '0.4.0', resumeHint: 'peras resume',
    }) }
  })
  on('fs.exists', (_, e) => { reads.push(e.path); return { value: options.exists !== false } })
  on('settings.read', () => ({ value: options.hooks === false ? {} : {
    hooks: Object.fromEntries((options.partial ? ['UserPromptSubmit'] : ['UserPromptSubmit', 'PreToolUse', 'PostToolBatch'])
      .map((event) => [event, [{ matcher: '*', hooks: [{ type: 'command', command: `"${NODE}" "${SCRIPT}" hook` }] }]])),
  } }))
  on('process.run', (_, e) => {
    calls.push({ argv: e.argv, init: e.init })
    if (options.fail) throw new Error('unavailable')
    return { value: { exitCode: options.exitCode ?? 0, stdout: options.stdout ?? 'CLI output',
      stderr: options.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_, e) => { notices.push(e.text); return { value: undefined } })
  on('command.register', (_, e) => { registrations.push(e); return { value: { command: 'peras' } } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return { calls, notices, registrations, reads }
}

async function command($: Engine, args = '', origin: PromptOrigin = { kind: 'composer' }) {
  return (await $.command.run({ command: 'peras', args, origin,
    presentation: { isFullscreen: false, columns: 80 } })).text
}

test('missing setup gates every command except help and setup', async ($, on) => {
  const f = fixture(on, { installed: false })
  for (const args of ['', 'lines', 'set week 80 pause', 'pause', 'resume', 'doctor', 'unknown']) {
    expect(await command($, args)).toBe(MISSING)
  }
  expect(await command($, 'help')).toContain('/peras setup')
  expect(f.calls.length).toBe(0)
})

test('removed settings hooks mean not set up', async ($, on) => {
  const f = fixture(on, { hooks: false })
  expect(await command($)).toBe(MISSING)
  expect(f.calls.length).toBe(0)
})

test('a missing runtime script means not set up', async ($, on) => {
  fixture(on, { exists: false })
  expect(await command($)).toBe(MISSING)
})

test('status passes output through without a model call', async ($, on) => {
  const f = fixture(on, { stdout: 'Usage: 15%\n' })
  expect(await command($)).toBe('Usage: 15%\n')
  expect(f.calls).toEqual([{ argv: [NODE, SCRIPT, 'status'], init: { env: {}, stdin: '' } }])
})

test('lines uses why and only allowed commands are dispatched', async ($, on) => {
  const f = fixture(on)
  for (const args of ['lines', 'set week 80 pause', 'pause 10m', 'resume', 'doctor']) await command($, args)
  expect(f.calls.map(c => c.argv.slice(2))).toEqual([
    ['why'], ['set', 'week', '80', 'pause'], ['pause', '10m'], ['resume'], ['doctor'],
  ])
})

test('arguments split on whitespace and shell syntax stays literal', async ($, on) => {
  const f = fixture(on)
  await command($, '  set\tweek  80\n pause ; $(touch /tmp/nope) "a b" ')
  expect(f.calls[0].argv).toEqual([NODE, SCRIPT, 'set', 'week', '80', 'pause', ';', '$(touch', '/tmp/nope)', '"a', 'b"'])
})

test('unknown words give local help and run no process', async ($, on) => {
  const f = fixture(on)
  const text = await command($, 'connect')
  for (const word of ['lines', 'set', 'pause', 'resume', 'doctor', 'setup', 'band']) expect(text).toContain(word)
  await command($, 'setup extra')
  expect(f.calls.length).toBe(0)
})

test('nonzero exit includes stderr', async ($, on) => {
  fixture(on, { exitCode: 1, stdout: 'partial', stderr: 'problem' })
  expect(await command($)).toBe('partial\nproblem')
})

test('ANSI colors and terminal links are stripped', async ($, on) => {
  fixture(on, { stdout: '\x1b[31mred\x1b[0m \x1b]8;;https://example.com\x07link\x1b]8;;\x1b\\' })
  expect(await command($)).toBe('red link')
})

test('combined output is capped at 4000 characters', async ($, on) => {
  fixture(on, { stdout: 'x'.repeat(5000), stderr: 'error', exitCode: 1 })
  expect((await command($)).length).toBe(4000)
})

test('typed setup alone runs pinned npx in HOME with closed stdin', async ($, on) => {
  const f = fixture(on, { installed: false })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await command($, 'help')
  await command($, 'doctor')
  await command($, 'setup', { kind: 'plugin', name: 'other' })
  expect(f.calls.length).toBe(0)
  expect(await command($, 'setup')).toBe('CLI output\n\nRestart Claude Code to turn Peras on.')
  expect(PERAS_CLI_VERSION).toBe('0.5.0')
  expect(f.calls).toEqual([{ argv: ['npx', '--yes', 'peras-cli@0.5.0', 'setup'],
    init: { cwd: '/h', timeoutMs: 180000, stdin: '' } }])
})

test('setup keeps restart instructions inside the output cap', async ($, on) => {
  fixture(on, { installed: false, stdout: 'x'.repeat(5000) })
  const text = await command($, 'setup')
  expect(text.length).toBe(4000)
  expect(text.endsWith('Restart Claude Code to turn Peras on.')).toBe(true)
})

test('already set up runs doctor instead of installing', async ($, on) => {
  const f = fixture(on)
  expect(await command($, 'setup')).toBe('Peras is already set up.\n\nCLI output')
  expect(f.calls[0].argv).toEqual([NODE, SCRIPT, 'doctor'])
  expect(f.calls.length).toBe(1)
})

test('paths with spaces and an environment prefix are parsed without a shell', async ($, on) => {
  const f = fixture(on, { command: 'PERAS_STRICT=1 "/h/Node Tools/node" "/h/Peras Data/app/bin/peras.mjs"' })
  await command($)
  expect(f.calls[0].argv).toEqual(['/h/Node Tools/node', '/h/Peras Data/app/bin/peras.mjs', 'status'])
  expect(f.calls[0].init?.env).toEqual({ PERAS_STRICT: '1' })
  expect(f.reads).toContain('/h/Peras Data/app/bin/peras.mjs')
})

test('Codex-only install records do not count as Claude setup', async ($, on) => {
  const f = fixture(on, { codex: true })
  expect(await command($)).toBe(MISSING)
  expect(f.calls.length).toBe(0)
})

test('PERAS_HOME and CLAUDE_CONFIG_DIR select the matching record', async ($, on) => {
  const f = fixture(on, { customHome: true })
  expect(await command($)).toBe('CLI output')
  expect(f.reads).toContain('/data/peras/install/record.json')
})

test('corrupt records and unsafe command expressions fail closed', async ($, on) => {
  fixture(on, { command: `"${NODE}" "${SCRIPT}"; echo nope` })
  expect(await command($)).toBe(MISSING)
})

test('invalid JSON never throws', async ($, on) => {
  fixture(on, { broken: true })
  expect(await command($)).toBe(MISSING)
})

test('interactive setup notice appears once and startup never runs a process', async ($, on) => {
  const f = fixture(on, { installed: false })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(f.notices).toEqual([NOTICE])
  expect(f.calls.length).toBe(0)
  expect(f.registrations[0]).toEqual({ name: 'peras', description: 'Peras usage lines, pause and setup. No model call.',
    argumentHint: '[lines | set ... | pause ... | resume ... | doctor | setup | band ... | help]', immediate: true })
})

test('headless startup has no setup notice or process', async ($, on) => {
  const f = fixture(on, { installed: false })
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  expect(f.notices.length).toBe(0)
  expect(f.calls.length).toBe(0)
  expect(f.reads.length).toBe(0)
})

test('set up interactive sessions have no setup notice', async ($, on) => {
  const f = fixture(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(f.notices.length).toBe(0)
  expect(f.calls.length).toBe(0)
})

test('process startup failure gives a useful setup error', async ($, on) => {
  fixture(on, { installed: false, fail: true })
  expect(await command($, 'setup')).toContain('Install Node.js')
})

test('normal process failure never throws', async ($, on) => {
  fixture(on, { fail: true })
  expect(await command($)).toContain('could not start or finish')
})

test('a failed setup does not say to restart', async ($, on) => {
  fixture(on, { installed: false, exitCode: 1, stderr: 'no network' })
  const text = await command($, 'setup')
  expect(text).toContain('no network')
  expect(text.includes('Restart Claude Code')).toBe(false)
})

test('a partial install is repaired by the Peras already there', async ($, on) => {
  const f = fixture(on, { partial: true })
  expect(await command($, 'setup')).toContain('Restart Claude Code')
  expect(f.calls[0].argv).toEqual([NODE, SCRIPT, 'setup'])
})

test('a pause that failed does not show on the band', async ($, on) => {
  const f = fixture(on, { installed: false })
  expect(await command($, 'pause')).toBe(MISSING)
  expect(f.calls).toEqual([])
})
