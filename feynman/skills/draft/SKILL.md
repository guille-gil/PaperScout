---
name: draft
description: Feynman paper-style draft built from collected research notes with explicit, source-traceable claims. Use only when the user types /feynman:draft or asks for a Feynman draft.
disable-model-invocation: true
argument-hint: <topic or notes path>
---

> Feynman mode: if `../start/references/core.md` has not been read in this task, read it now (and `../start/references/paper-routing.md` before the first paper search) and treat Feynman mode as on for the rest of the task.

# Draft

1. Write `outputs/.plans/<slug>.md`: proposed title, sections, key claims, source material (existing `outputs/` and `notes/` files first), and a verification log for critical claims, figures and calculations. Summarise in two lines and continue unless the user asked to review the outline.
2. Run `map action=show`. If the project has a current idea version, the draft argues it: its claims give the section logic and their linked evidence gives the support. Address the map's warnings or state them as limitations.
3. When notes already exist, have the `writer` subagent produce the draft from them; otherwise gather evidence first (see `../lit/SKILL.md` steps 1 to 2) and then write.
4. Minimum structure: title, abstract, problem statement, related work (connected narrative by idea), method or synthesis, evidence or experiments, limitations, conclusion.
5. Follow the provenance rules: missing results become placeholders or a proposed experiment, never plausible numbers. Tables and figures carry provenance; plotting scripts sit next to the draft.
6. Sweep for any claim stronger than its support before citation. Then run the `verifier` subagent for inline citations and source checks.
7. Export the cited papers with `session action=bibtex path=<workspace>/papers/<slug>.bib` and cite with the returned keys. Save exactly one draft to `papers/<slug>.md` with a Sources appendix. Reply briefly with the path and the `Next in Feynman:` line (usually `/feynman:review papers/<slug>.md`).
