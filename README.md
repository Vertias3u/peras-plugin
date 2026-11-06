<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo.svg">
    <img src="assets/logo-light.svg" width="96" height="96" alt="Peras logo: a pixel pear">
  </picture>
</p>

<h1 align="center">Peras for Claude Code</h1>

**Stop Claude Code at a usage line you set, so a long run doesn't burn through your 5-hour or weekly limit.**

This plugin sets [Peras](https://github.com/Vertias3u/Peras) up from inside Claude Code, runs it with no model call, and shows your limits above the prompt.

## Install

In Claude Code:

```
/plugin marketplace add Vertias3u/peras-plugin
/plugin install peras@peras
/peras setup
```

Then restart Claude Code. It needs Claude Code 2.1.287 or later, a Pro or Max login, and Node.js.

To update it, run `/plugin update peras@peras`. To remove the plugin, run `/plugin uninstall peras@peras`. That leaves Peras's hooks in place; [What it does to your machine](#what-it-does-to-your-machine) says how to remove them too.

## What you get

**Commands that cost no usage.** Each one runs on your machine with no model call, even while Claude is working.

| Command | What it does |
|---|---|
| `/peras` | Your usage, resets and pauses |
| `/peras lines` | Which lines are active and why |
| `/peras set weekly 90 pause` | Change a line |
| `/peras pause 1h`, `/peras resume` | Pause Claude now, or lift a pause |
| `/peras doctor` | Check that Peras is working |
| `/peras band mini` | Choose the band: `mini`, `quiet`, `line`, `full` or `off` |

**A band above the prompt.** It shows your 5-hour and weekly bars, marks your lines, and shows when each window resets. Your choice is remembered across sessions.

| Style | Height | What it shows |
|---|---|---|
| `mini` (default) | 2 rows | A small Clawd beside two thin bars. Clawd breathes in colour while Claude works, glances at the bars now and then, and sinks down asleep when Peras pauses it. |
| `quiet` | 0 rows, 2 when it matters | Nothing until you cross a line or Peras pauses Claude, then Clawd says what happened. |
| `line` | 1 row | Both bars and their reset times. |
| `full` | 4 rows | Big Clawd standing at the end of full-height bars. |
| `off` | 0 rows | No band. |

- **It works without setup**, as a plain meter. It appears after Claude's first reply, because that's when Claude Code first has your limits.
- **It shows where each window is headed** by its reset, as `week 74% → 100%`, when Peras's forecast puts it at least 5 points past where it is now. The forecast takes the colour of a line it would cross. To get it, the band runs the read-only `peras usage --json` at most once a minute. The exact time a window fills ("full by 18:40") and the status line's "this chat" share aren't on the band; `/peras` shows both.
- **It replaces Peras's status line** on `mini`, `line` and `full`, so the same numbers don't show twice. On `quiet` and `off`, or if the plugin is turned off, that line stays. A status line you had before Peras is never hidden. Changing style changes the band at once, and the status line follows the next time Claude Code loads its settings, at the latest in your next session.

## What it does to your machine

This plugin doesn't stop Claude by itself. **Peras stops Claude, and only after you type `/peras setup`.** Nothing runs that command for you.

`/peras setup` runs `npx --yes peras-cli@0.5.0 setup`, which downloads that exact version of [peras-cli](https://www.npmjs.com/package/peras-cli) from npm and then:

- adds Peras's hooks and a status line to `~/.claude/settings.json`, first saving a backup of that file beside it
- copies Peras into `~/.peras/runtimes` and links it from `~/.peras/app`
- keeps its rules, usage readings and history in `~/.peras`

If you set `CLAUDE_CONFIG_DIR` or `PERAS_HOME`, those folders are used in place of `~/.claude` and `~/.peras`.

If Peras is already there but some hooks are missing, `/peras setup` asks that copy to add them back, and downloads nothing.

From then on, those hooks run on every prompt and tool call, and they can refuse tool calls and end a turn when you cross a line you chose. By default they warn at 75% of your week, pause at 90% of your week, and warn at 95% of your 5 hours. The hooks stay active in all your sessions, even if you uninstall this plugin. To remove them, run `npx peras-cli remove`. It takes Peras's hooks out of your settings, puts back the status line you had, and leaves your lines, history and the copied program in `~/.peras`. Delete that folder to clear them.

The `/peras` commands run the Peras program you installed, so they do what that program does. `/peras`, `/peras lines` and `/peras doctor` read usage for Claude and, if you set it up, for Codex, which can start `codex app-server` and update the readings in `~/.peras`. `/peras set`, `/peras pause` and `/peras resume` change your rules or pause state, and can refresh Peras's own hooks if they're out of date.

The plugin itself reads your limits from Claude Code, reads `~/.peras/config.json` and its settings to mark your lines, watches Peras's hook answers to show a pause, and remembers your band style. On styles that replace the status line, it reads Peras's install record in `~/.peras/install` and changes the status line command Claude Code runs in that session, so Peras keeps running with its text dropped. Peras's "could not run" message still shows. Nothing is written to `settings.json`, and the line returns when the plugin is off. It sends nothing anywhere, and Peras has no telemetry.

## Limits

- It's for Claude Code only, not claude.ai or Cowork.
- There are no readings with an API key, because Claude Code only reports limits on a subscription login.
- The band draws in the terminal. The Desktop app and other surfaces show one line of text, and so does a terminal too narrow for the style.
- The band shows a pause once Peras refuses a tool or stops a turn, not before, and keeps saying paused until a tool goes through or you type `/peras resume`, even if a timed pause has ended. It marks lines that are always on; lines set for certain hours aren't marked.
- It marks lines only while Peras's hooks are in place. Folder lines match the folder path as Claude Code reports it, so a session opened through a symlink can mark your global lines instead.

Peras is free and open source. The CLI lives at [Vertias3u/Peras](https://github.com/Vertias3u/Peras). Found a bug in the plugin? [Open an issue](https://github.com/Vertias3u/peras-plugin/issues).

## License

[MIT](LICENSE)
