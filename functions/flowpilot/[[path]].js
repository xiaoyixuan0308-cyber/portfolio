// FlowPilot Lab read-only demo: serves pre-rendered pages and API snapshots.
import M from "../_lib/fp-manifest.json";

const enc = (s) => encodeURIComponent(s);
function keyOf(url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const qs = [...url.searchParams.entries()]
    .filter(([k]) => k !== "_rsc")
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => enc(k) + "=" + enc(v))
    .join("&");
  return path + (qs ? "?" + qs : "");
}
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const READ_ONLY = "演示版为只读，此操作在完整版中可用";

async function asset(context, path, type) {
  const u = new URL(context.request.url);
  u.pathname = path; u.search = "";
  const r = await context.env.ASSETS.fetch(new Request(u.toString()));
  if (!r.ok) return null;
  return new Response(r.body, { status: 200, headers: { "content-type": type, "cache-control": "public, max-age=300" } });
}

export async function onRequest(context) {
  const req = context.request;
  const url = new URL(req.url);
  const p = url.pathname;

  if (p.startsWith("/flowpilot/_next/") || p.startsWith("/flowpilot/__") || /\.[a-z0-9]+$/i.test(p)) return context.next();

  // App Router client navigation: refuse so Next falls back to a full page load
  if (url.searchParams.has("_rsc") || req.headers.get("RSC") === "1") return new Response("", { status: 404 });

  if (p.startsWith("/flowpilot/api/")) {
    if (req.method !== "GET") return json({ error: READ_ONLY, message: READ_ONLY }, 403);
    if (p === "/flowpilot/api/search/hierarchy") {
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      const type = (url.searchParams.get("type") || "").toLowerCase();
      let table = (url.searchParams.get("table") || "monthly").toLowerCase();
      table = table === "month" ? "monthly" : table === "week" ? "weekly" : table;
      if (!q) return json({ error: "请提供搜索关键词 q" }, 400);
      const r = await context.env.ASSETS.fetch(new Request(new URL(`/flowpilot/__a/search-${type}-${table}.json`, url).toString()));
      if (!r.ok) return json({ error: "type 必须为 channel / category / sku 之一" }, 400);
      const all = await r.json();
      const f = { channel: ["channel_code", "channel_name"], category: ["category_code", "category_name"], sku: ["sku"] }[type];
      const rows = all.filter((row) => f.some((k) => String(row[k] ?? "").toLowerCase().includes(q)));
      return json({ q, type, table, total: rows.length, rows });
    }
    const fn = M.api[keyOf(url)];
    if (fn) return (await asset(context, "/flowpilot/__a/" + fn, "application/json; charset=utf-8")) || json({ error: "演示数据缺失" }, 404);
    return json({ error: "演示版未包含此数据", message: "演示版未包含此数据" }, 404);
  }

  if (req.method !== "GET" && req.method !== "HEAD") return json({ error: READ_ONLY }, 403);
  const k = keyOf(url);
  const fn = M.pages[k] || M.pages[k.split("?")[0]];
  if (fn) return (await asset(context, "/flowpilot/__p/" + fn, "text/html; charset=utf-8")) || new Response("Not found", { status: 404 });
  const home = M.pages["/flowpilot"];
  return Response.redirect(new URL("/flowpilot", url).toString(), 302) || home;
}
