// ============================================================
//  FIFA Calendario 2026 · Edge Function · weekly-digest
//  Resumen semanal por email (pensado para pg_cron, lunes).
//
//  Seguridad: verify_jwt=false. Exige cabecera 'x-cron-secret'
//  que debe coincidir con el secreto CRON_SECRET. Usa la
//  service-role key (omite RLS) porque corre del lado servidor.
//
//  Para cada usuario CON email arma y envía vía Resend:
//   · Puntos ganados en los últimos 7 días.
//   · Total acumulado y posición aproximada (leaderboard_global).
//   · Su mejor acierto de la semana.
//   · Próximos partidos por jugar.
//
//  Devuelve { ok:true, sent:n }. Maneja errores y CORS.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Constantes de configuración ──────────────────────────────
const DAYS_WINDOW = 7;                       // ventana del resumen (días)
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const UPCOMING_LIMIT = 5;                     // próximos partidos a listar
const EMAIL_FROM = "FIFA Calendario 2026 <quiniela@rubiksoft.dev>";
const EMAIL_SUBJECT = "Tu resumen semanal · FIFA Calendario 2026";

// CORS: permite invocación desde cualquier origen (la auth real es x-cron-secret).
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Respuesta JSON con CORS unificada.
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Escapa texto para HTML (anti-inyección en el cuerpo del correo).
function esc(s: unknown): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Nombre legible de un partido usando nombres en español o placeholders.
function matchLabel(
  m: Record<string, any>,
  teamMap: Map<string, { name_es: string; flag: string | null }>,
): string {
  const home = m.home_team
    ? `${teamMap.get(m.home_team)?.flag ?? ""} ${teamMap.get(m.home_team)?.name_es ?? m.home_team}`
    : (m.home_placeholder ?? "Por definir");
  const away = m.away_team
    ? `${teamMap.get(m.away_team)?.flag ?? ""} ${teamMap.get(m.away_team)?.name_es ?? m.away_team}`
    : (m.away_placeholder ?? "Por definir");
  return `${home.trim()} vs ${away.trim()}`;
}

// Formatea una fecha ISO a texto corto en español (zona Ciudad de México).
function fmtDate(iso: string | null): string {
  if (!iso) return "Por confirmar";
  try {
    return new Intl.DateTimeFormat("es-MX", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Mexico_City",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// Construye el HTML del correo para un usuario concreto.
function buildEmailHtml(args: {
  name: string;
  weekPts: number;
  totalPts: number;
  rank: number | null;
  totalPlayers: number;
  best: { label: string; pts: number } | null;
  upcoming: string[];
  siteUrl: string;
}): string {
  const { name, weekPts, totalPts, rank, totalPlayers, best, upcoming, siteUrl } = args;

  const rankLine = rank
    ? `Posición <strong>#${rank}</strong> de ${totalPlayers} participantes`
    : "Aún sin posición en la tabla global";

  const bestLine = best
    ? `<li><strong>${esc(best.label)}</strong> — ${best.pts} pts 🎯</li>`
    : `<li>Esta semana no sumaste aciertos. ¡La próxima es tuya! 💪</li>`;

  const upcomingItems = upcoming.length
    ? upcoming.map((u) => `<li>${esc(u)}</li>`).join("")
    : `<li>No hay partidos próximos por pronosticar.</li>`;

  return `<!doctype html>
<html lang="es">
<body style="margin:0;background:#0b1020;font-family:Arial,Helvetica,sans-serif;color:#e8ecf5;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <h1 style="font-size:22px;margin:0 0 4px;">⚽ Tu resumen semanal</h1>
    <p style="color:#9aa6c0;margin:0 0 20px;">Hola, ${esc(name)} 👋</p>

    <div style="background:#141b32;border-radius:12px;padding:18px;margin-bottom:16px;">
      <p style="margin:0;font-size:15px;color:#9aa6c0;">Puntos esta semana</p>
      <p style="margin:4px 0 0;font-size:34px;font-weight:bold;color:#4ade80;">+${weekPts} pts</p>
    </div>

    <div style="background:#141b32;border-radius:12px;padding:18px;margin-bottom:16px;">
      <p style="margin:0;font-size:15px;color:#9aa6c0;">Total acumulado</p>
      <p style="margin:4px 0 8px;font-size:24px;font-weight:bold;">${totalPts} pts</p>
      <p style="margin:0;color:#c7d0e6;">${rankLine}</p>
    </div>

    <div style="background:#141b32;border-radius:12px;padding:18px;margin-bottom:16px;">
      <p style="margin:0 0 8px;font-size:15px;color:#9aa6c0;">Tu mejor acierto de la semana</p>
      <ul style="margin:0;padding-left:18px;color:#c7d0e6;">${bestLine}</ul>
    </div>

    <div style="background:#141b32;border-radius:12px;padding:18px;margin-bottom:20px;">
      <p style="margin:0 0 8px;font-size:15px;color:#9aa6c0;">Próximos partidos por jugar</p>
      <ul style="margin:0;padding-left:18px;color:#c7d0e6;">${upcomingItems}</ul>
    </div>

    <a href="${esc(siteUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold;">Ir a mi quiniela →</a>

    <p style="margin:28px 0 0;font-size:12px;color:#6b7693;border-top:1px solid #232c47;padding-top:14px;">
      Hecho con 💛 por <strong>RubikSoft</strong> · FIFA Calendario 2026
    </p>
  </div>
</body>
</html>`;
}

// Envía un correo vía la API de Resend. Devuelve true si fue aceptado.
async function sendEmail(
  apiKey: string,
  to: string,
  html: string,
): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to,
      subject: EMAIL_SUBJECT,
      html,
    }),
  });
  if (!res.ok) {
    // Registra solo el status (sin volcar la respuesta del proveedor).
    console.error(`Resend ${res.status} para ${to}`);
    return false;
  }
  return true;
}

// ── Handler principal ────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  // Preflight CORS.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    // 1) Autenticación por secreto compartido del cron.
    const cronSecret = Deno.env.get("CRON_SECRET");
    if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
      return json({ ok: false, error: "No autorizado" }, 401);
    }

    // 2) Validar variables de entorno requeridas (fail-fast).
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const siteUrl = Deno.env.get("SITE_URL") ?? supabaseUrl ?? "";
    if (!supabaseUrl || !serviceKey || !resendKey) {
      return json({ ok: false, error: "Configuración incompleta del servidor" }, 500);
    }

    // 3) Cliente service-role (omite RLS para leer todos los usuarios).
    const db = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const now = Date.now();
    const sinceIso = new Date(now - DAYS_WINDOW * MS_PER_DAY).toISOString();
    const nowIso = new Date(now).toISOString();

    // 4) Mapa de equipos (id → nombre_es + bandera) para etiquetar partidos.
    const { data: teams, error: teamsErr } = await db
      .from("teams")
      .select("id, name_es, flag");
    if (teamsErr) throw teamsErr;
    const teamMap = new Map(
      (teams ?? []).map((t) => [t.id, { name_es: t.name_es, flag: t.flag }]),
    );

    // 5) Tabla global completa para calcular posición aproximada y total.
    const { data: leaderboard, error: lbErr } = await db
      .from("leaderboard_global")
      .select("user_id, total_pts")
      .order("total_pts", { ascending: false });
    if (lbErr) throw lbErr;
    const totalPlayers = leaderboard?.length ?? 0;
    const rankByUser = new Map<string, number>();
    const totalByUser = new Map<string, number>();
    (leaderboard ?? []).forEach((row, i) => {
      rankByUser.set(row.user_id, i + 1);
      totalByUser.set(row.user_id, row.total_pts ?? 0);
    });

    // 6) Próximos partidos por jugar (compartidos por todos los usuarios).
    const { data: upcomingMatches, error: upErr } = await db
      .from("matches")
      .select("id, home_team, away_team, home_placeholder, away_placeholder, kickoff, status")
      .gt("kickoff", nowIso)
      .neq("status", "finished")
      .order("kickoff", { ascending: true })
      .limit(UPCOMING_LIMIT);
    if (upErr) throw upErr;
    const upcomingLines = (upcomingMatches ?? []).map(
      (m) => `${matchLabel(m, teamMap)} — ${fmtDate(m.kickoff)}`,
    );

    // 7) Usuarios con email (destinatarios potenciales).
    const { data: profiles, error: profErr } = await db
      .from("profiles")
      .select("id, display_name, email")
      .not("email", "is", null);
    if (profErr) throw profErr;

    // 8) Picks puntuados en la ventana de 7 días (para puntos semanales y mejor acierto).
    //    Solo cuentan picks con points no nulos y actualizados en la ventana.
    const { data: weekPicks, error: pickErr } = await db
      .from("picks")
      .select("user_id, match_id, points")
      .gte("updated_at", sinceIso)
      .not("points", "is", null);
    if (pickErr) throw pickErr;

    // Agrupar picks de la semana por usuario.
    const weekByUser = new Map<
      string,
      { sum: number; best: { matchId: number; pts: number } | null }
    >();
    for (const p of weekPicks ?? []) {
      const cur = weekByUser.get(p.user_id) ?? { sum: 0, best: null };
      const pts = p.points ?? 0;
      cur.sum += pts;
      if (!cur.best || pts > cur.best.pts) {
        cur.best = { matchId: p.match_id, pts };
      }
      weekByUser.set(p.user_id, cur);
    }

    // 9) Resolver etiquetas de los partidos del "mejor acierto" en una sola consulta.
    const bestMatchIds = [...weekByUser.values()]
      .map((v) => v.best?.matchId)
      .filter((id): id is number => typeof id === "number");
    const matchLabelById = new Map<number, string>();
    if (bestMatchIds.length) {
      const { data: bestMatches, error: bmErr } = await db
        .from("matches")
        .select("id, home_team, away_team, home_placeholder, away_placeholder")
        .in("id", [...new Set(bestMatchIds)]);
      if (bmErr) throw bmErr;
      for (const m of bestMatches ?? []) {
        matchLabelById.set(m.id, matchLabel(m, teamMap));
      }
    }

    // 10) Enviar un correo por usuario con email. Tolerante a fallos individuales.
    let sent = 0;
    for (const prof of profiles ?? []) {
      const email = (prof.email ?? "").trim();
      if (!email) continue;

      const week = weekByUser.get(prof.id);
      const weekPts = week?.sum ?? 0;
      const totalPts = totalByUser.get(prof.id) ?? 0;
      const rank = rankByUser.get(prof.id) ?? null;
      const best =
        week?.best && week.best.pts > 0
          ? {
              label: matchLabelById.get(week.best.matchId) ?? "Partido",
              pts: week.best.pts,
            }
          : null;

      const html = buildEmailHtml({
        name: prof.display_name ?? "participante",
        weekPts,
        totalPts,
        rank,
        totalPlayers,
        best,
        upcoming: upcomingLines,
        siteUrl,
      });

      try {
        if (await sendEmail(resendKey, email, html)) sent++;
      } catch (err) {
        // Un fallo de red por usuario no debe tumbar el lote completo.
        console.error(`Error enviando a ${email}:`, err);
      }
    }

    return json({ ok: true, sent });
  } catch (err) {
    console.error("weekly-digest falló:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: msg }, 500);
  }
});
