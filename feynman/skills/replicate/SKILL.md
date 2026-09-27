---
name: replicate
description: Feynman replication plan for a paper, claim or benchmark, executed only after an explicit environment choice. Use only when the user types /feynman:replicate or asks for a Feynman replication.
disable-model-invocation: true
argument-hint: <paper id or claim>
---

> Feynman mode: if `../start/references/core.md` has not been read in this task, read it now (and `../start/references/paper-routing.md` before the first paper search) and treat Feynman mode as on for the rest of the task.

# Replicate

1. **Extract.** Pull implementation details from the paper (Paper Scout `read`: method, experiments, appendix; `read` with `query` for hyperparameters) and linked code (`code`), using a `researcher` subagent for large targets. Read recent `CHANGELOG.md` entries if resuming.
2. **Recipe pass.** For training, fine-tuning, benchmark or data-heavy targets, link each claimed result to its dataset, method, hyperparameters, compute, metric and code path. Check dataset availability and schema where possible; mark the rest `unverified`.
3. **Plan.** Code, data, metrics, environment, and the test oracles that decide success. State what is verified, inferred and missing. Write it to `outputs/.plans/<slug>-replication.md`.
4. **Environment.** Before running anything, ask where to execute: local folder, virtual environment, Docker, the university HPC cluster (if the user uses one), a cloud GPU service they have set up, or plan only. Do not install packages or run experiments before the answer.
5. **Execute** in the chosen environment, saving scripts, raw outputs and results under `experiments/<slug>/`. Do not call it replicated unless the planned checks passed.
6. **Log** meaningful progress, failures and outcomes to `CHANGELOG.md` for multi-step work.
7. **Report** in `outputs/<slug>-replication.md` with a Sources section (paper, data, docs, repository). Reply briefly with the outcome and the `Next in Feynman:` line.
