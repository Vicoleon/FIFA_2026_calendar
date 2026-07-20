// delay-check: herramienta para MEDIR el retraso del plan gratis de football-data.org.
// Consulta los partidos de hoy de una competencia (por defecto Brasileirão = BSA,
// la única liga activa entre las gratuitas en junio) y devuelve, por cada partido:
// marcador, estado, minuto, utcDate y `lastUpdated` (cuándo la API lo refrescó),
// más la hora actual del servidor para poder comparar contra el marcador real.
//
// Uso:  /functions/v1/delay-check?comp=BSA   (o PL, PD, SA, BL1, FL1, DED, PPL, ELC, CL, WC)
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const TOKEN = Deno.env.get("FOOTBALL_DATA_TOKEN");
  if (!TOKEN) return json({ error: "FOOTBALL_DATA_TOKEN no configurado" }, 400);

  const comp = (new URL(req.url).searchParams.get("comp") || "BSA").toUpperCase();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  // ventana de 'hoy' y 'ayer' (por zonas horarias / partidos que cruzan medianoche UTC)
  const yest = new Date(now.getTime() - 24 * 3600e3).toISOString().slice(0, 10);

  const url = `https://api.football-data.org/v4/competitions/${comp}/matches?dateFrom=${yest}&dateTo=${today}`;
  const r = await fetch(url, { headers: { "X-Auth-Token": TOKEN } });
  if (!r.ok) return json({ error: "football-data error", status: r.status, body: await r.text(), comp }, 502);
  const data = await r.json();

  const fmt = (m: any) => {
    const lu = m.lastUpdated ? new Date(m.lastUpdated) : null;
    return {
      partido: `${m.homeTeam?.name ?? m.homeTeam?.tla ?? "?"} vs ${m.awayTeam?.name ?? m.awayTeam?.tla ?? "?"}`,
      estado: m.status,                                  // TIMED / IN_PLAY / PAUSED / FINISHED
      minuto: m.minute ?? null,
      marcador: `${m.score?.fullTime?.home ?? "-"} - ${m.score?.fullTime?.away ?? "-"}`,
      arranque_utc: m.utcDate,
      ultima_actualizacion_utc: m.lastUpdated ?? null,
      hace_segundos: lu ? Math.round((now.getTime() - lu.getTime()) / 1000) : null,
    };
  };

  const matches = (data.matches || []).map(fmt);
  const live = matches.filter((x: any) => x.estado === "IN_PLAY" || x.estado === "PAUSED");

  return json({
    competencia: comp,
    hora_servidor_utc: now.toISOString(),
    rate_limit_restante: r.headers.get("X-Requests-Available-Minute"),
    total_partidos_ventana: matches.length,
    en_vivo_ahora: live.length,
    como_medir: "Compara 'marcador' y 'minuto' de un partido EN_VIVO contra un marcador real (Google/ESPN) al mismo tiempo. 'hace_segundos' indica hace cuánto la API tocó ese registro.",
    partidos_en_vivo: live,
    todos_los_partidos: matches,
  });
});
