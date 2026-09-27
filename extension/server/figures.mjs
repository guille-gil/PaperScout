// On-demand figure rendering: find a figure's caption in a PDF, render that page, crop to the figure,
// and return a compact PNG. Nothing is rendered unless a figure or page is explicitly requested.

const MAX_W = 1000;

function captionRegex(n) {
  const num = String(n).replace(/[^0-9A-Za-z.]/g, "");
  return new RegExp(`^\\s*(Fig\\.?|Figure|FIGURE|FIG\\.?)\\s*${num.replace(".", "\\.")}(?![0-9])`);
}

// Group text items into lines (in stream order) with geometry.
function lines(items) {
  const out = [];
  let cur = null;
  for (const it of items) {
    if (typeof it.str !== "string" || !it.str.trim()) { if (it.hasEOL && cur) { out.push(cur); cur = null; } continue; }
    const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 8;
    if (!cur || Math.abs(y - cur.y) > Math.max(2, h * 0.4)) { if (cur) out.push(cur); cur = { x, y, h, x2: x + (it.width || 0), text: it.str }; }
    else { cur.text += " " + it.str; cur.x2 = Math.max(cur.x2, x + (it.width || 0)); cur.h = Math.max(cur.h, h); }
    if (it.hasEOL) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

export async function renderFigure(buf, { figure, page }) {
  const unpdf = await import("unpdf");
  const canvasImport = () => import("@napi-rs/canvas");
  const pdf = await unpdf.getDocumentProxy(new Uint8Array(buf));
  let target = null; // { page, top, bottom } in PDF units (y from bottom)

  if (figure) {
    const rx = captionRegex(figure);
    const cands = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const pg = await pdf.getPage(p);
      const vp = pg.getViewport({ scale: 1 });
      const ls = lines((await pg.getTextContent()).items);
      const bodyH = ls.map((l) => l.h).sort((a, b) => a - b)[Math.floor(ls.length / 2)] || 9;
      ls.forEach((l, i) => {
        if (!rx.test(l.text)) return;
        // Prose lines: body-size text that is reasonably long. Figure labels are short or small.
        const prose = ls.filter((o) => o.h >= bodyH * 0.9 && o.text.length > 40 && o.y > l.y + l.h * 1.2 && o.x < l.x2 && o.x2 > l.x);
        const above = prose.length ? Math.min(...prose.map((o) => o.y)) : vp.height - 20;
        const gap = above - l.y;
        // Caption extends downwards until a clear vertical gap.
        let bottom = l.y - l.h * 0.28, prevY = l.y, caption = l.text;
        // Continue the caption only while lines look like caption text: smaller than body text, or the
        // previous caption line has not ended a sentence (body-size captions).
        const smallCap = l.h < bodyH * 0.97;
        let prevText = l.text;
        for (const o of ls.slice(i + 1)) {
          const near = o.y < prevY && prevY - o.y < o.h * 1.8 && o.x < l.x2 && o.x2 > l.x - 5;
          const capLike = smallCap ? o.h <= l.h * 1.05 : !/[.:]\s*$/.test(prevText);
          if (!near || !capLike) break;
          bottom = o.y - o.h * 0.28; prevY = o.y; caption += " " + o.text; prevText = o.text;
        }
        // Two-column pages: keep only the caption's column unless the caption crosses the middle.
        const mid = vp.width / 2;
        const x0 = l.x2 <= mid + 10 ? 0 : l.x >= mid - 10 ? mid - 6 : 0;
        const x1 = l.x2 <= mid + 10 ? mid + 6 : vp.width;
        cands.push({ page: p, top: prose.length ? above - bodyH * 0.45 : above, bottom, gap, width: vp.width, height: vp.height, x0, x1, caption: caption.replace(/\s+/g, " ").trim().slice(0, 400) });
      });
    }
    if (!cands.length) throw new Error(`No caption for figure ${figure} found in the PDF text.`);
    target = cands.sort((a, b) => b.gap - a.gap)[0];
    if (target.gap < 30) target = { ...target, top: target.height, bottom: 0 }; // fall back to the full page
  } else {
    const p = Math.max(1, Math.min(Number(page) || 1, pdf.numPages));
    const pg = await pdf.getPage(p);
    const vp = pg.getViewport({ scale: 1 });
    target = { page: p, top: vp.height, bottom: 0, width: vp.width, height: vp.height, x0: 0, x1: vp.width };
  }

  const scale = Math.min(2, MAX_W / target.width);
  const png = await unpdf.renderPageAsImage(new Uint8Array(buf), target.page, { canvasImport, scale });
  const { createCanvas, loadImage } = await canvasImport();
  const img = await loadImage(Buffer.from(png));
  const y0 = Math.max(0, Math.floor((target.height - target.top) * scale) - 4);
  const y1 = Math.min(img.height, Math.ceil((target.height - target.bottom) * scale) + 1);
  const h = Math.max(20, y1 - y0);
  const px0 = Math.max(0, Math.floor((target.x0 ?? 0) * scale)), px1 = Math.min(img.width, Math.ceil((target.x1 ?? target.width) * scale));
  const w = Math.max(20, px1 - px0);
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, px0, y0, w, h, 0, 0, w, h);
  const out = c.toBuffer("image/png");
  return { page: target.page, png: out, width: w, height: h, caption: target.caption || "", full: target.top === target.height && target.bottom === 0 };
}
