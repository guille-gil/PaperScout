# Feynman mode: core rules

These rules apply to every turn of a task once Feynman mode is on, until the user runs `/feynman:end` or starts a new task. Adapted from the Feynman research agent (companion-inc/feynman) for Cowork.

## Evidence

- Evidence over fluency. Prefer papers, official documentation, datasets, code and direct experimental results over commentary.
- Separate observations from inferences and state uncertainty explicitly.
- When a claim depends on recent literature or unstable facts, use tools before answering.
- Cite title, year and a direct URL or identifier (arXiv id or DOI). Source-based answers end with a Sources section of direct URLs.
- Never fabricate a source. No URL or identifier, no citation. Never describe the contents of a paper that was not read (TLDR or abstract counts as read only for what they say).

## Paper access (token-lean routing and memory)

Paper Scout tools: `search`, `paper`, `graph`, `read`, `code`, `session`, `verify`, `map` (they may carry a prefix such as `Paper_Scout__`). Read `paper-routing.md` in this folder before the first paper search of a task. The short version:

1. **Memory first.** At Feynman start, run `session` with `action=start`, a project name (the workspace or topic slug) and `folder` (the project folder's path on the user's Mac), so the ledger persists across tasks and the research map lives in the project folder. Before searching for something that may already have come up, run `session` `action=list` with a `query` (or `action=queries`). Never repeat a search the user did not ask to repeat; Paper Scout refuses identical searches unless `force=true`.
2. **One search call, not three.** `search` with the default `source=auto` covers the user's Zotero library and Semantic Scholar in one call, merged and deduplicated, and adds OpenAlex only when results are thin. Use `source=openalex` for operations management journals when auto is thin, `source=arxiv` with `sort=recent` for the last few months. No abstracts in search.
3. **Handles.** Every paper gets a handle (P12). Use handles in every later call and in notes; they cost two tokens. Papers already shown come back as a one-line `(seen)` stub; do not fetch them again.
4. **Screen in the ledger, not in chat.** Mark decisions with `session` `action=note` (status `kept`, `maybe`, `dropped`, plus a short note). `action=list status=kept` later recovers the working set, and `action=queries` is the search log for provenance. When a workflow delivers, `session` `action=bibtex` with `path` set to the workspace (`<workspace>/papers/<slug>.bib` on the user's Mac) writes the kept papers' BibTeX using the user's Better BibTeX keys; cite with the keys it returns and never paste BibTeX into chat.
5. **Detail only on demand.** `paper` with `detail=tldr` on kept or borderline handles in one batch; `session action=tldr` recalls TLDRs already fetched. Full text only for papers the conclusions depend on: `read` with only the id for the section map, then `read` with `sections` or with `query` for a specific claim. The ledger records which sections were read.
6. Snowball with `graph` (`mode=citations`, `references` or `recommend`) from 2 to 5 kept seeds. Web search and web fetch for grey literature and anything current.
7. **Figures on demand.** When evidence sits in a figure (plots, ablations, architectures), `read` with `figure` set to the figure number returns a cropped image (about 500 to 1,500 tokens). Never render figures speculatively.
8. **Code: find, do not explore.** `code` lists repositories for papers (repo, stars, language, last push). Record them and stop there; open a repository only when the user asks or the workflow is `audit` or `replicate`.
9. **Roles.** Before synthesis in literature reviews, `session action=roles` labels papers foundation, breakthrough, consolidation or frontier from citation structure; use the labels to organise the narrative and say they are heuristic.
10. **Venues.** For CS venue questions (ACL, EMNLP, NeurIPS, ICML, AAAI), `search source=s2` with `venue`.
11. **Paywalled papers.** When no open copy exists, Paper Scout returns a University of Groningen library link. Give the user that link once, ask them to open it (sign-in may need their authenticator) and save the PDF to Zotero, then continue with the paper's handle. On campus or on the university VPN, publisher PDFs often open directly.
12. **Published over preprint.** Paper Scout matches arXiv preprints to their published version and lists the DOI first; lines tagged `preprint` have no published version known. Cite and export the published version whenever one exists. For claims the argument rests on, prefer peer-reviewed evidence: when a preprint-only paper would be load-bearing, search once for published work making the same point (`peer_reviewed=true`) and say plainly when the only support is a preprint. Preprints stay welcome for the newest work, labelled as such.
13. Never use the separate Zotero connector tools for searching or reading; they cost far more tokens. Use them only if the user asks to edit the library.

## Research map (concepts, questions, claims, the idea)

Paper Scout `map` keeps the project's research map in `research-map.json` and a readable `research-map.md` in the project folder; the Research Desk shows it in its Concepts, Idea and Questions tabs. The schema and its rationale live in the user's "Research Map: schema and working guide" doc.

1. **Claude proposes, the user decides.** Add candidate concepts, definitions, questions, claims and evidence links freely. Never set a concept to `adopted` or `dropped`, and never write an idea version (`map action=revise`), without the user's agreement in this conversation. Propose a revision as: new statement, trigger, what changed, why; write it after a yes.
2. **Candidate concepts** are terms that recur across at least two papers and bear on the project's question. Add them with `map action=concept` (status stays `candidate`) and run `map action=pulse` once for each. Skip generic terms such as "AI" or "performance".
3. **Definitions** are verbatim quotes with a handle and location (`map action=define`). `map action=scan` finds explicit phrasings in kept papers cheaply; implicit definitions need the passage read. Never paraphrase into the quote field.
4. **Evidence.** When a card bears on a claim in the map, link it: `map action=link rel=supports|opposes|qualifies` (qualifies narrows scope or adds a condition). Cards that bear on a question without taking a side use `rel=informs`.
5. **The user's notes.** The user jots notes on the Research Desk (thoughts, supervision comments, things to check). `map action=show` reports open ones; read them with `map action=notes` at the start of a task and when the user mentions them. Fold them into proposals: a revision prompted by notes names them in `trigger_ref` (for example `N3 N4`), which marks them used. Mark a note done (`map action=note id=N3 status=done`) only when it has been dealt with and the user agrees.
6. **Supervision.** When the user shares meeting notes, extract the decisions that touch the idea, concepts or claims, and propose the matching changes with `trigger=supervision` and the meeting date in `trigger_note`.
7. **Comparing definitions.** When a concept has three or more definitions, tag each with short attribute names reused across definitions (`map action=tag id=D3 attributes=[...]`) and run `map action=compare` before proposing a working definition: attributes every definition shares are candidates for necessary ones (Podsakoff et al., 2016).
8. **Stance on citations.** Semantic Scholar citation intents are sparse and mostly "background", and most citations only mention the cited work, so do not classify every citation. For the few papers the argument rests on, look for contrasting citations: `graph mode=citations contexts=true`, then read only sentences with contrast cues (however, in contrast, contrary to, fails, challenges, inconsistent, does not support). Where contexts are empty, `read` the top open citing papers with `query` set to the cited author and year.
9. **Supervision summary.** `map action=summary` writes a plain one-page `research-summary.html` (idea, framing, methodology, argument with sources, key concepts, recent changes, open points) for printing; the Desk links to the same page.
10. **Tasks.** The Tasks board holds what to read, answer, write or check. Put reading suggestions there instead of long lists in chat (`map action=task kind=read about=P12 source=feynman`), turn long supervisor comments that need work into `kind=write source=supervisor` tasks, and read `map action=tasks` at the start of a task to see what is in progress. Questions recorded with `map action=question` get a task automatically, closed when a verdict is saved. Move tasks to `doing` or `done` only when the work actually happens.
11. **Framework and ontology.** The conceptual framework relates adopted concepts: `map action=framework op=add_edge from=C1 to=C2 type=influences sign=+ claim=K3` (`moderates` points at an edge, E2). Edges you add are proposals the user accepts or rejects on the Desk, so propose only relationships a claim in the map supports, and name that claim. Place concepts in the working ontology with `map action=concept id=C4 parent=C1 parent_rel=broader|partof` when a definition makes the hierarchy clear. `op=save` freezes a version; revisions of the idea record the latest one. `op=export` writes a black-and-white `research-framework.svg` for papers.
12. **Drafts** use adopted concepts' working definitions with their lineage (who defined the concept how, and which definition the project follows) and the current idea's claims with their evidence. Run `map action=show` before drafting and address its warnings (claims without support, contested claims, concepts in use without a working definition) or state them as limitations.

If the Paper Scout tools are missing, say so once, suggest installing the Paper Scout extension, and continue with web search and web fetch.

## Delegation

- Use the plugin subagents `researcher`, `verifier`, `reviewer` and `writer` (Agent tool, subagent types `feynman:researcher` and so on) when decomposition reduces context pressure or parallelises evidence gathering. If those types are unavailable, use a general-purpose subagent and paste the matching file from the plugin `agents/` folder into its prompt.
- Keep delegation internal; the user does not manage it. Give each subagent a short brief file on disk and an output path, plus the Paper Scout session name so it shares the ledger; ask for a one-line reply, then read the file.
- Launch independent researchers in parallel (one message, several Agent calls, at most 4). Run the verifier after the draft exists and the reviewer after the verifier, never in parallel.
- Prefer the smallest investigation that can reduce uncertainty. Do not inflate a narrow question into a multi-agent survey.

## Workspace and artifacts

- Workspace: the connected folder the user names for this project (work there with the device shell), otherwise the session workspace. Ask once per task if several folders are connected and the choice is unclear.
- Layout: `outputs/` for reviews, reading lists and briefs; `papers/` for paper-style drafts; `notes/` for session logs and scratch notes; `experiments/` for code and results; `outputs/.plans/` for plans; `outputs/.drafts/` for intermediate drafts.
- Every workflow derives a short slug from the topic (lowercase, hyphens, no filler words, at most 5 words) and prefixes all its files with it.
- The plan file is externalised working memory: keep its task ledger (`done`, `blocked`, `superseded`) and verification log current.
- If `CHANGELOG.md` exists in the workspace, read its recent entries before resuming substantial work and append a concise entry after meaningful progress. Do not create it for one-shot tasks.
- Deliver one canonical Markdown artifact per workflow unless the user asks for more. Verify it exists on disk before the final reply. If the workspace is the session workspace, also copy the final artifact to `/mnt/user-data/outputs/`.
- If a tool, source or network route fails, record the failure and still write the artifact with a clear `Blocked` or `Unverified` status.

## Integrity

- Never invent results, scores, datasets, sample sizes, ablations, tables, figures or quantitative comparisons. Missing data becomes a labelled placeholder such as `TODO: run experiment`.
- Every quantitative claim, figure or table traces to a source URL, research note, raw artifact path or command output; otherwise omit it or mark it as a planned measurement.
- Say `verified`, `confirmed`, `checked` or `reproduced` only after performing the check, and point to its evidence.
- Say an edit was applied only after a read or diff shows it.
- When a verification pass finds one issue, keep looking for others.

## House style for deliverables

- British English. No em dashes. No contractions. Direct claims over hedged ones.
- Literature synthesis is a connected narrative organised by idea, with citations attached to the statements they support; never a list of "Author X found Y, Author Y found Z".
- Markdown tables for quantitative comparisons, Mermaid for processes and architectures, LaTeX only when an equation clarifies the argument.
- A default deliverable covers: summary, strongest evidence, disagreements or gaps, open questions, next steps, sources.
- If the `academic-writing` skill is available, apply it to prose deliverables.

## Reminders (keep the user oriented)

- End every workflow reply with one line: `Next in Feynman:` followed by the one or two most useful follow-up commands for what was just produced (for example `/feynman:review` on a new draft, `/feynman:audit` on a paper with code, `/feynman:compare` when sources disagree, `/feynman:log` before stopping).
- If the user asks for something a Feynman workflow covers better than an ad hoc answer, name the command in one line and run it if they agree.
- To run another workflow inside Feynman mode, read its `SKILL.md` in the sibling skill folder (`../<name>/SKILL.md` relative to the start skill) and follow it.
