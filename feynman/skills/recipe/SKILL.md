---
name: recipe
description: Feynman search for ranked, implementable training or evaluation recipes backed by reported results, datasets and code. Use only when the user types /feynman:recipe or asks for Feynman recipes.
disable-model-invocation: true
argument-hint: <task or paper>
---

> Feynman mode: if `../start/references/core.md` has not been read in this task, read it now (and `../start/references/paper-routing.md` before the first paper search) and treat Feynman mode as on for the rest of the task.

# Recipe

Required files: `outputs/.plans/<slug>-recipe.md`, `outputs/.drafts/<slug>-recipe-research.md`, `outputs/<slug>-recipe.md`, `outputs/<slug>-recipe.provenance.md`.

1. **Plan** the target task, benchmark or behaviour, candidate source types, feasibility constraints (compute the user actually has) and a task ledger. Continue automatically.
2. **Research** from evidence of results, not from example scripts. Use a `researcher` subagent in recipe mode for broad sweeps.
3. **Extract** for each approach: source, reported result and benchmark, dataset, method, key hyperparameters, compute assumptions, code path (Paper Scout `code`), current docs.
4. **Validate datasets** (availability, splits, columns, licence) by fetching the dataset card or repository. Unchecked means `unverified`.
5. **Ground implementation** in working code or official docs; record file paths, function names and commands.
6. **Synthesise** research notes first, then the final ranked brief: Recommendation (one recipe to try first and why), ranked table (source, result, dataset, method, hyperparameters, compute, code, verification status), dataset notes, minimal implementation plan, known gaps, Sources.
7. **Verify** the top-ranked recipe's sources, data and code before delivery; write the provenance sidecar. Use `verified`, `unverified`, `blocked` and `inferred` precisely. Reply briefly with the path and the `Next in Feynman:` line.
