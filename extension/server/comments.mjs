// Supervision comments: reads them from a Word file (comments and the passage each covers), a PDF (annotations and
// the text under them) or pasted text, and anchors each one to a sentence of the draft. Local, with no network and
// no Claude: deciding what a comment means for the argument is left to Claude and the user. Files are only read.

import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const clip = (s, n) => { s = oneLine(s); return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, "") + "…"; };
export const commentHash = (c) => createHash("sha1").update(oneLine(`${c.text}|${c.quote}`).toLowerCase()).digest("hex").slice(0, 10);

// ---------- a minimal zip reader (enough for .docx: stored or deflated entries) ----------
export function readZip(buf, wanted) {
  const out = {};
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("this does not look like a Word (.docx) file");
  let p = buf.readUInt32LE(eocd + 16);
  const n = buf.readUInt16LE(eocd + 10);
  for (let k = 0; k < n && buf.readUInt32LE(p) === 0x02014b50; k++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (!wanted.includes(name)) continue;
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = buf.subarray(start, start + csize);
    out[name] = method === 0 ? data : method === 8 ? inflateRawSync(data) : null;
  }
  return out;
}

const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&");
const wtext = (xml) => unxml([...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<\/w:p>/g)].map((m) => (m[1] === undefined ? " " : m[1])).join(""));

export function docxComments(buf) {
  const z = readZip(buf, ["word/comments.xml", "word/document.xml"]);
  if (!z["word/comments.xml"]) return [];
  const comments = z["word/comments.xml"].toString("utf8"), doc = (z["word/document.xml"] || Buffer.alloc(0)).toString("utf8");
  const out = [];
  for (const m of comments.matchAll(/<w:comment\s([^>]*)>([\s\S]*?)<\/w:comment>/g)) {
    const attr = (k) => (m[1].match(new RegExp(`w:${k}="([^"]*)"`)) || [])[1] || "";
    const id = attr("id");
    const a = doc.indexOf(`<w:commentRangeStart w:id="${id}"`), b = doc.indexOf(`<w:commentRangeEnd w:id="${id}"`);
    const quote = a >= 0 && b > a ? oneLine(wtext(doc.slice(a, b))) : "";
    out.push({ by: unxml(attr("author")), date: attr("date").slice(0, 10), text: oneLine(wtext(m[2])), quote });
  }
  return out.filter((c) => c.text);
}

// ---------- PDF annotations (through pdf.js, which the extension already uses to read papers) ----------
const KINDS = new Set(["Text", "Highlight", "Underline", "StrikeOut", "Squiggly", "FreeText", "Caret"]);
export async function pdfComments(buf) {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const out = []; let bare = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const annots = (await page.getAnnotations()).filter((a) => KINDS.has(a.subtype));
    if (!annots.length) continue;
    const items = (await page.getTextContent()).items.filter((i) => i.str && i.transform).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0, h: i.height || Math.abs(i.transform[3]) || 10 }));
    for (const a of annots) {
      const text = oneLine(a.contentsObj?.str || a.contents || "");
      if (!text) { bare++; continue; }
      const [x1, y1, x2, y2] = a.rect;
      const marks = ["Highlight", "Underline", "StrikeOut", "Squiggly"].includes(a.subtype);
      // Highlights cover their text; a sticky note refers to the line it sits beside.
      const box = marks ? [x1 - 1, y1 - 1, x2 + 1, y2 + 1] : [0, y1 - 8, 1e6, y2 + 8];
      const under = items.filter((i) => i.x < box[2] && i.x + i.w > box[0] && i.y < box[3] && i.y + i.h > box[1]).sort((p, q) => (Math.abs(q.y - p.y) > 3 ? q.y - p.y : p.x - q.x));
      out.push({ by: oneLine(a.titleObj?.str || a.title || ""), date: String(a.modificationDate || "").replace(/^D:(\d{4})(\d{2})(\d{2}).*/, "$1-$2-$3").replace(/^D:.*/, ""), text, quote: oneLine(under.map((i) => i.s).join(" ")), page: n });
    }
  }
  return { comments: out, bare };
}

// ---------- pasted text ----------
// Blocks separated by a blank line. Lines starting with ">" quote the passage; "by: NAME" names the author.
export function parsePasted(text) {
  const out = [];
  for (const block of String(text || "").replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const quote = lines.filter((l) => l.startsWith(">")).map((l) => l.replace(/^>+\s*/, "")).join(" ");
    let by = "", rest = lines.filter((l) => !l.startsWith(">"));
    const b = rest[0]?.match(/^(?:by|from)\s*:\s*(.+)$/i) || rest[0]?.match(/^([A-Z][\w.'-]{0,20}(?: [A-Z][\w.'-]{0,20})?)\s*:\s+(.{3,})$/);
    if (b && rest[0].length < 200) { by = oneLine(b[1]); rest = b[2] ? [b[2], ...rest.slice(1)] : rest.slice(1); }
    const t = oneLine(rest.join(" "));
    if (t) out.push({ by, date: "", text: t, quote: oneLine(quote) });
  }
  return out;
}

// ---------- anchoring ----------
const stop = new Set("the and for that with this from are was were has have had not but can may also its their than then into".split(" "));
export const tokens = (s) => oneLine(String(s || "").replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\d{4}[^)]*\)/g, " ")).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !stop.has(w));

// The sentence of the draft a quoted passage belongs to: the most overlap, relative to the shorter of the two.
export function anchorTo(quote, sents) {
  const q = tokens(quote);
  if (q.length < 2) return null;
  const qs = new Set(q);
  let best = null;
  for (const s of sents) {
    const st = tokens(s.text); if (!st.length) continue;
    const ss = new Set(st); let n = 0; for (const t of qs) if (ss.has(t)) n++;
    const score = n / Math.min(qs.size, ss.size);
    if (n >= 2 && score >= 0.7 && (!best || score > best.score || (score === best.score && n > best.n))) best = { s, score, n };
  }
  return best ? best.s : null;
}

// What became of a comment's passage since it was made: still there, edited, or gone.
export function passageState(anchor, sents) {
  if (!anchor) return { state: "open", at: null };
  const same = sents.find((s) => s.id === anchor.sid);
  if (same) return { state: "open", at: same };
  const moved = anchorTo(anchor.text, sents);
  return moved ? { state: "edited", at: moved } : { state: "gone", at: null };
}

export { clip };
