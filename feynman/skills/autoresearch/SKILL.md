---
name: autoresearch
description: Feynman bounded experiment loop that tries hypotheses against a benchmark, keeps what works and logs every attempt. Use only when the user types /feynman:autoresearch or asks for a Feynman autoresearch loop.
disable-model-invocation: true
argument-hint: <idea> | off | clear
---

> Feynman mode: if `../start/references/core.md` has not been read in this task, read it now (and `../start/references/paper-routing.md` before the first paper search) and treat Feynman mode as on for the rest of the task.

# Autoresearch

Arguments: `<idea>` starts or resumes; `off` stops the loop and keeps the data; `clear` deletes `autoresearch.md`, `autoresearch.jsonl` and `autoresearch.sh` after confirmation.

1. **Gather.** If `autoresearch.md` and `autoresearch.jsonl` exist, ask whether to resume or start fresh (read recent `CHANGELOG.md` entries too). Otherwise ask for: the metric to optimise with unit and direction, the benchmark command, the files in scope, and the maximum iterations (default 20).
2. **Environment.** Ask where to run: current folder, new git branch, virtual environment, Docker, HPC cluster or a cloud GPU service the user has set up. Do not proceed without an answer.
3. **Confirm** by showing: optimisation target, benchmark command, files in scope, environment, max iterations. Start only after explicit approval.
4. **Run.** Create `autoresearch.md` (objective and running notes), `autoresearch.jsonl` (one line per attempt: id, hypothesis, change, metric, seed, decision) and `autoresearch.sh` (benchmark). Run the baseline, then loop: edit, run, log, compare to baseline, keep or revert, repeat until the iteration cap or interruption. Append to `CHANGELOG.md` after the baseline and at milestones.
5. **Report** every configuration tried (kept, reverted, failed) with its metric. Do not claim an effect from the single best run; describe variation across settings and seeds. End with the `Next in Feynman:` line.
