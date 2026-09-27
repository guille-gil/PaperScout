// Research map: one project's concepts, definitions, questions, claims and versioned idea, tied to the
// ledger's papers (P12) and evidence cards (P12#3). Stored as research-map.json in the project folder,
// with a readable research-map.md regenerated on every change. Claude proposes; the user decides.

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const clip = (s, n) => { s = oneLine(s); return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, "") + "…"; };
const today = () => new Date().toISOString().slice(0, 10);
export const cap = (s) => { s = String(s ?? ""); return s ? s[0].toUpperCase() + s.slice(1) : s; };
const arr = (x) => (x === undefined || x === null || x === "" ? [] : Array.isArray(x) ? x : [x]).map((v) => oneLine(v)).filter(Boolean);

export const CONCEPT_STATUS = ["candidate", "adopted", "parked", "dropped"];
export const CONCEPT_ROLE = ["core", "lens", "context", ""];
export const VERDICTS = ["answered", "partly", "open", "contested", ""];
export const TRIGGERS = ["paper", "card", "supervision", "own", "data", "question"];
const FRAME = ["conversation", "opportunity", "what", "how", "why", "boundaries", "originality", "utility", "method"];
const OPPORTUNITY = ["confusion", "neglect", "application", "problematization", ""];

// rel -> allowed [from kinds, to kinds]
const RELS = {
  supports: [["card"], ["claim"]], opposes: [["card"], ["claim"]], qualifies: [["card"], ["claim"]],
  informs: [["card", "paper"], ["question"]], answers: [["claim"], ["question"]],
  uses: [["claim"], ["concept"]], sameas: [["concept"], ["concept"]], related: [["concept"], ["concept"]], broader: [["concept"], ["concept"]], partof: [["concept"], ["concept"]],
};

export function kindOf(h) {
  h = String(h || "");
  if (/^P\d+#\d+$/i.test(h)) return "card";
  if (/^P\d+$/i.test(h)) return "paper";
  if (/^C\d+$/i.test(h)) return "concept";
  if (/^D\d+$/i.test(h)) return "definition";
  if (/^RQ\d+$/i.test(h)) return "question";
  if (/^K\d+$/i.test(h)) return "claim";
  if (/^v\d+[a-z]?$/i.test(h)) return "version";
  if (/^N\d+$/i.test(h)) return "note";
  if (/^T\d+$/i.test(h)) return "task";
  if (/^E\d+$/i.test(h)) return "edge";
  return "";
}
const normH = (h) => { h = oneLine(h); return /^v\d/i.test(h) ? h.toLowerCase() : h.toUpperCase(); };

function blank(project) {
  return { schema: 1, project, created: new Date().toISOString(), updated: "", next: { C: 1, D: 1, RQ: 1, K: 1 },
    concepts: {}, definitions: {}, questions: {}, claims: {}, versions: [], links: [], notes: {} };
}

export class ResearchMap {
  // ctx: { ledger, cacheDir, pulse(label) -> {total, years, earliest}, scan(handle, terms) -> [{loc, text}] }
  constructor(ctx) { this.ctx = ctx; }

  path() {
    const st = this.ctx.ledger.ensure();
    if (st.folder) return { file: join(st.folder, "research-map.json"), inFolder: true };
    return { file: join(this.ctx.cacheDir, "maps", st.name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() + ".json"), inFolder: false };
  }

  load(project) {
    const st = this.ctx.ledger.ensure();
    let file;
    if (project && project.toLowerCase() !== st.name.toLowerCase()) {
      const other = this.ctx.ledger.peek(project);
      if (!other) throw new Error(`no project named "${project}"`);
      file = other.folder ? join(other.folder, "research-map.json") : join(this.ctx.cacheDir, "maps", other.name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() + ".json");
      this.readOnly = true;
    } else { file = this.path().file; this.readOnly = false; }
    this.file = file;
    let m = null;
    if (existsSync(file)) { try { m = JSON.parse(readFileSync(file, "utf8")); } catch (e) { throw new Error(`research-map.json could not be read (${e.message}); fix or move it before writing`); } }
    this.m = m || blank(project || st.name);
    this.m.notes ||= {}; this.m.next.N ||= 1;
    this.m.tasks ||= {}; this.m.next.T ||= 1;
    this.m.framework ||= { nodes: {}, edges: [], versions: [] }; this.m.next.E ||= 1; this.m.next.F ||= 1;
    // Questions recorded before tasks existed get their task, so they show on the board.
    for (const [q, x] of Object.entries(this.m.questions)) if (!Object.values(this.m.tasks).some((t) => t.about === q))
      this.m.tasks[`T${this.m.next.T++}`] = { title: x.text, kind: "question", source: "claude", about: q, status: x.verdict ? "done" : "todo", due: "", note: "", created: x.created || today(), done: x.verdict ? x.updated || x.created || "" : "" };
    return this.m;
  }

  save() {
    if (this.readOnly) throw new Error("that project is not the active one; switch to it first");
    this.m.updated = new Date().toISOString();
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.m, null, 1));
    renameSync(tmp, this.file);
    try { writeFileSync(this.file.replace(/\.json$/, ".md"), this.markdown()); } catch {}
  }

  // ---------- lookups ----------
  paperLabel(h) {
    const p = this.ctx.ledger.get(h);
    if (!p) return h;
    const l = this.ctx.ledger.fixLasts(p);
    const who = !l.length ? "" : l.length === 1 ? l[0] : l.length === 2 ? `${l[0]} & ${l[1]}` : `${l[0]} et al.`;
    return `${[who, p.year].filter(Boolean).join(" ") || clip(p.title, 40)} (${h})`;
  }
  card(h) {
    const [ph, n] = h.toUpperCase().split("#");
    const c = this.ctx.ledger.get(ph)?.cards?.[Number(n) - 1];
    return c || null;
  }
  exists(h) {
    const k = kindOf(h), m = this.m;
    if (k === "paper") return !!this.ctx.ledger.get(h);
    if (k === "card") return !!this.card(h);
    if (k === "concept") return !!m.concepts[h];
    if (k === "definition") return !!m.definitions[h];
    if (k === "question") return !!m.questions[h];
    if (k === "claim") return !!m.claims[h];
    if (k === "version") return m.versions.some((v) => v.v === h);
    if (k === "note") return !!m.notes[h];
    if (k === "task") return !!m.tasks[h];
    if (k === "edge") return m.framework.edges.some((e) => e.id === h);
    return false;
  }
  conceptId(ref, { create = false } = {}) {
    const r = oneLine(ref);
    if (!r) return null;
    if (/^C\d+$/i.test(r)) { const h = r.toUpperCase(); if (!this.m.concepts[h]) throw new Error(`unknown concept ${h}`); return h; }
    const low = r.toLowerCase();
    for (const [h, c] of Object.entries(this.m.concepts)) if (c.label.toLowerCase() === low || (c.alt || []).some((a) => a.toLowerCase() === low)) return h;
    if (!create) throw new Error(`no concept "${r}"; add it with action=concept first`);
    const h = `C${this.m.next.C++}`;
    this.m.concepts[h] = { label: r, alt: [], attributes: [], scope: "", use: "", useHistory: [], status: "candidate", role: "", note: "", created: today() };
    return h;
  }
  current() { return this.m.versions.find((v) => v.status === "current") || null; }
  linksOf(pred) { return this.m.links.filter(pred); }
  claimSupport(k) {
    const by = (rel) => this.m.links.filter((l) => l.to === k && l.rel === rel).map((l) => l.from);
    return { supports: by("supports"), opposes: by("opposes"), qualifies: by("qualifies") };
  }
  conceptsInUse() {
    const cur = this.current();
    const s = new Set(cur?.concepts || []);
    const claims = new Set(cur?.claims || []);
    for (const l of this.m.links) if (l.rel === "uses" && (claims.has(l.from) || this.m.claims[l.from]?.status === "active")) s.add(l.to);
    return [...s];
  }
  flags() {
    const m = this.m, out = [];
    const active = Object.entries(m.claims).filter(([, c]) => c.status === "active").map(([k]) => k);
    const unsupported = active.filter((k) => !this.claimSupport(k).supports.length);
    const contested = active.filter((k) => this.claimSupport(k).opposes.length);
    const undefinedC = this.conceptsInUse().filter((c) => m.concepts[c] && (m.concepts[c].status !== "adopted" || !m.concepts[c].use));
    const unanswered = Object.keys(m.questions).filter((q) => !m.links.some((l) => l.rel === "answers" && l.to === q));
    const triage = Object.entries(m.concepts).filter(([, c]) => c.status === "candidate").map(([k]) => k);
    if (unsupported.length) out.push(`claims without support: ${unsupported.join(" ")}`);
    if (contested.length) out.push(`claims with opposing evidence: ${contested.join(" ")}`);
    if (undefinedC.length) out.push(`concepts in use without an adopted working definition: ${undefinedC.join(" ")}`);
    if (unanswered.length) out.push(`questions without a position: ${unanswered.join(" ")}`);
    if (triage.length) out.push(`candidate concepts awaiting your triage: ${triage.join(" ")}`);
    return out;
  }

  // ---------- rendering for Claude (compact) ----------
  conceptLine(h) {
    const c = this.m.concepts[h];
    const defs = Object.values(this.m.definitions).filter((d) => d.concept === h);
    const yrs = defs.map((d) => d.year).filter(Boolean).sort();
    const bits = [`${h} ${c.label} [${[c.status, c.role].filter(Boolean).join(", ")}]`];
    if (c.alt?.length) bits.push(`aka ${c.alt.join(", ")}`);
    if (defs.length) bits.push(`${defs.length} def${defs.length > 1 ? "s" : ""}${yrs.length ? ` ${yrs[0]}${yrs.length > 1 ? "-" + yrs.at(-1) : ""}` : ""}`);
    if (c.pulse) bits.push(`pulse ${c.pulse.total} works${c.pulse.first ? ` since ${c.pulse.first}` : ""}`);
    const rel = this.m.links.filter((l) => l.from === h && ["sameas", "related", "broader"].includes(l.rel)).map((l) => `${l.rel} ${l.to}`);
    if (rel.length) bits.push(rel.join(", "));
    if (c.use) bits.push(`use: ${clip(c.use, 120)}`);
    return bits.join(" | ");
  }
  versionText(v) {
    const lines = [`${v.v} (${v.status}, ${v.date}${v.of ? `, revises ${v.of}` : ""}): ${v.statement}`];
    for (const f of FRAME) if (v[f]) lines.push(`  ${f}: ${v[f]}`);
    const empty = FRAME.filter((f) => !v[f]);
    if (empty.length) lines.push(`  (empty: ${empty.join(", ")})`);
    for (const k of v.claims || []) {
      const c = this.m.claims[k]; if (!c) continue;
      const s = this.claimSupport(k);
      lines.push(`  ${k} ${c.text} [+${s.supports.length} -${s.opposes.length} ~${s.qualifies.length}]`);
    }
    if (v.concepts?.length) lines.push(`  concepts: ${v.concepts.map((c) => `${c} ${this.m.concepts[c]?.label || "?"}`).join("; ")}`);
    if (v.trigger) lines.push(`  trigger: ${v.trigger.type}${v.trigger.ref ? " " + v.trigger.ref : ""}${v.trigger.note ? ": " + v.trigger.note : ""}`);
    if (v.change) lines.push(`  change: ${v.change}`);
    if (v.rationale) lines.push(`  rationale: ${v.rationale}`);
    return lines.join("\n");
  }

  // ---------- the tool ----------
  async tool(a) {
    const action = a.action || "show";
    this.load(a.project);
    const m = this.m;
    const where = () => { const p = this.path(); return p.inFolder ? p.file : `${p.file} (no project folder set; pass folder= to session start to keep the map with your project)`; };

    if (action === "show") {
      const cur = this.current();
      const cs = Object.values(m.concepts);
      const count = (s) => cs.filter((c) => c.status === s).length;
      return [`Research map "${m.project}" (${where()})`,
        cur ? `Idea ${cur.v}: ${cur.statement}` : "No idea version yet (map action=revise writes v1, after the user agrees).",
        `Concepts: ${count("adopted")} adopted, ${count("candidate")} candidate, ${count("parked")} parked, ${count("dropped")} dropped. Definitions ${Object.keys(m.definitions).length}. Claims ${Object.keys(m.claims).length}. Questions ${Object.keys(m.questions).length}. Versions ${m.versions.length}.`,
        ...this.flags().map((f) => `! ${f}`),
        Object.values(m.notes).some((n) => n.status === "open") ? `Open notes from the user: ${Object.entries(m.notes).filter(([, n]) => n.status === "open").map(([k]) => k).join(" ")} (map action=notes)` : ""].filter(Boolean).join("\n");
    }
    if (action === "concepts") {
      let hs = Object.keys(m.concepts).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
      if (a.status) hs = hs.filter((h) => m.concepts[h].status === a.status);
      if (!hs.length) return a.status ? `No ${a.status} concepts.` : "No concepts yet.";
      return hs.map((h) => this.conceptLine(h)).join("\n");
    }
    if (action === "concept") {
      const ref = a.id || a.label;
      if (!ref) throw new Error("concept needs id (C3) or label");
      const isNew = !/^C\d+$/i.test(oneLine(ref)) && !Object.values(m.concepts).some((c) => c.label.toLowerCase() === oneLine(ref).toLowerCase() || c.alt.some((x) => x.toLowerCase() === oneLine(ref).toLowerCase()));
      const h = this.conceptId(ref, { create: true });
      const c = m.concepts[h];
      if (a.id && a.label) c.label = oneLine(a.label);
      if (a.alt !== undefined) c.alt = [...new Set([...(c.alt || []), ...arr(a.alt)])];
      if (a.attributes !== undefined) c.attributes = arr(a.attributes);
      if (a.scope !== undefined) c.scope = oneLine(a.scope);
      if (a.note !== undefined) c.note = oneLine(a.note);
      if (a.status !== undefined) { if (!CONCEPT_STATUS.includes(a.status)) throw new Error(`status must be one of ${CONCEPT_STATUS.join(", ")}`); c.status = a.status; }
      if (a.role !== undefined) { if (!CONCEPT_ROLE.includes(a.role)) throw new Error("role must be core, lens or context"); c.role = a.role; }
      if (a.use !== undefined && oneLine(a.use) !== c.use) { if (c.use) c.useHistory.push({ text: c.use, until: today() }); c.use = oneLine(a.use); }
      for (const rel of ["related", "broader", "sameas", "partof"]) for (const t of arr(a[rel])) this.addLink(h, rel, this.conceptId(t, { create: true }));
      if (a.parent !== undefined) {
        // Place the concept in the working ontology: one parent, as a kind of it (broader) or a part of it.
        m.links = m.links.filter((l) => !(l.from === h && ["broader", "partof"].includes(l.rel)));
        if (a.parent) { const p = this.conceptId(a.parent); if (this.ontologyAncestors(p).includes(h)) throw new Error("that would make a loop in the ontology"); this.addLink(h, a.parent_rel === "partof" ? "partof" : "broader", p); }
      }
      this.save();
      return `${isNew ? "Added" : "Updated"} ${this.conceptLine(h)}`;
    }
    if (action === "define") {
      if (!a.quote) throw new Error("define needs quote (the definition, verbatim)");
      const ph = String(a.handle || "").toUpperCase();
      const p = this.ctx.ledger.get(ph);
      if (!p) throw new Error(`define needs handle, a known paper (P12); got ${ph || "none"}`);
      const c = this.conceptId(a.id || a.label, { create: true });
      const dup = Object.entries(m.definitions).find(([, d]) => d.concept === c && d.h === ph && oneLine(d.quote) === oneLine(a.quote));
      if (dup) return `Already saved as ${dup[0]}.`;
      const h = `D${m.next.D++}`;
      m.definitions[h] = { concept: c, quote: String(a.quote).trim().slice(0, 1200), h: ph, year: p.year || null, loc: oneLine(a.loc).slice(0, 40), kind: a.kind === "implicit" ? "implicit" : "explicit", attrs: [], at: today() };
      if (a.attributes !== undefined) this.tagDef(h, arr(a.attributes));
      this.save();
      return `${h} saved: ${m.concepts[c].label} (${c}) as defined by ${this.paperLabel(ph)}.`;
    }
    if (action === "tag") {
      const d = String(a.id || "").toUpperCase();
      if (!m.definitions[d]) throw new Error(`tag needs id, a definition (D3); got ${d || "none"}`);
      this.tagDef(d, arr(a.attributes));
      this.save();
      return `${d} has: ${m.definitions[d].attrs.join("; ") || "no attributes"}.`;
    }
    if (action === "compare") {
      const c = this.conceptId(a.id || a.label);
      const t = this.compareTable(c);
      if (!t.defs.length) return `No definitions saved for ${c} yet.`;
      if (!t.attrs.length) return `${t.defs.length} definitions for ${c}, none tagged yet. Tag each with action=tag id=D.. attributes=[...] (short attribute names, reused across definitions).`;
      const head = `| Definition | ${t.attrs.join(" | ")} |`;
      const rows = t.defs.map(([dh, d]) => `| ${dh} ${d.year || "n.d."} ${this.paperLabel(d.h).replace(/ \(P\d+\)$/, "")} | ${t.attrs.map((x) => (d.attrs || []).includes(x) ? "x" : "").join(" | ")} |`);
      const shared = t.attrs.filter((x) => t.defs.every(([, d]) => (d.attrs || []).includes(x)));
      return [head, `|${" --- |".repeat(t.attrs.length + 1)}`, ...rows, shared.length ? `Shared by all: ${shared.join("; ")}.` : "No attribute is shared by all definitions."].join("\n");
    }
    if (action === "note") {
      if (a.id) {
        const n = String(a.id).toUpperCase(); if (!m.notes[n]) throw new Error(`unknown note ${n}`);
        if (a.status) { if (!["open", "done"].includes(a.status)) throw new Error("note status: open or done"); m.notes[n].status = a.status; }
        if (a.text) m.notes[n].text = String(a.text).trim().slice(0, 2000);
        this.save(); return `${n} is ${m.notes[n].status}.`;
      }
      if (!a.text) throw new Error("note needs text");
      const kind = ["thought", "supervision", "check"].includes(a.kind) ? a.kind : "thought";
      const about = a.about ? normH(a.about) : "";
      if (about && !this.exists(about)) throw new Error(`${about} is not known`);
      const n = `N${m.next.N++}`;
      m.notes[n] = { text: String(a.text).trim().slice(0, 2000), kind, about, at: new Date().toISOString(), status: "open", used: "" };
      this.save();
      return `${n} saved.`;
    }
    if (action === "notes") {
      const ns = Object.entries(m.notes).filter(([, n]) => (a.status ? n.status === a.status : n.status === "open"));
      if (!ns.length) return a.status ? `No ${a.status} notes.` : "No open notes.";
      return ns.map(([k, n]) => `${k} ${n.at.slice(0, 10)} ${n.kind}${n.about ? " on " + n.about : ""}: ${n.text}`).join("\n");
    }
    if (action === "summary") {
      const file = this.file.replace(/research-map\.json$/, "research-summary.html");
      writeFileSync(file, this.summaryHtml(await this.references()));
      return `Wrote ${file}. Open it in a browser and print, or save as PDF.`;
    }
    if (action === "task") {
      const KINDS = ["read", "question", "write", "check", "other"], SRC = ["you", "supervisor", "feynman", "claude"], ST = ["todo", "doing", "done"];
      let t = a.id ? String(a.id).toUpperCase() : null;
      if (t && !m.tasks[t]) throw new Error(`unknown task ${t}`);
      if (!t) {
        const title = oneLine(a.text || a.title);
        if (!title) throw new Error("task needs text (what to do)");
        const kind = KINDS.includes(a.kind) ? a.kind : "other";
        let about = a.about ? normH(a.about) : "";
        if (about && !this.exists(about)) throw new Error(`${about} is not known`);
        if (kind === "question" && !about) { about = `RQ${m.next.RQ++}`; m.questions[about] = { text: title, verdict: "", coverage: "", created: today() }; }
        t = `T${m.next.T++}`;
        m.tasks[t] = { title, kind, source: SRC.includes(a.source) ? a.source : "claude", about, status: "todo", due: "", note: "", created: today() };
      }
      const x = m.tasks[t];
      if (a.id && (a.text || a.title)) x.title = oneLine(a.text || a.title);
      if (a.status !== undefined) { if (!ST.includes(a.status)) throw new Error("task status: todo, doing or done"); x.status = a.status; x.done = a.status === "done" ? today() : ""; }
      if (a.due !== undefined) { if (a.due && !/^\d{4}-\d{2}-\d{2}$/.test(a.due)) throw new Error("due as YYYY-MM-DD"); x.due = a.due; }
      if (a.note !== undefined) x.note = String(a.note).trim().slice(0, 2000);
      this.save();
      return `${t} ${x.title} [${x.kind}, ${x.status}${x.about ? ", " + x.about : ""}]`;
    }
    if (action === "tasks") {
      const want = a.status ? [a.status] : ["doing", "todo"];
      const ts = Object.entries(m.tasks).filter(([, t]) => want.includes(t.status)).sort((x, y) => want.indexOf(x[1].status) - want.indexOf(y[1].status));
      if (!ts.length) return "No open tasks.";
      return ts.map(([k, t]) => `${k} [${t.status}] ${t.kind}: ${t.title}${t.about ? ` (${t.about})` : ""}${t.due ? ` due ${t.due}` : ""} from ${t.source}`).join("\n");
    }
    if (action === "framework") return this.frameworkOp(a);
    if (action === "definitions") {
      const c = a.id || a.label ? this.conceptId(a.id || a.label) : null;
      const ds = Object.entries(m.definitions).filter(([, d]) => !c || d.concept === c).sort((x, y) => (x[1].year || 9999) - (y[1].year || 9999));
      if (!ds.length) return "No definitions saved yet.";
      return ds.map(([h, d]) => `${h} ${d.year || "n.d."} ${this.paperLabel(d.h)}${d.loc ? " " + d.loc : ""}${c ? "" : ` [${d.concept} ${m.concepts[d.concept]?.label}]`}${d.kind === "implicit" ? " (implicit)" : ""}: "${clip(d.quote, 400)}"`).join("\n");
    }
    if (action === "pulse") {
      const h = this.conceptId(a.id || a.label, { create: true });
      const c = m.concepts[h];
      const phrase = oneLine(a.phrase || c.label);
      const r = await this.ctx.pulse(phrase);
      c.pulse = { phrase, at: today(), total: r.total, years: r.years, first: r.earliest?.[0]?.year || null, earliest: r.earliest || [] };
      this.save();
      const ys = Object.entries(r.years).sort((x, y) => x[0] - y[0]);
      const partial = ys.length && Number(ys.at(-1)[0]) === new Date().getFullYear() ? " (current year to date)" : "";
      return [`${h} "${phrase}": ${r.total.toLocaleString("en-GB")} works in OpenAlex (title or abstract).`,
        ys.map(([y, n]) => `${y} ${n}`).join(", ") + partial,
        r.earliest?.length ? `Earliest: ${r.earliest.map((e) => `${e.year} ${clip(e.title, 70)}${e.doi ? " doi:" + e.doi : ""}`).join("; ")}` : ""].filter(Boolean).join("\n");
    }
    if (action === "scan") {
      const h = this.conceptId(a.id || a.label);
      const c = m.concepts[h];
      const terms = [c.label, ...(c.alt || [])];
      let hs = arr(a.handles).map((x) => x.toUpperCase());
      if (!hs.length) hs = Object.keys(this.ctx.ledger.ensure().papers).filter((x) => this.ctx.ledger.get(x).status === "kept");
      if (!hs.length) throw new Error("scan needs handles, or kept papers in the ledger");
      const max = Math.min(Number(a.limit) || 8, 15);
      const out = [], skipped = [];
      for (const ph of hs.slice(0, max)) {
        try {
          const hits = await this.ctx.scan(ph, terms);
          for (const x of hits.slice(0, 3)) out.push(`${ph} ${x.loc}: "${clip(x.text, 420)}"`);
        } catch (e) { skipped.push(`${ph} (${clip(e.message, 40)})`); }
      }
      return [`Definition candidates for ${h} ${c.label} in ${Math.min(hs.length, max)} papers (explicit phrasings only; implicit definitions need reading). Save good ones with action=define.`,
        ...(out.length ? out : ["none found"]), skipped.length ? `No text: ${skipped.join(", ")}` : "", hs.length > max ? `${hs.length - max} more papers not scanned (limit=${max}).` : ""].filter(Boolean).join("\n");
    }
    if (action === "claim") {
      let k = a.id ? String(a.id).toUpperCase() : null;
      if (k && !m.claims[k]) throw new Error(`unknown claim ${k}`);
      if (!k) { if (!a.text) throw new Error("claim needs text (one complete sentence)"); k = `K${m.next.K++}`; m.claims[k] = { text: oneLine(a.text), status: "active", history: [], created: today() }; }
      else if (a.text && oneLine(a.text) !== m.claims[k].text) { m.claims[k].history.push({ text: m.claims[k].text, until: today() }); m.claims[k].text = oneLine(a.text); }
      if (a.status) { if (!["active", "revised", "dropped"].includes(a.status)) throw new Error("claim status: active, revised or dropped"); m.claims[k].status = a.status; }
      for (const t of arr(a.uses)) this.addLink(k, "uses", this.conceptId(t, { create: true }));
      for (const t of arr(a.answers)) this.addLink(k, "answers", t.toUpperCase());
      this.save();
      return `${k} ${m.claims[k].text} [${m.claims[k].status}]`;
    }
    if (action === "question") {
      let q = a.id ? String(a.id).toUpperCase() : null;
      if (q && !m.questions[q]) throw new Error(`unknown question ${q}`);
      if (!q) {
        if (!a.text) throw new Error("question needs text"); q = `RQ${m.next.RQ++}`; m.questions[q] = { text: oneLine(a.text), verdict: "", coverage: "", created: today() };
        if (!Object.values(m.tasks).some((t) => t.about === q)) { const t = `T${m.next.T++}`; m.tasks[t] = { title: oneLine(a.text), kind: "question", source: a.source || "claude", about: q, status: "doing", due: "", note: "", created: today() }; }
      }
      else if (a.text) m.questions[q].text = oneLine(a.text);
      if (a.verdict !== undefined) {
        if (!VERDICTS.includes(a.verdict)) throw new Error(`verdict: ${VERDICTS.filter(Boolean).join(", ")}`);
        m.questions[q].verdict = a.verdict; m.questions[q].updated = today();
        if (a.verdict) for (const t of Object.values(m.tasks)) if (t.about === q && t.status !== "done") Object.assign(t, { status: "done", done: today() });
      }
      if (a.coverage !== undefined) m.questions[q].coverage = oneLine(a.coverage);
      this.save();
      const pos = m.links.filter((l) => l.rel === "answers" && l.to === q).map((l) => l.from);
      return `${q} ${m.questions[q].text} [${m.questions[q].verdict || "no verdict"}]${pos.length ? ` positions: ${pos.join(" ")}` : ""}`;
    }
    if (action === "questions") {
      const qs = Object.entries(m.questions);
      if (!qs.length) return "No questions yet.";
      return qs.map(([q, x]) => {
        const pos = m.links.filter((l) => l.rel === "answers" && l.to === q).map((l) => `${l.from} ${clip(m.claims[l.from]?.text, 90)}`);
        return `${q} ${x.text} [${x.verdict || "no verdict"}]${x.coverage ? ` (${x.coverage})` : ""}${pos.length ? "\n  " + pos.join("\n  ") : ""}`;
      }).join("\n");
    }
    if (action === "link" || action === "unlink") {
      const rel = String(a.rel || "").toLowerCase().replace(/[\s_-]/g, "");
      if (!RELS[rel]) throw new Error(`rel must be one of ${Object.keys(RELS).join(", ")}`);
      const froms = arr(a.from).map(normH), tos = arr(a.to).map(normH);
      if (!froms.length || !tos.length) throw new Error("link needs from and to");
      let n = 0;
      for (const f of froms) for (const t of tos) {
        if (action === "unlink") { const before = m.links.length; m.links = m.links.filter((l) => !(l.from === f && l.to === t && l.rel === rel)); n += before - m.links.length; }
        else { n += this.addLink(f, rel, t, a.note) ? 1 : 0; }
      }
      this.save();
      return `${action === "link" ? "Linked" : "Removed"} ${n}: ${froms.join(" ")} ${rel} ${tos.join(" ")}.`;
    }
    if (action === "revise") {
      if (!a.statement && !a.branch_of && !m.versions.length) throw new Error("the first version needs statement");
      if (!a.trigger || !TRIGGERS.includes(a.trigger)) throw new Error(`revise needs trigger: ${TRIGGERS.join(", ")}`);
      const base = a.branch_of ? m.versions.find((v) => v.v === String(a.branch_of).toLowerCase()) : this.current() || m.versions.at(-1);
      if (a.branch_of && !base) throw new Error(`unknown version ${a.branch_of}`);
      if (m.versions.length && !a.change) throw new Error("revise needs change (what changed, in a sentence)");
      const main = m.versions.filter((v) => /^v\d+$/.test(v.v)).length;
      let id;
      if (a.branch_of) { const root = base.v.match(/^v\d+/)[0]; const used = m.versions.filter((v) => v.v.startsWith(root) && v.v !== root).length; id = root + "abcdefghijklmnopqrstuvwxyz"[used]; }
      else id = `v${main + 1}`;
      const v = { v: id, date: today(), of: base?.v || "", status: a.branch_of ? "branch" : "current", statement: oneLine(a.statement || base?.statement) };
      for (const f of FRAME) v[f] = a[f] !== undefined ? oneLine(a[f]) : base?.[f] || "";
      if (v.opportunity && !OPPORTUNITY.includes(v.opportunity)) throw new Error(`opportunity: ${OPPORTUNITY.filter(Boolean).join(", ")}`);
      v.claims = a.claims !== undefined ? arr(a.claims).map((x) => x.toUpperCase()) : [...(base?.claims || [])];
      v.concepts = a.concepts !== undefined ? arr(a.concepts).map((x) => this.conceptId(x)) : [...(base?.concepts || [])];
      for (const k of v.claims) if (!m.claims[k]) throw new Error(`unknown claim ${k}; add it with action=claim first`);
      v.trigger = { type: a.trigger, ref: oneLine(a.trigger_ref), note: oneLine(a.trigger_note) };
      if (v.trigger.ref) for (const r of v.trigger.ref.split(/[\s,]+/)) if (kindOf(r) && !this.exists(normH(r))) throw new Error(`trigger_ref ${r} is not known`);
      v.change = oneLine(a.change || "First version.");
      if (m.framework.versions.length) v.framework = m.framework.versions.at(-1).v;
      v.rationale = oneLine(a.rationale);
      if (base) v.diff = FRAME.concat(["statement"]).filter((f) => (v[f] || "") !== (base[f] || ""))
        .concat(v.claims.filter((k) => !base.claims?.includes(k)).map((k) => `+${k}`), (base.claims || []).filter((k) => !v.claims.includes(k)).map((k) => `-${k}`),
          v.concepts.filter((k) => !base.concepts?.includes(k)).map((k) => `+${k}`), (base.concepts || []).filter((k) => !v.concepts.includes(k)).map((k) => `-${k}`));
      if (!a.branch_of) for (const o of m.versions) if (o.status === "current") o.status = "superseded";
      for (const r of v.trigger.ref.split(/[\s,]+/)) if (kindOf(r) === "note" && m.notes[r.toUpperCase()]) Object.assign(m.notes[r.toUpperCase()], { status: "done", used: id });
      m.versions.push(v);
      this.save();
      return `Wrote ${id}${base ? ` (from ${base.v}; changed: ${v.diff.join(", ") || "nothing but the record"})` : ""}.`;
    }
    if (action === "version") {
      const v = m.versions.find((x) => x.v === String(a.id || "").toLowerCase());
      if (!v) throw new Error(`unknown version ${a.id}`);
      if (!["current", "abandoned"].includes(a.status)) throw new Error("version status: current (adopt it) or abandoned");
      if (a.status === "current") for (const o of m.versions) if (o.status === "current") o.status = "superseded";
      v.status = a.status;
      this.save();
      return `${v.v} is now ${v.status}.`;
    }
    if (action === "idea") {
      if (!m.versions.length) return "No idea version yet.";
      const v = a.id ? m.versions.find((x) => x.v === String(a.id).toLowerCase()) : this.current() || m.versions.at(-1);
      if (!v) throw new Error(`unknown version ${a.id}`);
      const hist = [...m.versions].reverse().map((x) => `${x.v} ${x.date} ${x.status} ${x.trigger?.type || ""}${x.trigger?.ref ? " " + x.trigger.ref : ""}: ${clip(x.change, 90)}`);
      return `${this.versionText(v)}\nHistory:\n${hist.join("\n")}`;
    }
    throw new Error(`unknown action ${action}`);
  }

  ontologyAncestors(c, seen = []) {
    const up = this.m.links.filter((l) => l.from === c && ["broader", "partof"].includes(l.rel)).map((l) => l.to);
    for (const u of up) if (!seen.includes(u)) { seen.push(u); this.ontologyAncestors(u, seen); }
    return seen;
  }
  // ---------- framework (the conceptual framework figure) ----------
  edgeEvidence(e) {
    if (!e.claim || !this.m.claims[e.claim]) return "none";
    const s = this.claimSupport(e.claim);
    return s.opposes.length ? "contested" : s.supports.length ? "supported" : "unsupported";
  }
  placeNode(c) {
    const F = this.m.framework;
    if (F.nodes[c]) return;
    // Free slot on a roomy grid (canvas 900 wide), so arrows between neighbours stay visible.
    const free = (x, y) => Object.values(F.nodes).every((n) => Math.abs(n.x - x) > 200 || Math.abs(n.y - y) > 110);
    for (let i = 0; i < 300; i++) { const x = 130 + (i % 3) * 320, y = 70 + Math.floor(i / 3) * 150; if (free(x, y)) { F.nodes[c] = { x, y }; return; } }
    F.nodes[c] = { x: 130, y: 70 };
  }
  edgeLine(e) {
    const m = this.m, lab = (h) => kindOf(h) === "edge" ? `edge ${h}` : `${h} ${m.concepts[h]?.label || "?"}`;
    const ev = this.edgeEvidence(e);
    return `${e.id} ${lab(e.from)} ${e.type}${e.sign ? `(${e.sign})` : ""} ${lab(e.to)} [${e.status}${e.claim ? `, ${e.claim} ${ev}` : ", no claim"}]${e.note ? ` ${e.note}` : ""}`;
  }
  frameworkOp(a) {
    const m = this.m, F = m.framework, op = a.op || "show";
    const by = a.by === "you" ? "you" : "claude";
    const TYPES = ["influences", "moderates", "associated"];
    const edge = (id) => { const e = F.edges.find((x) => x.id === String(id || "").toUpperCase()); if (!e) throw new Error(`unknown edge ${id}`); return e; };
    if (op === "show") {
      const nodes = Object.keys(F.nodes);
      if (!nodes.length) return "The framework is empty. Add concepts with op=add_node or relationships with op=add_edge.";
      const live = F.edges.filter((e) => e.status !== "rejected");
      return [`Framework: ${nodes.map((c) => `${c} ${m.concepts[c]?.label}`).join("; ")}.`, ...live.map((e) => this.edgeLine(e)),
        F.versions.length ? `Versions: ${F.versions.map((v) => `${v.v} ${v.date}${v.note ? " " + v.note : ""}`).join("; ")}` : "No saved versions."].join("\n");
    }
    if (op === "add_node") { for (const c of arr(a.id || a.from)) this.placeNode(this.conceptId(c)); this.save(); return `In the framework: ${Object.keys(F.nodes).join(" ")}.`; }
    if (op === "remove_node") {
      const c = this.conceptId(a.id); delete F.nodes[c];
      const gone = new Set(F.edges.filter((e) => e.from === c || e.to === c).map((e) => e.id));
      F.edges = F.edges.filter((e) => !gone.has(e.id) && !gone.has(e.to));
      this.save(); return `Removed ${c} and ${gone.size} relationship${gone.size === 1 ? "" : "s"}.`;
    }
    if (op === "move") {
      const c = this.conceptId(a.id); if (!F.nodes[c]) throw new Error(`${c} is not in the framework`);
      F.nodes[c] = { x: Math.max(79, Math.min(821, Math.round(Number(a.x) || 0))), y: Math.max(30, Math.min(2000, Math.round(Number(a.y) || 0))) };
      this.save(); return `Moved ${c}.`;
    }
    if (op === "add_edge") {
      const type = TYPES.includes(a.type) ? a.type : "influences";
      const from = this.conceptId(arr(a.from)[0]);
      const toRaw = normH(arr(a.to)[0] || "");
      let to;
      if (type === "moderates") { if (kindOf(toRaw) !== "edge") throw new Error("moderates points at a relationship (E3), not a concept"); to = edge(toRaw).id; }
      else to = this.conceptId(toRaw);
      if (from === to) throw new Error("a concept cannot relate to itself");
      if (F.edges.some((e) => e.from === from && e.to === to && e.type === type && e.status !== "rejected")) return "That relationship is already in the framework.";
      const claim = a.claim ? String(a.claim).toUpperCase() : "";
      if (claim && !m.claims[claim]) throw new Error(`unknown claim ${claim}`);
      this.placeNode(from); if (kindOf(to) === "concept") this.placeNode(to);
      const e = { id: `E${m.next.E++}`, from, to, type, sign: ["+", "-"].includes(a.sign) ? a.sign : "", claim, note: oneLine(a.note), status: by === "you" ? "accepted" : "proposed", by, at: today() };
      F.edges.push(e); this.save();
      return `${e.status === "proposed" ? "Proposed" : "Added"} ${this.edgeLine(e)}`;
    }
    if (op === "edit_edge") {
      const e = edge(a.id);
      if (a.type !== undefined && TYPES.includes(a.type)) e.type = a.type;
      if (a.sign !== undefined) e.sign = ["+", "-"].includes(a.sign) ? a.sign : "";
      if (a.claim !== undefined) { const k = String(a.claim || "").toUpperCase(); if (k && !m.claims[k]) throw new Error(`unknown claim ${k}`); e.claim = k; }
      if (a.note !== undefined) e.note = oneLine(a.note);
      if (a.status !== undefined) { if (!["accepted", "rejected", "proposed"].includes(a.status)) throw new Error("status: accepted or rejected"); e.status = a.status; }
      this.save(); return this.edgeLine(e);
    }
    if (op === "remove_edge") { const e = edge(a.id); F.edges = F.edges.filter((x) => x.id !== e.id && x.to !== e.id); this.save(); return `Removed ${e.id}.`; }
    if (op === "save") {
      const v = { v: `F${m.next.F++}`, date: today(), note: oneLine(a.note), nodes: JSON.parse(JSON.stringify(F.nodes)), edges: JSON.parse(JSON.stringify(F.edges.filter((e) => e.status === "accepted"))) };
      F.versions.push(v); this.save(); return `Saved framework ${v.v}.`;
    }
    if (op === "restore") {
      const v = F.versions.find((x) => x.v === String(a.id || "").toUpperCase()); if (!v) throw new Error(`unknown framework version ${a.id}`);
      F.nodes = JSON.parse(JSON.stringify(v.nodes)); F.edges = [...JSON.parse(JSON.stringify(v.edges)), ...F.edges.filter((e) => e.status === "rejected")];
      this.save(); return `Restored ${v.v} as the working framework.`;
    }
    if (op === "export") {
      const file = this.file.replace(/research-map\.json$/, "research-framework.svg");
      writeFileSync(file, this.frameworkSvg()); return `Wrote ${file}.`;
    }
    throw new Error("framework op: show, add_node, remove_node, move, add_edge, edit_edge, remove_edge, save, restore, export");
  }
  // Plain black-and-white figure for papers.
  frameworkSvg() {
    const m = this.m, F = m.framework, W = 150, H = 48;
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const nodes = Object.entries(F.nodes);
    if (!nodes.length) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 60"><text x="10" y="30">Empty framework</text></svg>`;
    const xs = nodes.map(([, n]) => n.x), ys = nodes.map(([, n]) => n.y);
    const x0 = Math.min(...xs) - W / 2 - 30, y0 = Math.min(...ys) - H / 2 - 30, x1 = Math.max(...xs) + W / 2 + 30, y1 = Math.max(...ys) + H / 2 + 30;
    const clipBox = (cx, cy, tx, ty) => { const dx = tx - cx, dy = ty - cy; if (!dx && !dy) return [cx, cy]; const s = Math.min(Math.abs((W / 2 + 4) / (dx || 1e-9)), Math.abs((H / 2 + 4) / (dy || 1e-9))); return [cx + dx * s, cy + dy * s]; };
    const mid = {};
    const live = F.edges.filter((e) => e.status === "accepted");
    const lines = [];
    for (const e of live.filter((e) => e.type !== "moderates")) {
      const a = F.nodes[e.from], b = F.nodes[e.to]; if (!a || !b) continue;
      const [sx, sy] = clipBox(a.x, a.y, b.x, b.y), [tx, ty] = clipBox(b.x, b.y, a.x, a.y);
      mid[e.id] = [(sx + tx) / 2, (sy + ty) / 2];
      const dash = this.edgeEvidence(e) === "supported" ? "" : ` stroke-dasharray="6 4"`;
      lines.push(`<line x1="${sx}" y1="${sy}" x2="${tx}" y2="${ty}" stroke="#000" stroke-width="1.4"${dash}${e.type === "influences" ? ' marker-end="url(#a)"' : ""}/>`);
      if (e.sign) lines.push(`<text x="${mid[e.id][0] + 8}" y="${mid[e.id][1] - 6}" font-size="14">${e.sign === "-" ? "\u2212" : "+"}</text>`);
    }
    for (const e of live.filter((e) => e.type === "moderates")) {
      const a = F.nodes[e.from], t = mid[e.to]; if (!a || !t) continue;
      const [sx, sy] = clipBox(a.x, a.y, t[0], t[1]);
      lines.push(`<line x1="${sx}" y1="${sy}" x2="${t[0]}" y2="${t[1]}" stroke="#000" stroke-width="1.4"${this.edgeEvidence(e) === "supported" ? "" : ' stroke-dasharray="6 4"'} marker-end="url(#a)"/>`);
    }
    const boxes = nodes.map(([c, n]) => {
      const words = cap(m.concepts[c]?.label || c).split(/\s+/); const L = [""];
      for (const w of words) { if ((L.at(-1) + " " + w).trim().length > 20 && L.at(-1)) L.push(w); else L[L.length - 1] = (L.at(-1) + " " + w).trim(); }
      const t = L.slice(0, 2).map((l, i) => `<text x="${n.x}" y="${n.y + (L.length > 1 ? (i ? 12 : -3) : 5)}" text-anchor="middle" font-size="13">${esc(l)}</text>`).join("");
      return `<rect x="${n.x - W / 2}" y="${n.y - H / 2}" width="${W}" height="${H}" fill="#fff" stroke="#000" stroke-width="1.4"/>${t}`;
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" font-family="Helvetica, Arial, sans-serif"><defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#000"/></marker></defs>${lines.join("")}${boxes.join("")}</svg>`;
  }

  // APA references for the papers the summary rests on.
  async references() {
    const m = this.m, cur = this.current(), hs = new Set();
    if (cur) {
      for (const k of cur.claims || []) { const s = this.claimSupport(k); for (const h of [...s.supports, ...s.opposes, ...s.qualifies]) hs.add(h.split("#")[0]); }
      for (const c of cur.concepts || []) for (const d of Object.values(m.definitions)) if (d.concept === c) hs.add(d.h);
    }
    if (!this.ctx.apa) return [];
    return (await this.ctx.apa([...hs])).sort((a, b) => a.localeCompare(b));
  }

  tagDef(d, attrs) {
    const def = this.m.definitions[d];
    const c = this.m.concepts[def.concept];
    c.attributes ||= [];
    const canon = (x) => c.attributes.find((y) => y.toLowerCase() === x.toLowerCase()) || x;
    def.attrs = [...new Set(attrs.map(canon))];
    for (const x of def.attrs) if (!c.attributes.includes(x)) c.attributes.push(x);
  }
  compareTable(c) {
    const defs = Object.entries(this.m.definitions).filter(([, d]) => d.concept === c).sort((x, y) => (x[1].year || 9999) - (y[1].year || 9999));
    const used = new Set(defs.flatMap(([, d]) => d.attrs || []));
    const attrs = (this.m.concepts[c]?.attributes || []).filter((x) => used.has(x));
    attrs.sort((x, y) => defs.filter(([, d]) => (d.attrs || []).includes(y)).length - defs.filter(([, d]) => (d.attrs || []).includes(x)).length);
    return { defs, attrs };
  }

  // One page, black and white, for supervision meetings.
  summaryHtml(refs = []) {
    const m = this.m, cur = this.current();
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const LBL = { conversation: "Conversation joined", opportunity: "Kind of gap", what: "What", how: "How", why: "Why", boundaries: "Where it holds", originality: "Originality", utility: "Utility" };
    const parts = [];
    parts.push(`<header><div class="proj">${esc(this.ctx.ledger.peek?.(m.project)?.title || m.project)}</div><div class="date">${esc(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }))}</div></header>`);
    if (!cur) parts.push("<p>No idea recorded yet.</p>");
    else {
      parts.push(`<h1>${esc(cur.statement)}</h1><p class="meta">Version ${esc(cur.v)} of ${esc(cur.date)}${cur.of ? `. Last change: ${esc(cur.change)}` : ""}</p>`);
      const fr = Object.keys(LBL).filter((k) => cur[k]);
      if (fr.length) parts.push(`<h2>Framing</h2><dl>${fr.map((k) => `<dt>${LBL[k]}</dt><dd>${esc(cap(k === "opportunity" ? { confusion: "Confusion spotting", neglect: "Neglect spotting", application: "Application spotting", problematization: "Problematization" }[cur[k]] || cur[k] : cur[k]))}</dd>`).join("")}</dl>`);
      if (cur.method) parts.push(`<h2>Methodology</h2><p>${esc(cap(cur.method))}</p>`);
      const claims = (cur.claims || []).filter((k) => m.claims[k]);
      if (claims.length) parts.push(`<h2>Argument</h2><ol>${claims.map((k) => { const s = this.claimSupport(k); const src = (hs) => [...new Set(hs.map((h) => this.paperLabel(h.split("#")[0]).replace(/ \(P\d+\)$/, "")))].join("; ");
        return `<li>${esc(m.claims[k].text)}<div class="ev">${[s.supports.length ? `For: ${esc(src(s.supports))}` : "No supporting evidence linked yet", s.qualifies.length ? `Qualified by: ${esc(src(s.qualifies))}` : "", s.opposes.length ? `Against: ${esc(src(s.opposes))}` : ""].filter(Boolean).join(". ")}.</div></li>`; }).join("")}</ol>`);
      const cs = (cur.concepts || []).filter((c) => m.concepts[c]);
      if (cs.length) parts.push(`<h2>Key concepts</h2><dl>${cs.map((c) => `<dt>${esc(cap(m.concepts[c].label))}</dt><dd>${esc(cap(m.concepts[c].use) || "Working definition not yet agreed.")}</dd>`).join("")}</dl>`);
      const recent = [...m.versions].reverse().filter((v) => v !== cur && v.status !== "abandoned").slice(0, 4);
      if (recent.length) parts.push(`<h2>Recent changes</h2><ul>${[cur, ...recent].filter((v) => v.of || v === m.versions[0]).slice(0, 5).map((v) => `<li>${esc(v.v)}, ${esc(v.date)}: ${esc(v.change)}${v.rationale ? ` (${esc(v.rationale)})` : ""}</li>`).join("")}</ul>`);
      const open = [...this.flags().filter((f) => !f.startsWith("candidate")), ...Object.values(m.notes).filter((n) => n.status === "open" && n.kind !== "thought").map((n) => n.text)];
      if (open.length) parts.push(`<h2>Open points</h2><ul>${open.map((f) => `<li>${esc((f[0].toUpperCase() + f.slice(1)).replace(/\b(K|C|RQ)\d+\b/g, (x) => m.claims[x]?.text ? `"${m.claims[x].text}"` : m.concepts[x]?.label ? `"${m.concepts[x].label}"` : m.questions[x]?.text || x))}</li>`).join("")}</ul>`);
    }
    if (refs.length) parts.push(`<h2>References</h2><div class="refs">${refs.map((r) => `<p>${esc(r)}</p>`).join("")}</div>`);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(m.project)}: summary</title><style>
@page { size: A4; margin: 18mm 20mm; }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 170mm; padding: 16px; font: 10.5pt/1.45 Georgia, "Times New Roman", serif; color: #000; background: #fff; }
header { display: flex; justify-content: space-between; border-bottom: 1px solid #000; padding-bottom: 4px; font: 9pt Helvetica, Arial, sans-serif; }
h1 { font-size: 15pt; line-height: 1.3; font-weight: normal; margin: 14px 0 4px; }
h2 { font: bold 9pt Helvetica, Arial, sans-serif; text-transform: uppercase; letter-spacing: .06em; margin: 14px 0 4px; }
.meta { font: 9pt Helvetica, Arial, sans-serif; margin: 0; }
dl { margin: 0; display: grid; grid-template-columns: 34mm 1fr; gap: 3px 10px; } dt { font-style: italic; } dd { margin: 0; }
ol, ul { margin: 0; padding-left: 16px; } li { margin: 3px 0; } .ev { font-size: 9pt; }
p { margin: 0; }
.refs p { padding-left: 1.5em; text-indent: -1.5em; margin: 0 0 3px; font-size: 9.5pt; }
</style></head><body>${parts.join("\n")}</body></html>`;
  }

  addLink(from, rel, to, note) {
    const spec = RELS[rel];
    const fk = kindOf(from), tk = kindOf(to);
    if (!spec[0].includes(fk) || !spec[1].includes(tk)) throw new Error(`${rel} links ${spec[0].join("/")} to ${spec[1].join("/")}; got ${from} (${fk || "?"}) to ${to} (${tk || "?"})`);
    if (!this.exists(from)) throw new Error(`${from} is not known`);
    if (!this.exists(to)) throw new Error(`${to} is not known`);
    if (from === to) throw new Error("a node cannot link to itself");
    if (this.m.links.some((l) => l.from === from && l.to === to && l.rel === rel)) return false;
    if (["supports", "opposes", "qualifies"].includes(rel)) this.m.links = this.m.links.filter((l) => !(l.from === from && l.to === to && ["supports", "opposes", "qualifies"].includes(l.rel)));
    this.m.links.push({ from, rel, to, note: oneLine(note), at: today() });
    return true;
  }

  // ---------- readable export ----------
  markdown() {
    const m = this.m, L = [];
    const cardLine = (h) => { const c = this.card(h); return c ? `${clip(c.c, 200)}${c.q ? ` ("${clip(c.q, 160)}")` : ""} [${this.paperLabel(h.split("#")[0])}${c.l ? ", " + c.l : ""}]` : h; };
    const refs = (s) => String(s || "").replace(/\bP\d+\b(?!#)/g, (h) => this.paperLabel(h));
    L.push(`# Research map: ${m.project}`, "", `Updated ${(m.updated || "").slice(0, 10)}. Generated by Paper Scout from research-map.json; edit through Claude or the Research Desk, not here.`, "");
    const cur = this.current();
    L.push("## Current idea", "");
    if (!cur) L.push("No version yet.", "");
    else {
      L.push(`**${cur.v}** (${cur.date}): ${cur.statement}`, "");
      const rows = FRAME.map((f) => `| ${f} | ${cur[f] || "_empty_"} |`);
      L.push("| Frame | Content |", "| --- | --- |", ...rows, "");
      if (cur.claims.length) {
        L.push("### Claims and their evidence", "");
        for (const k of cur.claims) {
          const c = m.claims[k]; if (!c) continue;
          const s = this.claimSupport(k);
          L.push(`**${k}.** ${c.text}`, "");
          for (const [rel, hs] of Object.entries(s)) for (const h of hs) L.push(`- ${rel}: ${kindOf(h) === "card" ? cardLine(h) : this.paperLabel(h)}`);
          if (!s.supports.length && !s.opposes.length && !s.qualifies.length) L.push("- no evidence linked yet");
          L.push("");
        }
      }
      if (cur.concepts.length) L.push(`Concepts used: ${cur.concepts.map((c) => `${m.concepts[c]?.label} (${c})`).join(", ")}.`, "");
    }
    if (m.versions.length) {
      L.push("## Idea history", "", "| Version | Date | Status | Trigger | What changed | Why |", "| --- | --- | --- | --- | --- | --- |");
      for (const v of [...m.versions].reverse()) L.push(`| ${v.v}${v.of ? ` (from ${v.of})` : ""} | ${v.date} | ${v.status} | ${v.trigger?.type || ""}${v.trigger?.ref ? " " + refs(v.trigger.ref) : ""}${v.trigger?.note ? ": " + v.trigger.note : ""} | ${v.change} | ${v.rationale || ""} |`);
      L.push("");
      for (const v of [...m.versions].reverse()) if (v !== cur) L.push(`- **${v.v}**: ${v.statement}`);
      L.push("");
    }
    const byStatus = ["adopted", "candidate", "parked", "dropped"].map((s) => [s, Object.entries(m.concepts).filter(([, c]) => c.status === s)]).filter(([, cs]) => cs.length);
    if (byStatus.length) {
      L.push("## Concepts", "");
      for (const [s, cs] of byStatus) {
        L.push(`### ${s[0].toUpperCase() + s.slice(1)}`, "");
        for (const [h, c] of cs) {
          L.push(`#### ${cap(c.label)} (${h})${c.role ? `, ${c.role}` : ""}`, "");
          if (c.use) L.push(`Working definition: ${c.use}`, "");
          if (c.scope) L.push(`Scope: ${c.scope}`, "");
          if (c.alt?.length) L.push(`Surrogate terms: ${c.alt.join(", ")}`, "");
          const rel = m.links.filter((l) => l.from === h && ["sameas", "related", "broader"].includes(l.rel));
          if (rel.length) L.push(`Relations: ${rel.map((l) => `${l.rel === "sameas" ? "same as" : l.rel} ${m.concepts[l.to]?.label} (${l.to})`).join("; ")}`, "");
          if (c.attributes?.length) L.push(`Attributes: ${c.attributes.join("; ")}`, "");
          const defs = Object.entries(m.definitions).filter(([, d]) => d.concept === h).sort((x, y) => (x[1].year || 9999) - (y[1].year || 9999));
          for (const [dh, d] of defs) L.push(`- ${d.year || "n.d."}, ${this.paperLabel(d.h)}${d.loc ? ", " + d.loc : ""}${d.kind === "implicit" ? " (implicit)" : ""}: "${oneLine(d.quote)}" (${dh})`);
          if (defs.length) L.push("");
          if (c.pulse) L.push(`Pulse (${c.pulse.at}): ${c.pulse.total} works; ${Object.entries(c.pulse.years).sort((x, y) => x[0] - y[0]).map(([y, n]) => `${y} ${n}`).join(", ")}`, "");
          if (c.useHistory?.length) L.push(`Earlier working definitions: ${c.useHistory.map((u) => `"${u.text}" (until ${u.until})`).join("; ")}`, "");
          if (c.note) L.push(`Note: ${c.note}`, "");
        }
      }
    }
    const qs = Object.entries(m.questions);
    if (qs.length) {
      L.push("## Questions", "");
      for (const [q, x] of qs) {
        L.push(`**${q}.** ${x.text} Verdict: ${x.verdict || "none yet"}.${x.coverage ? ` Coverage: ${x.coverage}.` : ""}`, "");
        for (const l of m.links.filter((l) => l.rel === "answers" && l.to === q)) L.push(`- ${m.claims[l.from]?.text} (${l.from})`);
        for (const l of m.links.filter((l) => l.rel === "informs" && l.to === q)) L.push(`- informs: ${kindOf(l.from) === "card" ? cardLine(l.from) : this.paperLabel(l.from)}`);
        L.push("");
      }
    }
    const openNotes = Object.entries(m.notes || {}).filter(([, n]) => n.status === "open");
    if (openNotes.length) {
      L.push("## Open notes", "");
      for (const [k, n] of openNotes) L.push(`- ${n.at.slice(0, 10)}, ${n.kind}${n.about ? ` on ${n.about}` : ""}: ${n.text} (${k})`);
      L.push("");
    }
    const openTasks = Object.entries(m.tasks || {}).filter(([, t]) => t.status !== "done");
    if (openTasks.length) {
      L.push("## Tasks", "");
      for (const [k, t] of openTasks) L.push(`- [${t.status === "doing" ? "~" : " "}] ${cap(t.kind)}: ${t.title}${t.due ? ` (due ${t.due})` : ""}, from ${t.source} (${k})`);
      L.push("");
    }
    const fe = (m.framework?.edges || []).filter((e) => e.status === "accepted");
    if (fe.length) { L.push("## Framework", ""); for (const e of fe) L.push(`- ${this.edgeLine(e)}`); L.push(""); }
    const loose = Object.entries(m.claims).filter(([k]) => !cur?.claims.includes(k));
    if (loose.length) {
      L.push("## Other claims", "");
      for (const [k, c] of loose) { const s = this.claimSupport(k); L.push(`- **${k}** [${c.status}] ${c.text} (+${s.supports.length} -${s.opposes.length} ~${s.qualifies.length})`); }
      L.push("");
    }
    return L.join("\n");
  }

  // Structured view for the Research Desk.
  snapshot(project) {
    this.load(project);
    const papers = {};
    const want = new Set();
    for (const d of Object.values(this.m.definitions)) want.add(d.h);
    for (const l of this.m.links) for (const h of [l.from, l.to]) if (/^P\d+/.test(h)) want.add(h.split("#")[0]);
    for (const h of want) { const p = this.ctx.ledger.get(h); if (p) papers[h] = { label: this.paperLabel(h), title: p.title, cards: p.cards || [] }; }
    return { map: this.m, flags: this.flags(), inUse: this.conceptsInUse(), papers, readOnly: !!this.readOnly, file: this.file };
  }
}

// Definition finder: explicit phrasings around a term, over a paper's sentences.
export function definitionHits(doc, terms) {
  const esc = (t) => t.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[-\u2010-\u2014\s]+/g, "[-\\u2010-\\u2014\\s]+");
  const T = `(?:${terms.filter(Boolean).map(esc).join("|")})(?:\\s*\\([A-Z][A-Za-z-]{1,8}\\))?`;
  const strong = [
    new RegExp(`${T}[^.;]{0,40}?\\b(?:is|are|was|can be|may be|has been|have been|will be)\\s+(?:here\\s+|broadly\\s+|commonly\\s+|generally\\s+|often\\s+)?(?:defined|understood|conceptuali[sz]ed|conceived|characteri[sz]ed|described|operationali[sz]ed|referred to)\\s+(?:as|by|in terms of)\\b`, "i"),
    new RegExp(`\\b(?:define[sd]?|defining|conceptuali[sz]e[sd]?|understand|use the term|refer to)\\s+${T}\\s+(?:as|to mean|to refer)\\b`, "i"),
    new RegExp(`${T}\\s+(?:refers?|referring)\\s+to\\b`, "i"),
    new RegExp(`\\bby\\s+${T}\\s*,?\\s+(?:we|i|the authors?|this (?:paper|study|article))\\s+mean`, "i"),
  ];
  const pointer = new RegExp(`\\b(?:definitions?|conceptuali[sz]ations?) of ${T}\\b`, "i");
  const copular = new RegExp(`^(?:[A-Z][^.]{0,30}\\s)?${T}\\s+(?:is|are)\\s+(?:a|an|the)\\s+(?:form|type|kind|process|state|ability|capacity|degree|extent|set|mode|approach|situation|condition|arrangement|phenomenon|practice|paradigm)\\b`, "i");
  const hits = [];
  doc.sections.forEach((sec, si) => {
    if (/^(references|bibliography|acknowledg)/i.test(sec.title || "")) return;
    const sents = String(sec.text || "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z(“"])/);
    sents.forEach((s, i) => {
      let score = 0;
      if (strong.some((r) => r.test(s))) score = 2; else if (copular.test(s) || pointer.test(s)) score = 1;
      if (!score) return;
      const text = (/[:;]$/.test(s) && sents[i + 1] ? s + " " + sents[i + 1] : s).slice(0, 700);
      hits.push({ score, loc: `§${si + 1} ${String(sec.title || "").slice(0, 40)}`, text });
    });
  });
  const seen = new Set();
  return hits.sort((x, y) => y.score - x.score).filter((h) => { const k = h.text.slice(0, 80); if (seen.has(k)) return false; seen.add(k); return true; });
}
