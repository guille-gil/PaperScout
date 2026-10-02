# Changelog

All notable changes are recorded here. Versions follow the Paper Scout extension.

## 0.24.0 (2026-10-02)

Supervisors' comments, and a check on what you cite.

### Paper Scout
- **Supervision rounds.** Add a round of comments to the Manuscript tab by pasting them, or by reading a Word file (its comments and the passage each covers) or a PDF (its annotations and the text under them). Files are read on your Mac, never stored or uploaded. Each comment is anchored to the sentence of your draft it is about, and every round is kept with its date and source. Importing the same comments twice adds nothing.
- Each comment shows where its passage is now. If you have edited the sentence since, it says *passage edited since*; if the sentence is gone, *no longer in the draft*, so you can tell what is probably dealt with. Mark comments done, add one to Tasks, or **Find papers** for the sentence it is about.
- For Claude: `map action=manuscript op=comments` lists the open comments with their places (capped at 12), and `op=intake` records pasted comments, which Claude splits into blocks, or a `.docx` or `.pdf` path.
- **Citation checks.** `op=support` gives Claude up to 8 cited sentences with what is known of each cited paper (title, year, TLDR) and asks whether the paper supports the sentence: `ok`, `weak`, `no` or `unclear`. Weak and doubtful ones are flagged on the tab like any other place. About 1,000 tokens a batch; remembered by sentence and by its citations, so adding or changing a citation brings the sentence back for checking.
- **Your own marker macros.** A macro your draft defines to colour or flag text (for example `\newcommand{\sv}[1]{\textcolor{red}{#1}}`) is found automatically and its contents count as notes, not as your prose. Other commands can be named on the Desk.
- Find papers says when three or more papers are already chosen for a place ("probably enough").
- Tests for the readers (Word, PDF, pasted text), anchoring and the support checks; the PDF and Word fixtures are small synthetic files.

### Paper Scout for Cowork (0.17.0)
- **`/paperscout:cite`**: a citation pass over the linked draft within a budget (at most 2 review batches, 1 support batch, 5 places searched, about 40 calls): judge, check what is cited, find papers for the flagged places, report briefly, never edit the draft.
- The manuscript rules moved to their own file, `references/manuscript.md`, read only when a draft is linked, so `core.md` stays about as short as in 0.20.0.

## 0.23.0 (2026-10-02)

Search starts from your sentence, not from a topic.

### Paper Scout
- **Find papers for a flagged place.** On the Manuscript tab each flagged sentence has a Find papers button. Paper Scout builds a short query from the sentence and its section, pools Zotero and Semantic Scholar (OpenAlex when thin), ranks the pool locally against the sentence, and shows a shortlist of at most 5 with a fit score, the terms that matched, and a note when your draft already cites the paper. Off-topic results are hidden and counted. It runs on the Desk, so it costs Claude nothing; in a chat, `search for=<place>` does the same (with `query=` for your own wording).
- **Use for this sentence** chooses a paper for a place (and keeps it); **Not this** drops it so it does not come back. Chosen papers show under the sentence with the citation to copy, or **Add to .bib**, which appends the paper's BibTeX entry to the end of the .bib your draft names (after a confirmation, never changing what is already there, with a unique key). This is the only thing Paper Scout ever writes to your files.
- **Scope.** Say in your own words what the paper is about and what is out of scope. Searches for a sentence skip papers mentioning anything on the out-of-scope list and report how many; `map action=manuscript op=scope` gives Claude a short brief of the draft (title, abstract, sections, what it already cites, your scope).
- **Working set.** The Papers tab gets an In your draft filter, and papers show the key they are cited as.
- Tests for the search pipeline run against canned API responses, so they need no network.

### Paper Scout for Cowork (0.16.0)
- `lit`, `deepresearch` and `ask` start from the draft's scope when a manuscript is linked; the manuscript rule explains `search for=`.

## 0.22.0 (2026-10-02)

### Paper Scout
- **Claude decides which sentences need a source, not a rule list.** The wording rules of 0.21.0 are gone. Paper Scout still does the structural work locally (sections, which sentences already cite, notes, empty `\cite{}`, the `.bib`), and hands Claude the uncited sentences in small batches when you ask: `map action=manuscript op=review` returns at most 30 sentences (`about=` narrows to a section), with the neighbours' citations flagged, and `op=judge` records a verdict per sentence (`cite`, `maybe` or `own`) with a short reason.
- Verdicts are remembered by sentence, so nothing is judged twice and a sentence you edit comes back for review by itself. A batch costs about 2,000 tokens; a whole short paper, a few thousand. Nothing is judged unless you ask.
- The Manuscript tab shows Claude's reasons next to each flag, how many uncited sentences are still unreviewed (with the sentence to say to Claude), and a collapsed list of the sentences Claude judged to need no source, each with "Ask again". You can still dismiss any flag. Notes asking for a source are no longer guessed from their wording: they appear with the sentence they sit on, and Claude reads them with it.
- Tool definitions: about 70 tokens more than 0.20.0 for the whole manuscript feature (2,396 in all, against 2,634 before the 0.20.0 diet).

### Paper Scout for Cowork (0.15.0)
- The manuscript rule now describes the review and judge cycle and its token cost.

## 0.21.0 (2026-10-02)

Keeping the literature close to the writing: Paper Scout now reads the draft you are working on.

### Paper Scout
- **Manuscript.** Link your LaTeX draft (Paper Scout offers the `.tex` files it finds in the project folder, or you give a path) and a new Manuscript tab on the Research Desk shows where the argument still needs sources: sentences that read like a statement about prior work and carry no citation, empty `\cite{}` placeholders, and notes asking for a source (`\todo`, the `changes` package, `% TODO` comments). It also shows the outline with citations per section, cited keys missing from the `.bib`, `.bib` entries never cited, and which cited papers are already in your Papers.
- It follows `\input` and `\include`, finds the `.bib` from `\bibliography` or `\addbibresource`, and works with natbib, biblatex and `\cite` variants. Only `.tex` and `.bib` files are read, and Paper Scout never writes to them.
- The reading is local and free: nothing on the tab costs Claude tokens. Claude is shown one line in `map action=show` and, on request, `map action=manuscript op=gaps`, a list capped at 10 places (`about=` narrows to a section, `limit` up to 25). The tool definitions grow by about 50 tokens.
- The wording heuristics are guesses, and they are kept cautious: sections that are your own argument (findings, discussion, conclusion) are not checked, a neighbouring citation downgrades a guess, and anything can be dismissed (and restored) on the Desk.
- Tests for the parser: `npm test` in `extension/`.

### Paper Scout for Cowork (0.14.0)
- A rule for the manuscript: Claude treats the `.tex` and `.bib` as read-only, and uses the capped gap list when you ask what the draft still needs.

## 0.20.0 (2026-10-02)

A lighter Paper Scout: less context loaded in every conversation, fewer tokens spent per workflow.

### Paper Scout
- The `map` tool definition no longer carries the framework and ontology parameters, so Claude's tool definitions are about 300 tokens shorter in every conversation and in every subagent. Frameworks and the ontology are unchanged on the Research Desk, where you draw and edit them; only Claude's ability to propose edges and placements is gone.

### Paper Scout for Cowork (0.13.0)
- `/paperscout:lit` and `/paperscout:deepresearch` search directly by default instead of launching researchers, verifier and reviewer subagents, each of which pays again for the tool definitions and its own searches. Fan-out happens when you ask for it or the work splits into clearly separate areas, and the plan states a call budget (about 30 calls direct) that Claude stops at and reports.
- `/paperscout:start` no longer prints the list of commands, which is on the Desk under Commands. The start skill and the map rules are shorter by about a thousand tokens (the framework and ontology rules are gone).

## 0.19.0 (2026-09-28)

### Paper Scout
- **Pop out** on the Desk opens it in your own browser, where it stays open between chats and when Claude's browser pane is closed. It works whenever Claude is running; bookmark it.
- `desk` with `browser=true` does the same from a chat.

### Paper Scout for Cowork (0.12.0)
- `/paperscout:desk` reopens the Desk in the browser pane; `/paperscout:desk browser` opens it in your own browser.
- In research mode Claude leaves the Desk tab alone (other pages open in new tabs), reopens it when you mention it and it is closed, and attaches files instead of previewing them so the side panel keeps the Desk.

## 0.18.0 (2026-09-28)

### Paper Scout
- The research map and its exports (summary, figures, ontology) live in `notes/` inside the project folder. Maps kept at the top of the folder by earlier versions are moved there the first time the project is opened.

## 0.17.1 (2026-09-28)

### Paper Scout
- "In your papers" and the list of papers mentioning a concept are dropdowns, closed until you open them.
- Papers you already have jump to their entry in Papers, opened and highlighted; the others open in your browser.

## 0.17.0 (2026-09-28)

### Paper Scout
- Each concept shows where it sits in your own papers: one line per paper with what it does for the concept (defines it, evidence for or against a claim that uses it) and where (section or page).
- The count of papers mentioning a concept opens the papers themselves, most cited first, with the phrase highlighted in the title or in a snippet of the abstract, and a button to add any of them to screening. The Desk fetches this from OpenAlex itself, so it costs no Claude tokens.

## 0.16.1 (2026-09-28)

### Paper Scout
- Links on the Research Desk (Semantic Scholar, publisher pages, arXiv, library access, the summary, saved PDFs) open in your default browser, so the pane showing the Desk never navigates away from it.

## 0.16.0 (2026-09-28)

### Paper Scout
- The extension has its icon.
- The Research Desk follows the project Claude is working in, without asking you to switch; choosing another project from the menu still pins your view to it.

### Paper Scout for Cowork
- `/paperscout:start` opens the Research Desk in the built-in browser pane by itself instead of handing you a link.
- On a new project with material in its folder (a proposal, a draft, notes), start seeds the Desk straight away: a first draft of the idea, framing and method, candidate concepts and reading tasks, all editable.

## 0.15.0 (2026-09-28)

### Paper Scout
- Link code to a project: a Code section on the Idea page keeps the folders of the project's repositories and opens them in Finder. `map action=repo op=brief` gives Claude a short overview (layout, recent commits, README) only when a question needs it. Read only.

### Paper Scout for Cowork
- Rule for using linked code on demand and offering to link a repository when one is mentioned.

## 0.14.1 (2026-09-28)

### Paper Scout
- Fixed dragging a box on the framework canvas, which could make it jump away from the pointer.
- Task cards can be picked up by their title as well as by the rest of the card.
- A short demo at the top of the README.

## 0.14.0 (2026-09-28)

### Paper Scout
- A Commands panel on the Research Desk lists every command with a line on what it does, plus things you can simply say.
- Usage estimate: Paper Scout records roughly how many tokens it adds to Claude's context (tool results and tool definitions), shown in the header and, per tool, in the Commands panel.
- Shorter `map` tool definition; the tool definitions now come to about 2,600 tokens.

### Paper Scout for Cowork
- The plugin is now called `paperscout`, so its commands are `/paperscout:start`, `/paperscout:lit` and so on. Remove the old `feynman` plugin after installing it.
- The rules loaded at start are about half as long: the detailed research map rules load only when Claude first writes to the map.

## 0.13.0 (2026-09-28)

### Paper Scout
- The framing has four parts, each edited on its own: background, positioning, claim and novelty. Earlier framings are carried over.
- Kept and saved are separate: keeping marks a paper as interesting, saving puts its PDF in the project's papers folder. Only saved papers are fetched, and a PDF dropped in the folder saves its paper.
- The task board has real cards: pick one up, see where it will land, and drop it in another column or higher up the same one. The order is kept.
- README screenshots are cropped to one feature each; full-page views are in `docs/images/full`.

### Plugin (then called Feynman for Cowork)
- Rules for the four-part framing and for suggesting which papers to save.

## 0.12.0 (2026-09-28)

### Paper Scout
- Edit in place on the Research Desk: the idea, framing, methodology, claims, notes, concepts (name, other names, working definition, scope), definitions and tasks. Desk edits become a new version of the idea, one per day.
- Framing and methodology are now prose. Maps with the earlier structured framing are read and shown as prose.
- Saved papers: kept papers are kept as PDFs in `<project folder>/papers`, copied from Zotero or downloaded as open copies; the rest becomes one task. A tracker on the Papers tab shows what is saved and opens the folder. `read` prefers these files.
- Frameworks: several per project, each a conceptual model or a pipeline (components such as modules, datasets and steps, with `feeds` and `produces` relationships, laid out top to bottom). Hypothesis labels, custom verbs, versions, comparison, restore and branching.
- Framework canvas: arrows route around boxes, moderators land on a junction, signs and labels sit in badges, suggestions highlight their arrow, and new boxes are placed next to what they connect to without moving the rest.
- Working ontology: click-to-edit placement, related links, versions, comparison and SKOS (Turtle) export.
- Tasks move between columns by drag and drop.
- `map action=focus` returns one concept, claim or question with its neighbours, so Claude reads a small part of a large map instead of all of it.

### Plugin (then called Feynman for Cowork)
- Rules for keeping the map out of the context, prose framing, respecting the user's own edits, the papers folder, pipelines and the ontology.

## 0.11.0 (2026-09-27)

First public release.

### Paper Scout
- Search across Zotero (read only), Semantic Scholar, OpenAlex and arXiv, with one-line results, handles and a per-project ledger.
- Section-level and passage-level reading of open full texts, figures on demand, citation snowballing and code discovery.
- Preprints matched to their published version; `peer_reviewed` search filter.
- Research map in the project folder: concepts with verbatim definitions, comparison by attribute and yearly frequency; claims linked to evidence; a versioned idea; notes; tasks.
- Conceptual framework with evidence-aware relationships and SVG export; working ontology.
- One-page supervision summary with APA references.
- Research Desk, a local page with Idea, Concepts, Papers and Tasks views.

### Plugin (then called Feynman for Cowork)
- Research workflows adapted from Feynman, with `/feynman:start` and `/feynman:end`.
- `/feynman:ask` for quick, scoped answers from the literature.
- Rules for working with the research map, tasks and the framework.
