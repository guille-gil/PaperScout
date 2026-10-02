---
name: ask
description: Paper Scout quick scoped answer to one research question (has this been answered, what solutions exist, what is the debate, what is meant by a term) with a verdict, positions and a reading list, recorded in the research map. Use only when the user types /paperscout:ask or asks for a Paper Scout quick question.
disable-model-invocation: true
argument-hint: <question>
---

> Research mode: if `../start/references/core.md` has not been read in this task, read it now (and `../start/references/paper-routing.md` before the first paper search) and treat research mode as on for the rest of the task.

> Manuscript: if `map action=show` lists a manuscript, read `../start/references/manuscript.md` (once per task), run `map action=manuscript op=scope` first and keep every query within it; prefer `search for=<place>` to a topic search.

# Ask: a quick, scoped answer

A light workflow for the exploratory phase. No subagents, no verifier, no files unless the user asks. Target budget: under 25,000 tokens. When the question needs more, say so and offer `/paperscout:deepresearch`.

1. **Frame.** Restate the question in one sentence and name its type: *settled* (has X been answered), *options* (what solutions to Y), *debate* (what is the debate on Z) or *concept* (what is meant by X). Check memory first: `map action=questions` and `session action=list` with a `query`. If the question was asked before, show the earlier verdict and ask whether to update it. Otherwise record it with `map action=question text=...`.
2. **Search.** At most three `search` calls from different angles, one of them framed against the question (limitations, critique, failure, null result). Then TLDRs for the 10 to 15 most relevant handles in one `paper` call. Snowball once from the best seed only if coverage is thin.
3. **Read.** At most five `read` calls with `query`, on the load-bearing papers: a review if one exists, the strongest empirical paper, and the strongest contrary one. Save an evidence card for each claim you use (`session action=card`).
4. **Record.** Each position becomes a claim that answers the question (`map action=claim text=... answers=[RQn]`), with its cards linked (`map action=link rel=supports` or `opposes`). Cards that inform without taking a side use `rel=informs`. Terms recurring across at least two papers become candidate concepts with a pulse. Mark reading-list papers `maybe` in the ledger and add each as a reading task (`map action=task kind=read about=P12 source=workflow`). Save the verdict: `map action=question id=RQn verdict=... coverage=...`.
5. **Answer in chat**, in this order and briefly:
   - **Verdict**: answered, partly answered, open or contested, with one sentence on why, and the coverage (papers screened and read, sources, years). Never a percentage or a vote count of papers.
   - **Positions**: two to four, each one sentence with the papers that hold it, as connected prose.
   - **Solutions proposed** (options questions only): a short table of solution, where it was proposed, and evidence status.
   - **The debate**: where positions conflict and why (method, context, definition of terms, level of analysis).
   - **Concepts noticed**: candidates added to the map, by handle, for the user to triage.
   - **Reading list**: five to eight handles in reading order, one reason each.
   - **What would change the verdict**.
6. End with the `Next:` line (usually `/paperscout:lit` to widen, `/paperscout:deepresearch` for a full brief, or adopting concepts on the Research Desk).
