# Records demo/vi-marks.gif. Run from the repo root:  vhs demo/vi-marks.tape
# Uses a throwaway herdr session (vi-marks-demo) and herdr's default prefix ";"
# from the author's config; adjust the Type lines for another prefix.
Output demo/vi-marks.gif
Set Shell zsh
Set FontSize 15
Set Width 1300
Set Height 720
Set Padding 0
Set TypingSpeed 90ms

Hide
# Start clean: no leftover demo session or demo marks from an earlier take
Type "herdr session stop vi-marks-demo; herdr session delete vi-marks-demo; rm -f ~/.local/state/herdr/plugins/*/marks.vi-marks-demo.json; clear" Enter
Sleep 1s
Type "unset HERDR_ENV HERDR_PANE_ID HERDR_TAB_ID HERDR_WORKSPACE_ID HERDR_SOCKET_PATH TERM_PROGRAM; herdr --session vi-marks-demo" Enter
Sleep 4s
Type "sh demo/setup.sh" Enter
Sleep 2s
Show
Sleep 1.5s
Screenshot demo/shots/01-start.png

# Find the compiler error in copy mode and mark it 'a'
Type ";["
Sleep 400ms
Type "?error[E" Enter
Sleep 1s
Screenshot demo/shots/02-found-error.png
Type ";m"
Sleep 600ms
Screenshot demo/shots/03-set-prompt.png
Type "a"
Sleep 1.2s
Screenshot demo/shots/04-set-a.png

# Switch to the tests workspace and mark the failing test 'b'
Type ";g"
Sleep 800ms
Type "/tests"
Sleep 400ms
Enter
Sleep 1s
Screenshot demo/shots/05-tests.png
Type ";["
Sleep 400ms
Type "?FAILED" Enter
Sleep 1s
Type ";m"
Sleep 600ms
Type "b"
Sleep 1.2s
Screenshot demo/shots/06-set-b.png

# List marks, then jump to 'a' from the list
Type ";M"
Sleep 2.5s
Screenshot demo/shots/07-show.png
Type "a"
Sleep 2s
Screenshot demo/shots/08-jumped-a.png

# Jump back with ''
Type ";'"
Sleep 600ms
Type "'"
Sleep 2s
Screenshot demo/shots/09-jumped-back.png
Sleep 1s
Sleep 1s

Hide
Type ";q"
Sleep 1s
Type "herdr session stop vi-marks-demo" Enter
Sleep 1s
