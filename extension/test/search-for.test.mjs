import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = mkdtempSync(join(tmpdir(), "ps-"));
process.env.HOME = join(root, "home");
process.env.PAPER_SCOUT_NO_STDIO = "1";
const proj = join(root, "paper");
cpSync(join(fileURLToPath(new URL("./fixtures/paper", import.meta.url))), proj, { recursive: true });
const { installMockFetch, calls } = await import("./mockfetch.mjs");
installMockFetch();
const { callTool } = await import("../server/index.mjs");
await callTool("session", { action: "start", name: "t", folder: proj });
const run = (a) => callTool("map", { action: "manuscript", ...a });
const SENT = "Knowledge graphs support fault diagnosis and maintenance decision support in industrial settings.";

test("a free sentence is searched, ranked against the sentence and the off-topic hidden", async () => {
  const j = JSON.parse(await callTool("search", { for: SENT, json: true }));
  assert.ok(j.items.length >= 2 && j.items.length <= 5);
  assert.ok(/knowledge graph|operational data/i.test(j.items[0].title), "a relevant paper comes first: " + j.items[0].title);
  assert.ok(!j.items.some((x) => /cats/i.test(x.title)), "the unrelated paper is hidden");
  assert.ok(j.hidden >= 1);
  assert.ok(j.items.every((x, i, a) => i === 0 || a[i - 1].score >= x.score), "sorted by fit");
  assert.ok(j.items[0].why.length > 0, "says which terms matched");
  assert.ok(j.items[0].h.startsWith("P"));
});

test("a flagged place can be searched by its id, and the shortlist is text for Claude", async () => {
  const r = JSON.parse(await run({ op: "data" }));
  const g = r.gaps.find((x) => x.kind === "empty-cite") || { id: null };
  const cand = (await run({ op: "review", limit: 1 })).match(/\nG[0-9a-f]{6}/)[0].trim();
  const out = await callTool("search", { for: cand, query: "knowledge graph maintenance decision support" });
  assert.match(out, /fit 0\.\d\d/);
  assert.match(out, /Shortlist only/);
  assert.ok(out.split("\n").length <= 8);
  await assert.rejects(() => callTool("search", { for: "Gabcdef" }), /not a place in the linked draft/);
});

test("papers the draft already cites are marked", async () => {
  const j = JSON.parse(await callTool("search", { for: "Automated triage knowledge graphs for maintenance decisions in hospitals", json: true }));
  const t = j.items.find((x) => /Triage at scale/.test(x.title));
  assert.ok(t, "found");
  assert.equal(t.inBib, "Smith2020");
});

test("the user's out-of-scope list hides papers and says how many", async () => {
  await run({ op: "scope", text: "maintenance knowledge", note: "garden\nlawn" });
  const j = JSON.parse(await callTool("search", { for: "Maintenance of knowledge in industrial parks", json: true, limit: 10 }));
  assert.ok(!j.items.some((x) => /Garden/.test(x.title)));
  assert.ok(j.hiddenOut >= 1);
  assert.match(await run({ op: "scope" }), /Out of scope, do not chase: garden, lawn/);
});

test("choosing a paper for a place is remembered", async () => {
  const j = JSON.parse(await callTool("search", { for: SENT, json: true }));
  const h = j.items[0].h;
  await run({ op: "attach", id: "G123abc", handle: h });
  const d = JSON.parse(await run({ op: "data" }));
  assert.equal(d.attach.G123abc[0].h, h);
  await run({ op: "detach", id: "G123abc", handle: h });
  assert.equal(JSON.parse(await run({ op: "data" })).attach.G123abc, undefined);
});

test("adding to the .bib only appends, keeps the keys unique, and is idempotent", async () => {
  const j = JSON.parse(await callTool("search", { for: SENT, json: true }));
  const h = j.items.find((x) => !x.inBib).h;
  const before = readFileSync(join(proj, "refs.bib"), "utf8");
  const out = await run({ op: "bib_add", handle: h });
  assert.match(out, /Added \S+ to refs\.bib: \\citep\{\S+\}/);
  const after = readFileSync(join(proj, "refs.bib"), "utf8");
  assert.ok(after.startsWith(before), "nothing before the new entry changed");
  assert.match(after.slice(before.length), /% Added by Paper Scout/);
  assert.match(await run({ op: "bib_add", handle: h }), /Already in the \.bib/);
  assert.equal(readFileSync(join(proj, "refs.bib"), "utf8"), after);
});

test("the search for a place makes a handful of calls, not a crawl", () => {
  assert.ok(calls.filter((u) => u.includes("api.semanticscholar.org")).length < 60);
});
