---
name: audit
description: Feynman paper-versus-code audit comparing a paper's claims with its public codebase for mismatches, omissions and reproducibility risks. Use only when the user types /feynman:audit or asks for a Feynman audit.
disable-model-invocation: true
argument-hint: <paper id or URL, and optionally the repository URL>
---

> Feynman mode: if `../start/references/core.md` has not been read in this task, read it now (and `../start/references/paper-routing.md` before the first paper search) and treat Feynman mode as on for the rest of the task.

# Audit

1. Write `outputs/.plans/<slug>.md`: which paper, which repository (Paper Scout `code` finds candidates when none is given), which claims to check (methods, defaults, hyperparameters, metrics, data handling, splits, preprocessing). Summarise in two lines and continue.
2. Extract the claims from the paper with Paper Scout `read` (method, experiments, appendix) and `read` with `query` for specific numbers.
3. Inspect the code: clone it into the workspace (shell) or read files via web fetch of raw GitHub URLs. Locate the code path for each claim.
4. For non-trivial audits, use a `researcher` subagent for evidence gathering and the `verifier` to verify sources and add inline citations.
5. Compare claim by claim: matches, mismatches, missing code, ambiguous defaults, undocumented steps, reproduction risks. Use a table with columns claim, paper location, code location, status (match, mismatch, missing, ambiguous), note.
6. Save exactly one artifact, `outputs/<slug>-audit.md`, ending with a Sources section (paper and repository URLs, with commit hash when available). Reply briefly with the path, the most serious mismatches and the `Next in Feynman:` line.
