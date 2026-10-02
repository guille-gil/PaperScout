import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseManuscript, applyState, reviewBatch, supportBatch, parseVerdicts, gapReport, summaryLine, sentences, cleanTex, parseBib, findManuscripts } from "../server/manuscript.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures", "paper");
const r = parseManuscript(join(FIX, "main.tex"));
const cand = (re) => r.candidates.find((c) => re.test(c.text));

test("finds the manuscript and its pieces", () => {
  assert.equal(r.title, "A Fixture for the Manuscript Parser");
  assert.deepEqual(r.bibFiles.map((f) => f.split("/").pop()), ["refs.bib"]);
  assert.equal(r.files.length, 2, "\\input is followed");
  assert.deepEqual(findManuscripts(FIX).map((f) => f.split("/").pop()), ["main.tex"]);
});

test("sections, with the section from an \\input file placed in order", () => {
  assert.deepEqual(r.sections.map((s) => s.title), ["Introduction", "Related Work", "Method"]);
  assert.equal(r.sections[1].file.endsWith("related.tex"), true);
  assert.equal(r.sections[1].line, 1);
});

test("citations, missing keys and unused entries", () => {
  assert.deepEqual(Object.keys(r.cites).sort(), ["Jones2019", "Missing2020", "Smith2020"]);
  assert.deepEqual(r.missing, ["Missing2020"]);
  assert.deepEqual(r.unused, ["Unused2018"]);
  assert.equal(r.bib.Smith2020.first, "Smith");
  assert.equal(r.bib.Smith2020.doi, "10.1000/example.1");
});

test("the parser does not decide what needs a source: every uncited sentence is a candidate for Claude", () => {
  assert.ok(cand(/Prior studies have shown/));
  assert.ok(cand(/We argue/), "even the authors' own argument is left for Claude to judge");
  assert.ok(cand(/Participants were recruited/));
  assert.ok(cand(/Another claim about the literature/), "from the \\input file");
});

test("cited sentences are not candidates, and et al. does not split a sentence", () => {
  assert.ok(!cand(/Smith et al\. report a smaller effect/) || cand(/Smith et al\. report a smaller effect/).notes.length > 0);
  assert.ok(!cand(/Recent reviews confirm that dashboards help/));
});

test("a cited sentence somebody left a note on is still a candidate, with the note", () => {
  const c = cand(/Smith et al\. report/);
  assert.ok(c, "kept because of the note");
  assert.deepEqual(c.cited, ["Smith2020"]);
  assert.match(c.notes[0].text, /right paper/);
});

test("candidates know whether their neighbours cite", () => {
  assert.deepEqual(cand(/We argue/).after, ["Smith2020"]);
  assert.deepEqual(cand(/Prior studies/).before, []);
});

test("front matter, abstract and float contents are left out", () => {
  assert.ok(!r.candidates.some((c) => /Reviews have shown many things/.test(c.text)), "table caption");
  assert.ok(!r.candidates.some((c) => c.section === "Front matter"));
});

test("a supervisor comment is attached to its sentence, also when it follows the full stop", () => {
  const c = cand(/long treated triage/);
  assert.ok(c.notes.some((n) => n.by === "SV" && /Who says this/.test(n.text)));
  const n = r.notes.find((x) => x.op === "comment");
  assert.equal(n.by, "SV");
  assert.equal(n.line, 13);
});

test("todonotes, tracked changes and TODO comments are notes", () => {
  assert.ok(cand(/Hospitals increasingly rely on dashboards\./).notes.some((x) => x.text === "cite"));
  assert.deepEqual(r.notes.filter((x) => x.kind === "change").map((x) => x.op).sort(), ["added", "comment", "deleted", "replaced"]);
  assert.ok(r.notes.some((x) => x.kind === "comment" && /sampling claim/.test(x.text)));
  assert.ok(!r.candidates.some((c) => /deleted words/.test(c.text)), "deleted text leaves the prose");
});

test("an empty citation is a gap by itself, not a judgement call", () => {
  const g = r.gaps.find((x) => x.kind === "empty-cite");
  assert.ok(g && /Many practitioners/.test(g.text));
  assert.ok(!r.candidates.some((c) => c.id === g.id), "and not also a candidate");
});

test("ids are stable across parses", () => {
  const again = parseManuscript(join(FIX, "main.tex"));
  assert.deepEqual(again.candidates.map((c) => c.id), r.candidates.map((c) => c.id));
  assert.equal(new Set(r.candidates.map((c) => c.id)).size, r.candidates.length);
});

test("a review batch is capped, filterable by section and carries the instructions", () => {
  const all = reviewBatch(r, {});
  assert.match(all, /cite\|maybe\|own/);
  assert.match(all, /Do not edit the draft/);
  const two = reviewBatch(r, { limit: 2 });
  assert.match(two, /2 of \d+ sentences to judge/);
  assert.match(two, /more; judge these/);
  const rel = reviewBatch(r, { section: "related" });
  assert.match(rel, /Another claim about the literature/);
  assert.doesNotMatch(rel, /Prior studies/);
  assert.match(reviewBatch(r, { limit: 99 }), /sentences to judge/, "the cap is enforced rather than trusted");
});

test("the batch is short: neighbours are flagged, not quoted", () => {
  const line = reviewBatch(r, { section: "introduction" }).split("\n").find((l) => /We argue/.test(l));
  assert.match(line, /after cites Smith2020/);
  assert.ok(line.length < 260);
});

test("verdicts are parsed from plain lines and unknown ids are refused", () => {
  const a = cand(/Prior studies/), b = cand(/We argue/);
  const { ok, bad } = parseVerdicts(r, `${a.id} cite no source for the 30% figure\n- ${b.id}: own the authors' argument\nGffffff cite made up id\nnonsense`);
  assert.equal(ok[a.id].need, "cite");
  assert.match(ok[a.id].why, /30%/);
  assert.equal(ok[b.id].need, "own");
  assert.equal(bad.length, 2);
});

test("judged sentences leave the next batch, and an edited sentence comes back by itself", () => {
  const a = cand(/Prior studies/);
  const verdicts = { [a.id]: { need: "cite", why: "x", date: "2026-10-02" } };
  assert.doesNotMatch(reviewBatch(r, { verdicts }), new RegExp(a.id));
  const edited = "G000000";
  assert.notEqual(edited, a.id);
  assert.ok(r.candidates.every((c) => c.id !== edited), "a new sentence has a new id, so it carries no verdict");
});

test("Claude's verdicts become the flagged places; own verdicts stay out of the list", () => {
  const a = cand(/Prior studies/), b = cand(/We argue/);
  const verdicts = { [a.id]: { need: "cite", why: "no source for the figure" }, [b.id]: { need: "own", why: "argument" } };
  const st = applyState(r, { verdicts, dismissed: [] });
  assert.ok(st.open.some((g) => g.id === a.id && g.kind === "reviewed" && g.by === "claude" && g.strength === "likely"));
  assert.ok(!st.open.some((g) => g.id === b.id));
  assert.deepEqual(st.own.map((o) => o.id), [b.id]);
  assert.ok(st.open.some((g) => g.kind === "empty-cite"), "explicit gaps are always there");
  assert.equal(st.pending, r.candidates.length - 2);
  assert.equal(st.sections.find((s) => s.title === "Introduction").gaps, 1);
});

test("dismissing hides a flag and takes it out of the pending count", () => {
  const a = cand(/Prior studies/);
  const verdicts = { [a.id]: { need: "maybe", why: "" } };
  const st = applyState(r, { verdicts, dismissed: [a.id] });
  assert.ok(!st.open.some((g) => g.id === a.id));
  assert.ok(st.gaps.some((g) => g.id === a.id && g.dismissed));
});

test("what Claude sees about the flagged places is capped and short", () => {
  const verdicts = Object.fromEntries(r.candidates.map((c) => [c.id, { need: "cite", why: "w" }]));
  const out = gapReport(r, { verdicts, limit: 2 });
  assert.ok(out.split("\n").length <= 6);
  assert.match(out, /more; narrow with about= or raise limit/);
  assert.match(out, /cited keys missing from the \.bib/);
  assert.match(summaryLine(r, {}), /uncited sentences not yet reviewed/);
});

test("sentence splitting keeps abbreviations and initials together", () => {
  const s = sentences("Turner et al. studied C. J. Turner's data, e.g. in 2019. Next one starts here.");
  assert.equal(s.length, 2);
});

test("cleanTex shows citations as keys and drops formatting", () => {
  assert.equal(cleanTex("A \\emph{bold} claim \\citep[p.~3]{A1,B2}."), "A bold claim [A1, B2].");
});

test("bibliography parser handles nested braces and quotes", () => {
  const b = parseBib('@article{k1, title = {A {Nested} Title}, year = "2020", author = {A, B and C, D}}');
  assert.equal(b.k1.title, "A Nested Title");
  assert.equal(b.k1.year, "2020");
});

test("only .tex files are read", () => {
  assert.throws(() => parseManuscript(join(FIX, "refs.bib")), /\.tex/);
});

test("a macro the author defined to colour text counts as a note, and leaves the prose", () => {
  assert.deepEqual(r.markers, ["sv"]);
  const n = r.notes.find((x) => x.op === "sv");
  assert.ok(n, "found");
  assert.equal(n.by, "SV"); assert.equal(n.text, "Check the sampling date.");
  assert.ok(!r.candidates.some((c) => /Check the sampling date/.test(c.text)), "not part of the paper's sentences");
  const extra = parseManuscript(join(FIX, "main.tex"), { markers: ["foo"] });
  assert.deepEqual(extra.markers.sort(), ["foo", "sv"], "extra commands can be added by name");
});

test("cited sentences get their own ids, which change when their citations change", () => {
  const c = r.cited.find((x) => /Smith et al\. report/.test(x.text));
  assert.ok(c && /^S[0-9a-f]{6}$/.test(c.id));
  assert.deepEqual(c.keys, ["Smith2020"]);
  assert.ok(r.cited.every((x) => x.keys.length));
});

test("a support batch gives Claude the sentence and what is known of each cited paper, and says what to fetch", () => {
  const info = { Smith2020: { title: "Triage at scale", year: "2020", h: "P7", tldr: "Shows triage automation at scale." }, Jones2019: { title: "Dashboards in practice", year: "2019", h: "", tldr: "" } };
  const out = supportBatch(r, { info });
  assert.match(out, /cited sentences to check/);
  assert.match(out, /Smith2020 \(2020\) Triage at scale \[P7\]: Shows triage automation at scale\./);
  assert.match(out, /Missing2020 \(not in the \.bib\)/);
  assert.match(out, /ok\|weak\|no\|unclear/);
  assert.match(supportBatch(r, { limit: 1, info }), /more; judge these/);
});

test("support verdicts are parsed by kind, and a flag only appears for weak, no or unclear", () => {
  const c = r.cited[0], d = r.cited[1];
  const bad = parseVerdicts(r, `${r.candidates[0].id} ok wrong kind of verdict\n${c.id} cite wrong kind too`);
  assert.deepEqual(Object.keys(bad.ok), []);
  const { ok } = parseVerdicts(r, `${c.id} weak about triage, not the 30% figure\n${d.id} ok`);
  assert.equal(ok[c.id].need, "weak");
  const st = applyState(r, { verdicts: ok });
  assert.ok(st.open.some((g) => g.id === c.id && g.kind === "support" && g.by === "claude" && /30%/.test(g.why)));
  assert.ok(!st.open.some((g) => g.id === d.id));
  assert.equal(st.pendingSupport, r.cited.length - 2);
  assert.match(summaryLine(r, {}), /cited ones not yet checked/);
});
