---
name: start
description: Turn on Feynman research mode for this task and show the menu of Feynman workflows. Use only when the user explicitly types /feynman:start or asks to start Feynman mode.
disable-model-invocation: true
---

# Start Feynman mode

1. Read `references/core.md` (in this skill's folder) now. Its rules govern every remaining turn of this task until the user runs `/feynman:end` or opens a new task.
2. Settle the workspace: if the user named a project or a single folder is connected, use it; if several are connected and none is obvious, ask once which one holds this research. Create `outputs/`, `papers/` and `notes/` there only when a workflow first writes to them.
3. If `CHANGELOG.md` exists in the workspace, read its last few entries and mention in one line where the previous session stopped.
4. Run Paper Scout `session` with `action=start`, the project name (reuse the name from earlier sessions to resume its paper ledger; `action=sessions` lists them) and `folder` set to the project folder's path on the user's Mac (the connected folder's path from the device information; Paper Scout keeps the research map there). Then run `map action=show`; if a map exists, mention the current idea version and any warnings in one line. If the Paper Scout tools are missing, say so in one line and continue with web search. Then call Paper Scout `desk` and give the Research Desk link in one line (offer to open it in the browser pane), so the user can follow screening and progress live.
5. Reply with the menu below, exactly as written (it is the user's reminder of what Feynman can do), then one line: `Feynman mode is on. What are we investigating?` If the user already gave a topic with the command, skip the question, pick the best-fitting workflow, name it in one line and start it.

## Menu

| Command | Use it when | Produces |
|---|---|---|
| `/feynman:ask <question>` | You want a quick scoped answer: has this been answered, what solutions exist, what is the debate | verdict, positions and reading list in chat, saved to the research map |
| `/feynman:lit <topic, lab or author>` | You need the state of the art or a map of a field, a lab or an author's corpus | `outputs/<slug>.md` plus provenance |
| `/feynman:deepresearch <question>` | A question needs a thorough, cited brief; asks you to approve the plan first | `outputs/<slug>.md` plus provenance |
| `/feynman:review <file, arXiv id or URL>` | You want a tough internal critique of a paper or draft (yours or anyone's) | `outputs/<slug>-review.md` |
| `/feynman:audit <paper + repo>` | You want to check whether a paper's code matches its claims | `outputs/<slug>-audit.md` |
| `/feynman:compare <topic or sources>` | Several sources or methods need a side-by-side matrix of agreement and disagreement | `outputs/<slug>-comparison.md` |
| `/feynman:summarize <paper, PDF or URL>` | You want one source digested section by section without loading all of it | `outputs/<slug>-summary.md` |
| `/feynman:draft <topic>` | Research notes need to become a paper-style draft | `papers/<slug>.md` |
| `/feynman:replicate <paper>` | You want a replication plan, and optionally to run it | plan, scripts, results |
| `/feynman:recipe <task>` | You need ranked, result-backed training or evaluation recipes | `outputs/<slug>-recipe.md` |
| `/feynman:autoresearch <idea>` | You want a bounded experiment loop against a benchmark | `autoresearch.md` log |
| `/feynman:eli5 <paper or idea>` | You want a plain-language explanation | inline answer |
| `/feynman:log` | You want a session log before stopping | `notes/<date>-<slug>.md` |
| `/feynman:end` | You are done with Feynman mode in this task | optional log, mode off |

Research map: ask to add or define a concept, to record or revise the idea, or to show what supports it; the Research Desk shows concepts, the idea and its history, and questions.

Paper access in every workflow: your Zotero library first, then Semantic Scholar, OpenAlex and arXiv, all through Paper Scout, reading only the sections that matter.
