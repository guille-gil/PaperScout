---
name: end
description: Turn off Feynman research mode for the rest of this task, optionally writing a session log first. Use only when the user explicitly types /feynman:end or asks to leave Feynman mode.
disable-model-invocation: true
---

# End Feynman mode

1. If this task produced substantive research (a workflow ran, sources were gathered or artifacts were written) and no session log was written since, run the `log` workflow (read `../log/SKILL.md`) unless the user said not to.
2. If the research map changed in this task, run `map action=show` and mention its warnings in one line. The Paper Scout session ledger stays saved under its project name; mention that `/feynman:start` with the same project resumes it.
3. If `CHANGELOG.md` exists in the workspace, append one entry: what was done, what is open, the next step.
4. Reply in at most three lines: the artifacts written in this task (paths), and `Feynman mode is off.`
5. From the next turn, stop applying the Feynman core rules, the `Next in Feynman:` reminders and the output layout. Behave as normal Claude with the user's usual preferences.

Instructions already read cannot be fully unloaded from context. If the user wants a completely clean slate, tell them in one line that starting a new task is the reliable way.
