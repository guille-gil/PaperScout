// Research map: one project's concepts, definitions, questions, claims and versioned idea, tied to the
// ledger's papers (P12) and evidence cards (P12#3). Stored as research-map.json in the project folder,
// with a readable research-map.md regenerated on every change. Claude proposes; the user decides.

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename, resolve as resolvePath } from "node:path";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const clip = (s, n) => { s = oneLine(s); return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, "") + "…"; };
const today = () => new Date().toISOString().slice(0, 10);
export const cap = (s) => { s = String(s ?? ""); return s ? s[0].toUpperCase() + s.slice(1) : s; };
const arr = (x) => (x === undefined || x === null || x === "" ? [] : Array.isArray(x) ? x : [x]).map((v) => oneLine(v)).filter(Boolean);

export const CONCEPT_STATUS = ["candidate", "adopted", "parked", "dropped"];
export const CONCEPT_ROLE = ["core", "lens", "context", ""];
export const VERDICTS = ["answered", "partly", "open", "contested", ""];
export const TRIGGERS = ["paper", "card", "supervision", "own", "data", "question", "edit"];
// The framing has four parts, each as long as it needs to be: background (a paragraph or two),
// positioning (where the project sits in the literature), the claim (often one sentence) and the novelty.
export const PARTS = [["background", "Background"], ["positioning", "Positioning"], ["thesis", "Claim"], ["novelty", "Novelty"]];
const PART_KEYS = PARTS.map(([k]) => k);
const FRAME = [...PART_KEYS, "method", "framing", "conversation", "opportunity", "what", "how", "why", "boundaries", "originality", "utility"];
// Earlier maps held the framing as eight short fields, then as one block of prose. Both stay readable.
const LEGACY = ["framing", "conversation", "opportunity", "what", "how", "why", "boundaries", "originality", "utility"];
const PROSE = new Set([...PART_KEYS, "framing", "method"]);
const para = (s) => String(s ?? "").replace(/\r/g, "").split(/\n\s*\n/).map(oneLine).filter(Boolean).join("\n\n").slice(0, 6000);
const GAP = { confusion: "The gap is one of competing explanations.", neglect: "The gap is an overlooked area.", application: "The opportunity is to extend existing work to a new setting.", problematization: "The opportunity is to challenge an assumption the field takes for granted." };
export function framingParts(v) {
  const out = Object.fromEntries(PART_KEYS.map((k) => [k, v?.[k] || ""]));
  if (!v || PART_KEYS.some((k) => v[k])) return out;
  if (v.framing) return { ...out, background: v.framing };
  const sent = (x) => { x = cap(oneLine(x)); return x && !/[.!?]$/.test(x) ? x + "." : x; };
  const join = (ks) => ks.map((k) => k === "opportunity" ? GAP[v[k]] || sent(v[k]) : sent(v[k])).filter(Boolean).join(" ");
  return { background: join(["conversation"]), positioning: join(["opportunity", "boundaries"]), thesis: join(["what", "how", "why"]), novelty: join(["originality", "utility"]) };
}
export function framingText(v) { const p = framingParts(v); return PARTS.filter(([k]) => p[k]).map(([k, l]) => `${l}: ${p[k]}`).join("\n\n"); }
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
  if (/^X\d+$/i.test(h)) return "component";
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
    this.m.next.E ||= 1; this.m.next.F ||= 1; this.m.next.FW ||= 1; this.m.next.O ||= 1;
    if (!this.m.frameworks) { this.m.frameworks = [{ id: `FW${this.m.next.FW++}`, name: "Main framework", nodes: {}, edges: [], versions: [], ...(this.m.framework || {}) }]; delete this.m.framework; }
    this.m.fwActive ||= this.m.frameworks[0].id;
    this.m.ontologyVersions ||= [];
    this.m.components ||= {}; this.m.next.X ||= 1;
    for (const t of Object.values(this.m.tasks)) if (t.source === "feynman") t.source = "workflow";
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
    if (k === "edge") return this.allEdges().some((e) => e.id === h);
    if (k === "component") return !!m.components[h];
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
  nodeLabel(h) { return this.m.concepts[h]?.label || this.m.components?.[h]?.label || h; }
  // A framework box is a concept (C3) or, in pipelines and models, a component (X2) that is not a concept:
  // a module, a dataset, a step. Labels resolve to an existing concept first, then to a component.
  nodeId(ref, F, { create = false, component = false } = {}) {
    const r = oneLine(ref); if (!r) throw new Error("which box? give an id (C3, X2) or a label");
    if (/^X\d+$/i.test(r)) { const h = r.toUpperCase(); if (!this.m.components[h]) throw new Error(`unknown component ${h}`); return h; }
    if (/^C\d+$/i.test(r)) return this.conceptId(r);
    const low = r.toLowerCase();
    if (!component) for (const [h, c] of Object.entries(this.m.concepts)) if (c.label.toLowerCase() === low || (c.alt || []).some((x) => x.toLowerCase() === low)) return h;
    for (const [h, c] of Object.entries(this.m.components)) if (c.label.toLowerCase() === low) return h;
    if (!create) throw new Error(`no concept or component "${r}"`);
    if (component || F?.kind === "pipeline") { const h = `X${this.m.next.X++}`; this.m.components[h] = { label: r, note: "", created: today() }; return h; }
    return this.conceptId(r, { create: true });
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
    const fp = framingParts(v);
    for (const [k, l] of PARTS) lines.push(`  ${l.toLowerCase()}: ${fp[k] ? fp[k].replace(/\n\n/g, " / ") : "(empty)"}`);
    lines.push(v.method ? `  method: ${v.method.replace(/\n\n/g, " / ")}` : "  method: (empty)");
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
        (m.repos || []).length ? `Code: ${m.repos.map((r) => `${r.label} (${r.path})`).join("; ")} (map action=repo op=brief for an overview, on demand)` : "",
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
      if (a.alt_set !== undefined) c.alt = [...new Set(arr(a.alt_set))];
      if (a.attributes !== undefined) c.attributes = arr(a.attributes);
      if (a.scope !== undefined) c.scope = oneLine(a.scope);
      if (a.note !== undefined) c.note = oneLine(a.note);
      if (a.status !== undefined) { if (!CONCEPT_STATUS.includes(a.status)) throw new Error(`status must be one of ${CONCEPT_STATUS.join(", ")}`); c.status = a.status; }
      if (a.role !== undefined) { if (!CONCEPT_ROLE.includes(a.role)) throw new Error("role must be core, lens or context"); c.role = a.role; }
      if (a.use !== undefined && oneLine(a.use) !== c.use) { if (c.use) c.useHistory.push({ text: c.use, until: today() }); c.use = oneLine(a.use); }
      for (const rel of ["related", "broader", "sameas", "partof"]) for (const t of arr(a[rel])) this.addLink(h, rel, this.conceptId(t, { create: true }));
      for (const t of arr(a.unrelated)) { const o = this.conceptId(t); m.links = m.links.filter((l) => !(l.rel === "related" && ((l.from === h && l.to === o) || (l.from === o && l.to === h)))); }
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
      const KINDS = ["read", "question", "write", "check", "other"], SRC = ["you", "supervisor", "workflow", "claude"], ST = ["todo", "doing", "done"];
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
      if (a.id && a.kind !== undefined && KINDS.includes(a.kind)) x.kind = a.kind;
      if (a.status !== undefined) { if (!ST.includes(a.status)) throw new Error("task status: todo, doing or done"); x.status = a.status; x.done = a.status === "done" ? today() : ""; }
      if (a.due !== undefined) { if (a.due && !/^\d{4}-\d{2}-\d{2}$/.test(a.due)) throw new Error("due as YYYY-MM-DD"); x.due = a.due; }
      if (a.note !== undefined) x.note = String(a.note).trim().slice(0, 2000);
      this.save();
      return `${t} ${x.title} [${x.kind}, ${x.status}${x.about ? ", " + x.about : ""}]`;
    }
    if (action === "task_order") {
      // The board's own order after a drag: one column's tasks, top to bottom.
      if (!["todo", "doing", "done"].includes(a.status)) throw new Error("task_order needs status todo, doing or done");
      const ids = arr(a.ids).map((x) => x.toUpperCase()).filter((x) => m.tasks[x]);
      ids.forEach((id, i) => { const t = m.tasks[id]; t.rank = i; if (t.status !== a.status) { t.status = a.status; t.done = a.status === "done" ? today() : ""; } });
      this.save(); return `Ordered ${ids.length} in ${a.status}.`;
    }
    if (action === "tasks") {
      const want = a.status ? [a.status] : ["doing", "todo"];
      const ts = Object.entries(m.tasks).filter(([, t]) => want.includes(t.status)).sort((x, y) => want.indexOf(x[1].status) - want.indexOf(y[1].status));
      if (!ts.length) return "No open tasks.";
      return ts.map(([k, t]) => `${k} [${t.status}] ${t.kind}: ${t.title}${t.about ? ` (${t.about})` : ""}${t.due ? ` due ${t.due}` : ""} from ${t.source}`).join("\n");
    }
    if (action === "framework") return this.frameworkOp(a);
    if (action === "ontology") return this.ontologyOp(a);
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
      for (const f of FRAME) v[f] = a[f] !== undefined ? (PROSE.has(f) ? para(a[f]) : oneLine(a[f])) : base?.[f] || "";
      // Writing any framing part carries the older framing over into the parts, then retires it.
      if (PART_KEYS.some((k) => a[k] !== undefined) && base && !PART_KEYS.some((k) => base[k])) { const fp = framingParts(base); for (const k of PART_KEYS) if (a[k] === undefined) v[k] = fp[k]; }
      if (PART_KEYS.some((k) => a[k] !== undefined) || a.framing !== undefined) for (const f of LEGACY) if (a[f] === undefined) v[f] = "";
      if (a.framing !== undefined && !PART_KEYS.some((k) => a[k] !== undefined)) { v.background = para(a.framing); v.framing = ""; }
      if (v.opportunity && !OPPORTUNITY.includes(v.opportunity)) throw new Error(`opportunity: ${OPPORTUNITY.filter(Boolean).join(", ")}`);
      v.claims = a.claims !== undefined ? arr(a.claims).map((x) => x.toUpperCase()) : [...(base?.claims || [])];
      v.concepts = a.concepts !== undefined ? arr(a.concepts).map((x) => this.conceptId(x)) : [...(base?.concepts || [])];
      for (const k of v.claims) if (!m.claims[k]) throw new Error(`unknown claim ${k}; add it with action=claim first`);
      v.trigger = { type: a.trigger, ref: oneLine(a.trigger_ref), note: oneLine(a.trigger_note) };
      if (v.trigger.ref) for (const r of v.trigger.ref.split(/[\s,]+/)) if (kindOf(r) && !this.exists(normH(r))) throw new Error(`trigger_ref ${r} is not known`);
      v.change = oneLine(a.change || "First version.");
      const fwNow = this.fw(); if (fwNow.versions.length) v.framework = `${fwNow.versions.at(-1).v} (${fwNow.name})`;
      v.rationale = oneLine(a.rationale);
      if (a.desk) v.desk = true;
      if (base) v.diff = FRAME.concat(["statement"]).filter((f) => (v[f] || "") !== (base[f] || ""))
        .concat(v.claims.filter((k) => !base.claims?.includes(k)).map((k) => `+${k}`), (base.claims || []).filter((k) => !v.claims.includes(k)).map((k) => `-${k}`),
          v.concepts.filter((k) => !base.concepts?.includes(k)).map((k) => `+${k}`), (base.concepts || []).filter((k) => !v.concepts.includes(k)).map((k) => `-${k}`));
      if (!a.branch_of) for (const o of m.versions) if (o.status === "current") o.status = "superseded";
      for (const r of v.trigger.ref.split(/[\s,]+/)) if (kindOf(r) === "note" && m.notes[r.toUpperCase()]) Object.assign(m.notes[r.toUpperCase()], { status: "done", used: id });
      m.versions.push(v);
      this.save();
      return `Wrote ${id}${base ? ` (from ${base.v}; changed: ${v.diff.join(", ") || "nothing but the record"})` : ""}.`;
    }
    if (action === "edit") {
      // The user's own edits from the Research Desk. Each day's edits share one version, so small
      // corrections do not flood the history; anything older is kept as it was.
      const fields = ["statement", ...PART_KEYS, "method"].filter((f) => a[f] !== undefined);
      if (!fields.length && a.claims === undefined) throw new Error("edit needs statement, a framing part, method or claims");
      const cur = this.current();
      if (!cur && !oneLine(a.statement)) throw new Error("write the idea itself first");
      if (cur && cur.desk && cur.date === today()) {
        const base = m.versions.find((x) => x.v === cur.of);
        if (fields.some((f) => PART_KEYS.includes(f)) && !PART_KEYS.some((k) => cur[k])) { const fp = framingParts(cur); for (const k of PART_KEYS) cur[k] = fp[k]; for (const f of LEGACY) cur[f] = ""; }
        for (const f of fields) cur[f] = f === "statement" ? oneLine(a[f]) || cur.statement : para(a[f]);
        if (a.claims !== undefined) { cur.claims = arr(a.claims).map((x) => x.toUpperCase()); for (const k of cur.claims) if (!m.claims[k]) throw new Error(`unknown claim ${k}`); }
        if (base) {
          cur.diff = FRAME.concat(["statement"]).filter((f) => (cur[f] || "") !== (base[f] || "")).concat(cur.claims.filter((k) => !base.claims?.includes(k)).map((k) => `+${k}`), (base.claims || []).filter((k) => !cur.claims.includes(k)).map((k) => `-${k}`));
          const names = { statement: "the idea", background: "the framing", positioning: "the framing", thesis: "the framing", novelty: "the framing", framing: "the framing", method: "the methodology" };
          const touched = [...new Set(cur.diff.map((d) => names[d] || (/^[+-]K/.test(d) ? "the argument" : null)).filter(Boolean))];
          cur.change = `Edited ${touched.length ? touched.join(", ").replace(/, ([^,]*)$/, " and $1") : "the record"} on the Research Desk.`;
        }
        this.save(); return `Updated ${cur.v} (today's edits).`;
      }
      const names = { statement: "the idea", background: "the framing", positioning: "the framing", thesis: "the framing", novelty: "the framing", method: "the methodology" };
      const touched = [...new Set(fields.map((f) => names[f])), ...(a.claims !== undefined ? ["the argument"] : [])];
      return this.tool({ action: "revise", trigger: "edit", desk: true, change: `Edited ${touched.join(", ").replace(/, ([^,]*)$/, " and $1")} on the Research Desk.`, ...Object.fromEntries(fields.map((f) => [f, a[f]])), ...(a.claims !== undefined ? { claims: a.claims } : {}) });
    }
    if (action === "undefine") {
      const d = String(a.id || "").toUpperCase();
      if (!m.definitions[d]) throw new Error(`unknown definition ${d}`);
      delete m.definitions[d]; this.save(); return `Removed ${d}.`;
    }
    if (action === "focus") return this.focus(a);
    if (action === "repo") return this.repoOp(a);
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

  // One item and its immediate neighbourhood, so Claude can work on part of a large map without
  // reading all of it: the concept, claim or question, what links to it, and the evidence one step away.
  focus(a) {
    const m = this.m, ref = oneLine(a.id || a.label);
    if (!ref) throw new Error("focus needs id (C3, K2, RQ1, X1) or a concept label");
    const k = kindOf(ref) || "concept";
    const ev = (h) => { const c = kindOf(h) === "card" ? this.card(h) : null; return `${h} ${c ? clip(c.c, 140) : ""} [${this.paperLabel(h.split("#")[0])}]`; };
    const claimBlock = (kk) => { const c = m.claims[kk]; if (!c) return []; const s = this.claimSupport(kk);
      return [`${kk} ${c.text} [${c.status}; +${s.supports.length} -${s.opposes.length} ~${s.qualifies.length}]`, ...s.supports.slice(0, 3).map((h) => `  for: ${ev(h)}`), ...s.opposes.slice(0, 3).map((h) => `  against: ${ev(h)}`), ...s.qualifies.slice(0, 2).map((h) => `  qualifies: ${ev(h)}`)]; };
    const edgesOf = (h) => m.frameworks.flatMap((F) => F.edges.filter((e) => e.status !== "rejected" && (e.from === h || e.to === h || e.claim === h)).map((e) => `${F.id} ${this.edgeLine(e, F)}`));
    const out = [];
    if (k === "concept" || k === "component") {
      const h = k === "component" ? normH(ref) : this.conceptId(ref);
      if (k === "component") { const x = m.components?.[h]; if (!x) throw new Error(`unknown component ${h}`); out.push(`${h} ${x.label} (component)${x.note ? ": " + x.note : ""}`); }
      else {
        const c = m.concepts[h]; out.push(this.conceptLine(h));
        if (c.use) out.push(`Working definition: ${c.use}`);
        const defs = Object.entries(m.definitions).filter(([, d]) => d.concept === h);
        if (defs.length) out.push(`Definitions: ${defs.map(([dh, d]) => `${dh} ${d.year || "n.d."} ${d.h}`).join("; ")} (map action=definitions id=${h} for the quotes)`);
        const up = m.links.filter((l) => l.from === h && ["broader", "partof"].includes(l.rel)).map((l) => `${l.rel === "partof" ? "part of" : "a kind of"} ${l.to} ${m.concepts[l.to]?.label}`);
        const down = m.links.filter((l) => l.to === h && ["broader", "partof"].includes(l.rel)).map((l) => `${l.from} ${m.concepts[l.from]?.label}`);
        if (up.length || down.length) out.push(`Ontology: ${[...up, down.length ? `narrower: ${down.join(", ")}` : ""].filter(Boolean).join("; ")}`);
        for (const l of m.links.filter((l) => l.rel === "uses" && l.to === h)) out.push(...claimBlock(l.from));
      }
      out.push(...edgesOf(h));
      for (const [nk, n] of Object.entries(m.notes)) if (n.about === h && n.status === "open") out.push(`${nk} note: ${n.text}`);
      for (const [tk, t] of Object.entries(m.tasks)) if (t.about === h && t.status !== "done") out.push(`${tk} task [${t.status}]: ${t.title}`);
    } else if (k === "claim") {
      const h = normH(ref); if (!m.claims[h]) throw new Error(`unknown claim ${h}`);
      out.push(...claimBlock(h));
      const uses = m.links.filter((l) => l.from === h && l.rel === "uses").map((l) => `${l.to} ${m.concepts[l.to]?.label}`);
      if (uses.length) out.push(`Uses: ${uses.join(", ")}`);
      const ans = m.links.filter((l) => l.from === h && l.rel === "answers").map((l) => `${l.to} ${m.questions[l.to]?.text}`);
      if (ans.length) out.push(`Answers: ${ans.join("; ")}`);
      out.push(...edgesOf(h));
    } else if (k === "question") {
      const h = normH(ref), q = m.questions[h]; if (!q) throw new Error(`unknown question ${h}`);
      out.push(`${h} ${q.text} [${q.verdict || "no verdict"}]${q.coverage ? ` (${q.coverage})` : ""}`);
      for (const l of m.links.filter((l) => l.rel === "answers" && l.to === h)) out.push(...claimBlock(l.from));
      const inf = m.links.filter((l) => l.rel === "informs" && l.to === h).map((l) => ev(l.from));
      if (inf.length) out.push(`Informs: ${inf.slice(0, 6).join("; ")}`);
    } else throw new Error("focus works on concepts, components, claims and questions");
    return out.join("\n");
  }
  // ---------- code linked to the project ----------
  // A project often has a repository behind it (built before, during or after the writing). The map keeps
  // where it is; Claude asks for a short overview only when a question touches the code. Read only.
  repoOp(a) {
    const m = this.m, op = a.op || "list";
    m.repos ||= [];
    const find = (ref) => { const r = oneLine(ref); const i = /^\d+$/.test(r) ? Number(r) - 1 : m.repos.findIndex((x) => x.label.toLowerCase() === r.toLowerCase() || x.path === r); if (i < 0 || !m.repos[i]) throw new Error(`no linked repository "${r}"; linked: ${m.repos.map((x) => x.label).join(", ") || "none"}`); return m.repos[i]; };
    const git = (dir, args) => { try { return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };
    if (op === "list") return m.repos.length ? m.repos.map((r, i) => `${i + 1}. ${r.label}: ${r.path}${r.role ? ` (${r.role})` : ""}${r.url ? ` ${r.url}` : ""}`).join("\n") : "No code linked to this project.";
    if (op === "add") {
      const raw = oneLine(a.path || a.id); if (!raw) throw new Error("repo add needs path (a folder on this Mac)");
      const dir = resolvePath(raw.replace(/^~(?=\/|$)/, homedir()));
      if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`folder ${dir} does not exist on this Mac`);
      if (m.repos.some((r) => r.path === dir)) return `${dir} is already linked.`;
      const url = oneLine(a.url) || git(dir, ["remote", "get-url", "origin"]).replace(/\.git$/, "").replace(/^git@github\.com:/, "https://github.com/");
      m.repos.push({ path: dir, label: oneLine(a.label) || basename(dir), role: oneLine(a.role || a.note), url, added: today() });
      this.save(); return `Linked ${m.repos.at(-1).label} (${dir}).`;
    }
    if (op === "remove") { const r = find(a.id || a.label || a.path); m.repos = m.repos.filter((x) => x !== r); this.save(); return `Unlinked ${r.label}; nothing was deleted.`; }
    if (op === "edit") { const r = find(a.id || a.path); if (a.label !== undefined && oneLine(a.label)) r.label = oneLine(a.label); if (a.role !== undefined) r.role = oneLine(a.role); this.save(); return `${r.label}: ${r.path}${r.role ? ` (${r.role})` : ""}`; }
    if (op === "brief") {
      const r = find(a.id || a.label || (m.repos.length === 1 ? "1" : ""));
      if (!existsSync(r.path)) return `${r.label}: ${r.path} is not there any more (moved or renamed?). Update it with op=remove and op=add.`;
      const SKIP = new Set([".git", "node_modules", "__pycache__", ".venv", "venv", "env", ".idea", ".vscode", "dist", "build", ".ipynb_checkpoints", ".DS_Store", ".mypy_cache", ".pytest_cache", "wandb", "mlruns"]);
      const lines = [], exts = {};
      const walk = (d, depth, pre) => {
        let ents = []; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
        ents = ents.filter((e) => !SKIP.has(e.name) && !e.name.startsWith(".")).sort((x, y) => (y.isDirectory() - x.isDirectory()) || x.name.localeCompare(y.name));
        let shownFiles = 0, hidden = 0;
        for (const e of ents) {
          if (e.isDirectory()) {
            let n = 0; try { n = readdirSync(join(d, e.name)).length; } catch {}
            if (depth < 2 && lines.length < 45) lines.push(`${pre}${e.name}/ (${n})`);
            if (depth < 4) walk(join(d, e.name), depth + 1, pre + "  ");
          } else {
            const x = (e.name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase(); if (x) exts[x] = (exts[x] || 0) + 1;
            // All top-level files; a few per folder one level down; counts only below that.
            if (depth === 0 || (depth === 1 && shownFiles < 4)) { if (lines.length < 45) { lines.push(`${pre}${e.name}`); shownFiles++; } }
            else if (depth === 1) hidden++;
          }
        }
        if (hidden && lines.length < 45) lines.push(`${pre}+${hidden} more files`);
      };
      walk(r.path, 0, "  ");
      const readme = ["README.md", "readme.md", "README.rst", "README.txt", "README"].map((f) => join(r.path, f)).find((f) => existsSync(f));
      const head = readme ? readFileSync(readme, "utf8").replace(/<[^>]+>/g, "").split("\n").filter((l) => l.trim() && !/^\s*(!\[|\[!\[|---+\s*$)/.test(l)).slice(0, 25).map((l) => clip(l, 160)).join("\n") : "";
      const log = git(r.path, ["log", "-6", "--format=%ad %s", "--date=short"]);
      const branch = git(r.path, ["rev-parse", "--abbrev-ref", "HEAD"]);
      const langs = Object.entries(exts).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(", ");
      return [`${r.label}: ${r.path}${r.role ? ` (${r.role})` : ""}${r.url ? ` ${r.url}` : ""}`, branch ? `Branch ${branch}.` : "Not a git repository.", langs ? `Files by type: ${langs}.` : "",
        log ? `Recent commits:\n${log.split("\n").map((l) => "  " + clip(l, 110)).join("\n")}` : "", `Layout:\n${lines.join("\n")}${lines.length >= 45 ? "\n  ..." : ""}`,
        head ? `README (start):\n${head}` : "No README.", "Read specific files with the device tools or the Read tool when needed; never modify the repository unless the user asks."].filter(Boolean).join("\n");
    }
    throw new Error("repo op: list, add (path, label, role), edit, remove, brief");
  }
  ontologyAncestors(c, seen = []) {
    const up = this.m.links.filter((l) => l.from === c && ["broader", "partof"].includes(l.rel)).map((l) => l.to);
    for (const u of up) if (!seen.includes(u)) { seen.push(u); this.ontologyAncestors(u, seen); }
    return seen;
  }
  // ---------- frameworks (conceptual framework figures) ----------
  // A project can hold several frameworks (a main model, an alternative account, one per study).
  // Each has its own concepts, relationships and saved versions.
  fw(id) {
    const m = this.m;
    const want = String(id || m.fwActive || "").toUpperCase();
    const f = m.frameworks.find((x) => x.id === want) || m.frameworks.find((x) => x.id === m.fwActive) || m.frameworks[0];
    if (id && f.id !== want) throw new Error(`unknown framework ${id}; frameworks: ${m.frameworks.map((x) => `${x.id} ${x.name}`).join("; ")}`);
    return f;
  }
  allEdges() { return this.m.frameworks.flatMap((f) => f.edges); }
  edgeEvidence(e) {
    if (!e.claim || !this.m.claims[e.claim]) return "none";
    const s = this.claimSupport(e.claim);
    return s.opposes.length ? "contested" : s.supports.length ? "supported" : "unsupported";
  }
  placeNode(F, c, x, y, near, dir = 1) {
    if (F.nodes[c]) return;
    if (Number.isFinite(x) && Number.isFinite(y)) { F.nodes[c] = { x: Math.round(x), y: Math.round(y) }; return; }
    if (near) {
      const ok = (x, y) => x >= 79 && x <= 821 && y >= 40 && Object.values(F.nodes).every((n) => Math.abs(n.x - x) > 190 || Math.abs(n.y - y) > 100);
      for (const [dx, dy] of [[240, 0], [240, 130], [240, -130], [0, 150], [0, -150], [-240, 0], [240, 260], [-240, 130], [0, 300]]) {
        const px = near.x + dx * dir, py = near.y + dy; if (ok(px, py)) { F.nodes[c] = { x: Math.round(px), y: Math.round(py) }; return; }
      }
    }
    // Free slot on a roomy grid (canvas 900 wide), so arrows between neighbours stay visible.
    const free = (x, y) => Object.values(F.nodes).every((n) => Math.abs(n.x - x) > 200 || Math.abs(n.y - y) > 110);
    for (let i = 0; i < 300; i++) { const x = 130 + (i % 3) * 320, y = 70 + Math.floor(i / 3) * 150; if (free(x, y)) { F.nodes[c] = { x, y }; return; } }
    F.nodes[c] = { x: 130, y: 70 };
  }
  edgeLine(e, F) {
    const lab = (h) => kindOf(h) === "edge" ? `edge ${h}` : `${h} ${this.nodeLabel(h)}`;
    const ev = this.edgeEvidence(e);
    const verb = e.type === "custom" ? `"${e.verb}"` : e.type;
    return `${e.id}${e.label ? ` [${e.label}]` : ""} ${lab(e.from)} ${verb}${e.sign ? `(${e.sign})` : ""} ${lab(e.to)} [${e.status}${e.claim ? `, ${e.claim} ${ev}` : ", no claim"}]${e.note ? ` ${e.note}` : ""}`;
  }
  // Layered layout: sources on the left, outcomes on the right, moderators above their arrow.
  arrange(F) {
    const nodes = Object.keys(F.nodes); if (!nodes.length) return;
    const flow = F.edges.filter((e) => e.status !== "rejected" && kindOf(e.to) !== "edge" && F.nodes[e.from] && F.nodes[e.to] && e.type !== "associated");
    const layer = Object.fromEntries(nodes.map((n) => [n, 0]));
    for (let i = 0; i < nodes.length; i++) for (const e of flow) if (layer[e.to] < layer[e.from] + 1 && layer[e.from] + 1 < nodes.length) layer[e.to] = layer[e.from] + 1;
    const mods = new Set(F.edges.filter((e) => e.type === "moderates" && e.status !== "rejected").map((e) => e.from));
    const cols = Math.max(...Object.values(layer)) + 1;
    const x = (l) => cols === 1 ? 450 : Math.round(110 + l * (680 / (cols - 1)));
    const byLayer = {};
    for (const n of nodes) if (!mods.has(n) || flow.some((e) => e.from === n || e.to === n)) (byLayer[layer[n]] ||= []).push(n);
    const top = mods.size ? 170 : 70;
    // Pipelines read top to bottom, one step per row, so long chains stay legible on the page.
    if (F.kind === "pipeline") {
      for (const [l, ns] of Object.entries(byLayer)) ns.forEach((n, i) => { F.nodes[n] = { x: Math.round(450 + (i - (ns.length - 1) / 2) * 230), y: 60 + Number(l) * 115 }; });
      for (const n of nodes) if (!F.nodes[n] || !Object.values(byLayer).flat().includes(n)) F.nodes[n] ||= { x: 750, y: 60 };
      return;
    }
    // Stagger alternate columns only when an arrow skips a column, so it is not drawn through the boxes between.
    const skips = flow.some((e) => kindOf(e.to) !== "edge" && Math.abs(layer[e.to] - layer[e.from]) > 1);
    for (const [l, ns] of Object.entries(byLayer)) ns.forEach((n, i) => { F.nodes[n] = { x: x(Number(l)), y: top + i * 130 + (skips && Number(l) % 2 ? 65 : 0) }; });
    let k = 0;
    for (const n of nodes) if (mods.has(n) && !Object.values(byLayer).flat().includes(n)) {
      const e = F.edges.find((x) => x.from === n && x.type === "moderates"); const t = F.edges.find((x) => x.id === e?.to);
      const mx = t && F.nodes[t.from] && F.nodes[t.to] ? (F.nodes[t.from].x + F.nodes[t.to].x) / 2 : 450;
      F.nodes[n] = { x: Math.round(Math.max(79, Math.min(821, mx + k * 20))), y: 50 }; k++;
    }
  }
  frameworkOp(a) {
    const m = this.m, op = a.op || "show";
    const by = a.by === "you" ? "you" : "claude";
    const TYPES = ["influences", "moderates", "associated", "enables", "constrains", "precedes", "partof", "feeds", "produces", "custom"];
    const F = op === "create" ? null : this.fw(a.fw);
    const edge = (id) => { const e = F.edges.find((x) => x.id === String(id || "").toUpperCase()); if (!e) throw new Error(`unknown edge ${id} in ${F.id}`); return e; };
    const version = (id) => { const v = F.versions.find((x) => x.v === String(id || "").toUpperCase()); if (!v) throw new Error(`unknown version ${id} of ${F.id}`); return v; };
    const snap = () => ({ nodes: JSON.parse(JSON.stringify(F.nodes)), edges: JSON.parse(JSON.stringify(F.edges.filter((e) => e.status === "accepted"))) });
    if (op === "list") return m.frameworks.map((f) => `${f.id}${f.id === m.fwActive ? " (active)" : ""} ${f.name}: ${Object.keys(f.nodes).length} concepts, ${f.edges.filter((e) => e.status === "accepted").length} relationships, ${f.versions.length} versions`).join("\n");
    if (op === "create") {
      const id = `FW${m.next.FW++}`;
      let base = { nodes: {}, edges: [] };
      if (a.from_version) { const src = m.frameworks.find((f) => f.versions.some((v) => v.v === String(a.from_version).toUpperCase())); if (!src) throw new Error(`unknown version ${a.from_version}`); base = src.versions.find((v) => v.v === String(a.from_version).toUpperCase()); }
      else if (a.copy) { const src = this.fw(a.copy); base = { nodes: src.nodes, edges: src.edges.filter((e) => e.status !== "rejected") }; }
      const edges = JSON.parse(JSON.stringify(base.edges)); const remap = {};
      for (const e of edges) { remap[e.id] = `E${m.next.E++}`; e.id = remap[e.id]; }
      for (const e of edges) if (remap[e.to]) e.to = remap[e.to];
      m.frameworks.push({ id, name: oneLine(a.name) || `Framework ${id.slice(2)}`, kind: a.kind === "pipeline" ? "pipeline" : "conceptual", nodes: JSON.parse(JSON.stringify(base.nodes)), edges, versions: [], created: today() });
      m.fwActive = id; this.save(); return `Created ${id} "${m.frameworks.at(-1).name}".`;
    }
    if (op === "rename") {
      if (!oneLine(a.name) && !a.kind) throw new Error("rename needs name (or kind: conceptual or pipeline)");
      if (oneLine(a.name)) F.name = oneLine(a.name);
      if (a.kind) F.kind = a.kind === "pipeline" ? "pipeline" : "conceptual";
      this.save(); return `${F.id} is now "${F.name}" (${F.kind || "conceptual"}).`;
    }
    if (op === "rename_node") {
      const h = this.nodeId(a.id, F);
      if (kindOf(h) === "concept") { if (!oneLine(a.label)) throw new Error("rename_node needs label"); m.concepts[h].label = oneLine(a.label); }
      else { if (a.label !== undefined && oneLine(a.label)) m.components[h].label = oneLine(a.label); if (a.note !== undefined) m.components[h].note = oneLine(a.note); }
      this.save(); return `${h} is "${this.nodeLabel(h)}".`;
    }
    if (op === "activate") { m.fwActive = F.id; this.save(); return `${F.id} "${F.name}" is the active framework.`; }
    if (op === "delete") {
      if (m.frameworks.length < 2) throw new Error("a project keeps at least one framework");
      m.frameworks = m.frameworks.filter((f) => f !== F); if (m.fwActive === F.id) m.fwActive = m.frameworks[0].id;
      this.save(); return `Deleted ${F.id} "${F.name}".`;
    }
    if (op === "show") {
      const nodes = Object.keys(F.nodes);
      const head = `${F.id} "${F.name}"${m.frameworks.length > 1 ? ` (${m.frameworks.length} frameworks: op=list)` : ""}`;
      if (!nodes.length) return `${head} is empty. Add concepts with op=add_node or relationships with op=add_edge.`;
      const live = F.edges.filter((e) => e.status !== "rejected");
      return [`${head}${F.kind === "pipeline" ? " (pipeline)" : ""}: ${nodes.map((c) => `${c} ${this.nodeLabel(c)}`).join("; ")}.`, ...live.map((e) => this.edgeLine(e)),
        F.versions.length ? `Versions: ${F.versions.map((v) => `${v.v} ${v.date}${v.note ? " " + v.note : ""}`).join("; ")}` : "No saved versions."].join("\n");
    }
    if (op === "add_node") {
      const ids = arr(a.id || a.from), labels = arr(a.label);
      for (const c of ids) this.placeNode(F, this.nodeId(c, F), Number(a.x), Number(a.y));
      for (const l of labels) this.placeNode(F, this.nodeId(l, F, { create: true, component: !!a.component }), Number(a.x), Number(a.y));
      this.save(); return `In ${F.id}: ${Object.keys(F.nodes).join(" ")}.`;
    }
    if (op === "remove_node") {
      const c = this.nodeId(a.id, F); delete F.nodes[c];
      const gone = new Set(F.edges.filter((e) => e.from === c || e.to === c).map((e) => e.id));
      F.edges = F.edges.filter((e) => !gone.has(e.id) && !gone.has(e.to));
      this.save(); return `Removed ${c} and ${gone.size} relationship${gone.size === 1 ? "" : "s"} from ${F.id}.`;
    }
    if (op === "move") {
      const moves = Array.isArray(a.positions) ? a.positions : [{ id: a.id, x: a.x, y: a.y }];
      for (const p of moves) { const c = this.nodeId(p.id, F); if (!F.nodes[c]) throw new Error(`${c} is not in ${F.id}`); F.nodes[c] = { x: Math.max(79, Math.min(821, Math.round(Number(p.x) || 0))), y: Math.max(30, Math.min(2400, Math.round(Number(p.y) || 0))) }; }
      this.save(); return `Moved ${moves.length}.`;
    }
    if (op === "arrange") { this.arrange(F); this.save(); return `Arranged ${F.id}.`; }
    if (op === "add_edge") {
      const type = TYPES.includes(a.type) ? a.type : F.kind === "pipeline" ? "feeds" : "influences";
      const from = this.nodeId(arr(a.from)[0], F, { create: F.kind === "pipeline" });
      const t0 = arr(a.to)[0] || ""; const toRaw = kindOf(t0) ? normH(t0) : t0;
      let to;
      if (type === "moderates" && kindOf(toRaw) === "edge") to = edge(toRaw).id;
      else if (type === "moderates") throw new Error("moderates points at a relationship (E3), not a concept");
      else to = this.nodeId(toRaw, F, { create: F.kind === "pipeline" });
      if (from === to) throw new Error("a concept cannot relate to itself");
      if (F.edges.some((e) => e.from === from && e.to === to && e.type === type && e.status !== "rejected")) return "That relationship is already in the framework.";
      const claim = a.claim ? String(a.claim).toUpperCase() : "";
      if (claim && !m.claims[claim]) throw new Error(`unknown claim ${claim}`);
      if (type === "custom" && !oneLine(a.verb)) throw new Error("a custom relationship needs verb (for example: shapes)");
      // New boxes go next to the box they connect to; nothing already placed moves.
      if (!F.nodes[from] && F.nodes[to]) this.placeNode(F, from, NaN, NaN, F.nodes[to], -1); else this.placeNode(F, from);
      if (kindOf(to) !== "edge") this.placeNode(F, to, NaN, NaN, F.nodes[from], 1);
      const e = { id: `E${m.next.E++}`, from, to, type, verb: type === "custom" ? oneLine(a.verb) : "", sign: ["+", "-"].includes(a.sign) && ["influences", "moderates"].includes(type) ? a.sign : "", label: oneLine(a.hypothesis).slice(0, 12), claim, note: oneLine(a.note), status: by === "you" ? "accepted" : "proposed", by, at: today() };
      F.edges.push(e); this.save();
      return `${e.status === "proposed" ? "Proposed" : "Added"} ${this.edgeLine(e)}`;
    }
    if (op === "edit_edge") {
      const e = edge(a.id);
      if (a.type !== undefined && TYPES.includes(a.type) && (a.type === "moderates") === (e.type === "moderates")) e.type = a.type;
      if (a.verb !== undefined) e.verb = oneLine(a.verb);
      if (e.type === "custom" && !e.verb) throw new Error("a custom relationship needs verb");
      if (a.sign !== undefined) e.sign = ["+", "-"].includes(a.sign) ? a.sign : "";
      if (!["influences", "moderates"].includes(e.type)) e.sign = "";
      if (a.hypothesis !== undefined) e.label = oneLine(a.hypothesis).slice(0, 12);
      if (a.claim !== undefined) { const k = String(a.claim || "").toUpperCase(); if (k && !m.claims[k]) throw new Error(`unknown claim ${k}`); e.claim = k; }
      if (a.note !== undefined) e.note = oneLine(a.note);
      if (a.status !== undefined) { if (!["accepted", "rejected", "proposed"].includes(a.status)) throw new Error("status: accepted or rejected"); e.status = a.status; }
      this.save(); return this.edgeLine(e);
    }
    if (op === "remove_edge") { const e = edge(a.id); F.edges = F.edges.filter((x) => x.id !== e.id && x.to !== e.id); this.save(); return `Removed ${e.id}.`; }
    if (op === "save") {
      const v = { v: `F${m.next.F++}`, date: today(), note: oneLine(a.note), ...snap() };
      F.versions.push(v); this.save(); return `Saved ${F.id} as ${v.v}.`;
    }
    if (op === "restore") {
      const v = version(a.id);
      F.nodes = JSON.parse(JSON.stringify(v.nodes)); F.edges = [...JSON.parse(JSON.stringify(v.edges)), ...F.edges.filter((e) => e.status === "rejected")];
      this.save(); return `Restored ${v.v} as the working state of ${F.id}.`;
    }
    if (op === "compare") {
      const A = a.id ? version(a.id) : F.versions.at(-1); if (!A) return "No saved version to compare with.";
      const B = a.with ? version(a.with) : { v: "working", ...snap() };
      const key = (e) => `${e.from}|${e.type}|${e.to}`;
      const ka = new Map(A.edges.map((e) => [key(e), e])), kb = new Map(B.edges.map((e) => [key(e), e]));
      const added = [...kb.keys()].filter((k) => !ka.has(k)).map((k) => this.edgeLine(kb.get(k)));
      const removed = [...ka.keys()].filter((k) => !kb.has(k)).map((k) => this.edgeLine(ka.get(k)));
      const changed = [...kb.keys()].filter((k) => ka.has(k) && (ka.get(k).sign !== kb.get(k).sign || ka.get(k).claim !== kb.get(k).claim || ka.get(k).label !== kb.get(k).label)).map((k) => this.edgeLine(kb.get(k)));
      const nA = new Set(Object.keys(A.nodes)), nB = new Set(Object.keys(B.nodes));
      return [`${A.v} compared with ${B.v}:`, `Concepts added: ${[...nB].filter((c) => !nA.has(c)).join(" ") || "none"}; removed: ${[...nA].filter((c) => !nB.has(c)).join(" ") || "none"}.`,
        ...added.map((l) => `+ ${l}`), ...removed.map((l) => `- ${l}`), ...changed.map((l) => `~ ${l}`)].join("\n");
    }
    if (op === "export") {
      const file = this.file.replace(/research-map\.json$/, `research-framework${m.frameworks.length > 1 ? "-" + F.id.toLowerCase() : ""}.svg`);
      writeFileSync(file, this.frameworkSvg(F)); return `Wrote ${file}.`;
    }
    throw new Error("framework op: list, create, rename, rename_node, activate, delete, show, add_node, remove_node, move, arrange, add_edge, edit_edge, remove_edge, save, restore, compare, export");
  }
  // Plain black-and-white figure for papers.
  frameworkSvg(F = this.fw()) {
    const m = this.m, W = 150;
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const nodes = Object.entries(F.nodes);
    if (!nodes.length) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 60"><text x="10" y="30">Empty framework</text></svg>`;
    const wrap = (s) => { const L = [""]; for (const w of cap(s).split(/\s+/)) { if ((L.at(-1) + " " + w).trim().length > 20 && L.at(-1)) L.push(w); else L[L.length - 1] = (L.at(-1) + " " + w).trim(); } return L.slice(0, 3); };
    const hOf = (c) => 26 + wrap(this.nodeLabel(c)).length * 15;
    const xs = nodes.map(([, n]) => n.x), ys = nodes.map(([, n]) => n.y);
    const x0 = Math.min(...xs) - W / 2 - 30, y0 = Math.min(...ys) - 60, x1 = Math.max(...xs) + W / 2 + 30, y1 = Math.max(...ys) + 70;
    const clipBox = (cx, cy, h, tx, ty) => { const dx = tx - cx, dy = ty - cy; if (!dx && !dy) return [cx, cy]; const s = Math.min(Math.abs((W / 2 + 4) / (dx || 1e-9)), Math.abs((h / 2 + 4) / (dy || 1e-9))); return [cx + dx * s, cy + dy * s]; };
    const WORD = { enables: "enables", constrains: "constrains", precedes: "precedes", partof: "part of", feeds: "feeds", produces: "produces", associated: "" };
    const mid = {}, lines = [], tags = [];
    const tagText = (x, y, s) => `<text x="${x}" y="${y}" font-size="12" paint-order="stroke" stroke="#fff" stroke-width="4">${esc(s)}</text>`;
    const segHits = (x1, y1, x2, y2, skip) => { let n = 0; for (let i = 2; i < 18; i++) { const t = i / 20, x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t; for (const [c, p] of nodes) if (!skip.includes(c) && Math.abs(x - p.x) < W / 2 + 6 && Math.abs(y - p.y) < hOf(c) / 2 + 6) n++; } return n; };
    const route = (sx, sy, tx, ty, skip, bend0, penalty) => {
      const dx = tx - sx, dy = ty - sy, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
      const hits = (cx, cy) => { let n = 0; for (let i = 1; i < 20; i++) { const t = i / 20, u = 1 - t, x = u * u * sx + 2 * u * t * cx + t * t * tx, y = u * u * sy + 2 * u * t * cy + t * t * ty; for (const [c, p] of nodes) if (!skip.includes(c) && Math.abs(x - p.x) < W / 2 + 8 && Math.abs(y - p.y) < hOf(c) / 2 + 8) n++; } return n; };
      let best = null;
      for (const off of [bend0, 50, -50, 100, -100, 160, -160]) { const cx = (sx + tx) / 2 + nx * off, cy = (sy + ty) / 2 + ny * off, n = hits(cx, cy) + (penalty ? 3 * penalty(0.25 * sx + 0.5 * cx + 0.25 * tx, 0.25 * sy + 0.5 * cy + 0.25 * ty) : 0); if (!best || n < best.n) best = { n, cx, cy }; if (!n) break; }
      const at = (t) => { const u = 1 - t; return [u * u * sx + 2 * u * t * best.cx + t * t * tx, u * u * sy + 2 * u * t * best.cy + t * t * ty]; };
      return { d: `M${sx} ${sy}Q${best.cx} ${best.cy} ${tx} ${ty}`, mid: at(0.5), at };
    };
    const live = F.edges.filter((e) => e.status === "accepted");
    const pair = (e) => live.some((x) => x !== e && x.from === e.to && x.to === e.from);
    for (const e of live.filter((e) => e.type !== "moderates")) {
      const a = F.nodes[e.from], b = F.nodes[e.to]; if (!a || !b) continue;
      const [sx, sy] = clipBox(a.x, a.y, hOf(e.from), b.x, b.y), [tx, ty] = clipBox(b.x, b.y, hOf(e.to), a.x, a.y);
      const mods = live.filter((x) => x.type === "moderates" && x.to === e.id && F.nodes[x.from]);
      const penalty = mods.length ? (mx, my) => mods.reduce((n, x) => n + segHits(F.nodes[x.from].x, F.nodes[x.from].y, mx, my, [x.from]), 0) : null;
      const r = route(sx, sy, tx, ty, [e.from, e.to], pair(e) ? 44 : 0, penalty); mid[e.id] = r.mid;
      const dash = this.edgeEvidence(e) === "supported" || (F.kind === "pipeline" && !e.claim) ? "" : ` stroke-dasharray="6 4"`;
      lines.push(`<path d="${r.d}" fill="none" stroke="#000" stroke-width="1.4"${dash}${e.type === "associated" ? "" : ' marker-end="url(#a)"'}/>`);
      const tag = [e.label, e.sign === "-" ? "−" : e.sign, e.type === "custom" ? e.verb : WORD[e.type]].filter(Boolean).join(" ");
      if (tag) { const [px, py] = mods.length ? r.at(0.3) : r.mid; tags.push(tagText(px, py - 7, tag).replace("<text ", '<text text-anchor="middle" ')); }
    }
    for (const e of live.filter((e) => e.type === "moderates")) {
      const a = F.nodes[e.from], t = mid[e.to]; if (!a || !t) continue;
      const [sx, sy] = clipBox(a.x, a.y, hOf(e.from), t[0], t[1]);
      lines.push(`<line x1="${sx}" y1="${sy}" x2="${t[0]}" y2="${t[1]}" stroke="#000" stroke-width="1.4"${this.edgeEvidence(e) === "supported" ? "" : ' stroke-dasharray="6 4"'} marker-end="url(#a)"/>`);
      const tag = [e.label, e.sign === "-" ? "−" : e.sign].filter(Boolean).join(" ");
      tags.push(`<circle cx="${t[0]}" cy="${t[1]}" r="3.5" fill="#000"/>`);
      if (tag) tags.push(tagText(t[0] + 8, t[1] - 8, tag));
    }
    const boxes = nodes.map(([c, n]) => {
      const L = wrap(this.nodeLabel(c)), h = hOf(c);
      const t = L.map((l, i) => `<text x="${n.x}" y="${n.y - (L.length - 1) * 7.5 + i * 15 + 5}" text-anchor="middle" font-size="13">${esc(l)}</text>`).join("");
      return `<rect x="${n.x - W / 2}" y="${n.y - h / 2}" width="${W}" height="${h}" fill="#fff" stroke="#000" stroke-width="1.4"/>${t}`;
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" font-family="Helvetica, Arial, sans-serif"><defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#000"/></marker></defs>${lines.join("")}${boxes.join("")}${tags.join("")}</svg>`;
  }

  // ---------- ontology ----------
  ontologySnap() {
    const m = this.m;
    return { labels: Object.fromEntries(Object.entries(m.concepts).map(([h, c]) => [h, c.label])),
      links: m.links.filter((l) => ["broader", "partof", "related", "sameas"].includes(l.rel)).map((l) => ({ from: l.from, rel: l.rel, to: l.to })) };
  }
  ontologyOp(a) {
    const m = this.m, op = a.op || "show";
    const version = (id) => { const v = m.ontologyVersions.find((x) => x.v === String(id || "").toUpperCase()); if (!v) throw new Error(`unknown ontology version ${id}`); return v; };
    const REL = { broader: "a kind of", partof: "part of", related: "related to", sameas: "same as" };
    if (op === "show") {
      const s = this.ontologySnap();
      if (!s.links.length) return "The ontology has no relations yet. Place concepts with map action=concept id=C4 parent=C1 parent_rel=broader|partof.";
      return [...s.links.map((l) => `${l.from} ${s.labels[l.from]} is ${REL[l.rel]} ${l.to} ${s.labels[l.to]}`),
        m.ontologyVersions.length ? `Versions: ${m.ontologyVersions.map((v) => `${v.v} ${v.date}${v.note ? " " + v.note : ""}`).join("; ")}` : "No saved versions."].join("\n");
    }
    if (op === "save") { const v = { v: `O${m.next.O++}`, date: today(), note: oneLine(a.note), ...this.ontologySnap() }; m.ontologyVersions.push(v); this.save(); return `Saved the ontology as ${v.v}.`; }
    if (op === "restore") {
      const v = version(a.id);
      m.links = [...m.links.filter((l) => !["broader", "partof", "related", "sameas"].includes(l.rel)), ...v.links.filter((l) => m.concepts[l.from] && m.concepts[l.to]).map((l) => ({ ...l, note: "", at: today() }))];
      this.save(); return `Restored ontology ${v.v}.`;
    }
    if (op === "compare") {
      const A = a.id ? version(a.id) : m.ontologyVersions.at(-1); if (!A) return "No saved version to compare with.";
      const B = a.with ? version(a.with) : { v: "working", ...this.ontologySnap() };
      const k = (l) => `${l.from}|${l.rel}|${l.to}`, sa = new Set(A.links.map(k)), sb = new Set(B.links.map(k));
      const say = (s) => { const [f, r, t] = s.split("|"); return `${B.labels[f] || A.labels[f] || f} is ${REL[r]} ${B.labels[t] || A.labels[t] || t}`; };
      const renamed = Object.keys(B.labels).filter((c) => A.labels[c] && A.labels[c] !== B.labels[c]).map((c) => `~ ${A.labels[c]} renamed to ${B.labels[c]}`);
      return [`${A.v} compared with ${B.v}:`, ...[...sb].filter((x) => !sa.has(x)).map((x) => `+ ${say(x)}`), ...[...sa].filter((x) => !sb.has(x)).map((x) => `- ${say(x)}`), ...renamed].join("\n");
    }
    if (op === "export") {
      const base = this.file.replace(/research-map\.json$/, "");
      const slug = String(m.project).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      const q = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"@en`;
      const T = [`@prefix skos: <http://www.w3.org/2004/02/skos/core#> .`, `@prefix ps: <urn:paper-scout:${slug}#> .`, "", `ps:scheme a skos:ConceptScheme ; skos:prefLabel ${q(this.ctx.ledger.peek?.(m.project)?.title || m.project)} .`,
        `ps:partOf a <http://www.w3.org/2002/07/owl#ObjectProperty> ; skos:definition ${q("The subject is a part of the object.")} .`, ""];
      for (const [h, c] of Object.entries(m.concepts)) {
        if (c.status === "dropped") continue;
        const L = [`ps:${h} a skos:Concept ; skos:inScheme ps:scheme ; skos:prefLabel ${q(c.label)}`];
        for (const x of c.alt || []) L.push(`skos:altLabel ${q(x)}`);
        if (c.use) L.push(`skos:definition ${q(c.use)}`);
        if (c.scope) L.push(`skos:scopeNote ${q(c.scope)}`);
        for (const l of m.links.filter((l) => l.from === h)) {
          if (l.rel === "broader") L.push(`skos:broader ps:${l.to}`);
          if (l.rel === "related") L.push(`skos:related ps:${l.to}`);
          if (l.rel === "sameas") L.push(`skos:exactMatch ps:${l.to}`);
          if (l.rel === "partof") L.push(`ps:partOf ps:${l.to}`);
        }
        T.push(L.join(" ;\n  ") + " .");
      }
      writeFileSync(base + "research-ontology.ttl", T.join("\n") + "\n");
      const parent = {}; for (const l of m.links) if (["broader", "partof"].includes(l.rel)) parent[l.from] = l;
      const kids = {}; for (const [h, c] of Object.entries(m.concepts)) if (c.status !== "dropped") (kids[parent[h]?.to && m.concepts[parent[h].to] ? parent[h].to : "_"] ||= []).push(h);
      const md = [`# Working ontology: ${m.project}`, ""];
      const walk = (h, d) => { const c = m.concepts[h]; md.push(`${"  ".repeat(d)}- **${cap(c.label)}**${parent[h] ? ` (${REL[parent[h].rel]} ${m.concepts[parent[h].to]?.label})` : ""}${c.use ? `: ${c.use}` : ""}`); for (const k of (kids[h] || [])) walk(k, d + 1); };
      for (const r of kids._ || []) walk(r, 0);
      writeFileSync(base + "research-ontology.md", md.join("\n") + "\n");
      return `Wrote ${base}research-ontology.ttl (SKOS) and ${base}research-ontology.md.`;
    }
    throw new Error("ontology op: show, save, restore, compare, export");
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
    const parts = [];
    parts.push(`<header><div class="proj">${esc(this.ctx.ledger.peek?.(m.project)?.title || m.project)}</div><div class="date">${esc(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }))}</div></header>`);
    if (!cur) parts.push("<p>No idea recorded yet.</p>");
    else {
      parts.push(`<h1>${esc(cur.statement)}</h1><p class="meta">Version ${esc(cur.v)} of ${esc(cur.date)}${cur.of ? `. Last change: ${esc(cur.change)}` : ""}</p>`);
      const fp = framingParts(cur);
      if (PART_KEYS.some((k) => fp[k])) parts.push(`<h2>Framing</h2>${PARTS.filter(([k]) => fp[k]).map(([k, l]) => fp[k].split("\n\n").map((x, i) => `<p>${i ? "" : `<b>${l}.</b> `}${esc(cap(x))}</p>`).join("")).join("")}`);
      if (cur.method) parts.push(`<h2>Methodology</h2>${cur.method.split("\n\n").map((x) => `<p>${esc(cap(x))}</p>`).join("")}`);
      const claims = (cur.claims || []).filter((k) => m.claims[k]);
      if (claims.length) parts.push(`<h2>Argument</h2><ol>${claims.map((k) => { const s = this.claimSupport(k); const src = (hs) => [...new Set(hs.map((h) => this.paperLabel(h.split("#")[0]).replace(/ \(P\d+\)$/, "")))].join("; ");
        return `<li>${esc(m.claims[k].text)}<div class="ev">${[s.supports.length ? `For: ${esc(src(s.supports))}` : "No supporting evidence linked yet", s.qualifies.length ? `Qualified by: ${esc(src(s.qualifies))}` : "", s.opposes.length ? `Against: ${esc(src(s.opposes))}` : ""].filter(Boolean).join(". ")}.</div></li>`; }).join("")}</ol>`);
      const F = this.fw();
      if (F.edges.some((e) => e.status === "accepted")) parts.push(`<h2>Conceptual framework: ${esc(F.name)}</h2><div class="fig">${this.frameworkSvg(F)}</div>`);
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
p { margin: 0 0 6px; }
p { margin: 0; }
.fig svg { width: 100%; max-height: 80mm; display: block; margin: 4px 0; }
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
    if ((m.repos || []).length) L.push("## Code", "", ...m.repos.map((r) => `- ${r.label}: \`${r.path}\`${r.role ? ` (${r.role})` : ""}${r.url ? ` ${r.url}` : ""}`), "");
    L.push("## Current idea", "");
    if (!cur) L.push("No version yet.", "");
    else {
      L.push(`**${cur.v}** (${cur.date}): ${cur.statement}`, "");
      const fp = framingParts(cur);
      L.push("### Framing", "", ...PARTS.flatMap(([k, l]) => [`**${l}.** ${fp[k] || "_Not yet written._"}`, ""]), "### Methodology", "", cur.method || "_Not yet written._", "");
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
    for (const F of m.frameworks || []) {
      const fe = F.edges.filter((e) => e.status === "accepted");
      if (fe.length) { L.push(`## Framework: ${F.name}`, ""); for (const e of fe) L.push(`- ${this.edgeLine(e)}`); L.push(""); }
    }
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
