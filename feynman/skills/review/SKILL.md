---
name: review
description: Feynman internal research critique of a paper, draft or artifact with severity-graded objections, inline annotations and a revision plan. Use only when the user types /feynman:review or asks for a Feynman review.
disable-model-invocation: true
argument-hint: <local file, arXiv id, DOI or URL>
---

> Feynman mode: if `../start/references/core.md` has not been read in this task, read it now (and `../start/references/paper-routing.md` before the first paper search) and treat Feynman mode as on for the rest of the task.

# Review

Do not ask for confirmation; summarise the plan in one or two lines and continue. Derive a slug from the artifact name.

1. Write `outputs/.plans/<slug>-review-plan.md`: artifact identifier and type; criteria (novelty, empirical rigour, baselines, reproducibility, validity of claims, figures and tables, metrics, related work positioning, writing); the checks needed for claims, figures, metrics, data and code availability.
2. Inspect the artifact. Local files and papers: Paper Scout `read` (section map first, then sections; local PDF paths work). Inspect linked code, data or cited papers only when they materially affect the review (`code` to find repositories). If parsing fails, record it and continue with a partial review.
3. Write evidence notes to `outputs/.drafts/<slug>-review-evidence.md` before the review: quoted claims with locations, methods, reported metrics, baselines, reproducibility facts, every source inspected.
4. For large artifacts, run the `reviewer` subagent on the evidence notes and artifact, and a `researcher` to check related-work positioning (Paper Scout `search` and `graph` for missing prior work). Otherwise review directly.
5. Write `outputs/<slug>-review.md` with: Summary Assessment, Strengths, Critical Issues, Major Issues, Minor Issues, Reproducibility and Verification, Inline Annotations (quote the exact passage, tag it with the weakness id), Recommendation (revision priority and confidence, never a venue acceptance prediction), Sources.
6. If critical evidence was unavailable, mark affected sections `Verification: BLOCKED` and separate blocked checks from real weaknesses.
7. Tone: tough but constructive, the way a supportive senior reviewer writes. Refer to the work ("the paper", "the draft"), not the author. Every weakness points to a passage.
8. Confirm the file exists, then reply briefly with the path, the top three issues and the `Next in Feynman:` line.
