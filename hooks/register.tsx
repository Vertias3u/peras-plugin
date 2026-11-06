import type { Register } from 'claude-code'

import { bandCommand, noteCommand, registerBand, startBand } from './band'
import { answerCommand, startCommands } from './commands'

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await startCommands($, e)
    await startBand($)
    return result
  })

  on('command.run', { command: 'peras' }, async ($, e) => {
    const band = await bandCommand($, e.args)
    if (band !== null) return { text: band }
    const { text, isOk } = await answerCommand($, e)
    if (isOk) await noteCommand($, e.args)
    return { text }
  })

  registerBand(on)
}
