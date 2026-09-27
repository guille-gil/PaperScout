---
name: compare
description: Feynman source comparison producing a grounded matrix of agreements, disagreements and confidence across papers, methods or sources. Use only when the user types /feynman:compare or asks for a Feynman comparison.
disable-model-invocation: true
argument-hint: <topic, or a list of papers or sources>
---

> Feynman mode: if `../start/references/core.md` has not been read in this task, read it now (and `../start/references/paper-routing.md` before the first paper search) and treat Feynman mode as on for the rest of the task.

# Compare

1. Write `outputs/.plans/<slug>.md`: which sources, which dimensions (for methods: task, data, baselines, metrics, results, assumptions, cost; for claims: evidence type, scope, caveats), expected structure. Summarise in two lines and continue.
2. Gather material. If the set is broad, use `researcher` subagents in parallel; otherwise do it directly with Paper Scout (`paper` TLDRs in one batch, then `read` with `query` or `sections` for the specific dimensions).
3. Build the matrix: source, key claim, evidence type, caveats, confidence. Quantitative results go in a Markdown table with the exact setting each number comes from; never align numbers from incomparable settings without saying so. Mermaid for method or architecture contrasts when source-supported.
4. Distinguish agreement, disagreement and uncertainty explicitly, and explain the likely cause of each disagreement (data, metric, setting, definition).
5. Run the `verifier` on the matrix for inline citations when more than a handful of sources are involved.
6. Save exactly one file, `outputs/<slug>-comparison.md`, ending with Sources. Reply briefly with the path and the `Next in Feynman:` line.
