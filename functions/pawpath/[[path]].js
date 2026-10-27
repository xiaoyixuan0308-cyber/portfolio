// PawPath read-only demo: serves pre-rendered pages per demo role (cookie pp_role).
import M from "../_lib/pp-manifest.json";

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
const READ_ONLY = "演示版为只读，此操作在完整版中可用";

export async function onRequest(context) {
  const req = context.request;
  const url = new URL(req.url);
  const p = url.pathname;
  if (p.startsWith("/pawpath/_next/") || p.startsWith("/pawpath/__") || p.startsWith("/pawpath/uploads/") || /\.[a-z0-9]+$/i.test(p)) return context.next();
  if (url.searchParams.has("_rsc") || req.headers.get("RSC") === "1") return new Response("", { status: 404 });
  if (req.method !== "GET" && req.method !== "HEAD")
    return new Response(JSON.stringify({ error: READ_ONLY }), { status: 403, headers: { "content-type": "application/json; charset=utf-8" } });

  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)pp_role=([a-z]+)/);
  let role = m && M.pages[m[1]] ? m[1] : "public";
  const k = keyOf(url);
  const redir = M.redirects[role][k];
  if (redir) return Response.redirect(new URL(redir, url).toString(), 302);
  const fn = M.pages[role][k] || M.pages[role][k.split("?")[0]];
  if (fn) {
    const a = new URL("/pawpath/__p/" + fn, url);
    const r = await context.env.ASSETS.fetch(new Request(a.toString()));
    if (r.ok) return new Response(r.body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
  return Response.redirect(new URL(role === "public" ? "/pawpath" : "/pawpath/home", url).toString(), 302);
}
