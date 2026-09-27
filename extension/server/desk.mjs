// Research Desk: a small local web page served by Paper Scout on 127.0.0.1, so the user can screen papers,
// read evidence cards and follow Feynman runs in a browser pane without spending Claude tokens.
// Access needs a random token in the URL, so other web pages cannot drive it.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export function startDesk({ port, cacheDir, callTool, log }) {
  mkdirSync(cacheDir, { recursive: true });
  const tokFile = join(cacheDir, "desk-token");
  let token = "";
  try { token = readFileSync(tokFile, "utf8").trim(); } catch {}
  if (!/^[a-f0-9]{32}$/.test(token)) { token = randomBytes(16).toString("hex"); try { writeFileSync(tokFile, token); } catch {} }
  const url = `http://127.0.0.1:${port}/?t=${token}`;
  const state = { url, running: false };

  const send = (res, code, body, type = "application/json; charset=utf-8") => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve) => {
    let b = ""; req.on("data", (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve(null); } });
  });

  const srv = createServer(async (req, res) => {
    try {
      const u = new URL(req.url, `http://127.0.0.1:${port}`);
      const given = u.searchParams.get("t") || req.headers["x-desk-token"];
      if (given !== token) return send(res, 403, "Open the Research Desk link from Paper Scout (it includes an access token).", "text/plain; charset=utf-8");
      if (req.method === "GET" && u.pathname === "/") {
        const html = readFileSync(join(HERE, "desk.html"), "utf8").replace("__DESK_TOKEN__", token);
        return send(res, 200, html, "text/html; charset=utf-8");
      }
      if (req.method === "GET" && u.pathname === "/summary") {
        const html = await callTool("map", { action: "summary_html", project: u.searchParams.get("project") || undefined });
        return send(res, 200, html, "text/html; charset=utf-8");
      }
      if (req.method === "GET" && u.pathname === "/api/desk") {
        const project = u.searchParams.get("project") || undefined;
        const dump = JSON.parse(await callTool("session", { action: "dump", project }));
        try { dump.map = JSON.parse(await callTool("map", { action: "snapshot", project })); }
        catch (e) { dump.map = null; dump.mapError = e.message || String(e); }
        return send(res, 200, dump);
      }
      if (req.method === "POST" && u.pathname.startsWith("/api/")) {
        const body = await readBody(req);
        if (!body) return send(res, 400, { error: "bad JSON" });
        const tool = u.pathname.slice(5);
        const allowed = { session: ["note", "start", "bibtex", "card", "title"], search: null, code: null, paper: null, map: ["concept", "note", "task", "framework"] };
        if (!(tool in allowed)) return send(res, 404, { error: "unknown action" });
        if (allowed[tool] && !allowed[tool].includes(body.action)) return send(res, 400, { error: "action not allowed" });
        // From the page, the map only takes concept triage and notes.
        let input = body;
        if (tool === "map" && body.action === "concept") {
          // Triage and edits by the user; a new concept needs only a label.
          input = { action: "concept" };
          for (const k of ["id", "label", "status", "use", "scope", "note", "role"]) if (body[k] !== undefined) input[k] = body[k];
          for (const k of ["parent", "parent_rel"]) if (body[k] !== undefined) input[k] = body[k];
          if (!input.id && !input.label) return send(res, 400, { error: "concept id or label required" });
        } else if (tool === "map" && body.action === "task") {
          input = { action: "task" };
          for (const k of ["id", "text", "kind", "about", "status", "due", "note"]) if (body[k] !== undefined) input[k] = body[k];
          if (!input.id) input.source = "you";
        } else if (tool === "map" && body.action === "framework") {
          if (["restore"].includes(body.op) && !body.confirmed) return send(res, 400, { error: "confirm restore" });
          input = { ...body, by: "you" };
        } else if (tool === "map") {
          input = body.id ? { action: "note", id: String(body.id), status: body.status } : { action: "note", text: String(body.text || ""), kind: body.kind, about: body.about || "" };
        }
        const out = await callTool(tool, input);
        return send(res, 200, { text: typeof out === "string" ? out : JSON.stringify(out) });
      }
      send(res, 404, { error: "not found" });
    } catch (e) {
      send(res, 500, { error: e.message || String(e) });
    }
  });
  srv.on("error", (e) => { log(`research desk not started: ${e.code === "EADDRINUSE" ? `port ${port} already in use` : e.message}`); });
  srv.listen(port, "127.0.0.1", () => { state.running = true; log(`research desk at ${url}`); });
  return state;
}
