<p align="center">
  <img src="docs/images/banner.png" alt="Paper Scout: a field notebook for academic literature research" width="100%">
</p>

<p align="center">
  <b>Search, read and think with the literature from inside Claude, without spending a fortune in tokens.</b><br>
  Your Zotero library, Semantic Scholar, OpenAlex and arXiv in one place, plus a notebook that remembers<br>
  your concepts, your argument and how it changed.
</p>

---

## What is this? 🧭

Paper Scout started as an itch: I liked doing research with the [Feynman](https://github.com/companion-inc/feynman) agent harness for my PhD work, but not in a terminal. So I brought it into the Claude desktop app and kept adding the things I missed while on my research process.

The repository has two parts that work together:

| Part | What it does |
| --- | --- |
| **Paper Scout** (`extension/`) | A desktop extension for Claude. It searches and reads papers with as few tokens as possible, keeps a ledger of everything you screened, and stores a **research map** (concepts, framework, the versioned idea, tasks) as plain files in your project folder. It also serves the **Research Desk**, a local page where you make the decisions. |
| **Paper Scout for Cowork** (`plugin/`) | A plugin with the research workflows (literature review, deep research, peer review, drafting and more), adapted from Feynman to Claude's Cowork mode, with explicit start and end commands so it only runs when you want it. |

The rule behind everything: **Claude proposes, you decide.** Claude brainstorms, suggests concepts, links evidence and drafts. Adopting a concept, accepting a relationship or rewriting your idea always waits for you. True human-in-the-wheel.

This is how Paper Scout looks like:

<p align="center"><img src="docs/demo.gif" alt="A 30-second tour of the Research Desk" width="80%"></p>


## A quick tour

The screenshots come from a small example project built from real papers on human-AI complementarity; the idea itself is only there for illustration. Full-page views of each tab are in [`docs/images/full`](docs/images/full).

### The idea 💡

Every project starts from an idea, and ideas change. The Idea page opens on the current statement, with a notes box for thoughts and supervisors' comments that Claude folds into its next proposal.

<p align="center"><img src="docs/images/idea.png" alt="The current idea with its notes" width="75%"></p>

Click the pen next to anything to edit it in place, no prompt needed. Your edits become a new version of the idea (edits made on the same day share one), so the history stays honest.

**Framing** comes in four parts, each as long as it needs to be: the background, where the project sits against existing work, the claim itself (often a single sentence) and what is new about it.

<p align="center"><img src="docs/images/framing.png" alt="The framing in four parts" width="75%"></p>

**The argument** lists its steps, each with a small bar of the evidence for, against and qualifying it. Open one to see the cards behind it, or add a step yourself.

<p align="center"><img src="docs/images/argument.png" alt="The argument with its evidence" width="75%"></p>

**The history** keeps every earlier version with what prompted the change (a paper, a supervision meeting, your own thinking) and the wording differences marked.

<p align="center"><img src="docs/images/history.png" alt="How the idea changed" width="75%"></p>

### Concepts 📚

Terms that keep coming up in the literature land here as candidates. Adopt, park or drop them. Each concept keeps your working definition and scope, how often the term appears per year, and a table comparing what each published definition includes.

<p align="center"><img src="docs/images/concept.png" alt="A concept with its definitions compared" width="75%"></p>

The definitions themselves are kept verbatim, with their source, year and where in the paper they appear.

<p align="center"><img src="docs/images/definitions.png" alt="Definitions in the literature" width="75%"></p>

### Frameworks 🗺️

Few arguments rest on a single chain of cause and effect, so a project can hold several frameworks side by side: your main account, a rival explanation, the model a key paper proposes. Drag boxes around, pull an arrow from the handle of one to another and say what the link is: influences, moderates, enables, constrains, precedes, part of, a plain association or a verb of your own. Label arrows as hypotheses (H1, H2…). The line style shows how solid each one is: solid when supported, dashed without evidence yet, red when contested. Claude's suggestions arrive dotted, for you to accept or reject.

<p align="center"><img src="docs/images/framework.png" alt="A conceptual framework" width="85%"></p>

Click an arrow to see the claim behind it and the evidence for and against.

<p align="center"><img src="docs/images/edge.png" alt="The evidence behind one arrow" width="85%"></p>

Save a version whenever the argument moves and compare any two: new links in green, dropped ones in red, changed ones in amber. Restore an old version, or branch it into a new framework. Any framework exports as a clean black-and-white figure for your paper.

<p align="center"><img src="docs/images/framework-compare.png" alt="Comparing two versions" width="85%"></p>

Not every paper is a theory paper. For a method, system or modelling paper a framework can be a **pipeline**, whose boxes are components (a module, a dataset, a step) as well as concepts, connected by what feeds or produces what.

<p align="center"><img src="docs/images/pipeline.png" alt="A pipeline for a method paper" width="45%"></p>

### Ontology 🌳

A working ontology places each concept as a kind of, or a part of, another, and links related ones. Click where a concept sits to move it, rename and redefine in place, keep versions, and export the whole thing as SKOS (Turtle). For a survey it doubles as the taxonomy.

<p align="center"><img src="docs/images/ontology.png" alt="The working ontology" width="85%"></p>

### Tasks ✅

A calm board for what to read, answer, write or check. Pick a card up and drop it in another column, or higher up the same one. Reading suggestions from the workflows, long comments from your supervisor and questions you put to the literature all end up here; questions carry their verdict and the positions found.

<p align="center"><img src="docs/images/tasks.png" alt="Moving a card on the task board" width="85%"></p>

### Papers 📄

Screen papers into keep, maybe or drop, and **save** the ones your argument will rest on. Keeping means a paper is interesting; saving means it belongs in the project. Preprints are matched to their published version, and BibTeX exports with your own Better BibTeX keys.

<p align="center"><img src="docs/images/papers.png" alt="Keeping and saving papers" width="75%"></p>

Saved papers are gathered as PDFs in a **papers** folder inside your project, because Claude writes far better from the papers themselves than from links. They are copied from Zotero when you have them there and downloaded when an open copy exists. Whatever is left becomes a single task, not one per paper; drop the PDFs in the folder under any name and they are matched by title.

<p align="center"><img src="docs/images/shelf.png" alt="The papers folder and its tracker" width="75%"></p>

### One page for supervision

A plain, printable summary of the current idea, its framing and methodology, the argument with its sources, the framework, key concepts, recent changes and open points, with references in APA.

<p align="center"><img src="docs/images/summary.png" alt="The one-page summary" width="60%"></p>

### Night Mode 🌙

<p align="center">
  <img src="docs/images/idea-dark.png" alt="Dark mode" width="62%">
</p>

## How it saves tokens

Paper Scout gives every paper a short handle (`P12`) and shows it as a single line. Papers already seen collapse to a stub, repeated searches are answered from memory, summaries come before abstracts, and full texts are read section by section or by passage. Your Zotero library is read directly from disk (read only), so the papers you already have cost almost nothing to find.

The research map grows with the project, so Claude never reads it whole. It starts from a few lines of overview and then pulls only what the step needs: one concept, claim or question with its immediate neighbours and the evidence one step away. The readable Markdown copy is for you. Anything you change on the Research Desk costs no tokens at all.

In numbers, on the example project: the tool definitions come to about 2,600 tokens per conversation, starting research mode loads about 2,800 tokens of rules (the detailed map rules, about 1,500 more, load only when Claude first writes to the map), an overview of the map costs about 160 and one concept in focus about 700. The **Commands** panel on the Desk keeps a running estimate of what Paper Scout has added to Claude's context, today, over the week and per project.

<p align="center"><img src="docs/images/usage.png" alt="The usage estimate on the Research Desk" width="55%"></p>

## Installation

You need the [Claude desktop app](https://claude.ai/download) and Node.js 18 or newer.

**1. Build and install the extension**

```bash
cd extension
npm install
npm run pack
```

Open the resulting `paper-scout.mcpb` with the Claude desktop app. In its settings you can add:

| Setting | Why |
| --- | --- |
| Semantic Scholar API key | Faster, more reliable search ([request one here](https://www.semanticscholar.org/product/api)) |
| OpenAlex API key or email | Polite access to OpenAlex |
| Zotero data folder | So Paper Scout can read your library |
| Library proxy | A link prefix for paywalled papers (it defaults to the University of Groningen; change it to your own) |

**2. Add the plugin**

```bash
cd plugin
zip -r ../paperscout.plugin .
```

Open `paperscout.plugin` with the Claude desktop app, then type `/paperscout:start` in a Cowork task. If you used an earlier version, the plugin was called `feynman`: remove it once the new one is installed.

## Using it

| Command | What happens |
| --- | --- |
| `/paperscout:start` | Turns on research mode for the task, connects your project and gives you the Research Desk link |
| `/paperscout:ask <question>` | A quick answer from the literature: verdict, positions, debate and a reading list |
| `/paperscout:lit <topic>` | A full literature review with citations and provenance |
| `/paperscout:deepresearch <question>` | A thorough, cited research brief |
| `/paperscout:review <paper or draft>` | A tough peer review |
| `/paperscout:draft <topic>` | A paper-style draft built on your research map |
| `/paperscout:end` | Leaves research mode |

The full list appears when you run `/paperscout:start`, and the **Commands** button on the Research Desk keeps it one click away.

<p align="center"><img src="docs/images/commands.png" alt="The Commands panel on the Research Desk" width="55%"></p> Outside those commands you can simply talk to Claude: "add this as a concept", "record this as the new version of the idea", "what supports claim K2?".

## Where your data lives

Everything about a project lives in its own folder, readable without the tool:

- `papers/`, the PDFs of your saved papers
- `research-map.json`, the map itself
- `research-map.md`, a readable copy regenerated on every change
- `research-summary.html`, `research-framework.svg` and `research-ontology.ttl` when you export them

Paper metadata and full texts are cached on your computer. Nothing is sent anywhere except the lookups to the public scholarly APIs.

## Credits 🙏

- **[Feynman](https://github.com/companion-inc/feynman)** by Companion, Inc. is the foundation of this project. Its research workflows, subagents and working rules were adapted here for Claude's Cowork mode. Feynman is released under the MIT licence; see [`plugin/NOTICE`](plugin/NOTICE).
- **[Claude](https://claude.ai)** by Anthropic is the environment all of this runs in. Paper Scout is a desktop extension (MCP server) and Paper Scout for Cowork is a plugin of skills and subagents on top of the Claude desktop app.
- Paper data comes from [Semantic Scholar](https://www.semanticscholar.org), [OpenAlex](https://openalex.org), [arXiv](https://arxiv.org), [Unpaywall](https://unpaywall.org) and your own [Zotero](https://www.zotero.org) library.
- The research map borrows from discourse graphs (Chan et al., 2024), concept definition methods (Podsakoff, MacKenzie and Podsakoff, 2016; Suddaby, 2010) and W3C SKOS.
- Typefaces: [Newsreader](https://fonts.google.com/specimen/Newsreader) and [Inter Tight](https://fonts.google.com/specimen/Inter+Tight).

## Licence

MIT, see [LICENSE](LICENSE). Made by [Guillermo Gil de Avalle](https://github.com/guille-gil).
