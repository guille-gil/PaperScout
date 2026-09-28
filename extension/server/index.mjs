#!/usr/bin/env node
// paper-scout: token-lean MCP server for Semantic Scholar, arXiv and OpenAlex.
// Design rules: compact one-line results, abstracts off by default, TLDRs before
// abstracts, full text read by section or by passage search, everything cached on disk.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, extname, dirname, resolve as resolvePath } from "node:path";
import { createInterface } from "node:readline";
import { toolLibrary, zoteroResolve, zotLookup, zotSearchRecords, setRenderer, zotBibData, zotSurnames } from "./zotero.mjs";
import { Ledger } from "./ledger.mjs";
import { renderFigure } from "./figures.mjs";
import { verifyDraft } from "./verify.mjs";
import { startDesk } from "./desk.mjs";
import { ResearchMap, definitionHits } from "./map.mjs";

const VERSION = "0.14.1";
const PARSER_VERSION = "3";
const S2 = "https://api.semanticscholar.org/graph/v1";
const S2_REC = "https://api.semanticscholar.org/recommendations/v1";
const OA = "https://api.openalex.org";
const ARXIV_API = "https://export.arxiv.org/api/query";
const LIST_FIELDS = "title,year,venue,citationCount,externalIds,authors,isOpenAccess,corpusId,journal";
const DAY = 86_400_000;

// ---------- configuration ----------
function loadConfig() {
  const cfg = {};
  const file = join(homedir(), ".config", "paper-scout", "config.json");
  try { Object.assign(cfg, JSON.parse(readFileSync(file, "utf8"))); } catch {}
  const env = (k) => (process.env[k] && !process.env[k].includes("${") ? process.env[k].trim() : "");
  return {
    s2Key: env("SEMANTIC_SCHOLAR_API_KEY") || cfg.semantic_scholar_api_key || "",
    openalexKey: env("OPENALEX_API_KEY") || cfg.openalex_api_key || "",
    mailto: env("PAPER_SCOUT_MAILTO") || cfg.mailto || "",
    zoteroDir: env("PAPER_SCOUT_ZOTERO_DIR") || cfg.zotero_dir || "",
    deskPort: Number(env("PAPER_SCOUT_DESK_PORT") || cfg.desk_port || 4517),
    proxy: env("PAPER_SCOUT_PROXY") || cfg.library_proxy || "https://proxy-ub.rug.nl/login?url=",
    cacheDir: env("PAPER_SCOUT_CACHE") || cfg.cache_dir ||
      (process.platform === "darwin" ? join(homedir(), "Library", "Caches", "paper-scout") : join(homedir(), ".cache", "paper-scout")),
  };
}
const CFG = loadConfig();
try { mkdirSync(join(CFG.cacheDir, "http"), { recursive: true }); mkdirSync(join(CFG.cacheDir, "text"), { recursive: true }); } catch {}

const LEDGER = new Ledger(CFG.cacheDir);
setRenderer((rec, opts) => LEDGER.line(LEDGER.register(rec).h, opts));
const log = (...a) => process.stderr.write(`[paper-scout] ${a.join(" ")}\n`);
const sha = (s) => createHash("sha1").update(s).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- HTTP with cache, throttling and retry ----------
const lastCall = {};
const queues = {};
// Semantic Scholar allows 1 request per second across all endpoints (with or without a key), so keep a
// safety margin. Calls to the same host are queued, so parallel tool calls and subagents never collide.
const MIN_GAP = { "api.semanticscholar.org": 1150, "export.arxiv.org": 3100 };

function throttle(host) {
  const gap = MIN_GAP[host] || 0;
  const turn = (queues[host] || Promise.resolve()).then(async () => {
    const wait = (lastCall[host] || 0) + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall[host] = Date.now();
  });
  queues[host] = turn.catch(() => {});
  return turn;
}

class HttpError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

async function http(url, { method = "GET", body, ttl = 7 * DAY, as = "json", headers = {} } = {}) {
  // The Accept header is part of the key: doi.org answers BibTeX, APA or JSON for the same URL.
  const key = sha(method + url + (body ? JSON.stringify(body) : "") + (headers.accept || ""));
  const cpath = join(CFG.cacheDir, "http", key + (as === "buffer" ? ".bin" : ".txt"));
  if (ttl > 0 && existsSync(cpath) && Date.now() - statSync(cpath).mtimeMs < ttl) {
    const raw = readFileSync(cpath);
    return as === "json" ? JSON.parse(raw.toString("utf8")) : as === "text" ? raw.toString("utf8") : raw;
  }
  const host = new URL(url).host;
  const h = { "user-agent": `paper-scout/${VERSION}${CFG.mailto ? ` (mailto:${CFG.mailto})` : ""}`, ...headers };
  if (host === "api.semanticscholar.org" && CFG.s2Key) h["x-api-key"] = CFG.s2Key;
  if (body) h["content-type"] = "application/json";
  for (let attempt = 0; attempt < 4; attempt++) {
    await throttle(host);
    let res;
    try {
      res = await fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : undefined, redirect: "follow", signal: AbortSignal.timeout(45_000) });
    } catch (e) {
      if (attempt === 3) throw new HttpError(`network error for ${host}: ${e.message}`, 0);
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt === 3) throw new HttpError(`${host} answered ${res.status}${res.status === 429 ? " (rate limited)" : ""}`, res.status);
      const ra = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10_000) : 2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new HttpError(`${host} answered ${res.status}`, res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (ttl > 0) try { writeFileSync(cpath, buf); } catch {}
    return as === "json" ? JSON.parse(buf.toString("utf8")) : as === "text" ? buf.toString("utf8") : buf;
  }
}

// ---------- formatting ----------
const clip = (s, n) => (!s ? "" : s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, "") + "…");
const oneLine = (s) => (s || "").replace(/\s+/g, " ").trim();
const tok = (chars) => (chars < 1000 ? `${Math.max(1, Math.round(chars / 4))}` : `${(chars / 4000).toFixed(1)}k`);

function authorsShort(list) {
  const names = (list || []).map((a) => (typeof a === "string" ? a : a?.name || a?.author?.display_name)).filter(Boolean);
  if (!names.length) return "";
  const last = (n) => n.trim().split(/\s+/).pop();
  return names.length === 1 ? last(names[0]) : names.length === 2 ? `${last(names[0])} & ${last(names[1])}` : `${last(names[0])} et al.`;
}

function s2Id(p) {
  const x = p.externalIds || {};
  if (x.ArXiv) return `arXiv:${x.ArXiv}`;
  if (x.DOI) return `doi:${x.DOI}`;
  if (p.corpusId || x.CorpusId) return `CorpusId:${p.corpusId || x.CorpusId}`;
  return p.paperId || "?";
}

// Surnames from full-name strings: multi-word surnames known from Zotero first, then name particles
// (de, van, von, ...), then the last word.
let SURNAMES = [], SURNAMES_AT = 0;
async function refreshSurnames() {
  if (Date.now() - SURNAMES_AT < 10 * 60_000) return;
  SURNAMES_AT = Date.now();
  try { SURNAMES = await zotSurnames(CFG.zoteroDir); LEDGER.surnames = SURNAMES; } catch {}
}
const PARTICLES = new Set("de del della der den di da das do dos du la le van von ter ten bin al el".split(" "));
function lastName(n) {
  const full = (n || "").trim().replace(/\s+/g, " ");
  if (!full) return "";
  const low = full.toLowerCase();
  for (const s of SURNAMES) if (low.endsWith(" " + s.toLowerCase()) || low === s.toLowerCase()) return full.slice(full.length - s.length);
  const t = full.split(" ");
  for (let i = 1; i < t.length - 1; i++) if (PARTICLES.has(t[i].toLowerCase())) return t.slice(i).join(" ");
  return t[t.length - 1];
}
function recS2(p) {
  const x = p.externalIds || {};
  const jn = oneLine(p.journal?.name || "");
  const venue = p.venue && !/^arxiv(\.org)?$/i.test(p.venue) ? p.venue : jn && !/arxiv/i.test(jn) ? jn : p.venue;
  return { title: oneLine(p.title), lasts: (p.authors || []).slice(0, 3).map((a) => lastName(a.name)), year: p.year, venue, cites: p.citationCount,
    ids: { doi: /^10\.48550\//i.test(x.DOI || "") ? "" : x.DOI || "", arxiv: x.ArXiv || ((x.DOI || "").match(/10\.48550\/arxiv\.(.+)$/i) || [])[1] || "", corpus: String(p.corpusId || x.CorpusId || "") }, oa: !!(p.isOpenAccess || p.openAccessPdf?.url || x.ArXiv), tldr: p.tldr?.text || "" };
}
function recOA(w) {
  const doi = (w.doi || "").replace(/^https?:\/\/doi\.org\//, "");
  const arxiv = (doi.match(/10\.48550\/arxiv\.(.+)$/i) || [])[1] || "";
  return { title: oneLine(w.title || w.display_name), lasts: (w.authorships || []).slice(0, 3).map((a) => lastName(a.author?.display_name)), year: w.publication_year,
    venue: w.primary_location?.source?.display_name, cites: w.cited_by_count, ids: { doi: arxiv ? "" : doi, arxiv, openalex: (w.id || "").replace("https://openalex.org/", "") }, oa: !!w.open_access?.is_oa };
}
function recArxiv(r) {
  return { title: r.title, lasts: r.authors.slice(0, 3).map(lastName), year: r.year, venue: r.journal || "arXiv", ids: { arxiv: r.id, doi: /^10\.48550\//i.test(r.doi || "") ? "" : r.doi || "" }, oa: true };
}
// Preprints: find the published version of arXiv-only papers in one Semantic Scholar batch call, so that
// citations, BibTeX and screening use the peer-reviewed record. Each handle is checked at most once a month.
async function resolvePublished(handles) {
  const todo = handles.filter((h) => { const p = LEDGER.get(h); return p && LEDGER.isPreprint(p) && (!p.pubChecked || Date.now() - Date.parse(p.pubChecked) > 30 * DAY); }).slice(0, 40);
  if (!todo.length) return 0;
  let found = 0;
  try {
    const r = await http(`${S2}/paper/batch?fields=externalIds,venue,journal,year`, { method: "POST", body: { ids: todo.map((h) => `ARXIV:${LEDGER.get(h).ids.arxiv}`) }, ttl: 7 * DAY });
    (Array.isArray(r) ? r : []).forEach((x, i) => {
      const p = LEDGER.get(todo[i]);
      p.pubChecked = new Date().toISOString();
      const doi = x?.externalIds?.DOI || "";
      const jn = oneLine(x?.journal?.name || "");
      const venue = x?.venue && !/arxiv/i.test(x.venue) ? x.venue : jn && !/arxiv/i.test(jn) ? jn : "";
      if (doi && !/^10\.48550\//i.test(doi)) { p.ids.doi = doi; if (venue) p.venue = venue; if (x.year) p.year = x.year; p.published = true; found++; LEDGER.index(); }
      else if (venue) { p.venue = venue; p.published = true; found++; }
    });
  } catch {}
  return found;
}

// Render a list of {rec, text} items through the ledger: merge duplicates across sources,
// mark papers already in Zotero, collapse papers shown earlier in the session.
async function renderItems(items, { full = false, peerReviewed = false } = {}) {
  await refreshSurnames();
  const order = [];
  const texts = {};
  for (const { rec, text } of items) {
    const { h } = LEDGER.register(rec);
    if (!order.includes(h)) order.push(h);
    if (text && !texts[h]) texts[h] = text;
  }
  for (const h of order) {
    const p = LEDGER.get(h);
    if (!p.ids.zot) { const z = await zotLookup(p.ids, p.title, CFG.zoteroDir); if (z) LEDGER.register({ ...z, ids: { ...z.ids } }); }
  }
  const published = await resolvePublished(order);
  let hidden = [];
  if (peerReviewed) { hidden = order.filter((h) => LEDGER.isPreprint(LEDGER.get(h))); order.splice(0, order.length, ...order.filter((h) => !hidden.includes(h))); }
  const preprints = order.filter((h) => LEDGER.isPreprint(LEDGER.get(h))).length;
  return { handles: order, lines: order.map((h) => LEDGER.line(h, { full, text: texts[h] })), published, preprints, hidden: hidden.length };
}
function lineS2(p, i, abstractChars = 0) {
  const r = recS2(p);
  const { h } = LEDGER.register(r);
  const t = abstractChars > 0 ? clip(oneLine(p.tldr?.text || p.abstract), abstractChars) : "";
  return LEDGER.line(h, { text: t });
}
function lineOA(w, i, abstractChars = 0, full = false) {
  const { h } = LEDGER.register(recOA(w));
  const t = abstractChars > 0 && w.abstract_inverted_index ? clip(invertAbstract(w.abstract_inverted_index), abstractChars) : "";
  return LEDGER.line(h, { text: t, full });
}

function invertAbstract(inv) {
  const words = [];
  for (const [w, pos] of Object.entries(inv || {})) for (const p of pos) words[p] = w;
  return words.filter(Boolean).join(" ");
}

// ---------- identifier handling ----------
const ARXIV_NEW = /(\d{4}\.\d{4,5})(v\d+)?/;
const ARXIV_OLD = /([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/;

function parseId(raw) {
  const s = String(raw || "").trim();
  if (!s) throw new Error("empty paper id");
  const expanded = s.startsWith("~") ? join(homedir(), s.slice(1)) : s;
  if ((expanded.startsWith("/") || /^[A-Za-z]:\\/.test(expanded)) && existsSync(expanded)) return { kind: "file", path: resolvePath(expanded) };
  let m;
  if ((m = s.match(/^zot(?:ero)?:([A-Z0-9]{8})$/i))) return { kind: "zotero", key: m[1].toUpperCase() };
  if ((m = s.match(/^P(\d+)$/i))) return { kind: "handle", h: `P${m[1]}` };
  if (/arxiv/i.test(s) || /^\d{4}\.\d{4,5}(v\d+)?$/.test(s)) {
    if ((m = s.match(ARXIV_NEW)) || (m = s.match(ARXIV_OLD))) return { kind: "arxiv", arxiv: m[1], s2: `ARXIV:${m[1]}` };
  }
  if ((m = s.match(/(10\.\d{4,9}\/[^\s"<>]+)/))) { const doi = m[1].replace(/[.,;)]+$/, ""); return { kind: "doi", doi, s2: `DOI:${doi}` }; }
  if ((m = s.match(/^corpus(?:id)?:?\s*(\d+)$/i))) return { kind: "s2", s2: `CorpusId:${m[1]}` };
  if ((m = s.match(/semanticscholar\.org\/paper\/(?:[^/]+\/)?([0-9a-f]{40})/i)) || (m = s.match(/^([0-9a-f]{40})$/i))) return { kind: "s2", s2: m[1] };
  if ((m = s.match(/^(?:https?:\/\/openalex\.org\/)?(W\d{4,})$/i))) return { kind: "openalex", openalex: m[1].toUpperCase() };
  if (/^https?:\/\//.test(s)) return { kind: "url", url: s };
  return { kind: "title", title: s };
}

// Zotero keys resolve to the item's arXiv id, DOI or title for the online tools.
async function resolveForS2(raw) {
  let p = parseId(raw);
  if (p.kind === "handle") {
    const id = LEDGER.bestId(p.h, "online");
    if (!id) throw new Error(`${p.h} is not in this session`);
    p = parseId(id);
  }
  if (p.kind !== "zotero") return p;
  const z = await zoteroResolve(p.key, CFG.zoteroDir);
  const q = z.arxiv ? `arXiv:${z.arxiv}` : z.doi || z.title;
  if (!q) throw new Error(`Zotero item ${p.key} has no DOI, arXiv id or title`);
  return parseId(q);
}

async function s2Resolve(idObj, fields = "paperId,title,externalIds,openAccessPdf,year") {
  if (idObj.s2) return http(`${S2}/paper/${encodeURIComponent(idObj.s2)}?fields=${fields}`);
  if (idObj.kind === "title") {
    const r = await http(`${S2}/paper/search/match?query=${encodeURIComponent(idObj.title)}&fields=${fields}`);
    if (!r?.data?.length) throw new Error(`no paper matches the title "${idObj.title}"`);
    return r.data[0];
  }
  if (idObj.kind === "openalex") {
    const w = await http(oaUrl(`/works/${idObj.openalex}`, { select: "doi" }));
    if (!w.doi) throw new Error(`${idObj.openalex} has no DOI, so it cannot be looked up on Semantic Scholar`);
    return http(`${S2}/paper/DOI:${encodeURIComponent(w.doi.replace(/^https?:\/\/doi\.org\//, ""))}?fields=${fields}`);
  }
  throw new Error("this identifier cannot be resolved on Semantic Scholar");
}

function oaUrl(path, params = {}) {
  const u = new URL(OA + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.searchParams.set(k, v);
  if (CFG.openalexKey) u.searchParams.set("api_key", CFG.openalexKey);
  else if (CFG.mailto) u.searchParams.set("mailto", CFG.mailto);
  return u.toString();
}

// ---------- search ----------
function oaYearFilter(year) {
  if (!year) return "";
  const m = String(year).match(/^(\d{4})?\s*(-)?\s*(\d{4})?$/);
  if (!m) return "";
  const [, a, dash, b] = m;
  if (!dash) return `publication_year:${a}`;
  return [a ? `from_publication_date:${a}-01-01` : "", b ? `to_publication_date:${b}-12-31` : ""].filter(Boolean).join(",");
}

// Keep hits that are about the query: every term (5-letter word-start stem) in title or abstract and
// at least half of the terms in the title. Relax to 75% coverage when too few hits survive.
function coverageFilter(rows, query, textOf, limit, titleOf) {
  const qt = [...new Set(terms(query.replace(/\b(AND|OR|NOT)\b/g, " ")))].map((t) => t.slice(0, 5));
  if (qt.length < 2) return { rows, dropped: 0 };
  const hits = (text) => { const t = " " + text.toLowerCase().replace(/[^a-z0-9]+/g, " "); return qt.filter((q) => t.includes(" " + q)).length; };
  const need = Math.ceil(qt.length / 2);
  const scored = rows.map((r) => ({ r, c: hits(textOf(r)) / qt.length, t: hits(titleOf(r) || "") }));
  let kept = scored.filter((x) => x.c === 1 && x.t >= need);
  if (kept.length < limit) kept = kept.concat(scored.filter((x) => !(x.c === 1 && x.t >= need) && x.c >= 0.75 && x.t >= need));
  return { rows: kept.map((x) => x.r), dropped: rows.length - kept.length };
}

async function searchS2({ query, limit, year, sort, venue, open_access, abstract_chars }) {
  const fields = LIST_FIELDS + (abstract_chars > 0 ? ",abstract,tldr" : "");
  let url, note = "";
  if (sort === "relevance") {
    const u = new URL(`${S2}/paper/search`);
    u.search = new URLSearchParams({ query, limit: String(limit), fields: fields.replace(",tldr", "") }).toString();
    if (year) u.searchParams.set("year", year);
    if (venue) u.searchParams.set("venue", venue);
    if (open_access) u.searchParams.set("openAccessPdf", "");
    url = u.toString();
  } else {
    const u = new URL(`${S2}/paper/search/bulk`);
    u.search = new URLSearchParams({ query, fields: fields.replace(",tldr", "").replace(",abstract", "") + ",abstract", sort: sort === "recent" ? "publicationDate:desc" : "citationCount:desc" }).toString();
    if (year) u.searchParams.set("year", year);
    if (venue) u.searchParams.set("venue", venue);
    if (open_access) u.searchParams.set("openAccessPdf", "");
    url = u.toString();
  }
  const r = await http(url, { ttl: DAY });
  let rows = r.data || [];
  if (sort !== "relevance") {
    const f = coverageFilter(rows, query, (p) => `${p.title} ${p.abstract || ""}`, limit, (p) => p.title);
    rows = f.rows;
    if (f.dropped) note = ` (${f.dropped} off-topic matches filtered)`;
  }
  rows = rows.slice(0, limit);
  return { head: `s2 ${sort}: ${r.total ?? rows.length} hits${note}`, items: rows.map((p) => ({ rec: recS2(p), text: abstract_chars > 0 ? clip(oneLine(p.tldr?.text || p.abstract), abstract_chars) : "" })) };
}

async function searchOpenAlex({ query, limit, year, sort, abstract_chars, open_access, peer_reviewed }) {
  const filter = [oaYearFilter(year), open_access ? "is_oa:true" : "", peer_reviewed ? "type:!preprint" : ""].filter(Boolean).join(",");
  const params = {
    "per-page": String(limit), filter: [`title_and_abstract.search:${query.replace(/,/g, " ")}`, filter].filter(Boolean).join(","),
    select: "id,doi,title,publication_year,cited_by_count,authorships,primary_location,open_access" + (abstract_chars > 0 || sort !== "relevance" ? ",abstract_inverted_index" : ""),
  };
  if (sort !== "relevance") params["per-page"] = "200";
  const r = await http(oaUrl("/works", params), { ttl: DAY });
  let rows = r.results || [];
  let dropped = 0;
  if (sort !== "relevance") {
    const f = coverageFilter(rows, query, (w) => `${w.title} ${invertAbstract(w.abstract_inverted_index)}`, limit, (w) => w.title);
    rows = f.rows; dropped = f.dropped;
  }
  if (sort === "citations") rows = [...rows].sort((x, y) => (y.cited_by_count || 0) - (x.cited_by_count || 0));
  if (sort === "recent") rows = [...rows].sort((x, y) => (y.publication_year || 0) - (x.publication_year || 0));
  rows = rows.slice(0, limit);
  const tag = sort === "relevance" ? "" : ` (top 200 by relevance${dropped ? `, ${dropped} off-topic filtered` : ""})`;
  return { head: `openalex ${sort}${tag}: ${r.meta?.count ?? rows.length} hits`, items: rows.map((w) => ({ rec: recOA(w), text: abstract_chars > 0 && w.abstract_inverted_index ? clip(invertAbstract(w.abstract_inverted_index), abstract_chars) : "" })) };
}

function arxivQuery(q) {
  if (/\b(ti|au|abs|cat|all|co|jr):/.test(q)) return q;
  const phrases = [];
  const rest = q.replace(/"([^"]+)"/g, (_, p) => { phrases.push(`all:"${p}"`); return " "; });
  const words = rest.split(/\s+/).filter((w) => w.length > 1).map((w) => `all:${w}`);
  return [...phrases, ...words].join(" AND ");
}

function xmlText(s) {
  return (s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

async function searchArxiv({ query, limit, sort, abstract_chars, year }) {
  const u = new URL(ARXIV_API);
  u.search = new URLSearchParams({
    search_query: arxivQuery(query), start: "0", max_results: String(limit),
    sortBy: sort === "recent" ? "submittedDate" : "relevance", sortOrder: "descending",
  }).toString();
  const xml = await http(u.toString(), { ttl: DAY, as: "text" });
  const total = (xml.match(/<opensearch:totalResults[^>]*>(\d+)</) || [])[1];
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
  let rows = entries.map((e) => {
    const g = (tag) => xmlText((e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1]);
    const id = (g("id").match(ARXIV_NEW) || g("id").match(ARXIV_OLD) || [])[1];
    const authors = [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => xmlText(m[1]));
    const cat = (e.match(/<arxiv:primary_category[^>]*term="([^"]+)"/) || [])[1];
    return { id, title: oneLine(g("title")), year: g("published").slice(0, 4), authors, cat, journal: oneLine(g("arxiv:journal_ref")), doi: oneLine(g("arxiv:doi")), summary: oneLine(g("summary")) };
  });
  if (year) {
    const [a, b] = String(year).split("-");
    rows = rows.filter((r) => (!a || r.year >= a.slice(0, 4)) && (String(year).includes("-") ? (!b || r.year <= b) : r.year === a));
  }
  return { head: `arxiv ${sort === "recent" ? "recent" : "relevance"}: ${total ?? rows.length} hits`, items: rows.map((r) => ({ rec: recArxiv(r), text: abstract_chars > 0 ? clip(r.summary, abstract_chars) : "" })) };
}

async function toolSearch(a) {
  await refreshSurnames();
  const args = {
    query: String(a.query || "").trim(),
    source: ["auto", "s2", "openalex", "arxiv", "zotero"].includes(a.source) ? a.source : "auto",
    limit: Math.max(1, Math.min(Number(a.limit) || 10, 50)),
    year: a.year ? String(a.year) : "",
    sort: ["relevance", "citations", "recent"].includes(a.sort) ? a.sort : "relevance",
    venue: a.venue || "",
    open_access: !!a.open_access,
    abstract_chars: Math.max(0, Math.min(Number(a.abstract_chars) || 0, 1500)),
  };
  if (a.peer_reviewed) args.peer_reviewed = true;
  if (!args.query) throw new Error("query is required");
  if (args.peer_reviewed && args.source === "arxiv") throw new Error("peer_reviewed cannot be combined with source=arxiv");
  const prior = LEDGER.priorQuery(args);
  if (prior && !a.force) {
    return `${prior.id} is the same search, already run this session: ${prior.handles.length ? prior.handles.join(" ") : "no results"}. Use those handles, session(action="list") to see them again, or force=true to re-run.`;
  }
  const heads = [];
  const items = [];
  const online = async (src) => {
    if (src === "arxiv") return searchArxiv(args);
    if (src === "openalex") return searchOpenAlex(args);
    try { return await searchS2(args); }
    catch (e) {
      if (e.status !== 429 && e.status !== 0 && !(e.status >= 500)) throw e;
      const alt = await searchOpenAlex(args);
      alt.head = `s2 unavailable (${e.status || "network"}${CFG.s2Key ? ", key set" : ", no key"}), used ${alt.head}`;
      return alt;
    }
  };
  if (args.source === "auto" || args.source === "zotero") {
    try {
      const z = await zotSearchRecords(args.query, args.source === "zotero" ? args.limit : Math.min(5, args.limit), CFG.zoteroDir);
      heads.push(`zotero ${z.length}`);
      items.push(...z.map((rec) => ({ rec })));
    } catch (e) { heads.push(`zotero unavailable`); }
  }
  if (args.source !== "zotero") {
    const r = await online(args.source === "auto" ? "s2" : args.source);
    heads.push(r.head);
    items.push(...r.items);
    // Auto mode widens to OpenAlex only when Semantic Scholar returned little.
    if (args.source === "auto" && r.items.length < Math.ceil(args.limit / 2) && !r.head.startsWith("openalex") && !r.head.startsWith("s2 unavailable")) {
      try { const o = await searchOpenAlex(args); heads.push(o.head); items.push(...o.items); } catch {}
    }
  }
  const { handles, lines, published, preprints, hidden } = await renderItems(items, { peerReviewed: args.peer_reviewed });
  const fresh = lines.filter((l) => !l.includes(" (seen) ")).length;
  const id = LEDGER.recordQuery(args, handles, `${args.source} ${args.sort} "${args.query}"${args.year ? ` ${args.year}` : ""}${args.peer_reviewed ? " peer-reviewed" : ""}`);
  const pre = [published ? `${published} preprint${published > 1 ? "s" : ""} matched to the published version` : "", preprints ? `${preprints} preprint-only (prefer published work for claims)` : "", hidden ? `${hidden} preprint-only hidden` : ""].filter(Boolean).join(", ");
  return [`${id} ${heads.join("; ")}. ${handles.length} papers, ${fresh} new${pre ? `; ${pre}` : ""}`, ...lines].join("\n");
}

// ---------- paper details ----------
async function toolPaper(a) {
  await refreshSurnames();
  const ids = (Array.isArray(a.ids) ? a.ids : [a.ids]).filter(Boolean).slice(0, 50);
  if (!ids.length) throw new Error("ids is required");
  const detail = ["tldr", "abstract", "meta", "bibtex"].includes(a.detail) ? a.detail : "tldr";
  const parsed = [];
  for (const id of ids) { try { parsed.push(await resolveForS2(id)); } catch { parsed.push({ kind: "title", title: String(id) }); } }
  const s2ids = [];
  for (const p of parsed) {
    if (p.s2) s2ids.push(p.s2);
    else if (p.kind === "title" || p.kind === "openalex") {
      try { s2ids.push((await s2Resolve(p, "paperId")).paperId); } catch { s2ids.push(undefined); }
    }
    else s2ids.push(null);
  }
  let fields = LIST_FIELDS;
  if (detail === "tldr") fields += ",tldr";
  if (detail === "abstract") fields += ",abstract";
  if (detail === "meta") fields += ",tldr,fieldsOfStudy,referenceCount,influentialCitationCount,openAccessPdf,publicationDate,journal,url";
  if (detail === "bibtex") fields = "citationStyles,externalIds,title";
  const wanted = s2ids.filter(Boolean);
  let res;
  try {
    res = wanted.length ? await http(`${S2}/paper/batch?fields=${fields}`, { method: "POST", body: { ids: wanted } }) : [];
  } catch (e) {
    if (detail === "bibtex" || !(e.status === 429 || e.status === 0 || e.status >= 500)) throw e;
    return paperViaOpenAlex(ids, parsed, detail, e.message);
  }
  let k = 0;
  const out = [];
  parsed.forEach((p, i) => {
    if (s2ids[i] === null) { out.push(`${i + 1}. ${ids[i]}: a file or URL, not a paper id (use outline/read)`); return; }
    if (s2ids[i] === undefined) { out.push(`${i + 1}. ${ids[i]}: no matching paper found`); return; }
    const r = res[k++];
    if (!r) { out.push(`${i + 1}. ${ids[i]}: not found on Semantic Scholar`); return; }
    if (detail === "bibtex") { out.push(r.citationStyles?.bibtex || `% no BibTeX for ${ids[i]}`); return; }
    const { h } = LEDGER.register(recS2(r));
    let s = LEDGER.line(h, { full: true });
    if (detail === "tldr") s += `\n   TLDR: ${r.tldr?.text ? oneLine(r.tldr.text) : "(none; ask for detail=abstract)"}`;
    if (detail === "abstract") s += `\n   ${r.abstract ? oneLine(r.abstract) : "(no abstract available)"}`;
    if (detail === "meta") {
      s += `\n   date ${r.publicationDate || r.year || "?"}; refs ${r.referenceCount ?? "?"}; influential cites ${r.influentialCitationCount ?? "?"}; fields ${(r.fieldsOfStudy || []).join(", ") || "?"}`;
      if (r.journal?.name) s += `\n   journal ${r.journal.name}${r.journal.volume ? ` ${r.journal.volume}` : ""}${r.journal.pages ? `, ${oneLine(r.journal.pages)}` : ""}`;
      s += `\n   pdf ${r.openAccessPdf?.url || "none listed"}; ${r.url || ""}`;
      if (r.tldr?.text) s += `\n   TLDR: ${oneLine(r.tldr.text)}`;
    }
    out.push(s);
  });
  return out.join("\n");
}

async function paperViaOpenAlex(ids, parsed, detail, why) {
  const out = [`(Semantic Scholar unavailable: ${why}. Showing OpenAlex or arXiv records; no TLDRs, abstracts clipped to 600 characters.)`];
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    let path = null;
    if (p.doi) path = `/works/doi:${p.doi}`;
    else if (p.openalex) path = `/works/${p.openalex}`;
    try {
      if (p.arxiv) {
        const xml = await http(`${ARXIV_API}?id_list=${encodeURIComponent(p.arxiv)}`, { as: "text" });
        const e = (xml.match(/<entry>([\s\S]*?)<\/entry>/) || [])[1];
        if (!e) { out.push(`${i + 1}. ${ids[i]}: not found on arXiv`); continue; }
        const g = (tag) => oneLine(xmlText((e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1]));
        const authors = [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => xmlText(m[1]));
        let s = `${i + 1}. ${g("title")} | ${authorsShort(authors)} ${g("published").slice(0, 4)} | arXiv | ?c | arXiv:${p.arxiv} OA`;
        if (detail !== "meta") s += `\n   ${clip(g("summary"), detail === "abstract" ? 3000 : 600)}`;
        out.push(s);
        continue;
      }
      let w;
      if (path) w = await http(oaUrl(path));
      else if (p.kind === "title") w = (await http(oaUrl("/works", { filter: `title.search:${p.title.replace(/,/g, " ")}`, "per-page": "1" }))).results?.[0];
      if (!w) { out.push(`${i + 1}. ${ids[i]}: not found`); continue; }
      let s = lineOA(w, i + 1, 0, true);
      const abs = invertAbstract(w.abstract_inverted_index);
      if (detail !== "meta") s += `\n   ${abs ? clip(abs, detail === "abstract" ? 3000 : 600) : "(no abstract in OpenAlex)"}`;
      else s += `\n   date ${w.publication_date || w.publication_year}; type ${w.type}; pdf ${w.best_oa_location?.pdf_url || w.open_access?.oa_url || "none listed"}`;
      out.push(s);
    } catch (e) { out.push(`${i + 1}. ${ids[i]}: ${e.message}`); }
  }
  return out.join("\n");
}

// ---------- citation graph ----------
async function toolCitations(a) {
  await refreshSurnames();
  const p = await resolveForS2(a.id);
  const pid = p.s2 || (await s2Resolve(p, "paperId")).paperId;
  const dir = a.direction === "references" ? "references" : "citations";
  const limit = Math.max(1, Math.min(Number(a.limit) || 15, 100));
  const withCtx = !!a.contexts;
  const fields = `title,year,venue,citationCount,externalIds,authors,isOpenAccess,corpusId,isInfluential${withCtx ? ",contexts" : ""}`;
  const r = await http(`${S2}/paper/${encodeURIComponent(pid)}/${dir}?fields=${fields}&limit=${dir === "citations" ? 1000 : 1000}`, { ttl: 3 * DAY });
  let rows = (r.data || []).map((x) => ({ ...(x.citingPaper || x.citedPaper || {}), _inf: x.isInfluential, _ctx: x.contexts || [] })).filter((x) => x.title);
  if (a.influential_only) rows = rows.filter((x) => x._inf);
  if (a.year) {
    const [lo, hi] = String(a.year).includes("-") ? String(a.year).split("-") : [a.year, a.year];
    rows = rows.filter((x) => x.year && (!lo || x.year >= +lo) && (!hi || x.year <= +hi));
  }
  const sort = a.sort === "recent" ? "recent" : "citations";
  rows.sort((x, y) => (sort === "recent" ? (y.year || 0) - (x.year || 0) : (y.citationCount || 0) - (x.citationCount || 0)));
  const total = rows.length;
  rows = rows.slice(0, limit);
  const lines = rows.map((x, i) => {
    let s = lineS2(x, i + 1) + (x._inf ? " *influential" : "");
    if (withCtx && x._ctx.length) s += `\n   ctx: "${clip(oneLine(x._ctx[0]), 300)}"`;
    return s;
  });
  const capped = (r.data || []).length >= 1000 ? " (first 1000 fetched)" : "";
  return [`${dir === "citations" ? "Papers citing" : "References of"} ${a.id}: ${total}${capped}, sorted by ${sort}, showing ${rows.length}`, ...lines].join("\n");
}

// ---------- recommendations ----------
async function toolRecommend(a) {
  await refreshSurnames();
  const pos = (Array.isArray(a.ids) ? a.ids : [a.ids]).filter(Boolean).slice(0, 20);
  const neg = (Array.isArray(a.negative_ids) ? a.negative_ids : []).slice(0, 20);
  if (!pos.length) throw new Error("ids is required");
  const toPid = async (id) => { const p = await resolveForS2(id); return (await s2Resolve(p, "paperId")).paperId; };
  const positivePaperIds = await Promise.all(pos.map(toPid));
  const negativePaperIds = await Promise.all(neg.map(toPid));
  const limit = Math.max(1, Math.min(Number(a.limit) || 10, 50));
  const r = await http(`${S2_REC}/papers?fields=${LIST_FIELDS}&limit=${limit}`, { method: "POST", body: { positivePaperIds, negativePaperIds }, ttl: 3 * DAY });
  const rows = r.recommendedPapers || [];
  return [`Recommended from ${pos.length} seed paper(s): ${rows.length}`, ...rows.map((p, i) => lineS2(p, i + 1))].join("\n");
}

// ---------- authors ----------
async function toolAuthor(a) {
  await refreshSurnames();
  const q = String(a.query || "").trim();
  if (!q) throw new Error("query is required (a name or an S2 author id)");
  const limit = Math.max(1, Math.min(Number(a.limit) || 15, 100));
  let authorId = /^\d+$/.test(q) ? q : "";
  if (!authorId) {
    const r = await http(`${S2}/author/search?query=${encodeURIComponent(q)}&fields=name,affiliations,hIndex,paperCount,citationCount&limit=8`, { ttl: 7 * DAY });
    const rows = (r.data || []).sort((x, y) => (y.citationCount || 0) - (x.citationCount || 0));
    if (!rows.length) return `No author matches "${q}".`;
    if (!a.papers) {
      return [`Authors matching "${q}" (call author again with the numeric id to list papers):`,
        ...rows.map((x, i) => `${i + 1}. ${x.name} | id ${x.authorId} | h${x.hIndex ?? "?"} | ${x.paperCount ?? "?"} papers | ${x.citationCount ?? "?"}c${x.affiliations?.length ? ` | ${clip(x.affiliations.join("; "), 60)}` : ""}`)].join("\n");
    }
    authorId = rows[0].authorId;
  }
  const info = await http(`${S2}/author/${authorId}?fields=name,affiliations,hIndex,paperCount,citationCount`, { ttl: 7 * DAY });
  const r = await http(`${S2}/author/${authorId}/papers?fields=${LIST_FIELDS}&limit=1000`, { ttl: 3 * DAY });
  let rows = r.data || [];
  const sort = a.sort === "recent" ? "recent" : "citations";
  rows.sort((x, y) => (sort === "recent" ? (y.year || 0) - (x.year || 0) : (y.citationCount || 0) - (x.citationCount || 0)));
  return [`${info.name} (id ${authorId}, h${info.hIndex ?? "?"}, ${info.paperCount ?? rows.length} papers, ${info.citationCount ?? "?"}c) sorted by ${sort}, showing ${Math.min(limit, rows.length)}`,
    ...rows.slice(0, limit).map((p, i) => lineS2(p, i + 1))].join("\n");
}

// ---------- full text ----------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", times: "×", minus: "−" };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}

function htmlToSections(html) {
  let h = html;
  const docTitle = oneLine(decodeEntities(((h.match(/<h1[^>]*ltx_title_document[^>]*>([\s\S]*?)<\/h1>/i) || h.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "").replace(/<[^>]+>/g, " ")));
  h = h.replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<(script|style|nav|header|footer|button|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<math[^>]*alttext="([^"]*)"[\s\S]*?<\/math>/gi, (_, t) => ` $${decodeEntities(t)}$ `)
    .replace(/<math[\s\S]*?<\/math>/gi, " [math] ")
    .replace(/<div[^>]*ltx_page_footer[\s\S]*$/i, " ");
  h = h.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lvl, inner) => `\n\n\u0001${lvl}${oneLine(decodeEntities(inner.replace(/<[^>]+>/g, " ")))}\n\n`);
  h = h.replace(/<\/(p|div|li|tr|figcaption|table|section|blockquote|dd|dt)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ").replace(/<li[^>]*>/gi, "\n- ").replace(/<[^>]+>/g, " ");
  const text = decodeEntities(h).replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n");
  const sections = [];
  let cur = { level: 1, title: "Front matter", text: "" };
  for (const part of text.split("\n")) {
    if (part.startsWith("\u0001")) {
      if (cur.text.trim() || cur.title !== "Front matter") sections.push(cur);
      const lvl = Number(part[1]);
      const title = part.slice(2).trim() || "(untitled)";
      cur = { level: /^abstract$/i.test(title) ? 1 : Math.min(4, Math.max(1, lvl - 1)), title, text: "" };
      if (lvl === 1 && docTitle && part.slice(2).trim() === docTitle) cur.title = "Title";
    } else cur.text += part + "\n";
  }
  sections.push(cur);
  return { title: docTitle, sections: sections.map((s) => ({ ...s, text: s.text.replace(/\n{3,}/g, "\n\n").trim() })).filter((s) => s.text || s.title !== "Front matter") };
}

const NAMED_HEAD = /^(abstract|introduction|background|related work|literature review|methodology|methods?|materials and methods|approach|experiments?|experimental (setup|results)|evaluation|results( and discussion)?|discussion|limitations|conclusions?( and future work)?|future work|references|bibliography|acknowledge?ments?|appendix( [a-z])?|keywords|declaration of competing interest|data availability)$/i;
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

function pdfTextToSections(pages) {
  const norm = (l) => l.trim().replace(/\d+/g, "#").toLowerCase();
  const edgeCount = {};
  const pageLines = pages.map((pg) => pg.replace(/\r/g, "").split("\n"));
  for (const ls of pageLines) {
    const edges = new Set([...ls.slice(0, 3), ...ls.slice(-3)].map(norm).filter((x) => x.length > 3));
    for (const e of edges) edgeCount[e] = (edgeCount[e] || 0) + 1;
  }
  const minRep = Math.max(3, Math.ceil(pages.length * 0.3));
  const cleaned = pageLines.map((ls) => ls.filter((l, i) => !((i < 3 || i >= ls.length - 3) && (edgeCount[norm(l)] || 0) >= minRep)).join("\n"));
  let text = cleaned.join("\n\n").replace(/-\n(?=[a-z])/g, "");
  const lines = text.split("\n").map((l) => l.trim());
  const sections = [];
  let cur = { level: 1, title: "Front matter", text: "" };
  let lastTop = 0;
  const push = () => { if (cur.text.trim() || cur.title !== "Front matter") sections.push(cur); };
  for (const line of lines) {
    let head = null;
    const m = line.match(/^(\d{1,2})((?:\.\d{1,2}){0,2})\.?\s+([A-Z][^]{2,90})$/);
    const r = line.match(/^([IVX]{1,4})\.\s+([A-Z][^]{2,90})$/);
    const words = line.split(/\s+/).length;
    const affiliation = /,.*,|;|@|universit|institut|department|school of|laborator|college|e-?mail|correspond/i;
    if (m && words <= 14 && !/[.:;,]$/.test(m[3]) && !/\d{2,}\s*$/.test(m[3]) && !affiliation.test(m[3])) {
      const top = Number(m[1]);
      const sub = m[2];
      if ((!sub && (top === lastTop + 1 || (lastTop === 0 && top <= 2))) || (sub && top === lastTop)) {
        head = { level: 1 + (sub ? sub.split(".").length - 1 : 0), title: line };
        if (!sub) lastTop = top;
      }
    } else if (r && words <= 14 && !/[.:;,]$/.test(r[2])) {
      const top = ROMAN.indexOf(r[1]) + 1;
      if (top === lastTop + 1) { head = { level: 1, title: line }; lastTop = top; }
    } else if (/^[A-Z]/.test(line) && NAMED_HEAD.test(line.replace(/[:.]$/, ""))) {
      head = { level: 1, title: line.replace(/[:.]$/, "") };
      if (/^abstract/i.test(head.title)) lastTop = 0;
    }
    if (head) { push(); cur = { ...head, text: "" }; }
    else cur.text += line + "\n";
  }
  push();
  const front = sections[0]?.title === "Front matter" ? sections[0].text.trim().split("\n")[0] : "";
  pdfTextToSections.lastTitle = front && front.length < 200 && !/editor|journal|received|accepted|doi|copyright|http|licen[cs]e|citation:|vol\.|volume/i.test(front) ? front : "";
  // Join wrapped prose lines, but keep table rows (lines with " | ") on their own lines as a block.
  const joinLines = (text) => {
    const out = [];
    for (const l of text.split("\n")) {
      const isRow = (l.match(/ \| /g) || []).length >= 1;
      const prev = out[out.length - 1];
      if (!l.trim()) { out.push(""); continue; }
      if (isRow) { if (prev !== undefined && prev !== "" && !prev.startsWith("\u0002")) out.push(""); out.push("\u0002" + l); continue; }
      const caption = /^(Table|Tab\.|TABLE)\s*[0-9IVX]+/.test(l);
      if (caption && prev !== undefined && prev !== "") { out.push(""); out.push(l); continue; }
      if (prev === undefined || prev === "" || prev.startsWith("\u0002")) { if (prev?.startsWith("\u0002")) out.push(""); out.push(l); }
      else out[out.length - 1] = prev + " " + l;
    }
    return out.join("\n").replace(/\u0002/g, "").replace(/\n{3,}/g, "\n\n").replace(/ {2,}/g, " ").trim();
  };
  return sections.map((s) => ({ ...s, text: joinLines(s.text) }));
}

// Rebuild lines from positioned text items in content-stream order (safe for two-column layouts).
// A wide horizontal gap on the same line becomes " | ", so table rows survive as rows.
function pageLines(items) {
  const lines = [];
  let cur = "", lastY = null, lastEnd = null, lastH = 10;
  for (const it of items) {
    if (typeof it.str !== "string") continue;
    const x = it.transform[4], y = it.transform[5];
    const h = Math.abs(it.transform[3]) || it.height || lastH;
    if (lastY !== null && Math.abs(y - lastY) > Math.max(2, h * 0.4)) { lines.push(cur); cur = ""; lastEnd = null; }
    if (it.str.trim()) {
      if (lastEnd !== null) {
        const gap = x - lastEnd;
        if (gap > h * 1.6) cur += " | ";
        else if (gap > h * 0.15 && !cur.endsWith(" ") && !it.str.startsWith(" ")) cur += " ";
      }
      cur += it.str;
      lastEnd = x + (it.width || 0);
      lastY = y; lastH = h;
    }
    if (it.hasEOL) { lines.push(cur); cur = ""; lastEnd = null; lastY = null; }
  }
  if (cur) lines.push(cur);
  return lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

async function pdfToSections(buf) {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    pages.push(pageLines(tc.items));
  }
  if (pages.join("").replace(/\s/g, "").length < 200) throw new Error("the PDF has no extractable text (probably scanned)");
  return pdfTextToSections(pages);
}

function looksLikeHtml(buf) { return /^\s*(<!doctype html|<html)/i.test(buf.subarray(0, 500).toString("utf8")); }

async function sectionsFromUrl(url) {
  const buf = await http(url, { as: "buffer", ttl: 30 * DAY });
  if (buf.subarray(0, 5).toString() === "%PDF-") return { format: "pdf", ...(await pdfToSectionsWrapped(buf)) };
  if (looksLikeHtml(buf)) return { format: "html", ...htmlToSections(buf.toString("utf8")) };
  return { format: "text", title: "", sections: [{ level: 1, title: "Text", text: buf.toString("utf8") }] };
}
async function pdfToSectionsWrapped(buf) { const sections = await pdfToSections(buf); return { title: pdfTextToSections.lastTitle || "", sections }; }

async function loadFullText(rawId) {
  let p = parseId(rawId);
  // The project's own papers folder comes first: it is local, complete and needs no lookups.
  if (p.kind === "handle" && libraryFile(p.h)) return loadFullTextParsed({ kind: "file", path: libraryFile(p.h) });
  if (p.kind === "handle") {
    const id = LEDGER.bestId(p.h, "read");
    if (!id) throw new Error(`${p.h} is not in this session`);
    p = parseId(id);
  }
  let zot = null;
  // Prefer the user's own Zotero PDF when the paper is in the library.
  if (["doi", "arxiv", "title"].includes(p.kind)) {
    const z = await zotLookup({ doi: p.doi || "", arxiv: p.arxiv || "" }, p.title || "", CFG.zoteroDir).catch(() => null);
    if (z?.ids?.zot && (z.local === "PDF" || z.local === "file" || z.local === "text")) p = { kind: "zotero", key: z.ids.zot };
  }
  if (p.kind === "zotero") {
    zot = await zoteroResolve(p.key, CFG.zoteroDir);
    zot.key = p.key;
    if (zot.path && existsSync(zot.path)) p = { kind: "file", path: zot.path };
    else if (zot.arxiv || zot.doi) p = parseId(zot.arxiv ? `arXiv:${zot.arxiv}` : zot.doi);
    else if (zot.ftcache) p = { kind: "ftcache", path: zot.ftcache, zotero: p.key, title: zot.title };
    else if (zot.title) p = parseId(zot.title);
    else throw new Error(`Zotero item ${p.key} has no attachment or identifier`);
  }
  try {
    const doc = await loadFullTextParsed(p);
    if (zot?.title) doc.title = zot.title;
    return doc;
  } catch (e) {
    if (zot?.ftcache && p.kind !== "ftcache") return loadFullTextParsed({ kind: "ftcache", path: zot.ftcache, zotero: zot.key, title: zot.title });
    throw e;
  }
}

async function loadFullTextParsed(p) {
  const rawId = p.path || p.url || p.arxiv || p.doi || p.title || p.openalex || p.s2;
  const key = sha(PARSER_VERSION + JSON.stringify(p));
  const cpath = join(CFG.cacheDir, "text", key + ".json");
  if (existsSync(cpath)) return JSON.parse(readFileSync(cpath, "utf8"));
  const tried = [];
  let doc = null, meta = null;

  if (p.kind === "ftcache") {
    doc = { format: "zotero-text", title: p.title || "", sections: [{ level: 1, title: "Full text (Zotero index, no section headings)", text: readFileSync(p.path, "utf8").replace(/\n{3,}/g, "\n\n") }], source: `zot:${p.zotero}` };
  } else if (p.kind === "file") {
    const buf = readFileSync(p.path);
    const ext = extname(p.path).toLowerCase();
    if (ext === ".pdf" || buf.subarray(0, 5).toString() === "%PDF-") doc = { format: "pdf", ...(await pdfToSectionsWrapped(buf)), source: p.path };
    else if (ext === ".html" || ext === ".htm") doc = { format: "html", ...htmlToSections(buf.toString("utf8")), source: p.path };
    else doc = { format: "text", title: "", sections: [{ level: 1, title: "Text", text: buf.toString("utf8") }], source: p.path };
  } else if (p.kind === "url") {
    doc = { ...(await sectionsFromUrl(p.url)), source: p.url };
  } else {
    let arxiv = p.arxiv, pdfUrl = null, doi = p.doi;
    if (!arxiv) {
      try {
        meta = await s2Resolve(p);
        arxiv = meta.externalIds?.ArXiv;
        doi = doi || meta.externalIds?.DOI;
        pdfUrl = meta.openAccessPdf?.url || null;
      } catch (e) { tried.push(`S2 lookup: ${e.message}`); }
    }
    const candidates = [];
    if (arxiv) candidates.push(`https://arxiv.org/html/${arxiv}`, `https://ar5iv.labs.arxiv.org/html/${arxiv}`, `https://arxiv.org/pdf/${arxiv}`);
    if (pdfUrl) candidates.push(pdfUrl);
    if (doi || p.openalex) {
      try {
        const w = await http(oaUrl(`/works/${p.openalex || "doi:" + doi}`, { select: "best_oa_location,open_access,title" }));
        if (!meta && w.title) meta = { title: w.title };
        const found = [w.best_oa_location?.pdf_url, w.open_access?.oa_url].filter(Boolean);
        for (const u of found) if (!candidates.includes(u)) candidates.push(u);
        if (!found.length) tried.push("OpenAlex: no open copy listed");
      } catch (e) { tried.push(`OpenAlex OA lookup: ${e.message}`); }
    }
    if (doi && CFG.mailto) {
      try {
        const u = await http(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(CFG.mailto)}`, { ttl: 14 * DAY });
        const locs = [u.best_oa_location, ...(u.oa_locations || [])].filter(Boolean);
        for (const l of locs) for (const x of [l.url_for_pdf, l.url]) if (x && !candidates.includes(x)) candidates.push(x);
        if (!locs.length) tried.push("Unpaywall: no open copy");
      } catch (e) { tried.push(`Unpaywall: ${e.message}`); }
    } else if (doi) tried.push("Unpaywall: skipped (no contact email set)");
    // Publisher PDF via the DOI landing page: works for open articles and, on campus or VPN, for subscribed ones.
    if (doi) candidates.push(`publisher:${doi}`);
    for (let url of candidates) {
      try {
        if (url.startsWith("publisher:")) {
          const landing = `https://doi.org/${url.slice(10)}`;
          const buf = await http(landing, { as: "buffer", ttl: 30 * DAY, headers: { accept: "text/html,application/pdf" } });
          if (buf.subarray(0, 5).toString() === "%PDF-") url = landing;
          else {
            const html = buf.toString("utf8");
            const m = html.match(/<meta[^>]+name=["']citation_pdf_url["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']citation_pdf_url["']/i);
            if (!m) { tried.push("publisher page: no PDF link (paywalled or script-only page)"); continue; }
            url = decodeEntities(m[1]);
          }
        }
        const d = await sectionsFromUrl(url);
        const chars = d.sections.reduce((n, s) => n + s.text.length, 0);
        if (chars < 1500) { tried.push(`${url}: too little text (likely a landing page)`); continue; }
        doc = { ...d, source: url };
        break;
      } catch (e) { tried.push(`${url}: ${e.message}`); }
    }
    if (!doc) {
      const lib = doi && CFG.proxy ? ` Library access: ${CFG.proxy}${encodeURIComponent(`https://doi.org/${doi}`)} (open it in a browser signed in to the library, save the PDF to Zotero, then read it by handle).` : "";
      throw new Error(`No open full text found for ${rawId}.${tried.length ? " Tried: " + tried.map((t) => clip(t, 120)).join("; ") + "." : ""}${lib} Otherwise use paper(detail=abstract).`);
    }
    if (meta?.title) doc.title = meta.title;
  }
  doc.sections = doc.sections.filter((s) => s.text.length > 0 || s.level <= 2);
  try { writeFileSync(cpath, JSON.stringify(doc)); } catch {}
  return doc;
}

async function toolOutline(a) {
  const doc = await loadFullText(a.id);
  const total = doc.sections.reduce((n, s) => n + s.text.length, 0);
  const lines = doc.sections.map((s, i) => `§${i + 1} ${"  ".repeat(Math.max(0, s.level - 1))}${clip(s.title, 90)} (~${tok(s.text.length)})`);
  return [`${doc.title ? clip(oneLine(doc.title), 150) + " " : ""}[${doc.format} from ${doc.source}] ~${tok(total)} tokens in ${doc.sections.length} sections`, ...lines,
    "Next: read(id, sections=[...]) or read(id, query=...)."].join("\n");
}

function pickSections(doc, specs) {
  if (!specs || !specs.length) return doc.sections.map((_, i) => i);
  const out = new Set();
  for (const raw of specs) {
    const s = String(raw).trim().replace(/^§/, "");
    let m;
    if ((m = s.match(/^(\d+)\s*-\s*(\d+)$/))) { for (let i = +m[1]; i <= +m[2]; i++) if (doc.sections[i - 1]) out.add(i - 1); continue; }
    if (/^\d+$/.test(s) && doc.sections[+s - 1]) { out.add(+s - 1); continue; }
    const needle = s.toLowerCase();
    doc.sections.forEach((sec, i) => { if (sec.title.toLowerCase().includes(needle)) out.add(i); });
  }
  return [...out].sort((x, y) => x - y);
}

async function toolRead(a) {
  const doc = await loadFullText(a.id);
  const idx = pickSections(doc, Array.isArray(a.sections) ? a.sections : a.sections ? [a.sections] : []);
  if (!idx.length) return `No section matches ${JSON.stringify(a.sections)}. Call outline first.`;
  const maxChars = Math.max(500, Math.min(Number(a.max_tokens) || 3000, 20000)) * 4;
  const full = idx.map((i) => `## §${i + 1} ${doc.sections[i].title}\n${doc.sections[i].text}`).join("\n\n");
  const hp = parseId(a.id);
  if (hp.kind === "handle") LEDGER.markRead(hp.h, idx.map((i) => `§${i + 1}`));
  const offset = Math.max(0, Number(a.offset) || 0);
  const chunk = full.slice(offset, offset + maxChars);
  const more = offset + maxChars < full.length ? `\n[truncated at char ${offset + maxChars} of ${full.length}; continue with offset=${offset + maxChars}]` : "";
  return chunk + more;
}

const STOP = new Set("a an the of and or in on for to with by from as at is are was were be been this that these those it its we our their which using use based via into than then also can may how what when where why does do".split(" "));
function terms(s) { return (s.toLowerCase().match(/[a-z0-9][a-z0-9\-]*/g) || []).filter((w) => !STOP.has(w) && w.length > 1); }

function passages(doc) {
  const out = [];
  doc.sections.forEach((sec, si) => {
    const paras = sec.text.split(/\n{2,}/);
    // Merge a table caption with the table block that follows it.
    for (let i = 0; i < paras.length - 1; i++) {
      if (/^(Table|Tab\.|TABLE)\s*[0-9IVX]+/.test(paras[i].trim()) && (paras[i + 1].match(/ \| /g) || []).length >= 2) { paras[i] = paras[i] + "\n" + paras[i + 1]; paras.splice(i + 1, 1); }
    }
    for (const para of paras) {
      const p = para.trim();
      if ((p.match(/ \| /g) || []).length >= 2) { out.push({ si, text: p.slice(0, 2500), table: true }); continue; }
      if (p.length < 40) continue;
      if (p.length <= 1200) { out.push({ si, text: p }); continue; }
      const sentences = p.split(/(?<=[.!?])\s+/).map((x) => x + " ");
      let buf = "";
      for (const s of sentences) { if ((buf + s).length > 900 && buf) { out.push({ si, text: buf.trim() }); buf = ""; } buf += s; }
      if (buf.trim()) out.push({ si, text: buf.trim() });
    }
  });
  return out;
}

async function toolFind(a) {
  const doc = await loadFullText(a.id);
  const q = String(a.query || "").trim();
  if (!q) throw new Error("query is required");
  const qt = [...new Set(terms(q))];
  const ps = passages(doc);
  const N = ps.length || 1;
  const df = Object.fromEntries(qt.map((t) => [t, ps.filter((p) => p.text.toLowerCase().includes(t)).length]));
  const phrase = q.toLowerCase();
  const scored = ps.map((p) => {
    const low = p.text.toLowerCase();
    let score = 0, hit = 0;
    for (const t of qt) {
      const c = low.split(t).length - 1;
      if (c) { hit++; score += (1 + Math.log(c)) * Math.log(1 + N / (1 + df[t])); }
    }
    if (qt.length > 1) score *= 0.5 + hit / qt.length;
    if (phrase.length > 6 && low.includes(phrase)) score *= 2;
    if (/^(references|bibliography)/i.test(doc.sections[p.si].title)) score *= 0.3;
    if (p.table && /\b(table|result|score|accuracy|recall|precision|f1|ndcg|mrr|bleu|rouge|%|compar|baseline)/i.test(q)) score *= 2;
    return { ...p, score };
  }).filter((p) => p.score > 0).sort((x, y) => y.score - x.score);
  const k = Math.max(1, Math.min(Number(a.max_hits) || 5, 20));
  if (!scored.length) return `No passage in ${a.id} matches "${q}". Try other terms or outline.`;
  return [`${scored.length} matching passages for "${q}", top ${Math.min(k, scored.length)}:`,
    ...scored.slice(0, k).map((p, i) => `[${i + 1}] §${p.si + 1} ${clip(doc.sections[p.si].title, 60)}${p.table ? " (table)" : ""}\n${p.table ? p.text.slice(0, 2000) : clip(p.text, 1000)}`)].join("\n\n");
}

// ---------- code repositories (find only, never explored) ----------
const GH = "https://api.github.com";
const ghHeaders = { accept: "application/vnd.github+json" };
function ghRepos(text) {
  const out = [];
  for (const m of String(text || "").matchAll(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g)) {
    const r = `${m[1]}/${m[2].replace(/\.(git|html)$/, "").replace(/[.,;)]+$/, "")}`;
    if (!/^(features|topics|orgs|about|pricing|sponsors|marketplace)\//i.test(r) && !out.includes(r)) out.push(r);
  }
  return out;
}
async function toolCode(a) {
  const ids = (Array.isArray(a.ids) ? a.ids : [a.ids]).filter(Boolean).slice(0, 10);
  if (!ids.length) throw new Error("ids is required");
  const lines = [];
  for (const raw of ids) {
    const p0 = parseId(raw);
    const h = p0.kind === "handle" ? p0.h : null;
    let title = h ? LEDGER.get(h)?.title : "", arxiv = h ? LEDGER.get(h)?.ids.arxiv : p0.arxiv;
    const found = new Map(); // repo -> source
    // 1. Links written in the paper itself (full text if reachable, otherwise the abstract).
    try { const doc = await loadFullText(raw); if (!title) title = doc.title; for (const r of ghRepos(doc.sections.map((s) => s.text).join("\n"))) if (!found.has(r)) found.set(r, "paper"); } catch {}
    // 2. Hugging Face paper page, for arXiv papers.
    if (arxiv) try { const hf = await http(`https://huggingface.co/api/papers/${arxiv}`, { ttl: 7 * DAY }); for (const r of ghRepos(hf.githubRepo || "")) if (!found.has(r)) found.set(r, "huggingface"); } catch {}
    // 3. Repositories whose README quotes the exact title (official code or reimplementations).
    if (found.size < 2 && title) try {
      const r = await http(`${GH}/search/repositories?q=${encodeURIComponent(`"${title.slice(0, 120)}" in:readme`)}&sort=stars&per_page=3`, { ttl: 7 * DAY, headers: ghHeaders });
      const listy = /awesome|survey|papers?[-_]?(list|daily|reading)|reading[-_]?list|daily|digest|blog|prompt|llmsurvey|collection|resources|curated/i;
      for (const it of r.items || []) {
        if (listy.test(it.full_name) || listy.test(it.description || "")) continue;
        if (!found.has(it.full_name)) found.set(it.full_name, "readme cites title");
      }
    } catch {}
    const label = h || String(raw);
    if (!found.size) { lines.push(`${label}: no code repository found`); continue; }
    const repos = [];
    for (const [r, src] of [...found].slice(0, 3)) {
      try {
        const g = await http(`${GH}/repos/${r}`, { ttl: 7 * DAY, headers: ghHeaders });
        repos.push(`${g.full_name} ★${g.stargazers_count} ${g.language || "?"} ${String(g.pushed_at || "").slice(0, 7)} (${src})${g.archived ? " archived" : ""}`);
      } catch (e) { repos.push(`${r} (${src}${e.status === 404 ? ", not found" : ""})`); }
    }
    if (h) LEDGER.get(h).repos = repos.map((x) => x.split(" ")[0]);
    lines.push(`${label}${title ? ` ${clip(title, 50)}` : ""}\n   ${repos.join("\n   ")}`);
  }
  return lines.join("\n") + "\nRepositories are listed only; open one only when asked.";
}

// ---------- figures ----------
async function pdfBufferFor(id) {
  const doc = await loadFullText(id);
  let src = doc.source || "";
  if (doc.format !== "pdf") {
    const ax = src.match(/(?:arxiv\.org|ar5iv\.labs\.arxiv\.org)\/html\/([^/?#]+)/);
    if (!ax) throw new Error("Figures need a PDF; this full text came from HTML without a PDF version.");
    src = `https://arxiv.org/pdf/${ax[1]}`;
  }
  return { buf: src.startsWith("/") ? readFileSync(src) : await http(src, { as: "buffer", ttl: 30 * DAY }), src };
}

async function toolFigure(a) {
  if (!a.figure && !a.page) throw new Error("give figure (e.g. \"3\") or page (number)");
  const { buf, src } = await pdfBufferFor(a.id);
  const r = await renderFigure(buf, { figure: a.figure, page: a.page });
  const tokens = Math.round((r.width * r.height) / 750);
  const what = a.figure ? `Figure ${a.figure}${r.full ? " (caption found, crop failed: full page)" : ""}` : `Page ${r.page}`;
  return { content: [
    { type: "text", text: `${what}, page ${r.page}, ${r.width}x${r.height}px (~${tokens} tokens) from ${src}${r.caption ? `\nCaption (from the PDF text): ${r.caption}` : ""}` },
    { type: "image", data: r.png.toString("base64"), mimeType: "image/png" },
  ] };
}

// ---------- BibTeX export ----------
const BIB_STOP = new Set("a an the of on in for and to with from towards toward via using".split(" "));
const asciiFold = (s) => (s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]/g, "");
function makeKey(last, year, title, used) {
  const w = (title || "").split(/\s+/).map((x) => asciiFold(x).toLowerCase()).find((x) => x && !BIB_STOP.has(x)) || "paper";
  const base = `${asciiFold(last).toLowerCase() || "anon"}${year || ""}${w}`;
  let k = base, n = 0;
  while (used.has(k)) k = base + String.fromCharCode(97 + n++);
  used.add(k);
  return k;
}
const bibEsc = (s) => String(s || "").replace(/([&%#_$])/g, "\\$1").replace(/\s+/g, " ").trim();
function bibEntry(type, key, fields) {
  const body = Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `  ${k} = {${v}}`).join(",\n");
  return `@${type}{${key},\n${body}\n}`;
}
function zotToBib(z, key) {
  const f = z.f;
  const names = (t) => z.cre.filter((c) => c.type === t).map((c) => (c.first ? `${bibEsc(c.last)}, ${bibEsc(c.first)}` : `{${bibEsc(c.last)}}`)).join(" and ");
  const common = { author: names("author") || names("editor") || "", title: `{${bibEsc(f.title)}}`, year: z.year, doi: f.DOI || "", url: f.DOI ? "" : f.url || "" };
  switch (z.type) {
    case "journalArticle": return bibEntry("article", key, { ...common, journal: bibEsc(f.publicationTitle), volume: f.volume, number: f.issue, pages: (f.pages || "").replace(/-+/g, "--") });
    case "conferencePaper": return bibEntry("inproceedings", key, { ...common, booktitle: bibEsc(f.proceedingsTitle || f.conferenceName), pages: (f.pages || "").replace(/-+/g, "--"), publisher: bibEsc(f.publisher) });
    case "bookSection": return bibEntry("incollection", key, { ...common, booktitle: bibEsc(f.bookTitle), editor: names("editor"), publisher: bibEsc(f.publisher), pages: (f.pages || "").replace(/-+/g, "--") });
    case "book": return bibEntry("book", key, { ...common, publisher: bibEsc(f.publisher), edition: f.edition, address: bibEsc(f.place) });
    case "thesis": return bibEntry("phdthesis", key, { ...common, school: bibEsc(f.university) });
    case "report": return bibEntry("techreport", key, { ...common, institution: bibEsc(f.institution || f.publisher), number: f.reportNumber });
    default: {
      const ax = z.arxiv;
      return bibEntry("misc", key, { ...common, ...(ax ? { eprint: ax, archivePrefix: "arXiv" } : {}), howpublished: bibEsc(f.repository || f.publicationTitle || f.publisher) });
    }
  }
}

async function toolBibtex(a) {
  const st = LEDGER.ensure();
  let hs = Array.isArray(a.handles) && a.handles.length ? a.handles.map((h) => String(h).toUpperCase()) : Object.keys(st.papers).filter((h) => st.papers[h].status === (a.status || "kept"));
  hs = hs.filter((h) => st.papers[h]);
  if (!hs.length) return `No papers to export (status ${a.status || "kept"}). Mark papers with session(action="note", status="kept") first, or pass handles.`;
  const used = new Set();
  const entries = [], keys = [], failed = [];
  for (const h of hs) {
    const p = st.papers[h];
    try {
      let entry = null, key = null;
      if (p.ids.zot) {
        const z = await zotBibData(p.ids.zot, CFG.zoteroDir);
        if (z) {
          key = z.citekey && !used.has(z.citekey) ? z.citekey : makeKey(z.cre[0]?.last || p.lasts?.[0], z.year || p.year, z.f.title || p.title, used);
          used.add(key);
          entry = zotToBib(z, key);
        }
      }
      if (!entry && p.ids.doi && !/^10\.48550\//i.test(p.ids.doi)) {
        const raw = await http(`https://doi.org/${encodeURI(p.ids.doi)}`, { as: "text", ttl: 30 * DAY, headers: { accept: "application/x-bibtex; charset=utf-8" } });
        if (/^\s*@/.test(raw)) {
          key = makeKey(p.lasts?.[0], p.year, p.title, used);
          const type = (raw.match(/^\s*@(\w+)/) || [])[1] || "article";
          const fl = {};
          for (const m of raw.matchAll(/(\w+)\s*=\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) fl[m[1].toLowerCase()] = m[2];
          const esc = (v) => String(v || "").replace(/\\?([&%#])/g, "\\$1").replace(/[–—]/g, "--").replace(/\s+/g, " ").trim();
          entry = bibEntry(type.toLowerCase(), key, { author: esc(fl.author), title: `{${esc(fl.title).replace(/^\{|\}$/g, "")}}`, year: fl.year, journal: esc(fl.journal), booktitle: esc(fl.booktitle), volume: fl.volume, number: fl.number, pages: esc(fl.pages), publisher: esc(fl.publisher), doi: fl.doi || p.ids.doi });
        }
      }
      if (!entry && p.ids.arxiv) {
        const xml = await http(`${ARXIV_API}?id_list=${encodeURIComponent(p.ids.arxiv)}`, { as: "text", ttl: 30 * DAY });
        const e = (xml.match(/<entry>([\s\S]*?)<\/entry>/) || [])[1] || "";
        const authors = [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => { const n = xmlText(m[1]).trim().split(/\s+/); const last = n.pop(); return `${bibEsc(last)}, ${bibEsc(n.join(" "))}`; });
        const cat = (e.match(/<arxiv:primary_category[^>]*term="([^"]+)"/) || [])[1];
        key = makeKey(p.lasts?.[0], p.year, p.title, used);
        entry = bibEntry("misc", key, { author: authors.join(" and "), title: `{${bibEsc(p.title)}}`, year: p.year, eprint: p.ids.arxiv, archivePrefix: "arXiv", primaryClass: cat, url: `https://arxiv.org/abs/${p.ids.arxiv}` });
      }
      if (!entry) {
        key = makeKey(p.lasts?.[0], p.year, p.title, used);
        entry = bibEntry("misc", key, { author: (p.lasts || []).join(" and "), title: `{${bibEsc(p.title)}}`, year: p.year, howpublished: bibEsc(p.venue) });
        failed.push(h);
      }
      p.citekey = key;
      entries.push(entry);
      keys.push(`${h} ${key}`);
    } catch (e) { failed.push(`${h} (${e.message})`); }
  }
  const out = a.path ? (a.path.startsWith("~") ? join(homedir(), a.path.slice(1)) : a.path) : join(homedir(), "Downloads", `${st.name.replace(/[^a-z0-9_-]+/gi, "-")}.bib`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, entries.join("\n\n") + "\n");
  return `Wrote ${entries.length} BibTeX entries to ${out}.\nKeys: ${keys.join("; ")}${failed.length ? `\nMinimal entries (check by hand): ${failed.join(" ")}` : ""}`;
}

// ---------- MCP plumbing ----------
const S = (props, required = []) => ({ type: "object", properties: props, required });
const ID_HELP = "session handle P12, zot:KEY, arXiv id, DOI, CorpusId:N, S2 id, OpenAlex W-id, URL, local file path, or an exact title";
// Fill missing citation counts server-side (no tokens) before assigning roles.
async function fillCitations() {
  const st = LEDGER.ensure();
  const miss = Object.keys(st.papers).filter((h) => st.papers[h].cites == null).slice(0, 100);
  if (!miss.length) return;
  const ids = miss.map((h) => { const i = st.papers[h].ids; return i.arxiv ? `ARXIV:${i.arxiv}` : i.doi ? `DOI:${i.doi}` : i.corpus ? `CorpusId:${i.corpus}` : null; });
  const want = miss.map((h, k) => [h, ids[k]]).filter(([, id]) => id);
  try {
    const res = await http(`${S2}/paper/batch?fields=citationCount,year`, { method: "POST", body: { ids: want.map(([, id]) => id) }, ttl: 7 * DAY });
    want.forEach(([h], k) => { const r = res[k]; if (r?.citationCount != null) { st.papers[h].cites = r.citationCount; st.papers[h].year ||= r.year; } });
  } catch {
    for (const [h] of want.slice(0, 25)) {
      const i = st.papers[h].ids;
      const doi = i.doi || (i.arxiv ? `10.48550/arxiv.${i.arxiv}` : "");
      if (!doi) continue;
      try { const w = await http(oaUrl(`/works/doi:${doi}`, { select: "cited_by_count,publication_year" }), { ttl: 7 * DAY }); st.papers[h].cites = w.cited_by_count; st.papers[h].year ||= w.publication_year; } catch {}
    }
  }
}
const ID = { type: "string", description: ID_HELP };
const IDS = { type: "array", items: { type: "string" }, description: "handles (P12) or other ids" };
const TOOLS = [
  { name: "search", description: "Find papers. Default source auto = Zotero + Semantic Scholar merged (OpenAlex added if thin). Each paper gets a handle (P12) usable everywhere; papers already shown collapse to a stub; an identical earlier search returns its handles instead of re-running. source=zotero with collection/tag/fulltext/has_pdf browses the library; collections=true lists the collection tree. Preprints are matched to their published version automatically; peer_reviewed=true hides preprint-only papers.",
    inputSchema: S({ query: { type: "string" }, source: { type: "string", enum: ["auto", "zotero", "s2", "openalex", "arxiv"] }, sort: { type: "string", enum: ["relevance", "citations", "recent"] },
      year: { type: "string", description: "2021, 2019-2023, 2020-" }, venue: { type: "string" }, limit: { type: "integer" }, force: { type: "boolean" }, abstract_chars: { type: "integer" },
      collection: { type: "string" }, tag: { type: "string" }, fulltext: { type: "boolean" }, has_pdf: { type: "boolean" }, collections: { type: "boolean" }, peer_reviewed: { type: "boolean", description: "hide preprint-only papers" } }) },
  { name: "paper", description: "Details for up to 50 papers in one call: tldr (default), abstract, meta, bibtex, or notes (your Zotero notes).",
    inputSchema: S({ ids: IDS, detail: { type: "string", enum: ["tldr", "abstract", "meta", "bibtex", "notes"] } }, ["ids"]) },
  { name: "graph", description: "Snowball from a paper or author. mode citations (who cites it), references (what it cites), recommend (similar to ids), author (find an author by name; with a numeric id lists their papers). Sorted by citations or recent.",
    inputSchema: S({ mode: { type: "string", enum: ["citations", "references", "recommend", "author"] }, id: ID, ids: IDS, query: { type: "string", description: "author name or id" },
      sort: { type: "string", enum: ["citations", "recent"] }, year: { type: "string" }, limit: { type: "integer" }, contexts: { type: "boolean", description: "add the citing sentence" }, influential_only: { type: "boolean" } }, ["mode"]) },
  { name: "read", description: "Read a paper's full text (Zotero PDF, arXiv, open copies) cheaply. With only id: section map with token sizes. sections: read those (\"§3\", \"4-6\", \"method\"). query: best-matching passages (tables come back as rows). figure or page: that figure or page as an image (~600 to 1,500 tokens). Paywalled papers return a library link.",
    inputSchema: S({ id: ID, sections: { type: "array", items: { type: "string" } }, query: { type: "string" }, figure: { type: "string" }, page: { type: "integer" }, max_tokens: { type: "integer" }, offset: { type: "integer" }, max_hits: { type: "integer" } }, ["id"]) },
  { name: "code", description: "List code repositories for papers (links in the paper, Hugging Face, GitHub READMEs quoting the title) with stars, language, last push. Finds only; never explores.",
    inputSchema: S({ ids: IDS }, ["ids"]) },
  { name: "session", description: "Project memory. start name=... folder=<project folder on this Mac> starts or resumes a project (the folder holds its research map). list (status, query) recalls papers; note marks handles kept|maybe|dropped with a note; card saves an evidence card (handles=[P12], note=claim, loc, quote); cards lists them; tldr recalls TLDRs; queries lists searches run; roles labels foundation/breakthrough/consolidation/frontier; bibtex writes a .bib (path) for kept papers; sessions lists projects; note saved=true|false marks the papers the argument rests on (kept means interesting; saved means it goes in the folder); papers op=sync puts the saved papers as PDFs in <project folder>/papers (read prefers those files).",
    inputSchema: S({ action: { type: "string", enum: ["list", "note", "card", "cards", "tldr", "queries", "roles", "bibtex", "start", "sessions", "dump", "title", "papers"] }, op: { type: "string", description: "papers: show|sync (copy saved papers from Zotero, download open PDFs, list the rest in one task)" }, name: { type: "string" }, folder: { type: "string" }, title: { type: "string" }, saved: { type: "boolean", description: "note: save the papers to the project's papers folder (or take them out)" }, project: { type: "string", description: "dump: read another project without switching" }, handles: IDS,
      status: { type: "string" }, note: { type: "string" }, loc: { type: "string" }, quote: { type: "string" }, query: { type: "string" }, path: { type: "string" }, limit: { type: "integer" } }) },
  { name: "verify", description: "Check a draft's citations mechanically: every citation has a source and vice versa, DOIs and arXiv ids resolve to the claimed title and year, cited papers were screened, and numbers next to citations appear in the cited paper's cards or text. Reads the file on this Mac; returns only problems.",
    inputSchema: S({ path: { type: "string", description: "Markdown or LaTeX draft" }, bib: { type: "string", description: ".bib for \\cite keys" }, text: { type: "string" }, numbers: { type: "boolean" } }) },
];

async function toolSearchAll(a) {
  const zot = a.collections || a.collection || a.tag || a.fulltext || a.has_pdf || (a.source === "zotero" && !a.query);
  if (zot) return toolLibrary(a, CFG.zoteroDir);
  return toolSearch(a);
}
async function toolPaperAll(a) {
  if (a.detail !== "notes") return toolPaper(a);
  const out = [];
  for (const raw of (Array.isArray(a.ids) ? a.ids : [a.ids]).filter(Boolean)) {
    const p = parseId(raw);
    const key = p.kind === "zotero" ? p.key : p.kind === "handle" ? LEDGER.get(p.h)?.ids.zot : null;
    out.push(key ? await toolLibrary({ item: key, detail: "notes" }, CFG.zoteroDir) : `${raw}: not in Zotero, no notes`);
  }
  return out.join("\n");
}
async function toolGraph(a) {
  if (a.mode === "recommend") return toolRecommend({ ...a, ids: a.ids?.length ? a.ids : [a.id] });
  if (a.mode === "author") return toolAuthor({ ...a, query: a.query || a.id, papers: /^\d+$/.test(String(a.query || a.id)) });
  return toolCitations({ ...a, id: a.id || a.ids?.[0], direction: a.mode === "references" ? "references" : "citations" });
}
async function toolReadAll(a) {
  if (a.figure || a.page) return toolFigure(a);
  if (a.query) return toolFind(a);
  if (a.sections?.length) return toolRead(a);
  return toolOutline(a);
}
TOOLS.push({ name: "map", description: "The project's research map (research-map.json in the project folder; never read the file). Read: show (overview, warnings), focus id=C3|K2|RQ1|X1 (one item, its neighbours, nearby evidence), idea, concepts, definitions, questions, notes, tasks. Write: concept (id|label; status, role, use, scope, alt, related, parent, parent_rel), define (handle, quote, loc) / undefine, tag + compare (definition attributes), scan, pulse, claim (text|id; uses, answers, status), question (verdict, coverage), link|unlink (from, rel, to), revise (statement, background, positioning, thesis, novelty, method, claims, concepts, trigger, change), version, note, task, summary, framework (op + fw), ontology (op). Adopting concepts, revising the idea and accepting relationships only after the user agrees",
  inputSchema: S({ action: { type: "string", enum: ["show", "concepts", "concept", "define", "definitions", "tag", "compare", "scan", "pulse", "claim", "question", "questions", "link", "unlink", "revise", "version", "idea", "note", "notes", "summary", "task", "tasks", "framework", "ontology", "focus", "undefine"] },
    op: { type: "string", description: "framework: list|create|rename|rename_node|activate|delete|show|add_node|remove_node|move|arrange|add_edge|edit_edge|remove_edge|save|restore|compare|export; ontology: show|save|restore|compare|export" },
    fw: { type: "string", description: "framework id (FW2); default the active one" }, name: { type: "string" }, copy: { type: "string" }, from_version: { type: "string" }, with: { type: "string" },
    type: { type: "string", enum: ["influences", "moderates", "associated", "enables", "constrains", "precedes", "partof", "feeds", "produces", "custom"] }, component: { type: "boolean" }, verb: { type: "string" }, hypothesis: { type: "string" }, unrelated: IDS, sign: { type: "string", enum: ["+", "-", ""] }, claim: { type: "string" },
    source: { type: "string", enum: ["you", "supervisor", "workflow", "claude"] }, parent: { type: "string" }, parent_rel: { type: "string", enum: ["broader", "partof"] }, due: { type: "string" }, x: { type: "number" }, y: { type: "number" },
    id: { type: "string" }, label: { type: "string" }, text: { type: "string" }, alt: IDS, related: IDS, broader: IDS, sameas: IDS, attributes: { type: "array", items: { type: "string" } },
    status: { type: "string" }, role: { type: "string" }, use: { type: "string" }, scope: { type: "string" }, note: { type: "string" },
    handle: { type: "string" }, handles: IDS, quote: { type: "string" }, loc: { type: "string" }, kind: { type: "string" }, about: { type: "string" }, phrase: { type: "string" }, limit: { type: "integer" },
    uses: IDS, answers: IDS, verdict: { type: "string" }, coverage: { type: "string" }, from: IDS, rel: { type: "string" }, to: IDS,
    statement: { type: "string" }, background: { type: "string" }, positioning: { type: "string" }, thesis: { type: "string" }, novelty: { type: "string" }, method: { type: "string" },
    claims: IDS, concepts: IDS, trigger: { type: "string" }, trigger_ref: { type: "string" }, trigger_note: { type: "string" }, change: { type: "string" }, rationale: { type: "string" }, branch_of: { type: "string" }, project: { type: "string" } }) });
TOOLS.push({ name: "desk", description: "Link to the Research Desk, a local page (open it in the browser pane) for screening papers, evidence cards, searches and BibTeX export, with live progress during research workflows.",
  inputSchema: S({}) });
// Read-only hints let the Claude app run these without asking each time; they only record what was seen.
for (const t of TOOLS) if (["search", "paper", "graph", "read", "code", "desk", "verify"].includes(t.name)) t.annotations = { readOnlyHint: true };
// ---------- research map ----------
async function conceptPulse(phrase) {
  const filter = `title_and_abstract.search:"${phrase.replace(/"/g, "")}"`;
  const g = await http(oaUrl("/works", { filter, group_by: "publication_year" }), { ttl: DAY });
  const years = {};
  for (const x of g.group_by || []) if (/^\d{4}$/.test(x.key) && x.count) years[x.key] = x.count;
  const e = await http(oaUrl("/works", { filter, sort: "publication_year:asc", per_page: 3, select: "display_name,publication_year,doi" }), { ttl: DAY });
  const earliest = (e.results || []).map((w) => ({ title: w.display_name, year: w.publication_year, doi: (w.doi || "").replace(/^https?:\/\/doi\.org\//, "") }));
  return { total: g.meta?.count ?? Object.values(years).reduce((a, b) => a + b, 0), years, earliest };
}
// APA 7 references: the DOI registry's formatter first, then Zotero data, then arXiv metadata.
function apaAuthors(list) {
  const f = (a) => `${a.last}${a.first ? ", " + a.first.split(/[\s-]+/).filter(Boolean).map((x) => x[0].toUpperCase() + ".").join(" ") : ""}`;
  const n = list.map(f);
  if (!n.length) return "";
  if (n.length === 1) return n[0];
  if (n.length <= 20) return n.slice(0, -1).join(", ") + ", & " + n.at(-1);
  return n.slice(0, 19).join(", ") + ", . . . " + n.at(-1);
}
async function apaRefs(handles) {
  const out = [];
  for (const h of handles) {
    const p = LEDGER.get(h); if (!p) continue;
    try {
      if (p.ids.doi && !/^10\.48550\//i.test(p.ids.doi)) {
        const t = await http(`https://doi.org/${encodeURI(p.ids.doi)}`, { as: "text", ttl: 30 * DAY, headers: { accept: "text/x-bibliography; style=apa; locale=en-GB" } });
        if (t && !/^\s*</.test(t)) { out.push(oneLine(decodeEntities(t))); continue; }
      }
      if (p.ids.zot) {
        const z = await zotBibData(p.ids.zot, CFG.zoteroDir);
        if (z) {
          const f = z.f, au = apaAuthors(z.cre.filter((c) => c.type === "author" && c.last));
          const src = f.publicationTitle || f.proceedingsTitle || f.bookTitle || f.publisher || "";
          const vol = [f.volume, f.issue ? `(${f.issue})` : ""].join("");
          out.push(oneLine(`${au} (${z.year || "n.d."}). ${f.title}. ${[src, vol, f.pages].filter(Boolean).join(", ")}${src ? "." : ""} ${f.DOI ? "https://doi.org/" + f.DOI : f.url || ""}`));
          continue;
        }
      }
      if (p.ids.arxiv) {
        const xml = await http(`${ARXIV_API}?id_list=${encodeURIComponent(p.ids.arxiv)}`, { as: "text", ttl: 30 * DAY });
        const names = [...(((xml.match(/<entry>([\s\S]*?)<\/entry>/) || [])[1] || "").matchAll(/<name>([\s\S]*?)<\/name>/g))].map((m) => { const n = xmlText(m[1]).trim().split(/\s+/); const last = n.pop(); return { last, first: n.join(" ") }; });
        out.push(oneLine(`${apaAuthors(names) || p.lasts.join(", ")} (${p.year || "n.d."}). ${p.title} [Preprint]. arXiv. https://doi.org/10.48550/arXiv.${p.ids.arxiv}`));
        continue;
      }
    } catch {}
    const L = p.lasts || [];
    out.push(oneLine(`${L.length > 2 ? L.slice(0, -1).join(", ") + ", & " + L.at(-1) : L.join(" & ")} (${p.year || "n.d."}). ${p.title}.${p.venue ? " " + p.venue + "." : ""}${p.ids.doi ? " https://doi.org/" + p.ids.doi : ""}`));
  }
  return out;
}
// ---------- saved papers: the project's folder of PDFs ----------
// Cowork reads local PDFs far better than links, so each project keeps its saved papers as files in
// <project folder>/papers. Zotero PDFs are copied (Zotero itself is only read), open copies are
// downloaded, and whatever remains becomes one task for the user rather than one task per paper.
function libraryDir(st = LEDGER.ensure()) {
  return st.folder ? join(st.folder, "papers") : join(CFG.cacheDir, "library", st.name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase());
}
const normWords = (t) => String(t || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 3);
function pdfName(h, p) {
  const who = LEDGER.fixLasts(p)[0] || "Unknown";
  const t = String(p.title || "Untitled").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 9).join(" ");
  return `${who} ${p.year || "n.d."} - ${t} (${h}).pdf`.replace(/\s+/g, " ").slice(0, 150);
}
function libraryMatch(files, h, p) {
  const tag = files.find((f) => f.includes(`(${h})`)); if (tag) return tag;
  const want = normWords(p.title).slice(0, 8); if (want.length < 3) return null;
  let best = null, score = 0;
  for (const f of files) {
    const have = new Set(normWords(f.replace(/\.pdf$/i, "")));
    const sc = want.filter((w) => have.has(w)).length / want.length;
    if (sc > score) { best = f; score = sc; }
  }
  if (p.ids?.doi) { const d = files.find((f) => f.toLowerCase().includes(p.ids.doi.toLowerCase().replace(/\//g, "_"))); if (d) return d; }
  if (p.ids?.arxiv) { const x = files.find((f) => f.includes(p.ids.arxiv)); if (x) return x; }
  return score >= 0.7 ? best : null;
}
async function openPdfUrls(p) {
  const urls = [];
  if (p.ids?.arxiv) urls.push(`https://arxiv.org/pdf/${p.ids.arxiv}`);
  const doi = p.ids?.doi;
  if (doi) {
    try { const r = await s2Resolve(parseId(doi)); if (r.openAccessPdf?.url) urls.push(r.openAccessPdf.url); } catch {}
    try { const w = await http(oaUrl(`/works/doi:${doi}`, { select: "best_oa_location,open_access" })); for (const u of [w.best_oa_location?.pdf_url, w.open_access?.oa_url]) if (u) urls.push(u); } catch {}
    if (CFG.mailto) try { const u = await http(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(CFG.mailto)}`, { ttl: 14 * DAY }); for (const l of [u.best_oa_location, ...(u.oa_locations || [])].filter(Boolean)) if (l.url_for_pdf) urls.push(l.url_for_pdf); } catch {}
  }
  return [...new Set(urls)];
}
function libraryState() {
  const st = LEDGER.ensure(), dir = libraryDir(st);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.pdf$/i.test(f)) : [];
  // Keeping a paper means it is interesting; saving it means it belongs in the folder (usually because
  // the argument will rest on it). A PDF the user drops in the folder saves that paper too.
  let changed = false;
  for (const [h, p] of Object.entries(st.papers)) {
    if (p.saved === undefined && p.pdf) { p.saved = true; changed = true; }
    if (p.status === "dropped") continue;
    if (p.pdf && files.includes(p.pdf)) continue;
    const f = files.length ? libraryMatch(files.filter((x) => !Object.values(st.papers).some((o) => o !== p && o.pdf === x)), h, p) : null;
    if (f && (p.saved || ["kept", "maybe"].includes(p.status))) { p.pdfFrom = p.pdf === f && p.pdfFrom ? p.pdfFrom : "you"; p.pdf = f; p.saved = true; changed = true; }
    else if (p.pdf && !f) { p.pdf = ""; p.pdfFrom = ""; changed = true; }
  }
  if (changed) LEDGER.save();
  const kept = Object.entries(st.papers).filter(([, p]) => p.saved && p.status !== "dropped");
  return { st, dir, files, kept };
}
function libraryTask(missing) {
  // One standing task for the papers that could not be fetched, rewritten on every sync.
  try {
    MAP.load(); const m = MAP.m;
    let k = Object.keys(m.tasks).find((t) => m.tasks[t].library);
    if (!missing.length) { if (k && m.tasks[k].status !== "done") { Object.assign(m.tasks[k], { status: "done", done: new Date().toISOString().slice(0, 10) }); MAP.save(); } return ""; }
    const title = `Add ${missing.length} paper${missing.length === 1 ? "" : "s"} to the papers folder`;
    const note = missing.map(([h, p]) => `${h} ${LEDGER.fixLasts(p)[0] || ""} ${p.year || ""}: ${p.title}${p.ids?.doi ? ` (https://doi.org/${p.ids.doi})` : ""}`).join("\n");
    if (!k) { k = `T${m.next.T++}`; m.tasks[k] = { title, kind: "read", source: "claude", about: "", status: "todo", due: "", note, created: new Date().toISOString().slice(0, 10), library: true }; }
    else Object.assign(m.tasks[k], { title, note, status: m.tasks[k].status === "done" ? "todo" : m.tasks[k].status, done: "" });
    MAP.save(); return k;
  } catch { return ""; }
}
async function toolPapersFolder(a) {
  const op = a.op || "show";
  let { st, dir, files, kept } = libraryState();
  if (op === "sync") {
    mkdirSync(dir, { recursive: true });
    const only = Array.isArray(a.handles) && a.handles.length ? new Set(a.handles.map((h) => String(h).toUpperCase())) : null;
    const log = { zotero: [], open: [], missing: [] };
    for (const [h, p] of kept) {
      if (only && !only.has(h)) continue;
      if (p.pdf && existsSync(join(dir, p.pdf))) continue;
      const name = pdfName(h, p), dest = join(dir, name);
      let done = false;
      try {
        const z = await zotLookup({ doi: p.ids?.doi || "", arxiv: p.ids?.arxiv || "" }, p.title || "", CFG.zoteroDir);
        if (z?.ids?.zot) { const r = await zoteroResolve(z.ids.zot, CFG.zoteroDir); if (r.path && /\.pdf$/i.test(r.path) && existsSync(r.path)) { copyFileSync(r.path, dest); Object.assign(p, { pdf: name, pdfFrom: "zotero" }); log.zotero.push(h); done = true; } }
      } catch {}
      if (!done) for (const u of await openPdfUrls(p)) {
        try { const buf = await http(u, { as: "buffer", ttl: 0, headers: { accept: "application/pdf" } }); if (buf.subarray(0, 5).toString() === "%PDF-") { writeFileSync(dest, buf); Object.assign(p, { pdf: name, pdfFrom: "open" }); log.open.push(h); done = true; break; } } catch {}
      }
      if (!done) log.missing.push([h, p]);
    }
    LEDGER.save();
    ({ st, dir, files, kept } = libraryState());
    const missing = kept.filter(([, p]) => !p.pdf);
    const t = libraryTask(missing);
    return [`Papers folder: ${dir}`, `${kept.length - missing.length} of ${kept.length} saved papers in the folder.${log.zotero.length ? ` Copied from Zotero: ${log.zotero.join(" ")}.` : ""}${log.open.length ? ` Downloaded open copies: ${log.open.join(" ")}.` : ""}`,
      missing.length ? `Not found as open PDFs: ${missing.map(([h]) => h).join(" ")}. They are listed in task ${t} for the user to add (library access or Zotero); files dropped in the folder are picked up by name.` : "Every saved paper is in the folder."].join("\n");
  }
  if (op === "dir") { mkdirSync(dir, { recursive: true }); return dir; }
  if (op === "file") { const f = String(a.name || ""); if (!/\.pdf$/i.test(f) || f.includes("/") || f.includes("\\") || f.startsWith(".")) throw new Error("bad file name"); const full = join(dir, f); if (!existsSync(full)) throw new Error("no such file"); return full; }
  if (op === "dump") return JSON.stringify({ dir, exists: existsSync(dir), files: files.length, papers: Object.fromEntries(kept.map(([h, p]) => [h, { pdf: p.pdf || "", from: p.pdfFrom || "" }])), extra: files.filter((f) => !kept.some(([, p]) => p.pdf === f)) });
  const missing = kept.filter(([, p]) => !p.pdf);
  return [`Papers folder: ${dir}${existsSync(dir) ? "" : " (not created yet; op=sync creates and fills it)"}`, `${kept.length - missing.length} of ${kept.length} saved papers in the folder.`, missing.length ? `Missing: ${missing.map(([h]) => h).join(" ")}` : ""].filter(Boolean).join("\n");
}
function libraryFile(h) { try { const st = LEDGER.ensure(), p = st.papers[String(h).toUpperCase()]; if (p?.pdf) { const f = join(libraryDir(st), p.pdf); if (existsSync(f)) return f; } } catch {} return null; }

const MAP = new ResearchMap({ ledger: LEDGER, cacheDir: CFG.cacheDir, pulse: conceptPulse, apa: apaRefs,
  scan: async (h, terms) => definitionHits(await loadFullText(h), terms) });

const HANDLERS = {
  desk: () => DESK?.running ? `Research Desk: ${DESK.url}\nOpen it in the browser pane. Projects, screening, cards and searches update live.` : "The Research Desk is not running (its port may be taken by another copy of Paper Scout).",
  search: toolSearchAll, paper: toolPaperAll, graph: toolGraph, read: toolReadAll, code: toolCode,
  session: async (a) => (await refreshSurnames(), a.action === "usage" ? usageSummary() : a.action === "papers" ? toolPapersFolder(a) : a.action === "bibtex" ? toolBibtex(a) : a.action === "roles" ? (await fillCitations(), LEDGER.tool(a)) : LEDGER.tool(a)),
  verify: (a) => verifyDraft(a, { LEDGER, http, oaUrl, loadFullText, xmlText, ARXIV_API }),
  map: async (a) => (await refreshSurnames(), a.action === "snapshot" ? JSON.stringify(MAP.snapshot(a.project)) : a.action === "summary_html" ? (MAP.load(a.project), MAP.summaryHtml(await MAP.references())) : MAP.tool(a)),
};

const INSTRUCTIONS = "Token-lean paper access with project memory. Refer to papers by handle (P12). Recall with session before searching; never repeat a search unasked. search (no abstracts) -> paper tldr in one batch -> graph to snowball -> read: section map, then only the sections or passages needed. Save claims as session cards while reading; run verify on drafts.";

export async function callTool(name, args) {
  const h = HANDLERS[name];
  if (!h) throw new Error(`unknown tool ${name}`);
  try { return await h(args || {}); } finally { LEDGER.save(); }
}

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notification
  try {
    if (method === "initialize") {
      return send({ jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "paper-scout", version: VERSION }, instructions: INSTRUCTIONS } });
    }
    if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
    if (method === "tools/list") { recordUsage("(tool definitions)", null, JSON.stringify(TOOLS)); return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } }); }
    if (method === "resources/list") return send({ jsonrpc: "2.0", id, result: { resources: [] } });
    if (method === "prompts/list") return send({ jsonrpc: "2.0", id, result: { prompts: [] } });
    if (method === "tools/call") {
      try {
        const out = await callTool(params?.name, params?.arguments);
        recordUsage(params?.name, params?.arguments, out);
        return send({ jsonrpc: "2.0", id, result: typeof out === "string" ? { content: [{ type: "text", text: out }] } : out });
      } catch (e) {
        return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true } });
      }
    }
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
  } catch (e) {
    send({ jsonrpc: "2.0", id, error: { code: -32603, message: e.message } });
  }
}

// ---------- usage: what Paper Scout adds to Claude's context ----------
// Only calls from Claude count (the Research Desk calls the same tools for free). Tokens are estimated
// at four characters each; images at about a thousand. Kept in the cache folder, not in the project.
const USAGE_FILE = join(CFG.cacheDir, "usage.json");
let USAGE = null;
function usageLoad() { if (!USAGE) { try { USAGE = JSON.parse(readFileSync(USAGE_FILE, "utf8")); } catch { USAGE = {}; } USAGE.days ||= {}; USAGE.projects ||= {}; } return USAGE; }
function recordUsage(name, args, out) {
  try {
    const u = usageLoad();
    let n = Math.round(JSON.stringify(args || {}).length / 4);
    if (typeof out === "string") n += Math.round(out.length / 4);
    else for (const c of out?.content || []) n += c.type === "image" ? 1000 : Math.round(String(c.text || "").length / 4);
    const day = new Date().toISOString().slice(0, 10), proj = LEDGER.ensure().name;
    const key = [name, args?.action, args?.op].filter(Boolean).join(" ");
    const add = (o) => { o.tokens = (o.tokens || 0) + n; o.calls = (o.calls || 0) + 1; o.byTool ||= {}; o.byTool[key] = (o.byTool[key] || 0) + n; };
    add(u.days[day] ||= {}); add(u.projects[proj] ||= {});
    for (const d of Object.keys(u.days).sort().slice(0, -60)) delete u.days[d];
    writeFileSync(USAGE_FILE, JSON.stringify(u));
  } catch {}
}
function usageSummary() {
  const u = usageLoad(), day = new Date().toISOString().slice(0, 10), proj = LEDGER.ensure().name;
  const week = Object.entries(u.days).filter(([d]) => (Date.now() - Date.parse(d)) / 86400000 < 7).reduce((n, [, x]) => n + (x.tokens || 0), 0);
  return JSON.stringify({ today: u.days[day] || { tokens: 0, calls: 0, byTool: {} }, week, project: u.projects[proj] || { tokens: 0, calls: 0, byTool: {} }, projectName: proj });
}

let DESK = null;
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain && !process.env.PAPER_SCOUT_NO_STDIO) {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); }
    handle(msg);
  });
  log(`ready (cache ${CFG.cacheDir}; S2 key ${CFG.s2Key ? "set" : "not set"})`);
  DESK = startDesk({ port: CFG.deskPort, cacheDir: CFG.cacheDir, callTool, log });
}

export const _internal = { parseId, htmlToSections, pdfTextToSections, passages, pickSections, arxivQuery, lineS2, lineOA, invertAbstract, oaYearFilter };
