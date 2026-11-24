# vi-marks for Claude Code

Vi-style marks and block hops for Claude Code's fullscreen transcript, focus
view included. It's the Claude Code half of
[herdr-vi-marks](https://github.com/nikisix/herdr-vi-marks): herdr can't scroll
a fullscreen Claude pane, because Claude keeps its history in its own
alternate-screen scrollback, so this mod does the scrolling from inside Claude.

| Chord | Effect |
| --- | --- |
| `ctrl+x p` | Hop to the previous block: a `⏺` reply or tool call, or a `❯` prompt |
| `ctrl+x n` | Hop to the next block |
| `ctrl+x m`, then `a`–`z` | Mark the block at the top of the view |
| `ctrl+x '`, then `a`–`z` | Jump to a mark |
| `ctrl+x '` twice (or `ctrl+x '`, `0`) | Jump back to where the last jump started, like vi's `''` |

A one-line band above the prompt shows `‹ prev  next ›  mark  jump` and the
marks you've set; you can also click those. Esc closes the mark dialogs.

In focus view, hops step through what focus view shows (each turn's prompt and
response) and skip the rows it folds away.

## Setup

Mods can't define keybinding actions, so the band's buttons borrow four engine
actions that only have handlers inside the `/diff` dialog. Bind chords to them
in `~/.claude/keybindings.json`, in a `Global` block:

```json
{
  "context": "Global",
  "bindings": {
    "ctrl+x p": "diff:previousFile",
    "ctrl+x n": "diff:nextFile",
    "ctrl+x m": "diff:previousSource",
    "ctrl+x '": "diff:nextSource"
  }
}
```

Inside the `/diff` dialog these chords do their diff-dialog jobs instead.

Load the mod in every session by adding its folder to `CLAUDE_CODE_PLUGIN_DIRS`
in the `env` block of `~/.claude/settings.json`, or for one session with
`claude --plugin-dir <this folder>`.

With herdr-vi-marks 0.5.0 or later, herdr's own keys (`prefix+m`, `prefix+'`,
`prefix+(`, `prefix+)` and their `ctrl+alt` variants) forward these chords when
the pane is a fullscreen Claude, so the same keys work in every pane.

## How it works

- Order: transcript rows are drawn under the ids the session's JSONL file
  stores (message uuids, and `tool_use` ids for tool rows). The mod reads that
  file, walks its `parentUuid` chain from the newest row (so rewinds and
  sidechains drop out), and keeps it cached until the file grows.
- Position: each message row reports which of its lines the viewport shows,
  at the viewport's edges, when that changes. The earliest row in the newest
  burst of reports is the top of the view; after a hop, the hop's target is.
- Moving: `$.ui.scroll` puts a row's top at the top of the view. It's allowed
  because a chord or click is the person's own input.
- Folds: rows folded away (focus view, or Claude's grouped tool calls) still
  exist but never report being on screen. A hop probes a row it hasn't seen
  on screen and skips it if it doesn't land; after three misses in a row it
  only tries each turn's prompt and final response, which focus view shows.

## Limitations

- Marks point at a whole block, not a line within it.
- Marks live in the running session's state: restarting Claude, even with
  `--resume`, starts with none.
- If the bottom of the transcript holds only slash-command output, the first
  hop after you scroll there yourself may start from the last hop's position.
- Right after the mod loads (or `/focus` toggles), the first hop across a fold
  probes a few rows, which takes up to a second.

## License

BSD 2-Clause.
