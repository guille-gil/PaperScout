---
name: lit
description: Feynman literature review of a topic, lab, PI or author using paper search and primary-source synthesis. Use only when the user types /feynman:lit or asks for a Feynman literature review.
disable-model-invocation: true
argument-hint: <topic, lab, PI or author>
---

> Feynman mode: if `../start/references/core.md` has not been read in this task, read it now (and `../start/references/paper-routing.md` before the first paper search) and treat Feynman mode as on for the rest of the task.

# Literature review

Investigate the topic, lab, PI or author given in the arguments as a literature review. Derive a slug and use it for every file in this run.

1. **Plan.** Write `outputs/.plans/<slug>.md`: key questions, source types (papers, web, repos), time window, expected sections, a small task ledger and a verification log. If the input names a lab, PI, author or profile page, run a publication-corpus review: resolve the identity first (Paper Scout `graph mode=author`), collect the reachable publication list, then map the research trajectory. Summarise the plan to the user in two or three lines and continue in the same turn; do not wait for approval unless the user asked to review the plan.
2. **Gather.** For narrow topics, search directly. For wide sweeps, write one brief per researcher (`outputs/.plans/<slug>-T<n>.md`, including the Paper Scout session name) and launch 2 to 4 `researcher` subagents in parallel, each writing `outputs/.drafts/<slug>-research-<angle>.md`. For corpus reviews the lead agent writes `notes/<slug>-publications.md` (titles, years, venues, ids, gaps) before delegating. Follow the budget ladder: titles, then TLDRs in batches, then sections only for load-bearing papers. Snowball from the 3 to 5 strongest seeds. Mark every assigned question `done`, `blocked` or `superseded` in the ledger.
3. **Synthesise.** Run `session action=roles` on the kept papers first and use the foundation, breakthrough, consolidation and frontier labels to structure the narrative. Write `outputs/.drafts/<slug>-draft.md` yourself. Organise by idea, not by paper: consensus, disagreements, open questions. For corpus reviews, identify 3 to 5 research trajectories and the 3 to 5 papers that most changed the corpus direction, ranked by contrastive originality, methodological strength and relation to prior art rather than author prestige. Propose concrete follow-up reading or experiments when useful. Mermaid for taxonomies or trajectories only when the structure is source-supported.
4. **Cite.** Run the `verifier` subagent on the draft and research files (with the Paper Scout session name); it writes `outputs/.drafts/<slug>-cited.md`.
5. **Verify.** Run the `reviewer` subagent on the cited draft as a verification pass (unsupported claims, logical gaps, zombie sections, single-source critical findings). Fix FATAL issues and re-run one pass if any were found. MAJOR issues go to Open Questions.
6. **Deliver.** Save `outputs/<slug>.md` and `outputs/<slug>.provenance.md` (date, queries run from `session action=queries`, sources consulted vs accepted vs rejected, verification status, intermediate files; for corpus reviews the publication log path and gaps). Export the kept papers with `session action=bibtex path=<workspace>/papers/<slug>.bib`. Confirm both files exist, then reply briefly with their paths and the `Next in Feynman:` line.
