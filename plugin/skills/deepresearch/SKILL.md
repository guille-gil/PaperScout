---
name: deepresearch
description: Paper Scout deep research - a thorough, source-heavy investigation producing a durable cited brief, with plan approval before gathering. Use only when the user types /paperscout:deepresearch or asks for Paper Scout deep research.
disable-model-invocation: true
argument-hint: <question or topic>
---

> Research mode: if `../start/references/core.md` has not been read in this task, read it now (and `../start/references/paper-routing.md` before the first paper search) and treat research mode as on for the rest of the task.

> Manuscript: if `map action=show` lists a manuscript, read `../start/references/manuscript.md` (once per task), run `map action=manuscript op=scope` first and keep every query within it; prefer `search for=<place>` to a topic search.

# Deep research

Every run leaves on disk: `outputs/.plans/<slug>.md`, `outputs/.drafts/<slug>-draft.md`, `outputs/.drafts/<slug>-cited.md`, the final `outputs/<slug>.md` (or `papers/<slug>.md` for paper-style output) and its `.provenance.md`. Before the plan is approved only the plan file may exist. After approval, if a capability fails, continue in degraded mode and still write a partial final output with `Verification: BLOCKED`. Never end with chat-only output after approval.

1. **Plan.** Write the plan with: key questions, evidence needed, scale decision, task ledger, verification log, decision log. Then stop and ask: `Proceed with this deep research plan? Reply "yes" to continue, or tell me what to change.` Do nothing else until the user confirms; apply requested changes to the plan and ask again.
2. **Scale.** Direct search (no subagents) is the default and covers most questions, including a comparison or a broad survey: it costs a fraction of the tokens, because every subagent pays for the tool definitions and its own searches again. Use researchers only when the user asks for them or the question splits into clearly separate domains: 2 for a comparison of 2 or 3 items, 3 to 4 for multi-domain work (at most 4 at once). State the call budget in the plan (direct: about 30 Paper Scout calls; with researchers: about 12 each plus the verifier and reviewer), since the user approves it, and stop and report when it is spent instead of continuing silently.
3. **Gather.** Prefer TLDRs, abstracts, HTML pages, official docs and metadata; read full-text sections only for the few papers the conclusions depend on. Direct mode: at least 3 distinct queries (definition or history, mechanism, current usage or comparison), logged with results in `outputs/.drafts/<slug>-research-direct.md`. Subagent mode: one brief file per researcher (with the Paper Scout session name), parallel launch, then check every expected output file exists and record failures in the ledger.
4. **Draft.** Write the report yourself (never delegate synthesis) to the draft path: executive summary, findings by question or theme, evidence-backed caveats and disagreements, open questions. Sweep: every critical claim, number or table maps to a source; downgrade or remove the rest; label inferences.
5. **Cite.** Direct mode: cite yourself, verify identifiers with Paper Scout (`verify` on the draft, `paper detail=meta`, `read` with `query` for critical claims) and web fetch, write the cited file. Subagent mode: run the `verifier` subagent (mandatory), and wait for it before review.
6. **Review.** Direct mode: review yourself and write `outputs/.drafts/<slug>-verification.md` with FATAL, MAJOR, MINOR findings and the checks performed. Subagent mode: run the `reviewer` subagent on the cited file as a verification pass. Fix FATAL issues (write `<slug>-revised.md` for more than three substantive fixes) and re-run one review pass. MAJOR issues go to Open Questions.
7. **Deliver.** Copy the final candidate (revised if it exists, otherwise cited) to the output path and write the provenance sidecar: date, rounds, sources consulted, accepted, rejected, verification (PASS, PASS WITH NOTES, BLOCKED), plan path, research files. Export kept papers with `session action=bibtex path=<workspace>/outputs/<slug>.bib`. Confirm all artifacts exist; reply briefly with paths, blocked checks and the `Next:` line.
