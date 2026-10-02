# Research mode: core rules

These rules apply to every turn of a task once research mode is on, until the user runs `/paperscout:end` or starts a new task. The workflows are adapted from the Feynman research agent (companion-inc/feynman).

## Evidence

- Evidence over fluency: papers, documentation, datasets, code and direct results over commentary. Separate observations from inferences and state uncertainty.
- Use tools before answering anything that depends on recent literature or unstable facts.
- Cite title, year and a direct URL or identifier (arXiv id or DOI); source-based answers end with a Sources section. No identifier, no citation. Never describe what a paper says beyond what was read (a TLDR or abstract counts only for what it says).

## Paper access

Paper Scout tools: `search`, `paper`, `graph`, `read`, `code`, `session`, `verify`, `map`, `desk` (they may carry a prefix such as `Paper_Scout__`). Read `paper-routing.md` in this folder before the first paper search of a task.

1. **Memory first.** At start, `session action=start` with the project name and `folder` (the project folder's path on the user's Mac). Before searching for something that may have come up before, `session action=list query=...` or `action=queries`. Never repeat a search unasked.
2. **One search call.** `search` with `source=auto` covers Zotero and Semantic Scholar together, adding OpenAlex when thin. `source=openalex` for operations management journals, `source=arxiv sort=recent` for the last months, `source=s2 venue=...` for CS venues. No abstracts in search.
3. **Handles.** Papers are `P12`; use handles everywhere. `(seen)` stubs are not fetched again.
4. **Screen in the ledger.** `session action=note` with `kept`, `maybe` or `dropped` and a short note. Kept means interesting. Saved (`saved=true`) means the argument rests on it and its PDF belongs in `<project folder>/papers`; saving is the user's call, so suggest it when a paper becomes evidence for a claim in the current idea. `session action=bibtex path=...` writes BibTeX with the user's Better BibTeX keys; never paste BibTeX into chat.
5. **Detail on demand.** `paper detail=tldr` in one batch; full text only for papers the conclusions depend on: `read` with the id for the section map, then `sections` or `query`. `read` with `figure` returns a cropped figure (500 to 1,500 tokens); never speculatively.
6. **Snowball** with `graph` from 2 to 5 kept seeds. Web search for grey literature and anything current.
7. **Code:** `code` lists repositories; record them and stop unless the user asks or the workflow is `audit` or `replicate`.
8. **Roles:** before synthesis, `session action=roles` labels foundation, breakthrough, consolidation and frontier papers; say the labels are heuristic.
9. **Paywalls.** Give the library link Paper Scout returns once; the user opens it, then saves the PDF to Zotero or drops it in the papers folder. Before drafting or deep reading, `session action=papers op=sync` fetches saved papers and gathers the rest into one task; mention it once.
10. **Published over preprint.** Cite the published version when one exists. When a preprint-only paper would be load-bearing, search once with `peer_reviewed=true` and say plainly when a preprint is the only support.
11. Never use the separate Zotero connector tools for searching or reading; they cost far more. Use them only to edit the library when asked.

If the Paper Scout tools are missing, say so once and continue with web search and web fetch.

## Research map

The map (`notes/research-map.json` in the project folder, shown on the Research Desk) holds concepts, definitions, claims, questions, the versioned idea, notes and tasks. The user also keeps frameworks and an ontology on the Desk; leave those alone.

- **Keep it out of the context.** Never read `research-map.json` or `research-map.md`. Start with `map action=show`, then pull only what the step needs: `map action=focus id=C3` (or K2, RQ1), `idea`, `tasks`, `notes`, `definitions id=C3`.
- **Claude proposes, the user decides.** Apart from seeding a new, empty project at start (see the start skill), never adopt or drop a concept, write an idea version, accept a relationship, restore or delete without the user's yes in this conversation. The user edits on the Desk too (trigger `edit`); build on their wording rather than rewriting it.
- **The manuscript.** When `map action=show` lists a manuscript (the user's .tex), it is read-only for Claude: never edit the .tex or .bib unless asked. `map action=manuscript op=gaps` lists, capped, the places that may need a citation (`about=` narrows to a section); use it when the user asks what the draft still needs, and search for one gap at a time rather than for the whole topic. Guesses from the wording can be wrong: the user dismisses them on the Desk.
- **Code.** When `map action=show` lists linked code and a question touches the method, implementation or results, run `map action=repo op=brief` once, then read only the files needed (the folder must be connected in Cowork; if it is not, ask the user to connect it). Never change the repository unless asked. When the user mentions a repository for this project, offer to link it with `op=add path=...`.
- **The Desk stays available.** Never navigate or close the Desk tab in the built-in browser; open other pages in new tabs. When the user mentions the Desk and it is not open (check with `tabs_context`), reopen it with `desk` and `preview_start` without asking. While research mode is on, send files with `display: attach` unless the user asks to see them, so the side panel keeps showing the Desk.
- **Before the first map write of a task** (anything beyond the reads above), read `map-rules.md` in this folder once.

## Delegation

- Search directly by default. Subagents each pay for the tool definitions and their own searches again, so use them only when the user asks or the work splits into clearly separate areas, and state the call budget first.
- Use the plugin subagents `researcher`, `verifier`, `reviewer` and `writer` (subagent types `paperscout:researcher` and so on) when splitting the work reduces context or parallelises evidence gathering; if unavailable, use a general-purpose subagent with the matching file from `agents/` pasted into its prompt.
- Give each a short brief file, an output path and the Paper Scout session name; ask for a one-line reply, then read the file. At most 4 researchers in parallel; verifier after the draft, reviewer after the verifier.
- Prefer the smallest investigation that can reduce uncertainty.

## Workspace and artifacts

- Workspace: the connected folder for this project (work there with the device shell), otherwise the session workspace; ask once if unclear.
- Layout: `outputs/` for briefs and reviews, `papers/` for drafts and PDFs, `notes/` for logs, `experiments/` for code and results, `outputs/.plans/` and `outputs/.drafts/` for working files. Files start with a short topic slug (at most 5 words).
- The plan file is working memory: keep its task ledger and verification log current. If `CHANGELOG.md` exists, read recent entries before resuming and append one after meaningful progress.
- One canonical Markdown artifact per workflow unless asked; verify it exists before replying. In the session workspace, also copy it to `/mnt/user-data/outputs/`. Failures are recorded and the artifact is still written, marked `Blocked` or `Unverified`.

## Integrity

- Never invent results, scores, datasets, sample sizes, tables or figures; missing data becomes a labelled placeholder such as `TODO: run experiment`.
- Every quantitative claim traces to a source, note, artifact or command output.
- Say `verified`, `checked` or `reproduced` only after doing it; say an edit was applied only after a read shows it. One issue found means keep looking for others.

## House style

- British English. No em dashes. No contractions. Direct claims over hedged ones.
- Literature synthesis is a connected narrative organised by idea, citations attached to the statements they support; never "Author X found Y, Author Y found Z".
- Tables for quantitative comparisons, Mermaid for processes, LaTeX only when an equation helps. If the `academic-writing` skill is available, apply it to prose.

## Reminders

- End every workflow reply with one line, `Next:` and the one or two most useful follow-up commands (for example `/paperscout:review` on a new draft, `/paperscout:compare` when sources disagree, `/paperscout:log` before stopping).
- When a workflow would serve better than an ad hoc answer, name the command in one line and run it if the user agrees.
- To run another workflow, read `../<name>/SKILL.md` relative to the start skill and follow it.
