// Manuscript: reads the user's LaTeX draft (and its .bib) on this Mac, entirely locally, and reports where it
// stands: outline, citations per section, cited keys missing from the .bib, supervisor notes (todonotes, the
// changes package, TODO comments) and the places that look like they still need a source. Nothing here calls
// Claude or the network, and nothing here ever writes to the user's files.
//
// Offsets are kept exact: commands that are not prose (\todo, \chcomment, ...) are blanked out with spaces of
// the same length, so every sentence can be traced to its line.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, basename, extname } from "node:path";
import { createHash } from "node:crypto";

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const clip = (s, n) => { s = oneLine(s); return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, "") + "\u2026"; };
const sha = (s) => createHash("sha1").update(s).digest("hex");

// Sections whose uncited statements are worth a second look: the ones that present other people's work. Findings,
// discussion and conclusions are the author's own argument, so their uncited sentences are not reported as gaps.
export const CHECKED = /^(?:\d+\s+)?(?:introduction|background|related|literature|state of the art|prior|review|theor|conceptual|previous)/i;
const SKIP_ENV = new Set(["table", "table*", "figure", "figure*", "tabular", "tabular*", "tabularx", "equation", "equation*", "align", "align*", "eqnarray", "comment", "verbatim", "lstlisting", "tikzpicture", "thebibliography", "ack", "keyword", "abstract", "algorithm", "algorithmic", "minipage"]);
const HEADING = /\\(part|chapter|section|subsection|subsubsection|paragraph)(\*?)(?:\[[^\]]*\])?\{((?:[^{}]|\{[^{}]*\})*)\}/;
const CITE = /\\(?!nocite)([A-Za-z]*[Cc]ite[A-Za-z]*)\*?\s*(?:\[[^\]]*\]\s*){0,2}\{([^{}]*)\}/g;
const NEEDS_CITE = /\b(?:cite|citation|sources?|who says|evidence|backing|add (?:a )?ref(?:erence)?|reference (?:needed|missing))\b|\?\?/i;
const NOTE_COMMENT = /^\s*(?:TODO|FIXME|XXX|CHECK|CONFIRM|REVISE|REVIEW|CITE|NOTE|NB|QUESTION|COMMENT|AUTHOR|SV|SUPERVISOR|Q)\b|^\s*[A-Z]{2,4}\s*:/i;

// ---------- small LaTeX helpers ----------
function stripComment(line) {
  const m = line.match(/(^|[^\\])%/);
  if (!m) return { code: line, comment: "" };
  const at = m.index + m[1].length;
  return { code: line.slice(0, at), comment: line.slice(at + 1) };
}

// Reads `[opt]{a}{b}...` starting at position i (after a command name). Handles nested braces.
function grabArgs(s, i, n) {
  const out = { opt: "", args: [], end: i };
  let p = i;
  while (s[p] === " ") p++;
  if (s[p] === "[") { const q = s.indexOf("]", p); if (q > 0) { out.opt = s.slice(p + 1, q); p = q + 1; } }
  for (let k = 0; k < n; k++) {
    while (s[p] === " " || s[p] === "\n") p++;
    if (s[p] !== "{") break;
    let depth = 0, q = p;
    for (; q < s.length; q++) { if (s[q] === "{" && s[q - 1] !== "\\") depth++; else if (s[q] === "}" && s[q - 1] !== "\\") { depth--; if (!depth) break; } }
    if (depth) break;
    out.args.push(s.slice(p + 1, q)); p = q + 1;
  }
  out.end = p;
  return out;
}
const blank = (s, a, b) => s.slice(0, a) + s.slice(a, b).replace(/[^\n]/g, " ") + s.slice(b);

// Display text: citations become [key, key], formatting commands lose their wrapper.
export function cleanTex(s) {
  s = String(s || "").replace(CITE, (_, __, keys) => `[${keys.split(",").map((k) => k.trim()).filter(Boolean).join(", ")}]`);
  for (let i = 0; i < 4; i++) s = s.replace(/\\(?:emph|textbf|textit|textsc|textrm|texttt|textsf|underline|mbox|text|hl|url|href)\*?(?:\[[^\]]*\])?\{([^{}]*)\}/g, "$1");
  s = s.replace(/\\(?:footnote|label|index)\{[^{}]*\}/g, "").replace(/\\(?:ref|eqref|autoref|cref|Cref|pageref)\{[^{}]*\}/g, "\u00a7");
  s = s.replace(/\\&/g, "&").replace(/\\%/g, "%").replace(/\\_/g, "_").replace(/\\\$/g, "$");
  s = s.replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, "").replace(/[{}]/g, "").replace(/~/g, " ").replace(/``|''/g, '"').replace(/---/g, "\u2014").replace(/--/g, "\u2013");
  return oneLine(s).replace(/\s+([.,;:!?])/g, "$1");
}

const ABBR = ["et al.", "e.g.", "i.e.", "cf.", "vs.", "etc.", "Fig.", "Figs.", "Eq.", "Eqs.", "Sec.", "Tab.", "No.", "Dr.", "Prof.", "approx.", "resp.", "pp.", "p."];
const ABBR_RE = new RegExp(`(?<![A-Za-z])(?:${ABBR.map((a) => a.replace(/\./g, "\\.").replace(/ /g, "\\s")).join("|")})`, "g");
// Splits prose into sentences without changing its length (so offsets stay valid).
export function sentences(text) {
  const protectedText = text.replace(ABBR_RE, (m) => m.replace(/\./g, "\u0001")).replace(/\b([A-Z])\.(?=\s?[A-Z])/g, "$1\u0001");
  const out = [];
  let start = 0;
  const re = /(?<=[.!?]["\u201d\u2019')\]]?)\s+(?=[A-Z\\(\u201c"\[*])/g;
  let m;
  while ((m = re.exec(protectedText))) { out.push([start, m.index]); start = m.index + m[0].length; }
  out.push([start, protectedText.length]);
  return out.filter(([a, b]) => text.slice(a, b).trim()).map(([a, b]) => ({ a, b, text: text.slice(a, b) }));
}

const hasCite = (s) => { CITE.lastIndex = 0; const r = CITE.test(s); CITE.lastIndex = 0; return r; };

// ---------- claim cues ----------
const STRONG = [
  /\b(?:has|have|had)\s+(?:\w+ly\s+|long\s+)?(?:been|sought|shown|used|treated|developed|established|proposed|described|reported|demonstrated|found|focused|emphasi[sz]ed|argued|applied)\b/i,
  /\b(?:reviews?|studies|research|literature|surveys?|authors|scholars|researchers|practitioners|work)\s+(?:\w+\s+){0,2}?(?:shows?|showed|suggests?|suggested|finds?|found|reports?|reported|indicates?|confirms?|describes?|argues?|demonstrates?|identif(?:y|ies)|highlights?|notes?|agree)\b/i,
  /\b(?:well[- ]known|well[- ]established|widely\s+(?:used|accepted|recogni[sz]ed|adopted|studied)|commonly\s+(?:used|applied|accepted)|state[- ]of[- ]the[- ]art|it is (?:known|accepted|recogni[sz]ed|argued|believed)|according to)\b/i,
  /\b\d+(?:\.\d+)?\s?%/, /\b(?:in|since|by)\s+(?:19|20)\d{2}\b/,
];
const WEAK = /\b(?:typically|generally|often|commonly|increasingly|recent(?:ly)?|existing|traditionally|most|many|several|numerous)\b/i;
const OWN = /\b(?:we|our|ours|this (?:paper|study|article|analysis|work|section|case|specification)|the (?:present|current) (?:paper|study|analysis|work|reading)|the paper|the analysis|the contribution|here)\b/i;

// ---------- bibliography ----------
export function parseBib(src) {
  const out = {};
  const re = /@(\w+)\s*[{(]/g;
  let m;
  while ((m = re.exec(src))) {
    const type = m[1].toLowerCase();
    if (["comment", "string", "preamble"].includes(type)) continue;
    let depth = 1, p = m.index + m[0].length;
    const bodyStart = p;
    for (; p < src.length && depth; p++) { if (src[p] === "{") depth++; else if (src[p] === "}") depth--; }
    const body = src.slice(bodyStart, p - 1);
    const comma = body.indexOf(",");
    if (comma < 0) continue;
    const key = body.slice(0, comma).trim();
    const fields = { type };
    const fre = /(\w+)\s*=\s*/g;
    fre.lastIndex = comma;
    let f;
    while ((f = fre.exec(body))) {
      let q = f.index + f[0].length, val = "";
      if (body[q] === "{") { let d = 0, e = q; for (; e < body.length; e++) { if (body[e] === "{") d++; else if (body[e] === "}") { d--; if (!d) break; } } val = body.slice(q + 1, e); fre.lastIndex = e + 1; }
      else if (body[q] === '"') { const e = body.indexOf('"', q + 1); val = body.slice(q + 1, e); fre.lastIndex = e + 1; }
      else { const e = body.slice(q).search(/[,\n]/); val = e < 0 ? body.slice(q) : body.slice(q, q + e); fre.lastIndex = q + (e < 0 ? val.length : e); }
      fields[f[1].toLowerCase()] = oneLine(val.replace(/[{}]/g, "").replace(/\\&/g, "&"));
    }
    out[key] = fields;
  }
  return out;
}
export function bibSummary(e) {
  const authors = (e.author || "").split(/\s+and\s+/).filter(Boolean);
  const first = (authors[0] || "").split(",")[0].trim();
  const arxiv = (/arxiv[:\s]*([0-9]{4}\.[0-9]{4,5})/i.exec(`${e.note || ""} ${e.eprint || ""} ${e.journal || ""}`) || [])[1] || (e.archiveprefix && /arxiv/i.test(e.archiveprefix) ? e.eprint : "") || "";
  return { title: e.title || "", year: e.year || "", first, authors: authors.length, doi: (e.doi || "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//, ""), arxiv, venue: e.journal || e.booktitle || e.institution || "" };
}

// ---------- files ----------
function readText(file) { try { return readFileSync(file, "utf8"); } catch { return null; } }
function texPath(base, name) {
  const n = name.trim();
  const withExt = extname(n) ? n : n + ".tex";
  if (extname(withExt).toLowerCase() !== ".tex") return "";
  return resolve(dirname(base), withExt);
}

// Lines of the main file with \input / \include files spliced in, each tagged with its file and line number.
function expand(file, seen = new Set(), depth = 0) {
  const real = resolve(file);
  if (seen.has(real) || depth > 6) return [];
  seen.add(real);
  const src = readText(real);
  if (src === null) return [];
  const out = [];
  src.split(/\r?\n/).forEach((t, i) => {
    const { code } = stripComment(t);
    const m = code.match(/\\(?:input|include|subfile)\s*\{([^{}]+)\}/);
    if (m) {
      const p = texPath(real, m[1]);
      if (p && existsSync(p)) { out.push(...expand(p, seen, depth + 1)); return; }
    }
    out.push({ f: real, n: i + 1, t });
  });
  return out;
}

// Looks for a main .tex file in a project folder: top level and one folder down, skipping Paper Scout's own folders.
export function findManuscripts(folder) {
  const found = [];
  const skip = new Set(["node_modules", "notes", "outputs", "papers", "experiments", ".git"]);
  const scan = (dir, depth) => {
    let names = []; try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (n.startsWith(".")) continue;
      const p = join(dir, n);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (depth < 1 && !skip.has(n)) scan(p, depth + 1); continue; }
      if (extname(n).toLowerCase() !== ".tex" || st.size > 3e6) continue;
      const head = readText(p) || "";
      if (/^[^%\n]*\\documentclass/m.test(head)) found.push({ path: p, mtime: st.mtimeMs });
    }
  };
  scan(folder, 0);
  found.sort((a, b) => (basename(a.path).toLowerCase() === "main.tex" ? -1 : 0) - (basename(b.path).toLowerCase() === "main.tex" ? -1 : 0) || b.mtime - a.mtime);
  return found.map((f) => f.path);
}

// ---------- the parse ----------
const CACHE = new Map();
function signature(files) { return files.map((f) => { try { return `${f}:${statSync(f).mtimeMs}`; } catch { return `${f}:0`; } }).join("|"); }

export function parseManuscript(mainPath) {
  const main = resolve(mainPath);
  if (extname(main).toLowerCase() !== ".tex") throw new Error("the manuscript must be a .tex file");
  if (!existsSync(main)) throw new Error(`${main} does not exist on this Mac`);
  const vlines = expand(main);
  const texFiles = [...new Set(vlines.map((v) => v.f))];

  // Bibliography files named in the source.
  const bibNames = [];
  for (const v of vlines) {
    const { code } = stripComment(v.t);
    for (const m of code.matchAll(/\\bibliography\s*\{([^{}]+)\}/g)) bibNames.push(...m[1].split(",").map((x) => x.trim()));
    for (const m of code.matchAll(/\\addbibresource(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g)) bibNames.push(m[1].trim());
  }
  const bibFiles = [...new Set(bibNames.map((n) => resolve(dirname(main), /\.bib$/i.test(n) ? n : n + ".bib")))].filter((f) => extname(f).toLowerCase() === ".bib");
  const sig = signature([...texFiles, ...bibFiles]);
  const hit = CACHE.get(main);
  if (hit && hit.sig === sig) return hit.result;

  const bib = {};
  for (const f of bibFiles) { const s = readText(f); if (s) Object.assign(bib, parseBib(s)); }

  const sections = [];
  const gaps = [], notes = [];
  const cites = {};
  let body = false, skip = 0, abstract = false, title = "", top = "";
  let cur = { id: "S0", level: 0, title: "Front matter", line: 1, file: main, words: 0, cites: 0, keys: new Set(), gaps: 0, notes: 0, checked: false };
  sections.push(cur);
  let par = []; // [{ f, n, t, off }]
  let parText = "";
  const nocite = new Set();

  const addGap = (g) => {
    // One gap per sentence. A note from a supervisor or the author says more than a guess from the wording, so it wins.
    g.id = "G" + sha(oneLine(g.text).toLowerCase()).slice(0, 6);
    const prev = gaps.find((x) => x.id === g.id);
    if (prev) { if (g.kind === "marker" && prev.kind !== "marker") Object.assign(prev, { kind: g.kind, strength: g.strength, why: g.why, line: g.line, file: g.file }); return; }
    g.section = cur.title; g.sectionId = cur.id; g.top = top || cur.title;
    gaps.push(g); cur.gaps++;
  };
  const addNote = (n) => { n.section = cur.title; n.sectionId = cur.id; n.id = "M" + sha(`${n.kind}|${n.line}|${n.text}`).slice(0, 6); notes.push(n); cur.notes++; if (NEEDS_CITE.test(`${n.text} ${n.comment || ""}`)) addGap({ kind: "marker", strength: "likely", line: n.line, file: n.file, text: n.context || n.text, why: `Note ${n.by ? `from ${n.by} ` : ""}asks for a source: "${clip(n.text || n.comment, 80)}"` }); };

  const flush = () => {
    if (!par.length) return;
    let text = parText;
    const markers = [];
    const lineAt = (pos) => { let hit = par[0]; for (const p of par) if (p.off <= pos) hit = p; return hit; };
    // Supervisor and author markers inside the paragraph: recorded, then blanked out of the prose.
    const cmd = /\\(?:ch)?(added|deleted|replaced|comment|highlight)\b|\\(todo|TODO)\b/g;
    let m;
    while ((m = cmd.exec(text))) {
      const name = (m[1] || m[2]).toLowerCase();
      if (m[1] === "comment" && text[m.index + m[0].length] !== "{" && text[m.index + m[0].length] !== "[") continue;
      const nargs = name === "replaced" ? 2 : 1;
      const g = grabArgs(text, m.index + m[0].length, nargs);
      if (!g.args.length) continue;
      const opt = Object.fromEntries([...g.opt.matchAll(/(\w+)\s*=\s*([^,\]]+)/g)].map((x) => [x[1].toLowerCase(), oneLine(x[2])]));
      const where = lineAt(m.index);
      const body = oneLine(cleanTex(g.args[0]));
      markers.push({ pos: m.index, kind: name === "todo" ? "todo" : "change", op: name, by: opt.id || "", comment: opt.comment || "", text: body, line: where.n, file: where.f });
      // added/highlighted/replaced text stays prose; deleted text and comments leave it.
      if (["added", "highlight"].includes(name)) { text = blank(text, m.index, m.index + m[0].length); const open = text.indexOf("{", m.index); text = blank(text, m.index, open + 1); const close = g.end - 1; text = blank(text, close, close + 1); }
      else if (name === "replaced") { const open = text.indexOf("{", m.index); const close1 = open + g.args[0].length + 1; text = blank(text, m.index, open + 1); text = blank(text, close1, g.end); }
      else text = blank(text, m.index, g.end);
      cmd.lastIndex = m.index + 1;
    }
    const sents = sentences(text);
    // A marker belongs to the sentence it sits in; one placed after a full stop refers to the sentence before it.
    for (const mk of markers) {
      const own = sents.find((s) => mk.pos >= s.a && mk.pos < s.b) || [...sents].reverse().find((s) => s.b <= mk.pos) || sents.find((s) => s.a >= mk.pos);
      if (own) mk.context = cleanTex(own.text);
    }
    sents.forEach((s, i) => {
      const raw = s.text;
      const clean = cleanTex(raw);
      const words = clean.split(/\s+/).filter(Boolean).length;
      cur.words += words;
      const where = lineAt(s.a);
      const keysIn = [...raw.matchAll(CITE)].flatMap((c) => c[2].split(",").map((k) => k.trim()));
      const empty = /\\[A-Za-z]*[Cc]ite[A-Za-z]*\*?\s*(?:\[[^\]]*\]\s*)*\{\s*(?:\?+|todo|tbd|xxx)?\s*\}|\[\s*(?:citation needed|cite|ref|\?+)\s*\]|\(\s*citation needed\s*\)|(?<![A-Za-z])\?\?(?![A-Za-z])/i.test(raw);
      if (empty) { addGap({ kind: "empty-cite", strength: "likely", line: where.n, file: where.f, text: clean, why: "A citation placeholder is still empty." }); return; }
      if (words < 6 || keysIn.length || !cur.checked || abstract || OWN.test(clean)) return;
      const strong = STRONG.some((r) => r.test(clean));
      const weak = WEAK.test(clean);
      if (!strong && !weak) return;
      const near = [sents[i - 1], sents[i + 1]].filter(Boolean).some((n) => hasCite(n.text));
      addGap({ kind: "uncited", strength: strong && !near ? "likely" : "check", line: where.n, file: where.f, text: clean,
        why: near ? "Reads like a statement about prior work; a neighbouring sentence cites." : strong ? "Reads like a statement about prior work and has no citation." : "A general statement about the field with no citation." });
    });
    for (const mk of markers) addNote({ kind: mk.kind, op: mk.op, by: mk.by, comment: mk.comment, text: mk.text, line: mk.line, file: mk.file, context: mk.context || "" });
    par = []; parText = "";
  };

  for (const v of vlines) {
    const { code, comment } = stripComment(v.t);
    if (comment && NOTE_COMMENT.test(comment) && (body || /confirm|author|check|todo|fixme/i.test(comment))) {
      addNote({ kind: "comment", text: oneLine(comment), line: v.n, file: v.f, by: (comment.match(/^\s*([A-Z]{2,4})\s*:/) || [])[1] || "" });
    }
    if (!title) { const t = code.match(/\\title\s*(?:\[[^\]]*\])?\{((?:[^{}]|\{[^{}]*\})*)\}/); if (t) title = cleanTex(t[1]); }
    if (!body) {
      if (/\\begin\{document\}/.test(code)) body = true;
      continue;
    }
    if (/\\end\{document\}/.test(code)) break;
    for (const m of code.matchAll(/\\nocite\s*\{([^{}]*)\}/g)) m[1].split(",").forEach((k) => nocite.add(k.trim()));
    for (const m of code.matchAll(CITE)) for (const k of m[2].split(",").map((x) => x.trim()).filter(Boolean)) { (cites[k] ||= { count: 0, sections: [], lines: [] }); cites[k].count++; cites[k].lines.push(v.n); if (!cites[k].sections.includes(cur.title)) cites[k].sections.push(cur.title); cur.cites++; cur.keys.add(k); }
    CITE.lastIndex = 0;
    if (/\\bibliography\s*\{|\\printbibliography|\\begin\{thebibliography\}/.test(code)) { flush(); break; }
    const begins = [...code.matchAll(/\\begin\{([^}]+)\}/g)].map((m) => m[1]);
    const ends = [...code.matchAll(/\\end\{([^}]+)\}/g)].map((m) => m[1]);
    if (begins.includes("abstract")) { flush(); abstract = true; cur = { id: `S${sections.length}`, level: 1, title: "Abstract", line: v.n, file: v.f, words: 0, cites: 0, keys: new Set(), gaps: 0, notes: 0, checked: false }; sections.push(cur); }
    for (const b of begins) if (SKIP_ENV.has(b) && b !== "abstract") skip++;
    for (const e of ends) { if (SKIP_ENV.has(e) && e !== "abstract" && skip > 0) skip--; if (e === "abstract") { flush(); abstract = false; } }
    if (skip > 0 || begins.some((b) => SKIP_ENV.has(b) && b !== "abstract") || ends.some((e) => SKIP_ENV.has(e) && e !== "abstract")) { if (!code.trim()) flush(); continue; }
    const h = code.match(HEADING);
    if (h) {
      flush();
      const level = { part: 0, chapter: 0, section: 1, subsection: 2, subsubsection: 3, paragraph: 4 }[h[1]];
      const ttl = cleanTex(h[3]);
      if (level <= 1) top = ttl;
      cur = { id: `S${sections.length}`, level, title: ttl, line: v.n, file: v.f, words: 0, cites: 0, keys: new Set(), gaps: 0, notes: 0, checked: CHECKED.test(top || ttl) };
      sections.push(cur);
      const rest = code.slice(code.indexOf(h[0]) + h[0].length);
      if (rest.trim()) { par.push({ f: v.f, n: v.n, off: parText.length }); parText += rest + "\n"; }
      continue;
    }
    if (!code.trim()) { flush(); continue; }
    if (/^\s*\\(?:begin|end)\{(?:document|frontmatter|center|abstract)\}/.test(code) && !code.replace(/\\(?:begin|end)\{[^}]*\}/g, "").trim()) continue;
    par.push({ f: v.f, n: v.n, off: parText.length });
    parText += code + "\n";
  }
  flush();

  const cited = Object.keys(cites);
  const missing = cited.filter((k) => !bib[k]);
  const unused = Object.keys(bib).filter((k) => !cites[k] && !nocite.has(k) && !nocite.has("*"));
  const result = {
    path: main, files: texFiles, bibFiles, title,
    sections: sections.filter((s) => s.id !== "S0" || s.notes).map((s) => ({ ...s, keys: [...s.keys] })),
    cites, bib: Object.fromEntries(Object.entries(bib).map(([k, e]) => [k, bibSummary(e)])),
    missing, unused, gaps, notes,
    stats: { words: sections.reduce((n, s) => n + s.words, 0), cites: cited.reduce((n, k) => n + cites[k].count, 0), keys: cited.length, sections: sections.filter((s) => s.level === 1).length },
  };
  CACHE.set(main, { sig, result });
  return result;
}

// ---------- what Claude is shown (capped) ----------
export function summaryLine(r, dismissed = []) {
  const open = r.gaps.filter((g) => !dismissed.includes(g.id));
  return `${basename(r.path)}: ${r.stats.sections} sections, ${r.stats.keys} sources cited, ${open.length} possible citation gaps, ${r.notes.length} notes${r.missing.length ? `, ${r.missing.length} cited keys missing from the .bib` : ""}`;
}

export function gapReport(r, { dismissed = [], section = "", limit = 10 } = {}) {
  limit = Math.max(1, Math.min(Number(limit) || 10, 25));
  const sec = oneLine(section).toLowerCase();
  let list = r.gaps.filter((g) => !dismissed.includes(g.id) && (!sec || g.section.toLowerCase().includes(sec) || (g.top || "").toLowerCase().includes(sec) || g.sectionId.toLowerCase() === sec));
  list = [...list].sort((a, b) => (a.strength === b.strength ? a.line - b.line : a.strength === "likely" ? -1 : 1));
  const shown = list.slice(0, limit);
  const lines = [summaryLine(r, dismissed)];
  if (r.missing.length) lines.push(`Cited but not in the .bib: ${r.missing.slice(0, 8).join(", ")}${r.missing.length > 8 ? " ..." : ""}`);
  for (const g of shown) lines.push(`${g.id} l.${g.line} ${clip(g.section, 28)} [${g.strength}] "${clip(g.text, 130)}"`);
  if (list.length > shown.length) lines.push(`(${list.length - shown.length} more; narrow with section= or raise limit)`);
  if (!list.length) lines.push("No open gaps" + (sec ? ` in "${section}"` : "") + ".");
  return lines.join("\n");
}
