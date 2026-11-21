# herdr-vi-marks

Vi-style line marks for [herdr](https://herdr.dev) scrollback.

![Setting marks in two workspaces, listing them, and jumping between them](demo/vi-marks.gif)

herdr's copy mode and scrollback have no built-in marks. This plugin adds them:
set a mark at the current scroll position with a letter, jump back to it later
from any workspace or pane, and use `'` to return to where you were before the
last jump, like vi's `''`.

| Keys (recommended) | Then press | Effect |
| --- | --- | --- |
| `prefix+m` | `a`–`z` | Set a mark at the current scroll position |
| `prefix+'` | `a`–`z` | Jump to that mark, switching workspace and pane if needed |
| `prefix+'` | `'` | Jump back to the position before the last jump |
| `prefix+M` | | List all marks with a preview of each line; press a letter to jump |

`Esc` or `Ctrl+C` cancels a prompt. Setting a mark also works from inside
herdr's copy mode, so you can search there with `/` or `?` and mark what you find.

Unlike vi, all marks are global: `'a` works from any pane, not only the one
where `a` was set.

## Requirements

- herdr 0.9.5 or later
- `python3` on your `PATH`
- macOS or Linux

## Install

```sh
herdr plugin install nikisix/herdr-vi-marks
```

herdr doesn't bind plugin actions to keys automatically. Add the keybindings
below to your config, then reload it.

## Recommended keybindings

Add this to the **end** of `~/.config/herdr/config.toml`. TOML attaches every
bare `key = value` line to the most recent table header, so `[[keys.command]]`
blocks placed above your other `[keys]` entries would swallow them.

```toml
# ── Vi marks (nikisix/herdr-vi-marks) ─────────────────────────────────────
# prefix+m {a-z}   set mark      (vi: m{a-z})
# prefix+' {a-z}   jump to mark  (vi: '{a-z})
# prefix+' '       jump back     (vi: '')
# prefix+M         list marks    (vi: :marks)
# The ctrl+alt variants skip the prefix for one-chord access.

[[keys.command]]
key = ["prefix+m", "ctrl+alt+m"]
type = "plugin_action"
command = "nikisix.vi-marks.prompt-set"
description = "Set scrollback mark (a-z)"

[[keys.command]]
key = ["prefix+'", "ctrl+alt+'"]
type = "plugin_action"
command = "nikisix.vi-marks.prompt-jump"
description = "Jump to scrollback mark (a-z or ')"

[[keys.command]]
key = "prefix+M"
type = "plugin_action"
command = "nikisix.vi-marks.prompt-show"
description = "Show all scrollback marks"
```

Then reload:

```sh
herdr server reload-config
```

## How it works

- Each action opens a small popup that reads a single key.
- A mark stores the pane and a line number counted from the top of that pane's
  scrollback, so new output arriving below doesn't move it.
- A jump focuses the marked pane (herdr switches workspace and tab as needed,
  even if the pane has moved since), then sets its scroll position directly.
  It doesn't need copy mode or synthetic keystrokes.
- All calls go straight to herdr's socket API (about 0.1 ms each) instead of
  spawning the `herdr` CLI (about 5 ms each).
- Marks are kept per herdr session in the plugin's state directory, because
  pane ids are only unique within a session. Jumping to a mark whose pane was
  closed removes the mark.

## Limitations

- Once scrollback reaches herdr's history limit and the oldest lines are
  dropped, existing marks gradually point at later lines than they were set on.
- Full-screen programs on the alternate screen (vim, less, most agent TUIs)
  have no herdr scrollback, so there is nothing to mark there.
- If herdr's session restore gives panes new ids after a server restart,
  marks set before the restart are lost.
- If herdr's interactive copy mode is active when you jump, the view moves, but
  the copy-mode cursor may not follow it.

## Demo

`demo/vi-marks.tape` records the GIF above with [vhs](https://github.com/charmbracelet/vhs):

```sh
vhs demo/vi-marks.tape
```

It runs in a throwaway `vi-marks-demo` herdr session and types the prefix `;`.
Edit the `Type` lines if your prefix differs.

## License

BSD 2-Clause. See [LICENSE](LICENSE).
