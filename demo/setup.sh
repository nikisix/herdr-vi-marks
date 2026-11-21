#!/bin/sh
# Run inside the demo session's first pane: build two workspaces of scrollback
dir=$(cd "$(dirname "$0")" && pwd)
herdr workspace rename "$HERDR_WORKSPACE_ID" api >/dev/null
tests=$(herdr workspace create --label tests --no-focus | jq -r .result.root_pane.pane_id)
herdr pane run "$tests" "clear && python3 $dir/log.py tests" >/dev/null
clear && python3 "$dir/log.py" build
