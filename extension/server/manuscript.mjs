// Manuscript: reads the user's LaTeX draft (and its .bib) on this Mac, entirely locally, and reports its structure:
// outline, citations per section, cited keys missing from the .bib, notes (todonotes, the changes package, TODO
// comments) and the sentences that carry no citation. Deciding which of those sentences need a source is an act of
// interpretation, so it is left to Claude, in small batches, on request; this module only prepares the batches and
// keeps the verdicts. Nothing here calls the network, and nothing here ever writes to the user's files.
//
// Offsets are kept exact: commands that are not prose (\todo, \chcomment, ...) are blanked out with spaces of
// the same length, so every sentence can be traced to its line.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, basename, extname } from "node:path";
import { createHash } from "node:crypto";

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const clip = (s, n) => { s = oneLine(s); return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, "") + "\u2026"; };
const sha = (s) => createHash("sha1").update(s).digest("hex");

const SKIP_ENV = new Set(["table", "table*", "figure", "figure*", "tabular", "tabular*", "tabularx", "equation", "equation*", "align", "align*", "eqnarray", "comment", "verbatim", "lstlisting", "tikzpicture", "thebibliography", "ack", "keyword", "abstract", "algorithm", "algorithmic", "minipage"]);
const HEADING = /\\(part|chapter|section|subsection|subsubsection|paragraph)(\*?)(?:\[[^\]]*\])?\{((?:[^{}]|\{[^{}]*\})*)\}/;
const CITE = /\\(?!nocite)([A-Za-z]*[Cc]ite[A-Za-z]*)\*?\s*(?:\[[^\]]*\]\s*){0,2}\{([^{}]*)\}/g;
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

export function parseManuscript(mainPath, opts = {}) {
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
  const extra = [...new Set((opts.markers || []).map((m) => String(m).replace(/^\\/, "").trim()).filter((m) => /^[A-Za-z]+$/.test(m)))];
  const sig = signature([...texFiles, ...bibFiles]) + "|" + extra.join(",");
  const hit = CACHE.get(main);
  if (hit && hit.sig === sig) return hit.result;

  // Macros the author or a supervisor defined to flag text (\newcommand{\sv}[1]{\textcolor{red}{#1}}) count as notes too.
  const defs = new Set(extra);
  { const src = vlines.map((v) => stripComment(v.t).code).join("\n");
    for (const m of src.matchAll(/\\(?:re)?newcommand\*?\s*\{?\\([A-Za-z]+)\}?\s*(?:\[\d\]\s*)*(?:\[[^\]]*\]\s*)?\{|\\(?:providecommand|DeclareRobustCommand)\*?\s*\{?\\([A-Za-z]+)\}?\s*(?:\[\d\]\s*)*\{|\\def\\([A-Za-z]+)(?:#\d)+\{/g)) {
      const name = m[1] || m[2] || m[3]; const g = grabArgs(src, m.index + m[0].length - 1, 1);
      if (g.args.length && /\\(?:textcolor|color|todo|hl|sout|uwave|ul)\b/.test(g.args[0]) && !/^(?:todo|textcolor|hl|ch.*)$/i.test(name)) defs.add(name);
    } }
  const macroRe = defs.size ? new RegExp(`\\\\(${[...defs].join("|")})\\b`, "g") : null;
  const bib = {};
  for (const f of bibFiles) { const s = readText(f); if (s) Object.assign(bib, parseBib(s)); }

  const sections = [];
  const gaps = [], notes = [], candidates = [], all = [];
  const cites = {};
  let body = false, skip = 0, abstract = false, title = "", top = "", abstractText = [];
  let cur = { id: "S0", level: 0, title: "Front matter", line: 1, file: main, words: 0, cites: 0, keys: new Set(), gaps: 0, notes: 0 };
  sections.push(cur);
  let par = []; // [{ f, n, t, off }]
  let parText = "";
  const nocite = new Set();

  const addGap = (g) => {
    g.id = "G" + sha(oneLine(g.text).toLowerCase()).slice(0, 6);
    if (gaps.some((x) => x.id === g.id)) return;
    g.section = cur.title; g.sectionId = cur.id; g.top = top || cur.title;
    gaps.push(g); cur.gaps++;
  };
  const addNote = (n) => { n.section = cur.title; n.sectionId = cur.id; n.id = "M" + sha(`${n.kind}|${n.line}|${n.text}`).slice(0, 6); notes.push(n); cur.notes++; };

  const flush = () => {
    if (!par.length) return;
    let text = parText;
    const markers = [];
    const lineAt = (pos) => { let hit = par[0]; for (const p of par) if (p.off <= pos) hit = p; return hit; };
    // Supervisor and author markers inside the paragraph: recorded, then blanked out of the prose.
    const cmd = new RegExp(`\\\\(?:ch)?(added|deleted|replaced|comment|highlight)\\b|\\\\(todo|TODO)\\b${macroRe ? `|\\\\(${[...defs].join("|")})\\b` : ""}`, "g");
    let m;
    while ((m = cmd.exec(text))) {
      const custom = m[3] || "";
      const name = custom ? custom : (m[1] || m[2]).toLowerCase();
      if (m[1] === "comment" && text[m.index + m[0].length] !== "{" && text[m.index + m[0].length] !== "[") continue;
      const nargs = name === "replaced" ? 2 : 1;
      const g = grabArgs(text, m.index + m[0].length, nargs);
      if (!g.args.length) continue;
      const opt = Object.fromEntries([...g.opt.matchAll(/(\w+)\s*=\s*([^,\]]+)/g)].map((x) => [x[1].toLowerCase(), oneLine(x[2])]));
      const where = lineAt(m.index);
      const body = oneLine(cleanTex(g.args[0]));
      markers.push({ pos: m.index, kind: custom ? "note" : name === "todo" ? "todo" : "change", op: name, by: custom ? custom.toUpperCase() : opt.id || "", comment: opt.comment || "", text: body, line: where.n, file: where.f });
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
    const info = sents.map((x) => {
      const clean = cleanTex(x.text);
      return { clean, words: clean.split(/\s+/).filter(Boolean).length, where: lineAt(x.a), keys: [...x.text.matchAll(CITE)].flatMap((c) => c[2].split(",").map((k) => k.trim()).filter(Boolean)),
        empty: /\\[A-Za-z]*[Cc]ite[A-Za-z]*\*?\s*(?:\[[^\]]*\]\s*)*\{\s*(?:\?+|todo|tbd|xxx)?\s*\}|\[\s*(?:citation needed|cite|ref|\?+)\s*\]|\(\s*citation needed\s*\)|(?<![A-Za-z])\?\?(?![A-Za-z])/i.test(x.text) };
    });
    info.forEach((x, i) => {
      cur.words += x.words;
      if (abstract && x.clean) abstractText.push(x.clean);
      if (x.empty) { addGap({ kind: "empty-cite", strength: "likely", line: x.where.n, file: x.where.f, text: x.clean, why: "A citation placeholder is still empty." }); return; }
      if (cur.level === 0 || x.words < 3) return;
      // Every sentence is kept (compactly) so comments can be anchored to the one they are about.
      all.push({ id: "G" + sha(oneLine(x.clean).toLowerCase()).slice(0, 6), line: x.where.n, file: x.where.f, section: cur.title, sectionId: cur.id, top: top || cur.title, text: x.clean, keys: x.keys });
      if (abstract) return;
      // Candidates for Claude to judge: sentences with no citation, and any sentence somebody left a note on.
      const notesHere = markers.filter((mk) => mk.context === x.clean);
      if (x.keys.length && !notesHere.length) return;
      const id = "G" + sha(oneLine(x.clean).toLowerCase()).slice(0, 6);
      if (candidates.some((c) => c.id === id)) return;
      candidates.push({ id, line: x.where.n, file: x.where.f, section: cur.title, sectionId: cur.id, top: top || cur.title, text: x.clean, cited: x.keys,
        before: info[i - 1]?.keys || [], after: info[i + 1]?.keys || [], notes: notesHere.map((mk) => ({ by: mk.by, text: clip(mk.text || mk.comment, 100) })) });
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
    if (begins.includes("abstract")) { flush(); abstract = true; cur = { id: `S${sections.length}`, level: 1, title: "Abstract", line: v.n, file: v.f, words: 0, cites: 0, keys: new Set(), gaps: 0, notes: 0 }; sections.push(cur); }
    for (const b of begins) if (SKIP_ENV.has(b) && b !== "abstract") skip++;
    for (const e of ends) { if (SKIP_ENV.has(e) && e !== "abstract" && skip > 0) skip--; if (e === "abstract") { flush(); abstract = false; } }
    if (skip > 0 || begins.some((b) => SKIP_ENV.has(b) && b !== "abstract") || ends.some((e) => SKIP_ENV.has(e) && e !== "abstract")) { if (!code.trim()) flush(); continue; }
    const h = code.match(HEADING);
    if (h) {
      flush();
      const level = { part: 0, chapter: 0, section: 1, subsection: 2, subsubsection: 3, paragraph: 4 }[h[1]];
      const ttl = cleanTex(h[3]);
      if (level <= 1) top = ttl;
      cur = { id: `S${sections.length}`, level, title: ttl, line: v.n, file: v.f, words: 0, cites: 0, keys: new Set(), gaps: 0, notes: 0 };
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
    path: main, markers: [...defs], files: texFiles, bibFiles, title, abstract: abstractText.join(" "),
    sections: sections.filter((s) => s.id !== "S0" || s.notes).map((s) => ({ ...s, keys: [...s.keys] })),
    candidates, all, cited: all.filter((x) => x.keys.length).map((x) => ({ ...x, id: "S" + sha(`${oneLine(x.text).toLowerCase()}|${x.keys.join(",")}`).slice(0, 6) })), cites, bib: Object.fromEntries(Object.entries(bib).map(([k, e]) => [k, bibSummary(e)])),
    missing, unused, gaps, notes,
    stats: { words: sections.reduce((n, s) => n + s.words, 0), cites: cited.reduce((n, k) => n + cites[k].count, 0), keys: cited.length, sections: sections.filter((s) => s.level === 1).length },
  };
  CACHE.set(main, { sig, result });
  return result;
}

// ---------- judging: what Claude is shown, and what comes back ----------
// Verdicts are kept per sentence (by a hash of its text), so an unchanged sentence is never judged twice and an
// edited one comes back for review by itself. need: cite (a source is wanted), maybe, own (no source needed).
export const NEEDS = ["cite", "maybe", "own"];
export const SUPPORT = ["ok", "weak", "no", "unclear"];

// The merged picture: explicit gaps (empty citations) plus sentences Claude judged to want a source.
export function applyState(r, { verdicts = {}, dismissed = [] } = {}) {
  const gaps = r.gaps.map((g) => ({ ...g, dismissed: dismissed.includes(g.id) }));
  const own = [];
  let pending = 0;
  for (const c of r.candidates) {
    const v = verdicts[c.id];
    if (!v) { if (!dismissed.includes(c.id)) pending++; continue; }
    if (v.need === "own") { own.push({ id: c.id, line: c.line, section: c.section, text: c.text, why: v.why || "" }); continue; }
    gaps.push({ id: c.id, kind: "reviewed", strength: v.need === "cite" ? "likely" : "check", line: c.line, file: c.file, section: c.section, sectionId: c.sectionId, top: c.top, text: c.text, why: v.why || "Claude: a source is wanted here.", by: "claude", dismissed: dismissed.includes(c.id) });
  }
  // Cited sentences: Claude can check whether the cited work supports them; weak ones are flagged like any other place.
  let pendingSupport = 0;
  for (const c of r.cited || []) {
    const v = verdicts[c.id];
    if (!v) { if (!dismissed.includes(c.id)) pendingSupport++; continue; }
    if (v.need === "ok") continue;
    gaps.push({ id: c.id, kind: "support", strength: v.need === "no" ? "likely" : "check", line: c.line, file: c.file, section: c.section, sectionId: c.sectionId, top: c.top, text: c.text, why: v.why || (v.need === "no" ? "Claude: the cited work does not support this." : v.need === "weak" ? "Claude: the cited work only partly supports this." : "Claude: too little is known about the cited work to say."), by: "claude", dismissed: dismissed.includes(c.id) });
  }
  const sections = r.sections.map((s) => ({ ...s, gaps: gaps.filter((g) => !g.dismissed && g.sectionId === s.id).length }));
  return { gaps, own, pending, pendingSupport, sections, open: gaps.filter((g) => !g.dismissed) };
}

export function summaryLine(r, state) {
  const a = applyState(r, state);
  const reviewed = a.gaps.filter((g) => g.by === "claude" && !g.dismissed).length;
  return `${basename(r.path)}: ${r.stats.sections} sections, ${r.stats.keys} sources cited; ${a.open.length} places flagged${reviewed ? ` (${reviewed} by Claude's review)` : ""}, ${a.pending} uncited sentences not yet reviewed${a.pendingSupport ? `, ${a.pendingSupport} cited ones not yet checked` : ""}, ${r.notes.length} notes${r.missing.length ? `, ${r.missing.length} cited keys missing from the .bib` : ""}`;
}

const pick = (list, section) => { const sec = oneLine(section).toLowerCase(); return list.filter((x) => !sec || x.section.toLowerCase().includes(sec) || (x.top || "").toLowerCase().includes(sec) || x.sectionId.toLowerCase() === sec); };
const names = (k) => k.slice(0, 3).join(", ") + (k.length > 3 ? "..." : "");

// A batch of uncited sentences for Claude to judge. Short on purpose: ids, lines, the sentence, and whether its
// neighbours cite (a citation next door often covers a sentence).
export function reviewBatch(r, { verdicts = {}, dismissed = [], section = "", limit = 30 } = {}) {
  limit = Math.max(1, Math.min(Number(limit) || 30, 50));
  const list = pick(r.candidates.filter((c) => !verdicts[c.id] && !dismissed.includes(c.id)), section);
  const shown = list.slice(0, limit);
  if (!shown.length) return `${summaryLine(r, { verdicts, dismissed })}\nNothing left to review${section ? ` in "${section}"` : ""}.`;
  const lines = [`${r.path.split("/").pop()}: ${shown.length} of ${list.length} sentences to judge. Read each as the author's reader would. cite = states a fact, number, attribution or claim about the literature or the world that a reader would want sourced. maybe = a general statement that probably wants one. own = the authors' own argument, definition, signpost or method, or already covered by a neighbouring citation. Reply with map action=manuscript op=judge text=<one line per id: ID cite|maybe|own and a reason of at most 10 words>. Do not edit the draft.`];
  for (const c of shown) {
    const flags = [c.cited.length ? `cited ${names(c.cited)}` : "", c.before.length ? `before cites ${names(c.before)}` : "", c.after.length ? `after cites ${names(c.after)}` : "", ...c.notes.map((n) => `note${n.by ? " " + n.by : ""}: "${n.text}"`)].filter(Boolean);
    lines.push(`${c.id} l.${c.line} \u00a7${clip(c.top === c.section ? c.section : `${c.top} > ${c.section}`, 36)} "${clip(c.text, 260)}"${flags.length ? ` | ${flags.join(" | ")}` : ""}`);
  }
  if (list.length > shown.length) lines.push(`(${list.length - shown.length} more; judge these, then call op=review again, or narrow with about=)`);
  return lines.join("\n");
}

// Verdict lines from Claude: "G1a2b3c cite no source for the 30% figure". Unknown ids and words are reported, not stored.
export function parseVerdicts(r, text) {
  const ids = new Map([...r.candidates.map((c) => [c.id, NEEDS]), ...(r.cited || []).map((c) => [c.id, SUPPORT])]);
  const ok = {}, bad = [];
  for (const line of String(text || "").split(/\n/).slice(0, 80)) {
    if (!line.trim()) continue;
    const m = line.match(/^\s*[-*\d.)\s]*#?([GS][0-9a-f]{6})\s*[:,\-\u2013]?\s*(cite|maybe|own|ok|weak|no|unclear)\b[\s:,\-\u2013]*(.*)$/i);
    if (!m || !ids.has(m[1]) || !ids.get(m[1]).includes(m[2].toLowerCase())) { bad.push(clip(line, 40)); continue; }
    ok[m[1]] = { need: m[2].toLowerCase(), why: clip(m[3], 90), date: new Date().toISOString().slice(0, 10) };
  }
  return { ok, bad };
}

// A batch of cited sentences for Claude to check against what is known of the papers cited. Only summaries are given:
// a title, a year and, when the ledger has one, the TLDR; Claude says "unclear" rather than guess from a title.
export function supportBatch(r, { verdicts = {}, dismissed = [], section = "", limit = 8, info = {} } = {}) {
  limit = Math.max(1, Math.min(Number(limit) || 8, 15));
  const list = pick((r.cited || []).filter((c) => !verdicts[c.id] && !dismissed.includes(c.id)), section);
  const shown = list.slice(0, limit);
  if (!shown.length) return `${summaryLine(r, { verdicts, dismissed })}\nNo cited sentences left to check${section ? ` in "${section}"` : ""}.`;
  const lines = [`${r.path.split("/").pop()}: ${shown.length} of ${list.length} cited sentences to check. Judge whether each cited work supports the sentence it is attached to, from the summaries given only. ok = it plausibly does. weak = related but not what the sentence claims, or only partly. no = it does not, or looks like the wrong paper. unclear = too little is known (fetch with paper detail=tldr on the handles shown). Reply with map action=manuscript op=judge text=<one line per id: ID ok|weak|no|unclear and a reason of at most 12 words>.`];
  for (const c of shown) {
    lines.push(`${c.id} l.${c.line} \u00a7${clip(c.top === c.section ? c.section : `${c.top} > ${c.section}`, 30)} "${clip(c.text, 240)}"`);
    for (const k of c.keys.slice(0, 4)) { const i = info[k]; lines.push(`  ${k}${i ? ` (${i.year}) ${clip(i.title, 90)}${i.h ? ` [${i.h}]` : ""}${i.tldr ? `: ${clip(i.tldr, 160)}` : i.h ? " (no summary yet)" : ""}` : " (not in the .bib)"}`); }
  }
  if (list.length > shown.length) lines.push(`(${list.length - shown.length} more; judge these, then call op=support again)`);
  return lines.join("\n");
}

// The places currently flagged, capped (explicit gaps first, then Claude's verdicts in document order).
export function gapReport(r, { verdicts = {}, dismissed = [], section = "", limit = 10 } = {}) {
  limit = Math.max(1, Math.min(Number(limit) || 10, 25));
  const a = applyState(r, { verdicts, dismissed });
  const list = pick(a.open, section).sort((x, y) => (x.strength === y.strength ? x.line - y.line : x.strength === "likely" ? -1 : 1));
  const shown = list.slice(0, limit);
  const lines = [summaryLine(r, { verdicts, dismissed })];
  if (r.missing.length) lines.push(`Cited but not in the .bib: ${r.missing.slice(0, 8).join(", ")}${r.missing.length > 8 ? " ..." : ""}`);
  for (const g of shown) lines.push(`${g.id} l.${g.line} ${clip(g.section, 28)} [${g.strength}] "${clip(g.text, 130)}" ${clip(g.why, 70)}`);
  if (list.length > shown.length) lines.push(`(${list.length - shown.length} more; narrow with about= or raise limit)`);
  if (!list.length) lines.push(a.pending ? `No places flagged yet; ${a.pending} uncited sentences have not been reviewed (op=review).` : "No places flagged" + (section ? ` in "${section}"` : "") + ".");
  return lines.join("\n");
}

// The brief a workflow starts from: what the paper is about, where it stands, what is already cited. Short on purpose.
export function scopeBrief(r, { scope = {}, verdicts = {}, dismissed = [] } = {}) {
  const a = applyState(r, { verdicts, dismissed });
  const outline = r.sections.filter((x) => x.level === 1 && x.id !== "S0").map((x) => x.title);
  const cited = Object.keys(r.cites).map((k) => { const b = r.bib[k]; return b ? `${k} (${b.year}) ${clip(b.title, 60)}` : k; });
  const lines = [`Draft: ${r.title || basename(r.path)} (${basename(r.path)})`];
  if (scope.in) lines.push(`In scope (the user's words): ${clip(scope.in, 400)}`);
  if (scope.out) lines.push(`Out of scope, do not chase: ${clip(scope.out, 300)}`);
  if (r.abstract) lines.push(`Abstract: ${clip(r.abstract, 900)}`);
  lines.push(`Sections: ${outline.join("; ")}`);
  lines.push(`Already cited (${cited.length}): ${cited.slice(0, 20).join("; ")}${cited.length > 20 ? "; ..." : ""}`);
  lines.push(`Flagged places: ${a.open.length}; uncited sentences not yet reviewed: ${a.pending}.`);
  return lines.join("\n");
}

export const splitList = (s) => String(s || "").split(/[\n,;]+/).map((x) => oneLine(x).toLowerCase()).filter((x) => x.length > 1);
