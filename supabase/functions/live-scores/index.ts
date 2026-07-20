// live-scores: proxy seguro que trae marcadores en vivo del Mundial desde
// football-data.org y los escribe en la tabla `matches`. El token vive como
// secreto FOOTBALL_DATA_TOKEN (nunca se expone al navegador).
//
// NOTA (respaldo 2026-07-20): función EN DESUSO. Se conserva sólo como
// respaldo histórico; la fuente única de datos en vivo pasó a ser `sync-espn`.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// normaliza nombres: minúsculas, sin acentos, sólo alfanumérico
const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

// alias de nombres de football-data.org -> nuestro id interno
const ALIAS: [string, string][] = [
  ["Korea Republic", "KOR"], ["South Korea", "KOR"],
  ["Cote d'Ivoire", "CIV"], ["Côte d'Ivoire", "CIV"], ["Ivory Coast", "CIV"],
  ["Turkey", "TUR"], ["Türkiye", "TUR"], ["Turkiye", "TUR"],
  ["Czech Republic", "CZE"], ["Czechia", "CZE"],
  ["Cape Verde", "CPV"], ["Cabo Verde", "CPV"],
  ["DR Congo", "COD"], ["Congo DR", "COD"], ["Democratic Republic of Congo", "COD"],
  ["United States", "USA"], ["USA", "USA"], ["United States of America", "USA"],
  ["Bosnia and Herzegovina", "BIH"], ["Bosnia-Herzegovina", "BIH"],
  ["IR Iran", "IRN"], ["Iran", "IRN"],
  ["New Zealand", "NZL"], ["Saudi Arabia", "KSA"], ["South Africa", "RSA"],
];

const mapStatus = (s: string) => {
  if (s === "IN_PLAY" || s === "PAUSED" || s === "LIVE") return "live";
  if (s === "FINISHED") return "finished";
  if (s === "TIMED" || s === "SCHEDULED") return "scheduled";
  return null; // POSTPONED/SUSPENDED/etc -> no tocar
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const debug = new URL(req.url).searchParams.get("debug") === "1";

  const TOKEN = Deno.env.get("FOOTBALL_DATA_TOKEN");
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // ¿hay una "ventana en vivo"? (algún partido con equipos, arranque en [-3h, +15min], no finalizado)
  const since = new Date(Date.now() - 3 * 3600e3).toISOString();
  const until = new Date(Date.now() + 15 * 60e3).toISOString();
  const { data: live } = await supa.from("matches")
    .select("id").lte("kickoff", until).gte("kickoff", since).neq("status", "finished").limit(1);
  if (!debug && (!live || live.length === 0)) return json({ synced: 0, reason: "no live window" });
  if (!TOKEN) return json({ error: "FOOTBALL_DATA_TOKEN no está configurado en los secretos" }, 400);

  // trae los partidos del Mundial
  const r = await fetch("https://api.football-data.org/v4/competitions/WC/matches", {
    headers: { "X-Auth-Token": TOKEN },
  });
  if (!r.ok) return json({ error: "football-data error", status: r.status, body: await r.text() }, 502);
  const ext = await r.json();

  const { data: teams } = await supa.from("teams").select("id,name,name_es");
  const byTla = new Map<string, string>();
  const byName = new Map<string, string>();
  (teams || []).forEach((t: any) => {
    byTla.set(t.id.toUpperCase(), t.id);
    byName.set(norm(t.name), t.id);
    byName.set(norm(t.name_es), t.id);
  });
  ALIAS.forEach(([a, id]) => byName.set(norm(a), id));
  const resolve = (tm: any) => {
    if (!tm) return null;
    if (tm.tla && byTla.has(tm.tla.toUpperCase())) return byTla.get(tm.tla.toUpperCase());
    if (tm.name && byName.has(norm(tm.name))) return byName.get(norm(tm.name));
    return null;
  };

  const { data: ours } = await supa.from("matches").select("id,home_team,away_team,kickoff");
  const results: any[] = [];
  for (const m of ext.matches || []) {
    const hid = resolve(m.homeTeam), aid = resolve(m.awayTeam);
    if (!hid || !aid) continue;
    const day = (m.utcDate || "").slice(0, 10);
    const mine = (ours || []).find((o: any) =>
      o.home_team && o.away_team && day && o.kickoff && o.kickoff.slice(0, 10) === day &&
      ((o.home_team === hid && o.away_team === aid) || (o.home_team === aid && o.away_team === hid)));
    if (!mine) continue;
    const st = mapStatus(m.status);
    let oh = m.score?.fullTime?.home, oa = m.score?.fullTime?.away;
    if (mine.home_team === aid) { const t = oh; oh = oa; oa = t; } // orienta a nuestro local/visita
    const patch: any = {};
    if (st) patch.status = st;
    if (oh != null) patch.home_score = oh;
    if (oa != null) patch.away_score = oa;
    if (m.minute != null) patch.minute = m.minute;
    if (Object.keys(patch).length) {
      results.push({ id: mine.id, ...patch });
      if (!debug) await supa.from("matches").update(patch).eq("id", mine.id);
    }
  }
  return json({ synced: results.length, debug, results });
});
