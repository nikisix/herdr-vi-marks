# herdr-vi-marks

Vi-style line marks for [herdr](https://herdr.dev) scrollback.

herdr's copy mode and scrollback have no built-in marks. This plugin adds them:
set a mark at the current scroll position with a letter, jump back to it later,
and use `'` to return to where you were before the last jump, like vi's `''`.

| Keys (recommended) | Then press | Effect |
| --- | --- | --- |
| `prefix+m` | `a`–`z` | Set a mark at the current scroll position |
| `prefix+'` | `a`–`z` | Jump to that mark |
| `prefix+'` | `'` | Jump back to the position before the last jump |

`Esc` or `Ctrl+C` cancels the prompt.

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
```

Then reload:

```sh
herdr server reload-config
```

## How it works

- Both actions open a small popup that reads a single key.
- A mark is stored as a line number counted from the top of the pane's
  scrollback, so new output arriving below doesn't move it.
- A jump sets the pane's scroll position directly through herdr's socket API
  (`pane.scroll`). It doesn't need copy mode or synthetic keystrokes.
- Marks are kept per pane in the plugin's state directory. Marks for panes that
  no longer exist are pruned automatically.

## Limitations

- Once scrollback reaches herdr's history limit and the oldest lines are
  dropped, existing marks gradually point at later lines than they were set on.
- Full-screen programs on the alternate screen (vim, less, most agent TUIs)
  have no herdr scrollback, so there is nothing to mark there.
- If herdr's interactive copy mode is active when you jump, the view moves, but
  the copy-mode cursor may not follow it.

## License

BSD 2-Clause. See [LICENSE](LICENSE).
