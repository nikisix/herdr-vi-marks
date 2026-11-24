import json
import os
import shutil
import socket
import string
import sys
from pathlib import Path

PLUGIN_ID = "nikisix.vi-marks"
state_dir = Path(os.environ["HERDR_PLUGIN_STATE_DIR"])
# Pane ids are only unique within a herdr session, so keep one marks file per
# session, named after its socket's directory (herdr for default, else the name)
session = Path(os.environ.get("HERDR_SOCKET_PATH", "default")).parent.name or "default"
state_file = state_dir / f"marks.{session}.json"

def call_api(method, params):
    # Everything goes through the socket API: ~0.1 ms per call vs ~5 ms per
    # spawned herdr CLI process, and pane.scroll has no CLI subcommand anyway
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.connect(os.environ["HERDR_SOCKET_PATH"])
        sock.sendall((json.dumps({"id": "vi-marks", "method": method, "params": params}) + "\n").encode())
        buf = b""
        while not buf.endswith(b"\n"):
            chunk = sock.recv(1 << 20)
            if not chunk:
                break
            buf += chunk
    res = json.loads(buf)
    if "error" in res:
        raise RuntimeError(res["error"].get("message", res["error"]))
    return res["result"]

def notify(title):
    try:
        call_api("notification.show", {"title": title})
    except Exception:
        pass

def load_marks():
    marks = json.loads(state_file.read_text()) if state_file.exists() else {}
    # Marks are global {key: {pane_id, line}}; drop entries from the old per-pane format
    return {k: m for k, m in marks.items() if isinstance(m, dict) and "pane_id" in m}

def save_marks(marks):
    state_dir.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps(marks, indent=2))

# Claude Code starts each assistant message and tool call with this dot at
# column 0: ⏺ on macOS, ● elsewhere
BLOCK_MARKERS = ("⏺", "●")
# Characters of anchor text kept with a mark; short enough to survive rewrapping
ANCHOR_CHARS = 40
FULLSCREEN_HINT = ("Claude is in fullscreen mode, so herdr has no scrollback: install the "
                   "vi-marks Claude Code mod, or set CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1")
# Claude Code's fullscreen renderer keeps its own scrollback. The vi-marks
# Claude Code mod handles marks and hops there, on these chords (bound in
# ~/.claude/keybindings.json), so herdr's keys forward them
CLAUDE_CHORDS = {"prev": "\x18p", "next": "\x18n", "set": "\x18m", "jump": "\x18'"}

def forward_to_claude(pid, action):
    if not fullscreen_agent(pid):
        return False
    # Only when the mod runs there: its band sits above Claude's prompt
    screen = call_api("pane.read", {"pane_id": pid, "source": "visible"})["read"]["text"]
    if "‹ prev" not in screen:
        return False
    call_api("pane.send_text", {"pane_id": pid, "text": CLAUDE_CHORDS[action]})
    return True

def get_scroll(pid):
    scroll = call_api("pane.get", {"pane_id": pid})["pane"]["scroll"]
    return scroll["offset_from_bottom"], scroll["max_offset_from_bottom"]

def fullscreen_agent(pid):
    # Alt-screen apps leave herdr nothing to scroll; only worth explaining for Claude
    pane = call_api("pane.get", {"pane_id": pid})["pane"]
    return pane["scroll"]["max_offset_from_bottom"] == 0 and pane.get("agent") == "claude"

def capture(pid):
    # A mark: the viewport top, anchored from the top of the buffer so new
    # output below doesn't move it, plus nearby text for re-anchoring
    offset, max_offset = get_scroll(pid)
    text, delta = anchor_text(pid)
    return {"pane_id": pid, "line": max(0, max_offset - offset), "max_offset": max_offset,
            "text": text, "delta": delta}

def anchor_text(pid):
    # The first non-blank row on screen, and how far below the top it sits.
    # The visible read follows the scroll position, so this works at any depth
    # (recent reads are capped at the last 1000 rows)
    rows = call_api("pane.read", {"pane_id": pid, "source": "visible"})["read"]["text"].split("\n")
    for delta, row in enumerate(rows):
        if row.strip():
            return row.rstrip()[:ANCHOR_CHARS], delta
    return "", 0

def search_rows(pid, query):
    # copy_search covers the whole buffer and returns every match at once
    for _ in range(3):
        rev = call_api("pane.copy_motion", {"pane_id": pid, "cursor": {"row": 0, "col": 0},
                                            "motion": "line_end"})["content_revision"]
        try:
            res = call_api("pane.copy_search", {"pane_id": pid, "query": query, "direction": "forward",
                                                "cursor": {"row": 0, "col": 0}, "content_revision": rev})
        except RuntimeError as e:
            if "changed" in str(e):  # output arrived between the two calls
                continue
            raise
        return [(m["start"]["row"], m["start"]["col"]) for m in res["matches"]]
    return []

def reanchor(mark, max_offset):
    # Resizing reflows the buffer (and Claude's classic renderer reprints its
    # transcript), so a raw row index drifts. Find the saved text again: keep
    # an exact hit, else take the hit nearest the row scaled to the new size
    text, delta = mark.get("text"), mark.get("delta", 0)
    if not text:
        return mark["line"]
    query = text.lstrip()
    col = len(text) - len(query)
    rows = [r - delta for r, c in search_rows(mark["pane_id"], query) if c == col]
    if not rows or mark["line"] in rows:
        return mark["line"]
    expected = mark["line"] * (max_offset + 1) / (mark.get("max_offset", max_offset) + 1)
    return max(0, min(rows, key=lambda r: abs(r - expected)))

def hop_block(pid, direction):
    offset, max_offset = get_scroll(pid)
    if max_offset == 0:
        notify(FULLSCREEN_HINT if fullscreen_agent(pid) else "No scrollback")
        return
    top = max_offset - offset
    rows = sorted({r for m in BLOCK_MARKERS for r, c in search_rows(pid, m) if c == 0})
    if direction == "prev":
        earlier = [r for r in rows if r < top]
        if not earlier:
            notify("No earlier block")
            return
        target = earlier[-1]
    else:
        later = [r for r in rows if r > top]
        # Past the last block, or a block already on the bottom screen: go live
        target = later[0] if later else max_offset
    call_api("pane.scroll", {"pane_id": pid, "offset_from_bottom": max(0, max_offset - target)})

def read_single_char():
    if os.name == "nt":
        import msvcrt
        ch = msvcrt.getwch()
        return "" if ch in ("\x03", "\x1b") else ch
    import termios
    import tty
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        ch = sys.stdin.read(1)
        return "" if ch in ("\x03", "\x1b") else ch
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)

def set_mark(pid, key):
    if key not in string.ascii_lowercase:
        return
    marks = load_marks()
    mark = marks[key] = capture(pid)
    save_marks(marks)
    msg = f"Mark '{key}' set (line {mark['line']})"
    if mark["max_offset"] == 0 and fullscreen_agent(pid):
        msg += f". {FULLSCREEN_HINT}"
    notify(msg)

def jump_to_mark(pid, key):
    marks = load_marks()
    mark_key = "_prev" if key == "'" else key
    mark = marks.get(mark_key)
    if not mark:
        notify("Previous position not set" if mark_key == "_prev" else f"Mark '{key}' not set")
        return

    here = capture(pid)
    if (mark["pane_id"], mark["line"]) == (here["pane_id"], here["line"]):
        notify(f"Already at mark '{key}' (line {mark['line']})")
        return

    target = mark["pane_id"]
    try:
        if target != pid:
            # pane.focus switches workspace and tab as needed, and follows panes
            # that have been moved since the mark was set
            call_api("pane.focus", {"pane_id": target})
        _, max_offset = get_scroll(target)
        line = min(max_offset, reanchor(mark, max_offset))
        call_api("pane.scroll", {"pane_id": target, "offset_from_bottom": max_offset - line})
        if line != mark["line"]:
            mark.update(line=line, max_offset=max_offset)
    except Exception as e:
        if target != pid and "not found" in str(e).lower():
            del marks[mark_key]
            save_marks(marks)
            notify(f"Mark '{key}' removed: its pane was closed")
        else:
            notify(f"Jump error: {e}")
        return

    marks["_prev"] = here
    save_marks(marks)
    notify(f"Jumped back (line {line})" if mark_key == "_prev" else f"Jumped to '{key}' (line {line})")

def describe_marks(marks):
    snap = call_api("session.snapshot", {})["snapshot"]
    workspaces = {w["workspace_id"]: w for w in snap["workspaces"]}
    tabs = {t["tab_id"]: t for t in snap["tabs"]}
    panes = {p["pane_id"]: p for p in snap["panes"]}
    texts = {}
    rows = []
    for key in sorted(marks, key=lambda k: (k == "_prev", k)):
        mark = marks[key]
        pane = panes.get(mark["pane_id"])
        label = "'" if key == "_prev" else key
        if not pane:
            rows.append((label, mark["line"], "(pane closed)", ""))
            continue
        ws = workspaces.get(pane["workspace_id"], {})
        tab = tabs.get(pane["tab_id"], {})
        where = f"{ws.get('label') or pane['workspace_id']} › {tab.get('label') or tab.get('number', '?')}"
        if pane.get("agent"):
            where += f" › {pane['agent']}"
        if mark["pane_id"] not in texts and not mark.get("text"):
            scroll = pane["scroll"]
            lines = scroll["max_offset_from_bottom"] + scroll["viewport_rows"]
            read = call_api("pane.read", {"pane_id": mark["pane_id"], "source": "recent", "lines": lines})
            # Reads return at most the last 1000 rows, so row indexes only line
            # up when the whole buffer fits; older marks beyond that go blank
            texts[mark["pane_id"]] = read["read"]["text"].split("\n") if lines <= 1000 else []
        buf = texts.get(mark["pane_id"], [])
        preview = mark.get("text", "").strip() or (buf[mark["line"]].strip() if mark["line"] < len(buf) else "")
        rows.append((label, mark["line"], where, preview))
    return rows

def show_marks(pid):
    marks = load_marks()
    if not marks:
        print("No marks set.  m{a-z} sets one.")
        print("\nPress any key to close")
        read_single_char()
        return

    rows = describe_marks(marks)
    width = shutil.get_terminal_size().columns
    where_w = max(len(r[2]) for r in rows)
    line_w = max(len(str(r[1])) for r in rows)
    print(f"mark  {'line'.rjust(line_w)}  {'pane'.ljust(where_w)}  text")
    for label, line, where, preview in rows:
        row = f" {label}    {str(line).rjust(line_w)}  {where.ljust(where_w)}  {preview}"
        print(row[: width - 1])
    sys.stdout.write("\nJump: a-z or '   Close: Esc ")
    sys.stdout.flush()
    ch = read_single_char()
    if ch and (ch in string.ascii_lowercase or ch == "'"):
        jump_to_mark(pid, ch)

cmd = sys.argv[1] if len(sys.argv) > 1 else ""

if cmd == "prompt":
    mode = sys.argv[2] if len(sys.argv) > 2 else "set"
    pid = os.environ.get("HERDR_PANE_ID")
    if not pid:
        notify("Error: HERDR_PANE_ID not set")
        sys.exit(1)

    if mode in ("set", "jump") and forward_to_claude(pid, mode):
        sys.exit(0)

    params = {
        "plugin_id": PLUGIN_ID,
        "entrypoint": "key-reader",
        "placement": "popup",
        "focus": True,
        "env": {"MARK_MODE": mode, "TARGET_PANE_ID": pid},
    }
    if mode == "show":
        # One row per mark plus header, prompt, and border
        params["width"] = "90%"
        params["height"] = len(load_marks()) + 6
    try:
        call_api("plugin.pane.open", params)
    except Exception as e:
        notify(f"Popup error: {e}")

elif cmd == "block":
    # Hop between Claude dialogue blocks (the dots); no popup, so it can repeat fast
    pid = os.environ.get("HERDR_PANE_ID")
    direction = sys.argv[2] if len(sys.argv) > 2 else "prev"
    try:
        if not forward_to_claude(pid, direction):
            hop_block(pid, direction)
    except Exception as e:
        notify(f"Block hop error: {e}")

elif cmd == "read-key":
    mode = os.environ.get("MARK_MODE", "")
    pid = os.environ.get("TARGET_PANE_ID", "")
    if mode == "show":
        show_marks(pid)
    else:
        sys.stdout.write("Set mark (a-z): " if mode == "set" else "Jump mark (a-z / '): ")
        sys.stdout.flush()
        ch = read_single_char()
        if ch and pid:
            (set_mark if mode == "set" else jump_to_mark)(pid, ch)
