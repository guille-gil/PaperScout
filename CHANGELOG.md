# Changelog

All notable changes are recorded here. Versions follow the Paper Scout extension.

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

### Feynman for Cowork
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

### Feynman for Cowork
- Research workflows adapted from Feynman, with `/feynman:start` and `/feynman:end`.
- `/feynman:ask` for quick, scoped answers from the literature.
- Rules for working with the research map, tasks and the framework.
