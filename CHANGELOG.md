# Changelog

## 0.1.1

No change in what the plugin does. The code is laid out the way the plugin directory reads mods: every hook and every call into Claude Code is in `hooks/register.tsx`. The band now sees Peras's refusals on `tool.call`, where they arrive as the call's error, rather than on `classic.PreToolUse`, so the plugin takes no part in the permission step. The README now says exactly which programs the plugin runs, what it reads, and what each hook does and changes.

## 0.1.0

First release: `/peras` commands with no model call, setup from inside Claude Code, a setup check, and the usage band above the prompt in five styles: `mini` (default), `quiet`, `line`, `full` and `off`. Styles that show the numbers replace Peras's status line for the session. Next to each number, the band shows where that window is headed by its reset, from Peras's own forecast. Clawd breathes in colour while Claude works, glances at the bars now and then, and sinks down asleep when Peras pauses it.
