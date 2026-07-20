// site: sirve el sitio del Mundial 2026 desde el repo público de GitHub.
const RAW = "https://raw.githubusercontent.com/Vicoleon/FIFA_2026_calendar/main/";
const BASE = "/functions/v1/site/";
const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  ico: "image/x-icon", txt: "text/plain; charset=utf-8",
};

Deno.serve(async (req) => {
  const url = new URL(req.url);
  let path = url.pathname.split("/site/")[1] ?? "";
  if (!path) path = "index.html";

  const ext = (path.split(".").pop() || "html").toLowerCase();
  const ct = TYPES[ext] || "application/octet-stream";

  const r = await fetch(RAW + path);
  if (!r.ok) {
    const h = new Headers(); h.set("content-type", "text/plain; charset=utf-8");
    return new Response("No encontrado: " + path, { status: 404, headers: h });
  }

  const headers = new Headers();
  headers.set("content-type", ct);
  headers.set("cache-control", "public, max-age=60");

  if (ext === "html") {
    let html = await r.text();
    html = html.replace(/<head([^>]*)>/i, `<head$1>\n  <base href="${BASE}">`);
    return new Response(html, { headers });
  }
  const body = await r.arrayBuffer();
  return new Response(body, { headers });
});
