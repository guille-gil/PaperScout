# Changelog

All notable changes are recorded here. Versions follow the Paper Scout extension.

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
