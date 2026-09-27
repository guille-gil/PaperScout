// Session ledger: every paper seen gets a short handle (P1, P2, ...) that works as an id in every tool.
// Papers already shown in the session are collapsed to one short line, repeated searches are answered
// from the ledger, and the ledger doubles as the screening log (kept, maybe, dropped, notes).

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, 90);
const oneLine = (s) => (s || "").replace(/\s+/g, " ").trim();
const clip = (s, n) => (!s ? "" : s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, "") + "…");

export class Ledger {
  constructor(cacheDir) {
    this.dir = join(cacheDir, "sessions");
    try { mkdirSync(this.dir, { recursive: true }); } catch {}
    this.state = null;
    this.surnames = [];
  }

  // Repair single-word surnames stored before compound surnames were known (e.g. "Avalle" -> "Gil de Avalle").
  fixLast(l) {
    if (!l || /\s/.test(l) || l.length < 4) return l;
    const hits = this.surnames.filter((s) => s.toLowerCase().endsWith(" " + l.toLowerCase()));
    return hits.length === 1 ? hits[0] : l;
  }
  fixLasts(p) {
    if (!p?.lasts?.length) return p?.lasts || [];
    const fixed = p.lasts.map((l) => this.fixLast(l));
    if (fixed.some((x, i) => x !== p.lasts[i])) p.lasts = fixed;
    return p.lasts;
  }

  file(name) { return join(this.dir, name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() + ".json"); }

  ensure() {
    if (this.state) return this.state;
    let name = "";
    try { name = readFileSync(join(this.dir, "_current"), "utf8").trim(); } catch {}
    // An unnamed session lasts one day; named sessions persist until switched.
    const today = `auto-${new Date().toISOString().slice(0, 10)}`;
    if (!name || (name.startsWith("auto-") && name !== today)) name = today;
    return this.load(name);
  }

  load(name) {
    const f = this.file(name);
    let st = null;
    if (existsSync(f)) try { st = JSON.parse(readFileSync(f, "utf8")); } catch {}
    this.state = st || { name, created: new Date().toISOString(), next: 1, qnext: 1, papers: {}, queries: {} };
    this.index();
    try { writeFileSync(join(this.dir, "_current"), name); } catch {}
    return this.state;
  }

  index() {
    this.keys = new Map();
    for (const [h, r] of Object.entries(this.state.papers)) for (const k of this.recKeys(r)) this.keys.set(k, h);
  }

  save() { try { this.state.updated = new Date().toISOString(); writeFileSync(this.file(this.state.name), JSON.stringify(this.state)); } catch {} }

  recKeys(r) {
    const ids = r.ids || {};
    const out = [];
    if (ids.doi) {
      out.push("doi:" + ids.doi.toLowerCase());
      const ax = ids.doi.match(/10\.48550\/arxiv\.(.+)$/i);
      if (ax) out.push("arxiv:" + ax[1].toLowerCase());
    }
    if (ids.arxiv) out.push("arxiv:" + ids.arxiv.toLowerCase());
    if (ids.corpus) out.push("corpus:" + ids.corpus);
    if (ids.openalex) out.push("oa:" + ids.openalex.toUpperCase());
    if (ids.zot) out.push("zot:" + ids.zot.toUpperCase());
    const t = norm(r.title);
    if (t.length > 20) out.push("t:" + t);
    return out;
  }

  // Merge a record into the ledger; returns { h, rec, fresh } where fresh means never shown before.
  register(rec) {
    const st = this.ensure();
    let h = null;
    for (const k of this.recKeys(rec)) if (this.keys.has(k)) { h = this.keys.get(k); break; }
    if (!h) {
      h = `P${st.next++}`;
      st.papers[h] = { title: rec.title, lasts: rec.lasts || [], year: rec.year, venue: rec.venue, cites: rec.cites, ids: { ...rec.ids }, oa: !!rec.oa, local: rec.local || "", shown: 0, status: "", note: "", tldr: "", read: [] };
    } else {
      const p = st.papers[h];
      // A published record replacing a preprint brings its own year.
      if (rec.ids?.doi && !/^10\.48550\//i.test(rec.ids.doi) && this.isPreprint(p) && rec.year) p.year = rec.year;
      for (const [k, v] of Object.entries(rec.ids || {})) if (v && !p.ids[k]) p.ids[k] = v;
      if (rec.cites != null && (p.cites == null || rec.cites > p.cites)) p.cites = rec.cites;
      if (rec.venue && (!p.venue || (/arxiv|corr/i.test(p.venue) && !/arxiv|corr/i.test(rec.venue)))) p.venue = rec.venue;
      if (!p.year && rec.year) p.year = rec.year;
      if (rec.oa) p.oa = true;
      if (rec.local) p.local = rec.local;
      const longer = rec.lasts?.[0] && p.lasts?.[0] && rec.lasts[0].length > p.lasts[0].length && rec.lasts[0].endsWith(p.lasts[0]);
      if (rec.lasts?.length && (!p.lasts?.length || rec.ids?.zot || longer)) p.lasts = rec.lasts; // Zotero names are structured, so they win
    }
    if (rec.tldr) st.papers[h].tldr = rec.tldr;
    for (const k of this.recKeys(st.papers[h])) this.keys.set(k, h);
    return { h, rec: st.papers[h], fresh: !st.papers[h].shown };
  }

  get(h) { return this.ensure().papers[String(h).toUpperCase()] || null; }

  // Read another project's state without switching the active one.
  peek(name) {
    const st = this.ensure();
    if (this.file(name) === this.file(st.name)) return st;
    const f = this.file(name);
    if (!existsSync(f)) return null;
    try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; }
  }

  // Look up an existing handle by any id or title, without creating one.
  find(rec) {
    this.ensure();
    for (const k of this.recKeys(rec)) if (this.keys.has(k)) return this.keys.get(k);
    return null;
  }

  // Best identifier for a handle: prefer local Zotero PDF for reading, arXiv/DOI for online lookups.
  bestId(h, purpose = "online") {
    const p = this.get(h);
    if (!p) return null;
    const i = p.ids;
    if (purpose === "read" && i.zot) return `zot:${i.zot}`;
    if (i.arxiv) return `arXiv:${i.arxiv}`;
    if (i.doi) return i.doi;
    if (i.corpus) return `CorpusId:${i.corpus}`;
    if (i.openalex) return i.openalex;
    if (i.zot) return `zot:${i.zot}`;
    return p.title;
  }

  // arXiv-only record with no published venue or DOI known.
  isPreprint(p) { return !!p?.ids?.arxiv && !p.ids.doi && !p.published && (!p.venue || /arxiv|corr|preprint/i.test(p.venue)); }

  line(h, { full = false, text = "" } = {}) {
    const p = this.get(h);
    const fresh = !p.shown;
    p.shown++;
    if (!fresh && !full) return `${h} (seen) ${clip(oneLine(p.title), 60)}${p.status ? ` [${p.status}]` : ""}`;
    const l = this.fixLasts(p);
    const who = !l.length ? "" : l.length === 1 ? l[0] : l.length === 2 ? `${l[0]} & ${l[1]}` : `${l[0]} et al.`;
    const bits = [oneLine(p.title), [who, p.year].filter(Boolean).join(" ")];
    if (p.venue) bits.push(clip(p.venue, 60));
    if (p.cites != null) bits.push(`${p.cites}c`);
    const i = p.ids;
    // Cite the published version: DOI first, arXiv only as the open copy.
    const id = i.doi ? `doi:${i.doi}${i.arxiv ? ` (open copy arXiv:${i.arxiv})` : ""}` : i.arxiv ? `arXiv:${i.arxiv}` : i.corpus ? `CorpusId:${i.corpus}` : i.openalex || "";
    const tail = [id, p.oa ? "OA" : "", i.zot ? `zot:${i.zot}${p.local ? " " + p.local : ""}` : ""].filter(Boolean).join(" ");
    const tags = [this.isPreprint(p) ? "preprint" : "", p.status, p.role].filter(Boolean).join(", ");
    let s = `${h} ${bits.join(" | ")}${tail ? ` | ${tail}` : ""}${tags ? ` [${tags}]` : ""}`;
    if (text) s += `\n   ${text}`;
    return s;
  }

  // ---------- queries ----------
  queryKey(args) {
    const q = { ...args, query: String(args.query || "").toLowerCase().replace(/\s+/g, " ").trim() };
    delete q.force; delete q.abstract_chars;
    return JSON.stringify(Object.keys(q).sort().map((k) => [k, q[k]]));
  }
  priorQuery(args) { const st = this.ensure(); return st.queries[this.queryKey(args)] || null; }
  recordQuery(args, handles, label) {
    const st = this.ensure();
    const key = this.queryKey(args);
    const prev = st.queries[key];
    st.queries[key] = { id: prev?.id || `Q${st.qnext++}`, label, handles, at: new Date().toISOString() };
    return st.queries[key].id;
  }

  // ---------- session tool ----------
  sessions() {
    return readdirSync(this.dir).filter((f) => f.endsWith(".json")).map((f) => ({ f, m: statSync(join(this.dir, f)).mtimeMs })).sort((a, b) => b.m - a.m).map((x) => x.f.replace(/\.json$/, ""));
  }

  tool(a) {
    const action = a.action || "list";
    if (action === "start") {
      if (!a.name) throw new Error("name is required to start or resume a session");
      const existed = existsSync(this.file(a.name));
      const st = this.load(a.name);
      if (a.folder) {
        const f = String(a.folder).replace(/^~(?=\/|$)/, process.env.HOME || "~");
        if (!existsSync(f) || !statSync(f).isDirectory()) throw new Error(`folder ${f} does not exist on this Mac`);
        st.folder = f;
      }
      this.save();
      return `Session "${st.name}" ${existed ? "resumed" : "started"}: ${Object.keys(st.papers).length} papers, ${Object.keys(st.queries).length} searches.${st.folder ? ` Project folder: ${st.folder} (research map kept there).` : " No project folder set (pass folder= to keep the research map with the project)."}`;
    }
    const st = this.ensure();
    if (action === "dump") {
      // Structured snapshot for the Research Desk page. project= reads another session read-only,
      // without switching the active one (so a running Feynman session is never disturbed).
      let snap = st, active = true;
      if (a.project && this.file(a.project) !== this.file(st.name)) {
        const f = this.file(a.project);
        if (!existsSync(f)) throw new Error(`no session named "${a.project}"`);
        snap = JSON.parse(readFileSync(f, "utf8")); active = false;
      }
      const papers = Object.entries(snap.papers).map(([h, p]) => ({ h, title: p.title, lasts: this.fixLasts(p), year: p.year || null, venue: p.venue || "", cites: p.cites ?? null,
        ids: p.ids || {}, oa: !!p.oa, local: p.local || "", status: p.status || "", note: p.note || "", role: p.role || "", tldr: p.tldr || "",
        cards: p.cards || [], repos: p.repos || [], read: p.read || [], citekey: p.citekey || "", pdf: p.pdf || "", pdfFrom: p.pdfFrom || "" }));
      const queries = Object.values(snap.queries || {}).map((q) => ({ id: q.id, label: q.label, handles: q.handles, at: q.at }));
      return JSON.stringify({ name: snap.name, active, activeName: st.name, updated: snap.updated || snap.created, folder: snap.folder || "", title: snap.title || "", papers, queries, sessions: this.sessions() });
    }
    if (a.project && ["note", "card", "roles", "bibtex"].includes(action) && this.file(a.project) !== this.file(st.name))
      throw new Error(`"${a.project}" is not the active project; switch to it first (session action=start).`);
    if (action === "title") {
      const t = String(a.title || a.name || "").replace(/\s+/g, " ").trim().slice(0, 120);
      if (!t) throw new Error("title is required");
      st.title = t; this.save(); return `Project title: ${t}`;
    }
    if (action === "sessions") return ["Sessions (newest first):", ...this.sessions().map((s) => `${s === st.name.toLowerCase() ? "* " : "  "}${s}`)].join("\n");
    if (action === "note") {
      const hs = (Array.isArray(a.handles) ? a.handles : [a.handles]).filter(Boolean).map((h) => String(h).toUpperCase());
      const bad = hs.filter((h) => !st.papers[h]);
      for (const h of hs) if (st.papers[h]) {
        if (a.status) st.papers[h].status = a.status === "clear" ? "" : a.status;
        if (a.note !== undefined) st.papers[h].note = String(a.note).slice(0, 300);
      }
      this.save();
      return `Noted ${hs.length - bad.length}${bad.length ? `; unknown: ${bad.join(" ")}` : ""}.`;
    }
    if (action === "queries") {
      const qs = Object.values(st.queries).sort((x, y) => Number(x.id.slice(1)) - Number(y.id.slice(1)));
      return [`${qs.length} searches in "${st.name}":`, ...qs.map((q) => `${q.id} ${q.label} -> ${q.handles.length ? q.handles.join(" ") : "none"}`)].join("\n");
    }
    if (action === "list") {
      let hs = Object.keys(st.papers).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
      if (a.status) hs = hs.filter((h) => (a.status === "unrated" ? !st.papers[h].status : st.papers[h].status === a.status));
      if (a.query) { const q = norm(a.query); hs = hs.filter((h) => norm(st.papers[h].title).includes(q) || norm(st.papers[h].note).includes(q)); }
      const limit = Math.max(1, Math.min(Number(a.limit) || 50, 200));
      const shown = hs.slice(-limit);
      const lines = shown.map((h) => {
        const p = st.papers[h];
        const extra = [p.tldr ? "tldr" : "", p.cards?.length ? `${p.cards.length} cards` : "", p.repos?.length ? `code ${p.repos.join(" ")}` : "", p.read?.length ? `read ${p.read.join(",")}` : "", p.note ? `note: ${p.note}` : ""].filter(Boolean).join("; ");
        return this.line(h, { full: true, text: extra });
      });
      return [`Session "${st.name}": ${Object.keys(st.papers).length} papers, showing ${shown.length}${a.status ? ` (${a.status})` : ""}`, ...lines].join("\n");
    }
    if (action === "card") {
      const h = String((Array.isArray(a.handles) ? a.handles[0] : a.handles) || "").toUpperCase();
      if (!st.papers[h]) throw new Error(`card needs one known handle; got ${h || "none"}`);
      if (!a.note) throw new Error("card needs note (the claim, in a sentence)");
      const p = st.papers[h];
      // Card numbers are cited by the research map (P12#3), so cards are never dropped or renumbered.
      if ((p.cards ||= []).length >= 100) throw new Error(`${h} already has 100 cards`);
      p.cards.push({ c: String(a.note).slice(0, 300), l: String(a.loc || "").slice(0, 40), q: String(a.quote || "").slice(0, 300) });
      this.save();
      return `Card ${h}#${p.cards.length} saved.`;
    }
    if (action === "cards") {
      let hs = Array.isArray(a.handles) && a.handles.length ? a.handles.map((h) => String(h).toUpperCase()) : Object.keys(st.papers).filter((h) => (a.status ? st.papers[h].status === a.status : true));
      hs = hs.filter((h) => st.papers[h]?.cards?.length);
      if (!hs.length) return "No evidence cards yet. Save them with session(action=card) while reading.";
      const out = [];
      for (const h of hs) for (const [i, c] of st.papers[h].cards.entries()) out.push(`${h}#${i + 1}${c.l ? ` ${c.l}` : ""}: ${c.c}${c.q ? ` "${c.q}"` : ""}`);
      return out.join("\n");
    }
    if (action === "roles") {
      // Heuristic roles from citation structure within this session's set (or the given handles / status).
      let hs = Array.isArray(a.handles) && a.handles.length ? a.handles.map((h) => String(h).toUpperCase()) : Object.keys(st.papers);
      if (a.status) hs = hs.filter((h) => st.papers[h]?.status === a.status);
      hs = hs.filter((h) => st.papers[h]);
      const now = new Date().getFullYear();
      const rated = hs.filter((h) => st.papers[h].cites != null && st.papers[h].year);
      const pct = (arr, v) => arr.length ? arr.filter((x) => x <= v).length / arr.length : 0;
      const cites = rated.map((h) => st.papers[h].cites);
      const vel = rated.map((h) => st.papers[h].cites / Math.max(1, now - st.papers[h].year + 0.5));
      const groups = { foundation: [], breakthrough: [], consolidation: [], frontier: [], unrated: [] };
      for (const h of hs) {
        const p = st.papers[h];
        let role = "unrated";
        if (/\b(survey|review|overview|tutorial|systematic|state of the art|state-of-the-art)\b/i.test(p.title || "")) role = "consolidation";
        else if (p.cites != null && p.year) {
          const age = now - p.year;
          const v = p.cites / Math.max(1, age + 0.5);
          if (age >= 5 && pct(cites, p.cites) >= 0.7) role = "foundation";
          else if (age < 5 && pct(vel, v) >= 0.75 && p.cites >= 10) role = "breakthrough";
          else if (age <= 2) role = "frontier";
          else role = "consolidation";
        }
        p.role = role === "unrated" ? "" : role;
        groups[role].push(h);
      }
      this.save();
      return [`Roles for ${hs.length} papers (heuristic: citations, citation rate and age within this set; surveys count as consolidation):`,
        ...Object.entries(groups).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.join(" ")}`),
        groups.unrated.length ? "unrated papers lack citation counts; paper(detail=meta) on them fills that in." : ""].filter(Boolean).join("\n");
    }
    if (action === "tldr") {
      const hs = (Array.isArray(a.handles) ? a.handles : [a.handles]).filter(Boolean).map((h) => String(h).toUpperCase());
      return hs.map((h) => st.papers[h] ? `${h} ${clip(st.papers[h].title, 60)}\n   ${st.papers[h].tldr || "(no TLDR fetched yet)"}` : `${h}: unknown`).join("\n");
    }
    throw new Error(`unknown action ${action}`);
  }

  markRead(h, sections) {
    const p = this.get(h); if (!p) return;
    p.read = [...new Set([...(p.read || []), ...sections])].slice(0, 30);
  }
}
