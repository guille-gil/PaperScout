// Read-only, token-lean access to the local Zotero library (zotero.sqlite), via sql.js.
// The database file is read into memory (never written), so it works whether Zotero is open or closed.

import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, isAbsolute } from "node:path";

const require = createRequire(import.meta.url);
let SQL = null;
let cache = { mtime: 0, dir: "", lib: null };

export function zoteroDir(cfgDir) {
  const cands = [cfgDir, join(homedir(), "Zotero")].filter(Boolean).map((d) => (d.startsWith("~") ? join(homedir(), d.slice(1)) : d));
  for (const d of cands) if (existsSync(join(d, "zotero.sqlite"))) return d;
  throw new Error(`Zotero database not found (looked in ${cands.join(", ")}). Set the Zotero data folder in the Paper Scout settings.`);
}

async function openDb(dir) {
  if (!SQL) {
    const initSqlJs = require("sql.js");
    const wasmDir = dirname(require.resolve("sql.js/dist/sql-wasm.wasm"));
    SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
  }
  const file = join(dir, "zotero.sqlite");
  const buf = readFileSync(file);
  return new SQL.Database(new Uint8Array(buf));
}

function rows(db, sql, params = []) {
  const st = db.prepare(sql);
  st.bind(params);
  const out = [];
  while (st.step()) out.push(st.get());
  st.free();
  return out;
}

async function loadLibrary(cfgDir) {
  if (cache.lib && Date.now() - (cache.checked || 0) < 60_000) return cache.lib;
  const dir = zoteroDir(cfgDir);
  const f = join(dir, "zotero.sqlite");
  const wal = f + "-wal";
  const mtime = Math.max(statSync(f).mtimeMs, existsSync(wal) ? statSync(wal).mtimeMs : 0);
  if (cache.lib && cache.dir === dir && cache.mtime === mtime) { cache.checked = Date.now(); return cache.lib; }
  const db = await openDb(dir);
  try {
    const tables = new Set(rows(db, "SELECT name FROM sqlite_master WHERE type='table'").map((r) => r[0]));
    const fieldTable = tables.has("fieldsCombined") ? "fieldsCombined" : "fields";
    const deleted = tables.has("deletedItems") ? "AND i.itemID NOT IN (SELECT itemID FROM deletedItems)" : "";
    const items = new Map();
    for (const [id, key, added, type, libraryID] of rows(db, `SELECT i.itemID, i.key, i.dateAdded, t.typeName, i.libraryID FROM items i JOIN itemTypes t ON t.itemTypeID = i.itemTypeID WHERE t.typeName NOT IN ('attachment','note','annotation') ${deleted}`)) {
      items.set(id, { id, key, added, type, libraryID, f: {}, creators: [], tags: [], cols: [], atts: [], notes: 0 });
    }
    const wanted = ["title", "date", "publicationTitle", "proceedingsTitle", "bookTitle", "conferenceName", "university", "publisher", "repository", "DOI", "url", "extra", "abstractNote", "shortTitle", "archiveID", "volume", "issue", "pages", "institution", "citationKey", "place", "reportNumber", "edition"];
    for (const [id, name, value] of rows(db, `SELECT d.itemID, f.fieldName, v.value FROM itemData d JOIN ${fieldTable} f ON f.fieldID = d.fieldID JOIN itemDataValues v ON v.valueID = d.valueID WHERE f.fieldName IN (${wanted.map(() => "?").join(",")})`, wanted)) {
      const it = items.get(id); if (it) it.f[name] = String(value);
    }
    const ctJoin = tables.has("creatorTypes") ? "LEFT JOIN creatorTypes ct ON ct.creatorTypeID = ic.creatorTypeID" : "";
    const ctCol = tables.has("creatorTypes") ? "ct.creatorType" : "'author'";
    for (const [id, first, last, ctype] of rows(db, `SELECT ic.itemID, c.firstName, c.lastName, ${ctCol} FROM itemCreators ic JOIN creators c ON c.creatorID = ic.creatorID ${ctJoin} ORDER BY ic.itemID, ic.orderIndex`)) {
      const it = items.get(id); if (it) { it.creators.push([first, last].filter(Boolean).join(" ")); (it.lasts ||= []).push(String(last || first || "")); (it.cre ||= []).push({ first: String(first || ""), last: String(last || ""), type: String(ctype || "author") }); }
    }
    for (const [id, name] of rows(db, "SELECT it.itemID, t.name FROM itemTags it JOIN tags t ON t.tagID = it.tagID")) {
      const it = items.get(id); if (it) it.tags.push(String(name));
    }
    const collections = new Map();
    for (const [cid, name, parent, key, libraryID] of rows(db, "SELECT collectionID, collectionName, parentCollectionID, key, libraryID FROM collections")) {
      collections.set(cid, { cid, name: String(name), parent, key, libraryID, items: new Set(), children: [] });
    }
    for (const c of collections.values()) if (c.parent && collections.has(c.parent)) collections.get(c.parent).children.push(c.cid);
    for (const [cid, id] of rows(db, "SELECT collectionID, itemID FROM collectionItems")) {
      const c = collections.get(cid); if (c) c.items.add(id);
      const it = items.get(id); if (it) it.cols.push(cid);
    }
    const attByKey = new Map();
    const attById = new Map();
    for (const [aid, parent, ctype, path, key, linkMode] of rows(db, `SELECT a.itemID, a.parentItemID, a.contentType, a.path, i.key, a.linkMode FROM itemAttachments a JOIN items i ON i.itemID = a.itemID WHERE 1=1 ${deleted}`)) {
      const att = { aid, parent, ctype: ctype || "", path: path || "", key, linkMode };
      attByKey.set(key, att);
      attById.set(aid, att);
      const it = items.get(parent); if (it) it.atts.push(att);
    }
    if (tables.has("itemNotes")) for (const [parent] of rows(db, "SELECT parentItemID FROM itemNotes WHERE parentItemID IS NOT NULL")) { const it = items.get(parent); if (it) it.notes++; }
    const byKey = new Map([...items.values()].map((it) => [it.key, it]));
    const hasFulltext = tables.has("fulltextWords") && tables.has("fulltextItemWords");
    const byDoi = new Map(), byArxiv = new Map(), byTitle = new Map();
    for (const it of items.values()) {
      if (it.f.DOI) byDoi.set(it.f.DOI.toLowerCase(), it.key);
      const ax = arxivOf(it.f); if (ax) byArxiv.set(ax, it.key);
      const t = normTitle(it.f.title); if (t.length > 20) byTitle.set(t, it.key);
    }
    const lib = { dir, items, byKey, collections, attByKey, attById, hasFulltext, db, byDoi, byArxiv, byTitle };
    if (cache.lib?.db) try { cache.lib.db.close(); } catch {}
    cache = { mtime, dir, lib, checked: Date.now() };
    return lib;
  } catch (e) {
    try { db.close(); } catch {}
    throw e;
  }
}

// ---------- helpers ----------
const normTitle = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, 90);
function arxivOf(f) {
  return (f.archiveID || "").match(/(\d{4}\.\d{4,5})/)?.[1] || (f.url || "").match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/)?.[1] || (f.DOI || "").match(/10\.48550\/arxiv\.(\d{4}\.\d{4,5})/i)?.[1] || (f.extra || "").match(/arXiv:\s*(\d{4}\.\d{4,5})/i)?.[1] || "";
}
let RENDER = null;
export function setRenderer(fn) { RENDER = fn; }
function zotRecord(lib, it) {
  const att = pdfOf(lib, it);
  const p = att && attachmentPath(lib, att);
  const local = p && existsSync(p) ? (/pdf/i.test(att.ctype) || /\.pdf$/i.test(att.path) ? "PDF" : "file") : att && ftCache(lib, att) ? "text" : "";
  return { title: oneLine(it.f.title) || "(untitled)", lasts: it.lasts || [], year: year(it), venue: venue(it), ids: { doi: it.f.DOI || "", arxiv: arxivOf(it.f), zot: it.key }, local };
}
// Match an online record against the library by DOI, arXiv id or title.
export async function zotLookup(ids, title, cfgDir) {
  let lib; try { lib = await loadLibrary(cfgDir); } catch { return null; }
  const k = (ids.doi && lib.byDoi.get(ids.doi.toLowerCase())) || (ids.arxiv && lib.byArxiv.get(ids.arxiv)) || lib.byTitle.get(normTitle(title));
  if (!k) return null;
  return zotRecord(lib, lib.byKey.get(k));
}
// Multi-word surnames stored in Zotero (structured names), used to read full-name strings correctly.
export async function zotSurnames(cfgDir) {
  let lib; try { lib = await loadLibrary(cfgDir); } catch { return []; }
  const set = new Set();
  for (const it of lib.items.values()) for (const c of it.cre || []) if (c.last && /\s/.test(c.last.trim())) set.add(c.last.trim());
  return [...set].sort((a, b) => b.length - a.length);
}

export async function zotSearchRecords(query, limit, cfgDir) {
  const out = await toolLibrary({ query, limit, _records: true, _relaxed: true }, cfgDir);
  return out;
}
const oneLine = (s) => (s || "").replace(/\s+/g, " ").trim();
const clip = (s, n) => (!s ? "" : s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, "") + "…");
const year = (it) => (it.f.date || "").match(/\d{4}/)?.[0] || "";
const venue = (it) => it.f.publicationTitle || it.f.proceedingsTitle || it.f.conferenceName || it.f.bookTitle || it.f.university || it.f.repository || it.f.publisher || "";
function authorsShort(names) {
  if (!names.length) return "";
  const last = (n) => n.trim().split(/\s+/).pop();
  return names.length === 1 ? last(names[0]) : names.length === 2 ? `${last(names[0])} & ${last(names[1])}` : `${last(names[0])} et al.`;
}
function lastsShort(l) { return !l.length ? "" : l.length === 1 ? l[0] : l.length === 2 ? `${l[0]} & ${l[1]}` : `${l[0]} et al.`; }
function pdfOf(lib, it) {
  const pdfs = it.atts.filter((a) => /pdf/i.test(a.ctype) || /\.pdf$/i.test(a.path));
  return pdfs[0] || it.atts.find((a) => /html|epub/i.test(a.ctype)) || null;
}
export function attachmentPath(lib, att) {
  if (!att?.path) return null;
  if (att.path.startsWith("storage:")) return join(lib.dir, "storage", att.key, att.path.slice(8));
  if (isAbsolute(att.path)) return att.path;
  return null; // "attachments:" relative paths need the base directory preference
}
function ftCache(lib, att) {
  const p = att && join(lib.dir, "storage", att.key, ".zotero-ft-cache");
  return p && existsSync(p) ? p : null;
}
function line(lib, it, i, opts = {}) {
  if (RENDER) return RENDER(zotRecord(lib, it), opts);
  const att = pdfOf(lib, it);
  const bits = [oneLine(it.f.title) || "(untitled)", [lastsShort(it.lasts || []), year(it)].filter(Boolean).join(" ")];
  const v = venue(it); if (v) bits.push(clip(v, 60));
  const p = att && attachmentPath(lib, att);
  const flag = p && existsSync(p) ? (/pdf/i.test(att.ctype) || /\.pdf$/i.test(att.path) ? " PDF" : " file") : att && ftCache(lib, att) ? " text" : "";
  return `${i}. ${bits.join(" | ")} | zot:${it.key}${flag}`;
}
function tokenize(s) { return (s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\-]*/gu) || []).filter((w) => w.length > 1); }
function collectionIds(lib, spec) {
  const s = String(spec).toLowerCase();
  const roots = [...lib.collections.values()].filter((c) => c.key.toLowerCase() === s || c.name.toLowerCase() === s);
  const matches = roots.length ? roots : [...lib.collections.values()].filter((c) => c.name.toLowerCase().includes(s));
  const ids = new Set();
  const walk = (cid) => { if (ids.has(cid)) return; ids.add(cid); for (const ch of lib.collections.get(cid)?.children || []) walk(ch); };
  matches.forEach((c) => walk(c.cid));
  return { ids, names: matches.map((c) => c.name) };
}

// ---------- the library tool ----------
export async function toolLibrary(a, cfgDir) {
  const lib = await loadLibrary(cfgDir);
  const limit = Math.max(1, Math.min(Number(a.limit) || 10, 50));
  if (a.item && RENDER) { /* item detail always prints the full line */ }

  if (a.item) {
    const key = String(a.item).replace(/^zot(ero)?:/i, "").toUpperCase();
    const it = lib.byKey.get(key);
    if (!it) return `No Zotero item with key ${key}.`;
    const detail = a.detail || "abstract";
    let s = line(lib, it, 1, { full: true });
    if (detail === "abstract") s += `\n   ${it.f.abstractNote ? oneLine(it.f.abstractNote) : "(no abstract in Zotero)"}`;
    if (detail === "meta") {
      const cols = it.cols.map((c) => lib.collections.get(c)?.name).filter(Boolean);
      s += `\n   type ${it.type}; date ${it.f.date?.split(" ")[0] || "?"}; added ${it.added?.slice(0, 10)}`;
      if (it.f.DOI) s += `; doi ${it.f.DOI}`;
      if (it.f.volume || it.f.pages) s += `; vol ${it.f.volume || "?"}${it.f.issue ? `(${it.f.issue})` : ""}, pp ${it.f.pages || "?"}`;
      s += `\n   authors ${it.creators.join("; ") || "?"}`;
      if (cols.length) s += `\n   collections ${cols.join("; ")}`;
      if (it.tags.length) s += `\n   tags ${clip(it.tags.join("; "), 300)}`;
      s += `\n   attachments ${it.atts.length}; notes ${it.notes}${it.f.url ? `; url ${it.f.url}` : ""}`;
    }
    if (detail === "notes") {
      const notes = rows(lib.db, "SELECT note FROM itemNotes WHERE parentItemID = ?", [it.id]).map((r) => oneLine(String(r[0]).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")));
      s += notes.length ? notes.map((n, i) => `\n   note ${i + 1}: ${clip(n, 1500)}`).join("") : "\n   (no notes)";
    }
    return s;
  }

  if (a.collections) {
    const all = [...lib.collections.values()];
    const count = (c) => { const ids = new Set(); const walk = (x) => { x.items.forEach((i) => lib.items.has(i) && ids.add(i)); x.children.forEach((ch) => walk(lib.collections.get(ch))); }; walk(c); return ids.size; };
    const out = [];
    const walk = (c, depth) => { out.push(`${"  ".repeat(depth)}${clip(oneLine(c.name), 60)} (${count(c)}) key ${c.key}`); if (depth < (a.depth === undefined ? 2 : Number(a.depth))) c.children.map((x) => lib.collections.get(x)).sort((x, y) => x.name.localeCompare(y.name)).forEach((ch) => walk(ch, depth + 1)); };
    all.filter((c) => !c.parent).sort((x, y) => x.name.localeCompare(y.name)).forEach((c) => walk(c, 0));
    return [`Zotero: ${lib.items.size} items, ${all.length} collections`, ...out].join("\n");
  }

  let pool = [...lib.items.values()];
  const notes = [];
  if (a.collection) {
    const { ids, names } = collectionIds(lib, a.collection);
    if (!ids.size) return `No collection matches "${a.collection}". Call library with collections=true to list them.`;
    pool = pool.filter((it) => it.cols.some((c) => ids.has(c)));
    notes.push(`in ${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""} (with subcollections)`);
  }
  if (a.tag) {
    const t = String(a.tag).toLowerCase();
    pool = pool.filter((it) => it.tags.some((x) => x.toLowerCase() === t || x.toLowerCase().includes(t)));
    notes.push(`tag ${a.tag}`);
  }
  if (a.year) {
    const [lo, hi] = String(a.year).includes("-") ? String(a.year).split("-") : [a.year, a.year];
    pool = pool.filter((it) => { const y = year(it); return y && (!lo || y >= lo) && (!hi || y <= hi); });
  }
  if (a.has_pdf) pool = pool.filter((it) => pdfOf(lib, it));

  const q = String(a.query || "").trim();
  let scored;
  if (q) {
    const qt = [...new Set(tokenize(q))];
    let ftHits = null;
    if (a.fulltext && lib.hasFulltext) {
      ftHits = null;
      for (const t of qt) {
        const ids = new Set(rows(lib.db, "SELECT DISTINCT iw.itemID FROM fulltextItemWords iw JOIN fulltextWords w ON w.wordID = iw.wordID WHERE w.word = ? OR w.word LIKE ?", [t, t + "%"]).map((r) => lib.attById.get(r[0])?.parent).filter(Boolean));
        ftHits = ftHits ? new Set([...ftHits].filter((x) => ids.has(x))) : ids;
      }
      notes.push("full text of attachments");
    }
    scored = pool.map((it) => {
      const title = (it.f.title || "").toLowerCase();
      const who = it.creators.join(" ").toLowerCase();
      const rest = [year(it), venue(it), it.f.DOI, it.tags.join(" "), it.f.shortTitle, it.f.extra, a.abstracts !== false ? it.f.abstractNote : ""].join(" ").toLowerCase();
      let score = 0, missing = 0;
      for (const t of qt) {
        const inT = title.includes(t), inW = who.includes(t), inR = rest.includes(t), inF = ftHits?.has(it.id);
        if (!inT && !inW && !inR && !inF) { missing++; continue; }
        score += inT ? 3 : inW ? 2.5 : inR ? 1 : 0.5;
      }
      if (missing && !(a._relaxed && (qt.length - missing) / qt.length >= 0.6 && qt.some((t) => title.includes(t)))) return null;
      if (qt.length > 1 && title.includes(q.toLowerCase())) score += 3;
      return { it, score };
    }).filter(Boolean);
    scored.sort((x, y) => y.score - x.score || (y.it.added || "").localeCompare(x.it.added || ""));
  } else {
    scored = pool.map((it) => ({ it, score: 0 }));
    const sort = a.sort || "added";
    scored.sort((x, y) => sort === "year" ? (year(y.it) || "").localeCompare(year(x.it) || "") : sort === "title" ? (x.it.f.title || "").localeCompare(y.it.f.title || "") : (y.it.added || "").localeCompare(x.it.added || ""));
  }
  if (!q && !a.collection && !a.tag && !a.year) notes.push("most recently added");
  const shown = scored.slice(0, limit);
  if (a._records) return shown.map((x) => zotRecord(lib, x.it));
  const head = `Zotero${notes.length ? " " + notes.join(", ") : ""}${q ? ` for "${q}"` : ""}: ${scored.length} items, showing ${shown.length}`;
  return [head, ...shown.map((x, i) => line(lib, x.it, i + 1))].join("\n");
}

// ---------- identity and full text for other tools ----------
export async function zoteroResolve(key, cfgDir) {
  const lib = await loadLibrary(cfgDir);
  const k = key.toUpperCase();
  let it = lib.byKey.get(k);
  let att = null;
  if (!it) {
    att = lib.attByKey.get(k);
    if (!att) throw new Error(`No Zotero item with key ${k}`);
    it = lib.items.get(att.parent) || null;
  } else att = pdfOf(lib, it);
  const f = it?.f || {};
  const arxiv = (f.archiveID || "").match(/(\d{4}\.\d{4,5})/)?.[1] || (f.url || "").match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/)?.[1] || (f.DOI || "").match(/10\.48550\/arxiv\.(\d{4}\.\d{4,5})/i)?.[1] || (f.extra || "").match(/arXiv:\s*(\d{4}\.\d{4,5})/i)?.[1];
  return {
    title: f.title || "", doi: f.DOI || "", arxiv: arxiv || "",
    path: attachmentPath(lib, att), ftcache: ftCache(lib, att),
  };
}

// ---------- BibTeX ----------
let BBT = { dir: "", mtime: 0, map: null };
async function betterBibtexKeys(dir) {
  const f = join(dir, "better-bibtex.sqlite");
  if (!existsSync(f)) return new Map();
  const m = statSync(f).mtimeMs;
  if (BBT.map && BBT.dir === dir && BBT.mtime === m) return BBT.map;
  const map = new Map();
  try {
    const db = new SQL.Database(new Uint8Array(readFileSync(f)));
    try { for (const [k, ck] of rows(db, "SELECT itemKey, citationKey FROM citationkey")) map.set(String(k), String(ck)); } catch {}
    db.close();
  } catch {}
  BBT = { dir, mtime: m, map };
  return map;
}

export async function zotBibData(key, cfgDir) {
  const lib = await loadLibrary(cfgDir);
  const it = lib.byKey.get(String(key).toUpperCase());
  if (!it) return null;
  const bbt = await betterBibtexKeys(lib.dir);
  return { type: it.type, f: it.f, cre: it.cre || [], citekey: bbt.get(it.key) || it.f.citationKey || "", arxiv: arxivOf(it.f), year: year(it) };
}
