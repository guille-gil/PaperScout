import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { docxComments, pdfComments, parsePasted, anchorTo, readZip } from "../server/comments.mjs";
import { parseManuscript } from "../server/manuscript.mjs";

const FIX = fileURLToPath(new URL("./fixtures", import.meta.url));
const docx = readFileSync(join(FIX, "comments", "review.docx")), pdf = readFileSync(join(FIX, "comments", "review.pdf"));
const root = mkdtempSync(join(tmpdir(), "ps-"));
process.env.HOME = join(root, "home"); process.env.PAPER_SCOUT_NO_STDIO = "1";
const proj = join(root, "paper"); cpSync(join(FIX, "paper"), proj, { recursive: true }); cpSync(join(FIX, "comments"), proj, { recursive: true });
const { callTool } = await import("../server/index.mjs");
await callTool("session", { action: "start", name: "t", folder: proj });
const run = (a) => callTool("map", { action: "manuscript", ...a });
const data = async () => JSON.parse(await run({ op: "data" }));

test("Word comments come with their author, date and the passage they cover", () => {
  const c = docxComments(docx);
  assert.equal(c.length, 2);
  assert.equal(c[0].by, "Laura M."); assert.equal(c[0].date, "2026-09-14");
  assert.equal(c[0].text, "Who says this? Please add a source & check the figure.");
  assert.equal(c[0].quote, "automated triage reduces handling time by 30%");
  assert.equal(c[1].text, "Too strong. Soften, or argue it.", "paragraphs of one comment are joined");
});

test("PDF annotations come with the text under them; empty highlights are counted, not invented", async () => {
  const { comments, bare } = await pdfComments(pdf);
  assert.equal(comments.length, 2); assert.equal(bare, 1);
  assert.equal(comments[0].by, "SV");
  assert.match(comments[0].quote, /Prior studies have shown that automated triage/);
  assert.match(comments[1].quote, /long treated triage/, "a sticky note takes the line it sits beside");
});

test("things that are not Word files are refused, not guessed at", () => {
  assert.throws(() => readZip(Buffer.from("hello"), ["word/comments.xml"]), /Word \(\.docx\)/);
});

test("pasted comments: blocks, quotes and authors", () => {
  const c = parsePasted("by: SV\n> automated triage reduces handling time\nWho says this?\n\nLM: Too strong, soften it.\n\nJust a loose remark");
  assert.equal(c.length, 3);
  assert.deepEqual([c[0].by, c[0].quote, c[0].text], ["SV", "automated triage reduces handling time", "Who says this?"]);
  assert.deepEqual([c[1].by, c[1].text], ["LM", "Too strong, soften it."]);
  assert.equal(c[2].by, "");
});

test("a quote is anchored to the sentence it belongs to, also when it is a fragment or spans two", () => {
  const r = parseManuscript(join(proj, "main.tex"));
  assert.match(anchorTo("automated triage reduces handling time by 30%", r.all).text, /Prior studies/);
  assert.match(anchorTo("Prior studies have shown that automated triage reduces handling time by 30%. We argue that the effect", r.all).text, /Prior studies|We argue/);
  assert.equal(anchorTo("a passage that is nowhere in the draft at all", r.all), null);
  assert.equal(anchorTo("ok", r.all), null, "too short to anchor");
});

test("a round from a Word file is recorded, anchored, and shown with the passage's place", async () => {
  const out = await run({ op: "intake", path: "review.docx" });
  assert.match(out, /Round R1 \(Word, review\.docx\): 2 comments recorded, 2 anchored/);
  const d = await data();
  const c = d.rounds[0].comments[0];
  assert.equal(c.id, "SC1"); assert.match(c.anchor.text, /Prior studies/); assert.equal(c.state, "open"); assert.equal(c.now.line, 11);
});

test("importing the same comments again adds nothing; a PDF is another round", async () => {
  assert.match(await run({ op: "intake", path: "review.docx" }), /already recorded/);
  const out = await run({ op: "intake", path: "review.pdf" });
  assert.match(out, /Round R2 \(PDF, review\.pdf\): 2 comments recorded, 2 anchored.*1 highlights without a comment were skipped/);
  const out2 = await run({ op: "intake", text: "by: SV\n> The field has long treated triage\nIs this too strong?" });
  assert.match(out2, /Round R3 \(pasted\): 1 comments recorded, 1 anchored/);
});

test("Claude is shown a capped list of open comments with their place, and can search for it", async () => {
  const out = await run({ op: "comments", limit: 3 });
  assert.match(out, /open supervisor comments, first 3/);
  assert.equal(out.split("\n").length, 4);
  assert.match(out, /SC1 R1 Laura M\. l\.11 .* place G[0-9a-f]{6}: "Who says this\?/);
  const place = out.match(/place (G[0-9a-f]{6})/)[1];
  assert.ok((await data()).gaps.length >= 0 && place);
  assert.match(await callTool("map", { action: "show" }), /\d+ open supervisor comments/);
});

test("resolving a comment closes it and it leaves the open list", async () => {
  await run({ op: "resolve", id: "SC1" });
  assert.doesNotMatch(await run({ op: "comments", limit: 25 }), /SC1 /);
  await run({ op: "resolve", id: "SC1", status: "open" });
  assert.match(await run({ op: "comments", limit: 25 }), /SC1 /);
  await assert.rejects(() => run({ op: "resolve", id: "SC99" }), /no supervisor comment/);
});

test("when the draft changes, a comment says its passage was edited, or is gone", async () => {
  const f = join(proj, "main.tex");
  const src = readFileSync(f, "utf8");
  writeFileSync(f, src.replace("Prior studies have shown that automated triage reduces handling time by 30\\%.", "Earlier work has shown that automated triage reduces handling time by 30\\% in hospitals."));
  let c = (await data()).rounds[0].comments.find((x) => x.id === "SC1");
  assert.equal(c.state, "edited"); assert.ok(c.now, "and says where the edited sentence is now");
  writeFileSync(f, src.replace(/Prior studies have shown that automated triage reduces handling time by 30\\%\. /, ""));
  c = (await data()).rounds[0].comments.find((x) => x.id === "SC1");
  assert.equal(c.state, "gone");
  writeFileSync(f, src);
});

test("only .pdf and .docx files are read, and an empty intake explains itself", async () => {
  await assert.rejects(() => run({ op: "intake", path: "refs.bib" }), /not a \.pdf or \.docx/);
  await assert.rejects(() => run({ op: "intake", text: "   " }), /no comments found/);
});
