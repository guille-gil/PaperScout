import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseManuscript, gapReport, sentences, cleanTex, parseBib, findManuscripts } from "../server/manuscript.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures", "paper");
const r = parseManuscript(join(FIX, "main.tex"));

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

test("an uncited claim about prior work is a likely gap, with its line", () => {
  const g = r.gaps.find((x) => /Prior studies have shown/.test(x.text));
  assert.ok(g, "found");
  assert.equal(g.line, 11);
  assert.equal(g.strength, "likely");
  assert.equal(g.section, "Introduction");
});

test("sentences that cite, or talk about the paper itself, are not gaps", () => {
  assert.ok(!r.gaps.some((x) => /Smith et al/.test(x.text)), "et al. does not split and the sentence cites");
  assert.ok(!r.gaps.some((x) => /We argue/.test(x.text)));
  assert.ok(!r.gaps.some((x) => /own design/.test(x.text)));
});

test("claims are only checked in the sections that present prior work", () => {
  assert.ok(!r.gaps.some((x) => /Participants were recruited in 2021/.test(x.text)), "Method is the author's own account");
});

test("a supervisor comment asking for a source becomes a gap tied to its sentence", () => {
  const n = r.notes.find((x) => x.op === "comment");
  assert.equal(n.by, "SV");
  assert.equal(n.line, 13);
  const g = r.gaps.find((x) => x.kind === "marker" && x.line === 13);
  assert.ok(g && /long treated triage/.test(g.text));
});

test("todonotes and empty citations are gaps", () => {
  assert.ok(r.gaps.some((x) => x.kind === "marker" && /dashboards/.test(x.text)), "\\todo{cite}");
  assert.ok(r.gaps.some((x) => x.kind === "empty-cite" && /Many practitioners/.test(x.text)), "\\cite{}");
});

test("tracked changes keep added text and drop deleted text from the prose", () => {
  const ops = r.notes.filter((x) => x.kind === "change").map((x) => x.op).sort();
  assert.deepEqual(ops, ["added", "comment", "deleted", "replaced"]);
  assert.ok(!r.gaps.some((x) => /deleted words/.test(x.text)));
});

test("a TODO comment is a note", () => {
  assert.ok(r.notes.some((x) => x.kind === "comment" && /sampling claim/.test(x.text)));
});

test("table captions are left alone", () => {
  assert.ok(!r.gaps.some((x) => /Reviews have shown many things/.test(x.text)));
});

test("one gap per sentence, and a note from a supervisor wins over a guess", () => {
  const texts = r.gaps.map((g) => g.text);
  assert.equal(new Set(texts).size, texts.length);
  const g = r.gaps.find((x) => /long treated triage/.test(x.text));
  assert.equal(g.kind, "marker");
  assert.ok(r.gaps.some((x) => x.text === "Hospitals increasingly rely on dashboards."), "no stray space before the full stop");
});

test("gap ids are stable and dismissed ones are hidden", () => {
  const again = parseManuscript(join(FIX, "main.tex"));
  assert.deepEqual(again.gaps.map((g) => g.id), r.gaps.map((g) => g.id));
  const dismissed = [r.gaps[0].id];
  assert.ok(!gapReport(r, { dismissed }).includes(r.gaps[0].id));
});

test("what Claude sees is capped and short", () => {
  const out = gapReport(r, { limit: 2 });
  assert.ok(out.split("\n").length <= 5);
  assert.match(out, /more; narrow with section= or raise limit/);
  assert.match(out, /cited keys missing from the \.bib/);
});

test("a section filter matches the parent section as well as the subsection", () => {
  assert.match(gapReport(r, { section: "related" }), /Another claim about the literature/);
  assert.match(gapReport(r, { section: "introduction" }), /Prior studies/);
  assert.doesNotMatch(gapReport(r, { section: "introduction" }), /Another claim/);
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
