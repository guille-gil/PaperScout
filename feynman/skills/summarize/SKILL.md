---
name: summarize
description: Feynman summary of one research source (paper, PDF, report, README or URL) read in bounded windows so the full text never floods context. Use only when the user types /feynman:summarize or asks for a Feynman summary.
disable-model-invocation: true
argument-hint: <arXiv id, DOI, PDF path or URL>
---

> Feynman mode: if `../start/references/core.md` has not been read in this task, read it now (and `../start/references/paper-routing.md` before the first paper search) and treat Feynman mode as on for the rest of the task.

# Summarize

The source stays outside the context; only bounded pieces are read. Derive a slug from the source name. If `outputs/<slug>-summary.md` exists, ask whether to overwrite or use a new slug.

1. **Load and measure.** Papers, PDFs and HTML pages: Paper Scout `read` with only the id (it fetches, caches and reports sizes per section). GitHub repositories: fetch the raw README. Other URLs: download to `outputs/.notes/<slug>-raw.txt` with the shell rather than pulling the page into context. If the text is empty or unextractable, stop and say so.
2. **Choose a tier** from the total size in the section map:
   - Under about 2k tokens: read it all and summarise.
   - 2k to 15k tokens: read section by section with Paper Scout `read` and `sections` (or 6,000-character windows of the raw file), appending key claims and evidence to `outputs/.notes/<slug>-notes.md` after each section, then synthesise from the notes.
   - Over 15k tokens: split the sections into 3 or 4 groups and give each group to a `researcher` subagent restricted to that source only (no web search), each writing `outputs/.notes/<slug>-summary-part-<n>.md`; then merge, deduplicate and resolve boundary conflicts. Record missing parts as coverage gaps.
3. **Write `outputs/<slug>-summary.md`:**
   - Title, source, date, tier
   - Key Claims (3 to 7)
   - Field Context (where it positions itself, which line of work it extends; mark what is source-inferred)
   - Technical Hinges (2 to 4 decisions the work turns on, ranked by originality and importance, with the contrast to prior work)
   - Methodology From Primitives (approach, data, evidence type, evaluation, baselines, failure modes)
   - Limitations (as stated by the source)
   - Follow-up Questions (3 that would change the next research decision)
   - Verdict (one paragraph: what it establishes, credibility, who should read it)
   - Sources, and Coverage gaps when parts failed
4. Confirm the file exists; reply briefly with the path, the verdict sentence and the `Next in Feynman:` line.
