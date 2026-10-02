---
name: cite
description: Paper Scout citation pass over the user's linked LaTeX draft: judge which uncited sentences need a source, check what is cited, and find papers for the flagged places, a few at a time within a call budget. Use only when the user types /paperscout:cite or asks for a citation pass on their draft.
disable-model-invocation: true
argument-hint: <section, or empty for the whole draft>
---

> Research mode: if `../start/references/core.md` has not been read in this task, read it now (and `../start/references/paper-routing.md` before the first paper search) and treat research mode as on for the rest of the task.

# Citation pass

The draft is the user's: never edit the .tex or .bib. Budget: at most 2 review batches, 1 support batch and 5 places searched per run, about 40 Paper Scout calls in all; stop and report when it is spent, and offer to continue.

1. Run `map action=show`. If it lists no manuscript, say the draft can be linked on the Desk (Manuscript tab) and stop. Otherwise read `../start/references/manuscript.md` (once per task) and run `map action=manuscript op=scope`.
2. **Review.** `op=review` (with `about=` the section in the arguments, if any), judge each sentence as its instructions say, record with `op=judge`. Repeat once if sentences remain and the user gave no section.
3. **Check what is cited.** If any cited sentences are unchecked, run `op=support` once: fetch the missing TLDRs in one `paper` call, judge, record with `op=judge`.
4. **Find papers.** Take the flagged places (`op=gaps`), `cite` before `maybe`, supervisor comments first (`op=comments`). For each of up to 5, run `search for=<place id>`; reword with `query=` only if the shortlist is off. Read nothing in full: TLDRs only.
5. **Report** in chat, briefly. Per place: the sentence clipped to a line, up to 3 papers (handle, authors, year, one line on why), and how many are already chosen. Say the user chooses on the Desk (Find papers, Use for this sentence) and that citations to copy appear there. Mention weak citations found in step 3 and any comments still open.

End with the `Next:` line: `/paperscout:review` on the section, or `/paperscout:draft` once the places are filled.
