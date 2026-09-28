---
name: desk
description: Reopen the Paper Scout Research Desk. Use when the user types /paperscout:desk or asks to reopen, show or bring back the Research Desk.
disable-model-invocation: true
---

# Reopen the Research Desk

1. If the arguments include `browser` (or the user wants it outside Claude), call Paper Scout `desk` with `browser=true` and reply in one line: the Desk is open in their own browser and stays there between chats while Claude is running; a bookmark keeps it one click away.
2. Otherwise call Paper Scout `desk` for the link and open it in the built-in browser pane with `preview_start` and that URL, in a new tab (the `Claude_Browser` tools; load them first if deferred). Do not ask first.
3. Call `tabs_context`. If the pane is hidden, tell the user once to show it with Cmd+Shift+B (Ctrl+Shift+B on Windows), or to close what is open in the side panel and click the globe icon. If no built-in browser is available, give the link in one line.
4. Reply in one line. Do not run anything else.
