# Paper routing and token budget

## Which source

| Need | First | Then |
|---|---|---|
| Anything already seen in this project | `session` `action=list` with `query` | `session` `action=queries` |
| A topic, first pass | `search` (auto: Zotero + Semantic Scholar, merged) | `sort=citations` for seminal work |
| Browsing the user's own collections, tags or PDF text | `search source=zotero` with `collection`, `tag` or `fulltext=true` (`collections=true` lists the tree) | `read` with the handle |
| Newest preprints | `search` with `source=arxiv`, `sort=recent` | |
| Operations management, industrial engineering, maintenance journals (IJPR, IJPE, JOM, EJOR, CIE, RESS) when auto is thin | `search` with `source=openalex` | `paper` for TLDRs |
| CS venues (ACL, EMNLP, NeurIPS, ICML, AAAI) | `search` with `source=s2` and `venue` | `paper` for TLDRs |
| Seminal work | `search` with `sort=citations` | `graph mode=references` on 2 or 3 recent surveys |
| What happened after a paper | `graph mode=citations sort=recent` | `graph mode=recommend` with that paper as seed |
| A lab or author corpus | `graph mode=author query=<name>`, then with the numeric id | `sort=recent` to see the current trajectory |
| A known paper id | `paper` with `detail=meta` | `read` if full text is needed |
| Grey literature, standards, products, docs | web search | web fetch on the best 2 or 3 results |

Run 2 to 4 reworded queries per question (method name, problem name, synonyms) and merge. Do not trust one query's ranking.

## Budget ladder (cheapest first)

| Step | Cost per paper | Use for |
|---|---|---|
| `session` recall or repeated search | 5 to 10 tokens per paper | anything seen before in the project |
| `(seen)` stub | about 12 tokens | a paper resurfacing in a new search |
| `search` line | about 35 tokens | screening by title, venue, year, citations |
| `paper` detail `tldr` | about 60 tokens | deciding relevance; batch up to 50 ids per call |
| `paper` detail `abstract` | about 250 tokens | borderline relevance, method type |
| `graph` with `contexts=true` | about 90 tokens per hit | how others characterise a paper |
| `read` with `query` | about 250 tokens per passage | checking one claim, number or definition; tables come back as rows (`a | b | c`) with their caption, so query result tables with the metric name |
| `read` with only the id (section map) | about 150 tokens | deciding which sections to read |
| `read` one section | 500 to 3,000 tokens | methods, results, limitations the conclusions depend on |
| `read` with `figure` | 500 to 1,500 tokens | evidence that only exists in a figure |
| whole paper | 8,000 to 20,000 tokens | almost never; use `summarize` workflow windows instead |

Rules:
- Keep `abstract_chars` at 0 in `search` unless there are 10 hits or fewer and titles are ambiguous.
- Batch ids into one `paper` call rather than calling per paper.
- Before reading sections, always get the section map. Read the section, not the paper.
- For citation verification, `paper` with `detail=meta` confirms title, year and venue against the id; `read` with `query` confirms that the cited number or claim appears in the text.
- Record every query and the ids kept in the research notes file so later steps do not repeat searches. Paper Scout caches results on disk, so repeating an identical call is free, but it still costs context.

## Identifiers Paper Scout accepts

Session handle (`P12`, preferred), Zotero key (`zot:ABCD1234`), arXiv id (`2005.11401`), DOI (`10.1080/...`), `CorpusId:N`, Semantic Scholar id, OpenAlex id (`W123...`), a URL, a local PDF path, or an exact title.

## When full text is not open

Paper Scout tries arXiv HTML, ar5iv, arXiv PDF, the Semantic Scholar open-access PDF, the OpenAlex open-access location, Unpaywall repository copies and the publisher page. If none works, it returns a library link; check the user's Zotero with `search source=zotero`, ask the user for the PDF, or rely on the abstract and mark the claim as abstract-level evidence.
