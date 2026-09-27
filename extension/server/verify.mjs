// Deterministic citation verification for a draft on disk (Markdown or LaTeX).
// Checks that every citation has a source, every source is cited, identifiers resolve to the
// titles and years claimed, cited papers were screened in the session, and numbers attached to
// citations appear in the cited paper's evidence cards or full text. Returns only the problems.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const words = (s) => norm(s).split(" ").filter((w) => w.length > 3);
const overlap = (title, text) => { const w = words(title); if (!w.length) return 1; const t = " " + norm(text) + " "; return w.filter((x) => t.includes(" " + x + " ")).length / w.length; };

function parseBib(src) {
  const out = new Map();
  for (const m of src.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,([\s\S]*?)\n\}/g)) {
    const f = {};
    for (const x of m[2].matchAll(/(\w+)\s*=\s*[{"]((?:[^{}]|\{[^{}]*\})*)[}"]/g)) f[x[1].toLowerCase()] = x[2].replace(/[{}]/g, "");
    out.set(m[1], f);
  }
  return out;
}

function splitSources(text) {
  const lines = text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) if (/^#{1,6}\s*(sources|references|bibliography)\b/i.test(lines[i].trim()) || /^\\section\*?\{(references|sources)\}/i.test(lines[i].trim())) start = i;
  if (start < 0) return { body: text, sources: new Map() };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^#{1,6}\s/.test(lines[i].trim())) { end = i; break; }
  const sources = new Map();
  for (const l of lines.slice(start + 1, end)) {
    const m = l.match(/^\s*(?:\[(\d+)\]|(\d+)[.)])\s*(.+)$/);
    if (m) sources.set(m[1] || m[2], m[3].trim());
  }
  return { body: [...lines.slice(0, start), ...lines.slice(end)].join("\n"), sources };
}

function idsIn(s) {
  const out = {};
  const h = s.match(/\bP(\d+)\b/); if (h) out.handle = `P${h[1]}`;
  const d = s.match(/(10\.\d{4,9}\/[^\s"<>)\]]+)/); if (d) out.doi = d[1].replace(/[.,;]+$/, "");
  const a = s.match(/arxiv(?:\.org\/(?:abs|pdf)\/|:\s*)(\d{4}\.\d{4,5})/i) || s.match(/\b(\d{4}\.\d{4,5})(v\d+)?\b/); if (a) out.arxiv = a[1];
  const u = s.match(/https?:\/\/[^\s)>\]]+/); if (u) out.url = u[0].replace(/[.,;]+$/, "");
  return out;
}

// Numbers worth checking: decimals, percentages and counts with 3+ digits, excluding years and citation numbers.
function numbersIn(sentence) {
  const s = sentence.replace(/\[[^\]]*\]/g, " ").replace(/\\cite\w*\{[^}]*\}/g, " ");
  const out = [];
  for (const m of s.matchAll(/(?<![\w.])(\d+(?:[.,]\d+)?)(\s?%)?(?![\w.]*\d)/g)) {
    const n = m[1], pct = !!m[2];
    if (/^(19|20)\d{2}$/.test(n) && !pct) continue;
    if (!pct && !n.includes(".") && n.length < 3) continue;
    out.push(n + (pct ? "%" : ""));
  }
  return out;
}
function numberVariants(n) {
  const v = new Set([n.replace("%", "")]);
  const x = parseFloat(n.replace(",", "."));
  const dec = (n.replace("%", "").split(/[.,]/)[1] || "").length;
  if (n.endsWith("%")) { v.add((x / 100).toFixed(dec + 2)); v.add(String(+(x / 100).toFixed(dec + 2))); }
  else if (x < 1) v.add(String(+(x * 100).toFixed(Math.max(0, dec - 2))));
  return [...v].map((s) => s.replace(/\.0$/, ""));
}

export async function verifyDraft(a, deps) {
  const { LEDGER, http, oaUrl, loadFullText, xmlText, ARXIV_API } = deps;
  let text = a.text || "";
  let label = "text";
  if (a.path) {
    const p = a.path.startsWith("~") ? join(homedir(), a.path.slice(1)) : a.path;
    if (!existsSync(p)) throw new Error(`file not found: ${p}`);
    text = readFileSync(p, "utf8");
    label = p;
  }
  if (!text.trim()) throw new Error("give path (a draft on this Mac) or text");
  let bib = new Map();
  if (a.bib) { const b = a.bib.startsWith("~") ? join(homedir(), a.bib.slice(1)) : a.bib; if (existsSync(b)) bib = parseBib(readFileSync(b, "utf8")); }
  const st = LEDGER.ensure();
  const byKey = new Map(Object.entries(st.papers).filter(([, p]) => p.citekey).map(([h, p]) => [p.citekey, h]));

  const { body, sources } = splitSources(text);
  const problems = [];
  const refs = new Map(); // ref label -> { ids, entry }

  // Citation markers in the body.
  const cited = new Set();
  for (const m of body.matchAll(/\[(\d+(?:\s*[-–,]\s*\d+)*)\]/g)) {
    for (const part of m[1].split(/\s*,\s*/)) {
      const r = part.split(/\s*[-–]\s*/).map(Number);
      if (r.length === 2 && r[1] >= r[0] && r[1] - r[0] < 50) for (let i = r[0]; i <= r[1]; i++) cited.add(String(i)); else cited.add(String(r[0]));
    }
  }
  for (const m of body.matchAll(/\\cite\w*\{([^}]+)\}/g)) for (const k of m[1].split(",")) cited.add("key:" + k.trim());
  for (const m of body.matchAll(/\[@([\w:.-]+)/g)) cited.add("key:" + m[1]);
  for (const m of body.matchAll(/\[(P\d+(?:\s*[,;]\s*P\d+)*)\]/g)) for (const h of m[1].split(/\s*[,;]\s*/)) cited.add("h:" + h);

  for (const c of cited) {
    if (/^\d+$/.test(c)) {
      if (!sources.has(c)) { problems.push(`[${c}] cited but missing from Sources`); continue; }
      refs.set(c, { ids: idsIn(sources.get(c)), entry: sources.get(c) });
    } else if (c.startsWith("key:")) {
      const k = c.slice(4);
      const h = byKey.get(k), b = bib.get(k);
      if (!h && !b) { problems.push(`\\cite{${k}}: key not in the .bib or the session`); continue; }
      refs.set(c, { ids: { handle: h, doi: b?.doi, arxiv: b?.eprint }, entry: b ? `${b.title || ""} ${b.year || ""}` : st.papers[h].title + " " + (st.papers[h].year || "") });
    } else refs.set(c, { ids: { handle: c.slice(2) }, entry: "" });
  }
  for (const n of sources.keys()) if (!cited.has(n)) problems.push(`Source ${n} is never cited`);

  // Resolve identities and compare with the claimed entry.
  const resolved = new Map();
  let checked = 0;
  for (const [rawRef, { ids, entry }] of refs) {
    const ref = /^\d+$/.test(rawRef) ? `[${rawRef}]` : rawRef.replace(/^key:/, "cite ").replace(/^h:/, "");
    let title = "", year = null, handle = ids.handle && st.papers[ids.handle] ? ids.handle : null;
    if (ids.handle && !handle) { problems.push(`${ref}: handle ${ids.handle} not in session "${st.name}"`); continue; }
    if (!handle) handle = LEDGER.find({ ids: { doi: ids.doi || "", arxiv: ids.arxiv || "" }, title: "" });
    try {
      if (ids.doi) {
        const w = await http(oaUrl(`/works/doi:${ids.doi}`, { select: "title,publication_year" }), { ttl: 30 * 86400000 });
        title = w.title; year = w.publication_year;
      } else if (ids.arxiv) {
        const xml = await http(`${ARXIV_API}?id_list=${ids.arxiv}`, { as: "text", ttl: 30 * 86400000 });
        const e = (xml.match(/<entry>([\s\S]*?)<\/entry>/) || [])[1] || "";
        title = xmlText((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "").replace(/\s+/g, " ").trim();
        year = +(e.match(/<published>(\d{4})/) || [])[1] || null;
        if (!title) problems.push(`${ref}: arXiv ${ids.arxiv} not found`);
      } else if (ids.url && !handle) {
        try { await http(ids.url, { as: "buffer", ttl: 7 * 86400000 }); } catch (e) { problems.push(`${ref}: URL does not resolve (${e.status || "network"}) ${ids.url}`); }
      } else if (handle) { title = st.papers[handle].title; year = st.papers[handle].year; }
      else if (!ids.url) problems.push(`${ref}: no DOI, arXiv id, URL or handle to check`);
    } catch (e) { problems.push(`${ref}: identifier does not resolve (${e.status || e.message})`); }
    if (title && entry && overlap(title, entry) < 0.6) problems.push(`${ref}: title mismatch; the identifier resolves to "${title.slice(0, 80)}"`);
    if (year && entry) { const ys = entry.match(/\b(19|20)\d{2}\b/g); if (ys && !ys.map(Number).some((y) => Math.abs(y - year) <= 1)) problems.push(`${ref}: year ${ys[0]} but the record says ${year}`); }
    if (Object.keys(st.papers).length && !handle) problems.push(`${ref}: not screened in session "${st.name}"`);
    if (handle && st.papers[handle].status === "dropped") problems.push(`${ref}: cites ${handle}, which was marked dropped`);
    resolved.set(rawRef, handle);
    checked++;
  }

  // Numbers attached to citations must appear in cards or the paper's text.
  let numChecked = 0, textLoads = 0;
  if (a.numbers !== false) {
    const sentences = body.replace(/\n+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z])/);
    const cache = new Map();
    for (const sent of sentences) {
      const marks = [...sent.matchAll(/\[(\d+(?:\s*[-–,]\s*\d+)*|P\d+(?:\s*[,;]\s*P\d+)*)\]|\\cite\w*\{([^}]+)\}|\[@([\w:.-]+)/g)];
      if (!marks.length) continue;
      const nums = numbersIn(sent);
      if (!nums.length) continue;
      const refsHere = [];
      for (const m of marks) {
        if (m[2]) m[2].split(",").forEach((k) => refsHere.push("key:" + k.trim()));
        else if (m[3]) refsHere.push("key:" + m[3]);
        else if (/^P/.test(m[1])) m[1].split(/\s*[,;]\s*/).forEach((h) => refsHere.push("h:" + h));
        else m[1].split(/\s*,\s*/).forEach((x) => refsHere.push(x.split(/\s*[-–]\s*/)[0]));
      }
      const handles = refsHere.map((r) => resolved.get(r)).filter(Boolean);
      if (!handles.length) continue;
      let hay = "";
      for (const h of handles) {
        const p = st.papers[h];
        hay += " " + (p.cards || []).map((c) => c.c + " " + c.q).join(" ") + " " + (p.tldr || "");
        if (!cache.has(h) && textLoads < 25) {
          textLoads++;
          try { const d = await loadFullText(h); cache.set(h, d.sections.map((x) => x.text).join(" ")); } catch { cache.set(h, ""); }
        }
        hay += " " + (cache.get(h) || "");
      }
      for (const n of nums) {
        numChecked++;
        const hit = numberVariants(n).some((v) => new RegExp(`(?<![\\d.,])${v.replace(".", "[.,]")}(?![\\d])`).test(hay));
        if (!hit) problems.push(`"${n}" (cited to ${handles.join(", ")}) not found in the cited paper's cards or text: "${sent.trim().slice(0, 90)}…"`);
      }
    }
  }

  const head = `Verify ${label}: ${refs.size} citations, ${sources.size} sources, ${checked} identities checked, ${numChecked} numbers checked. ${problems.length ? problems.length + " problems:" : "No problems found."}`;
  return [head, ...problems.slice(0, 60), problems.length > 60 ? `(${problems.length - 60} more)` : ""].filter(Boolean).join("\n");
}
