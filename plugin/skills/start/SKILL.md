---
name: start
description: Turn on Paper Scout research mode for this task and show the menu of Paper Scout workflows. Use only when the user explicitly types /paperscout:start or asks to start research mode.
disable-model-invocation: true
---

# Start research mode

1. Read `references/core.md` (in this skill's folder) now. Its rules govern every remaining turn of this task until the user runs `/paperscout:end` or opens a new task.
2. Settle the workspace: if the user named a project or a single folder is connected, use it; if several are connected and none is obvious, ask once which one holds this research. Create `outputs/`, `papers/` and `notes/` there only when a workflow first writes to them.
3. If `CHANGELOG.md` exists in the workspace, read its last few entries and mention in one line where the previous session stopped.
4. Run Paper Scout `session` with `action=start`, the project name (reuse the name from earlier sessions to resume its paper ledger; `action=sessions` lists them) and `folder` set to the project folder's path on the user's Mac (the connected folder's path from the device information; Paper Scout keeps the research map there). Then run `map action=show`; if a map exists, mention the current idea version and any warnings in one line. If the Paper Scout tools are missing, say so in one line and continue with web search.
5. **Open the Research Desk without asking.** Call Paper Scout `desk` for the link, then open it in the built-in browser pane with `preview_start` and that URL (the `Claude_Browser` tools; load them first if they are deferred, and if access to 127.0.0.1 has to be requested, request it for the site). The Desk follows the active project by itself. If the pane is hidden, tell the user once to show it (Cmd+Shift+B on Mac, Ctrl+Shift+B on Windows). Only if no built-in browser is available, give the link in one line.
6. **Populate a new project straight away.** If the map is empty and the project folder already holds material (a proposal, draft, abstract, notes or slides), read the most informative file or two in bounded windows and seed the Desk without waiting for confirmation: a first idea version (`map action=revise trigger=own change="First draft, written by Claude from <file>; edit it on the Desk."` with the statement, the four framing parts and the method where the material supports them), candidate concepts for the terms it rests on, and a few reading tasks. Say in one line what was drafted and that everything can be edited on the Desk. This is the one case where Claude writes an idea version without asking; later versions still wait for the user. If the folder holds nothing useful, leave the map empty and ask for the idea.
7. Reply with the menu below, exactly as written (it is the user's reminder of what Paper Scout can do), then one line: `Research mode is on. What are we investigating?` If the user already gave a topic with the command, skip the question, pick the best-fitting workflow, name it in one line and start it.

## Menu

| Command | Use it when | Produces |
|---|---|---|
| `/paperscout:ask <question>` | You want a quick scoped answer: has this been answered, what solutions exist, what is the debate | verdict, positions and reading list in chat, saved to the research map |
| `/paperscout:lit <topic, lab or author>` | You need the state of the art or a map of a field, a lab or an author's corpus | `outputs/<slug>.md` plus provenance |
| `/paperscout:deepresearch <question>` | A question needs a thorough, cited brief; asks you to approve the plan first | `outputs/<slug>.md` plus provenance |
| `/paperscout:review <file, arXiv id or URL>` | You want a tough internal critique of a paper or draft (yours or anyone's) | `outputs/<slug>-review.md` |
| `/paperscout:audit <paper + repo>` | You want to check whether a paper's code matches its claims | `outputs/<slug>-audit.md` |
| `/paperscout:compare <topic or sources>` | Several sources or methods need a side-by-side matrix of agreement and disagreement | `outputs/<slug>-comparison.md` |
| `/paperscout:summarize <paper, PDF or URL>` | You want one source digested section by section without loading all of it | `outputs/<slug>-summary.md` |
| `/paperscout:draft <topic>` | Research notes need to become a paper-style draft | `papers/<slug>.md` |
| `/paperscout:replicate <paper>` | You want a replication plan, and optionally to run it | plan, scripts, results |
| `/paperscout:recipe <task>` | You need ranked, result-backed training or evaluation recipes | `outputs/<slug>-recipe.md` |
| `/paperscout:autoresearch <idea>` | You want a bounded experiment loop against a benchmark | `autoresearch.md` log |
| `/paperscout:eli5 <paper or idea>` | You want a plain-language explanation | inline answer |
| `/paperscout:log` | You want a session log before stopping | `notes/<date>-<slug>.md` |
| `/paperscout:end` | You are done with research mode in this task | optional log, mode off |

Research map: ask to add or define a concept, to record or revise the idea, or to show what supports it. The Research Desk shows the idea, concepts, frameworks, papers and tasks, and its Commands button repeats this list.

Paper access in every workflow: your Zotero library first, then Semantic Scholar, OpenAlex and arXiv, all through Paper Scout, reading only the sections that matter.
