// sync-espn: marcador + estadísticas (posesión, tiros, córners, faltas, tarjetas)
// + goleadores desde la API pública no oficial de ESPN. Fuente gratuita, sin llave.
// Liga del Mundial: fifa.world
//
//  Modos:
//   (normal / mode=full)         -> scoreboard + summary: marcador, stats y goleadores (lento)
//   mode=scores                  -> SOLO scoreboard: marcador + minuto + estado (rápido, para "en vivo")
//                                   Guard robusto basado en ESPN: si ESPN no reporta ningún
//                                   partido "in", no escribe. NO depende de nuestros kickoff.
//   ?debug=1                     -> igual pero NO escribe
//   ?league=bra.1&date=YYYYMMDD  -> otra liga/fecha
//   ?event=ID&league=X           -> VALIDADOR: stats + goleadores de ese partido (sin DB)
//
//  El "mode" se acepta por query (?mode=scores) o por body JSON ({"mode":"scores"}).
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

const ALIAS: [string, string][] = [
  ["Korea Republic", "KOR"], ["South Korea", "KOR"],
  ["Cote d'Ivoire", "CIV"], ["Ivory Coast", "CIV"],
  ["Turkey", "TUR"], ["Turkiye", "TUR"],
  ["Czech Republic", "CZE"], ["Czechia", "CZE"],
  ["Cape Verde", "CPV"], ["Cabo Verde", "CPV"],
  ["DR Congo", "COD"], ["Congo DR", "COD"],
  ["United States", "USA"], ["USA", "USA"],
  ["Bosnia and Herzegovina", "BIH"], ["Bosnia-Herzegovina", "BIH"],
  ["IR Iran", "IRN"], ["Iran", "IRN"],
  ["New Zealand", "NZL"], ["Saudi Arabia", "KSA"], ["South Africa", "RSA"],
];

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer";

function getStat(stats: any[], names: string[]): number | null {
  for (const n of names) {
    const e = (stats || []).find((x) => (x.name || "").toLowerCase() === n.toLowerCase());
    if (e) { const v = parseFloat(String(e.displayValue).replace("%", "")); if (!isNaN(v)) return Math.round(v); }
  }
  return null;
}
const extractStats = (tb: any) => ({
  possession: getStat(tb?.statistics, ["possessionPct"]),
  shots: getStat(tb?.statistics, ["totalShots", "shots"]),
  shots_on_target: getStat(tb?.statistics, ["shotsOnTarget", "shotsOnGoal"]),
  corners: getStat(tb?.statistics, ["wonCorners", "corners"]),
  fouls: getStat(tb?.statistics, ["foulsCommitted", "fouls"]),
  offsides: getStat(tb?.statistics, ["offsides"]),
  yellow_cards: getStat(tb?.statistics, ["yellowCards"]),
  red_cards: getStat(tb?.statistics, ["redCards"]),
});
const isGoalEvent = (ke: any) => ke?.scoringPlay === true || /goal/i.test(ke?.type?.text || "");
const minOf = (ke: any) => parseInt(String(ke?.clock?.displayValue || "").replace(/\D/g, "")) || null;

// minuto de juego SOLO cuando el partido está en curso (state === "in").
const liveMinute = (displayClock: any, state: string): number | null => {
  if (state !== "in") return null;
  const n = parseInt(String(displayClock || ""));
  return isNaN(n) ? null : n;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const u = new URL(req.url);

  // El modo/flags pueden venir por query o por body JSON (db.functions.invoke manda body).
  let body: any = {};
  if (req.method === "POST") { try { body = await req.json(); } catch { /* sin body */ } }
  const debug = u.searchParams.get("debug") === "1" || body?.debug === true;
  const league = u.searchParams.get("league") || body?.league || "fifa.world";
  const mode = (u.searchParams.get("mode") || body?.mode || "full").toLowerCase();
  const eventId = u.searchParams.get("event") || body?.event;

  // VALIDADOR: stats + goleadores de un partido cualquiera, sin tocar la DB
  if (eventId) {
    const sum = await fetch(`${ESPN}/${league}/summary?event=${eventId}`).then((r) => r.ok ? r.json() : null);
    const bt = sum?.boxscore?.teams || [];
    const comps = sum?.header?.competitions?.[0]?.competitors || [];
    const emap: Record<string, string> = {};
    comps.forEach((c: any) => { emap[c.team?.id] = c.team?.abbreviation || c.team?.displayName; });
    return json({
      modo: "validador", league, event: eventId,
      equipos: bt.map((tb: any) => ({ equipo: tb.team?.displayName, abbr: tb.team?.abbreviation, stats: extractStats(tb) })),
      goleadores: (sum?.keyEvents || []).filter(isGoalEvent).map((ke: any) => ({
        equipo: emap[ke.team?.id], jugador: ke.athletesInvolved?.[0]?.displayName, minuto: ke.clock?.displayValue,
      })),
    });
  }

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const dParam = u.searchParams.get("date") || body?.date;
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const dates = dParam ? [dParam] : [fmt(new Date(Date.now() - 864e5)), fmt(new Date())];

  // --- resolución de equipos (compartida por ambos modos) ---
  const { data: teams } = await supa.from("teams").select("id,name,name_es");
  const byTla = new Map<string, string>(), byName = new Map<string, string>();
  (teams || []).forEach((t: any) => { byTla.set(t.id.toUpperCase(), t.id); byName.set(norm(t.name), t.id); byName.set(norm(t.name_es), t.id); });
  ALIAS.forEach(([a, id]) => byName.set(norm(a), id));
  const resolveTeam = (tm: any) => {
    const ab = (tm?.abbreviation || "").toUpperCase();
    if (byTla.has(ab)) return byTla.get(ab);
    return byName.get(norm(tm?.displayName || tm?.name || "")) || null;
  };

  const { data: ours } = await supa.from("matches").select("id,home_team,away_team,kickoff,status,home_score,away_score,minute,home_pens,away_pens");
  // tanda de penales: ESPN expone shootoutScore aparte del marcador (score).
  const penOf = (ev: any, H: any, A: any, swap: boolean) => {
    const hp = parseInt(H?.shootoutScore), ap = parseInt(A?.shootoutScore);
    const desc = ((ev.status?.type?.description || "") + " " + (ev.status?.type?.detail || "")).toLowerCase();
    const isShootout = !isNaN(hp) && !isNaN(ap) && (hp > 0 || ap > 0 || /shootout|penal/.test(desc));
    if (!isShootout) return null;
    return { home_pens: swap ? ap : hp, away_pens: swap ? hp : ap };
  };
  const findMine = (hid: string, aid: string, day: string) =>
    (ours || []).find((o: any) =>
      o.home_team && o.away_team && o.kickoff && o.kickoff.slice(0, 10) === day &&
      ((o.home_team === hid && o.away_team === aid) || (o.home_team === aid && o.away_team === hid)));

  // ============================================================
  //  MODO RÁPIDO: SOLO MARCADOR (para "en vivo", cada minuto)
  // ============================================================
  if (mode === "scores") {
    // Pre-carga los scoreboards de las fechas (una sola vez).
    const evs: any[] = [];
    for (const date of dates) {
      const sb = await fetch(`${ESPN}/${league}/scoreboard?dates=${date}`).then((r) => r.ok ? r.json() : null);
      if (sb?.events) evs.push(...sb.events);
    }
    // Guard ROBUSTO basado en ESPN (no en nuestros kickoff, que pueden estar mal):
    // procesa si ESPN tiene un partido "in" (en curso) O si NUESTRA BD aún marca
    // algún partido como 'live' (hay que capturar su silbatazo final aunque ya
    // nada esté "in"). Cuando todo está finalizado en ambos lados, sale barato.
    const anyLive = evs.some((ev) => ev?.status?.type?.state === "in");
    const weHaveLive = (ours || []).some((o: any) => o.status === "live");
    if (!debug && !anyLive && !weHaveLive) return json({ fuente: "espn", mode: "scores", actualizados: 0, reason: "nothing live" });

    const out: any[] = [];
    for (const ev of evs) {
      const comp = ev.competitions?.[0]; if (!comp) continue;
      const state = ev.status?.type?.state;
      if (state === "pre" && !debug) continue; // sin marcador todavía
      const cs = comp.competitors || [];
      const H = cs.find((c: any) => c.homeAway === "home") || cs[0];
      const A = cs.find((c: any) => c.homeAway === "away") || cs[1];
      const hid = resolveTeam(H?.team), aid = resolveTeam(A?.team);
      if (!hid || !aid) continue;
      const day = (ev.date || "").slice(0, 10);
      const mine = findMine(hid, aid, day);
      if (!mine) continue;

      const status = state === "post" ? "finished" : state === "in" ? "live" : "scheduled";
      const hs = parseInt(H?.score), as = parseInt(A?.score);
      const swap = mine.home_team === aid;
      const oh = swap ? as : hs, oa = swap ? hs : as;
      const minute = liveMinute(ev.status?.displayClock, state);
      const patch: any = { status, minute };
      if (!isNaN(oh)) patch.home_score = oh;
      if (!isNaN(oa)) patch.away_score = oa;
      const pens = penOf(ev, H, A, swap);
      if (pens) { patch.home_pens = pens.home_pens; patch.away_pens = pens.away_pens; }

      // sólo escribe si cambió algo (evita writes/eventos Realtime redundantes)
      const changed = mine.status !== status
        || (patch.home_score != null && mine.home_score !== patch.home_score)
        || (patch.away_score != null && mine.away_score !== patch.away_score)
        || (mine.minute ?? null) !== (minute ?? null)
        || (!!pens && ((mine.home_pens ?? null) !== patch.home_pens || (mine.away_pens ?? null) !== patch.away_pens));
      out.push({ id: mine.id, ...patch, changed });
      if (!debug && changed) await supa.from("matches").update(patch).eq("id", mine.id);
    }
    return json({ fuente: "espn", mode: "scores", league, fechas: dates, actualizados: out.filter((o) => o.changed).length, debug, detalle: out });
  }

  // ============================================================
  //  MODO COMPLETO: marcador + estadísticas + goleadores (cron horario)
  // ============================================================
  const out: any[] = [];
  for (const date of dates) {
    const sb = await fetch(`${ESPN}/${league}/scoreboard?dates=${date}`).then((r) => r.ok ? r.json() : null);
    for (const ev of sb?.events || []) {
      const comp = ev.competitions?.[0]; if (!comp) continue;
      const state = ev.status?.type?.state;
      if (state === "pre" && !debug) continue;
      const cs = comp.competitors || [];
      const H = cs.find((c: any) => c.homeAway === "home") || cs[0];
      const A = cs.find((c: any) => c.homeAway === "away") || cs[1];
      const hid = resolveTeam(H?.team), aid = resolveTeam(A?.team);
      if (!hid || !aid) continue;
      const day = (ev.date || "").slice(0, 10);
      const mine = findMine(hid, aid, day);
      if (!mine) continue;

      const status = state === "post" ? "finished" : state === "in" ? "live" : "scheduled";
      const hs = parseInt(H?.score), as = parseInt(A?.score);
      const swap = mine.home_team === aid;
      const oh = swap ? as : hs, oa = swap ? hs : as;
      const patch: any = { status, minute: liveMinute(ev.status?.displayClock, state) };
      if (!isNaN(oh)) patch.home_score = oh;
      if (!isNaN(oa)) patch.away_score = oa;
      const pens = penOf(ev, H, A, swap);
      if (pens) { patch.home_pens = pens.home_pens; patch.away_pens = pens.away_pens; }

      const sum = await fetch(`${ESPN}/${league}/summary?event=${ev.id}`).then((r) => r.ok ? r.json() : null);
      const statRows: any[] = [];
      for (const tb of sum?.boxscore?.teams || []) {
        const tid = resolveTeam(tb.team);
        if (tid === hid || tid === aid) statRows.push({ match_id: mine.id, team_id: tid, ...extractStats(tb) });
      }
      // goleadores (keyEvents). Mapea por id de equipo de ESPN.
      const espnMap: Record<string, string> = {};
      if (H?.team?.id) espnMap[H.team.id] = hid;
      if (A?.team?.id) espnMap[A.team.id] = aid;
      const goalRows: any[] = [];
      for (const ke of sum?.keyEvents || []) {
        if (!isGoalEvent(ke)) continue;
        const tid = espnMap[ke.team?.id];
        if (!tid) continue;
        const txt = (ke.type?.text || "").toLowerCase();
        goalRows.push({
          match_id: mine.id, team_id: tid,
          player: ke.athletesInvolved?.[0]?.displayName || null,
          minute: minOf(ke),
          own_goal: /own/.test(txt), penalty: /penal/.test(txt),
        });
      }

      out.push({ id: mine.id, ...patch, stats_filas: statRows.length, goles: goalRows.length });
      if (!debug) {
        await supa.from("matches").update(patch).eq("id", mine.id);
        if (statRows.length) await supa.from("match_stats").upsert(statRows, { onConflict: "match_id,team_id" });
        if (goalRows.length) {
          await supa.from("goals").delete().eq("match_id", mine.id); // evita duplicados al re-sincronizar
          await supa.from("goals").insert(goalRows);
        }
      }
    }
  }
  return json({ fuente: "espn", mode: "full", league, fechas: dates, actualizados: out.length, debug, detalle: out });
});
