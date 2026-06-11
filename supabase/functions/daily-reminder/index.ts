// ============================================================
//  Edge Function (Deno) · daily-reminder
//  Recordatorio diario por correo: avisa a cada usuario cuántos
//  partidos próximos (próximas 36 h) aún no ha pronosticado.
//
//  Pensada para ejecutarse con pg_cron (ver SQL al pie de este archivo).
//  Seguridad: NO usa JWT (verify_jwt = false). Se protege exigiendo el
//  header 'x-cron-secret' === CRON_SECRET; si no coincide responde 401.
//
//  Variables de entorno requeridas (Deno.env):
//    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  -> cliente admin (service role)
//    CRON_SECRET                              -> secreto compartido con el cron
//    RESEND_API_KEY                           -> envío de correos (Resend)
//  Opcionales:
//    SITE_URL        -> enlace al sitio (default abajo)
//    RESEND_FROM     -> remitente verificado (default abajo)
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---- Constantes de negocio ---------------------------------
const HORIZON_HOURS = 36; // ventana de partidos próximos a recordar
const HOURS_TO_MS = 60 * 60 * 1000;
const DEFAULT_SITE_URL = "https://quiniela-mundial-2026.app";
const DEFAULT_FROM = "Quiniela Mundial 2026 <no-reply@rubiksoft.dev>";

// ---- CORS (por si se invoca manualmente desde un navegador) -
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Respuesta JSON con CORS aplicado. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Escapa texto para insertarlo de forma segura en el HTML del correo. */
function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

// ---- Tipos auxiliares (forma mínima de los datos que usamos) -
interface TeamRef {
  name_es: string | null;
  flag: string | null;
}
interface MatchRow {
  id: number;
  kickoff: string | null;
  home: TeamRef | TeamRef[] | null;
  away: TeamRef | TeamRef[] | null;
}
interface ProfileRow {
  id: string;
  display_name: string | null;
  email: string | null;
}

/** Normaliza la relación embebida de Supabase (objeto o array) a uno solo. */
function one<T>(rel: T | T[] | null): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

/** Construye el HTML del correo recordatorio (en español). */
function buildEmailHtml(
  name: string,
  pending: number,
  matches: MatchRow[],
  siteUrl: string,
): string {
  const saludo = name ? `Hola, ${esc(name)}` : "Hola";
  const plural = pending === 1 ? "partido" : "partidos";

  // Lista (máx 8) de los partidos próximos para dar contexto.
  const items = matches
    .slice(0, 8)
    .map((m) => {
      const h = one(m.home);
      const a = one(m.away);
      const hn = `${h?.flag ? h.flag + " " : ""}${esc(h?.name_es ?? "Por definir")}`;
      const an = `${a?.flag ? a.flag + " " : ""}${esc(a?.name_es ?? "Por definir")}`;
      return `<li style="margin:4px 0;">${hn} <span style="color:#888;">vs</span> ${an}</li>`;
    })
    .join("");

  return `<!doctype html>
<html lang="es"><body style="margin:0;background:#0b1020;font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;color:#e8ecf4;">
  <div style="max-width:520px;margin:0 auto;padding:28px 22px;">
    <h1 style="font-size:20px;margin:0 0 6px;">⚽ ${saludo}</h1>
    <p style="font-size:15px;line-height:1.5;color:#c4ccdb;margin:0 0 14px;">
      Tienes <strong>${pending} ${plural}</strong> sin pronosticar que se juegan en las próximas ${HORIZON_HOURS} horas.
      ¡No te quedes sin tus puntos!
    </p>
    <ul style="font-size:14px;line-height:1.5;color:#dfe5f0;padding-left:18px;margin:0 0 18px;">${items}</ul>
    <a href="${esc(siteUrl)}"
       style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;
              padding:11px 20px;border-radius:10px;font-weight:600;font-size:15px;">
      Hacer mis pronósticos
    </a>
    <hr style="border:none;border-top:1px solid #1e2740;margin:24px 0 12px;">
    <p style="font-size:12px;color:#7e8aa3;margin:0;">
      Hecho con cariño por <strong>RubikSoft</strong> · Quiniela Mundial 2026.
    </p>
  </div>
</body></html>`;
}

/** Envía un correo vía Resend. Devuelve true si la API respondió OK. */
async function sendEmail(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      // No filtramos el cuerpo completo; solo el estado para depurar.
      console.error(`Resend respondió ${res.status} para ${to}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Error enviando correo a ${to}:`, err);
    return false;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Preflight CORS.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    // --- 1) Autorización por secreto compartido (no JWT) ---
    const cronSecret = Deno.env.get("CRON_SECRET");
    const provided = req.headers.get("x-cron-secret");
    if (!cronSecret || provided !== cronSecret) {
      return json({ ok: false, error: "No autorizado" }, 401);
    }

    // --- 2) Cliente admin (service role) ---
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return json({ ok: false, error: "Faltan credenciales de Supabase" }, 500);
    }
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return json({ ok: false, error: "Falta RESEND_API_KEY" }, 500);
    }
    const siteUrl = Deno.env.get("SITE_URL") || DEFAULT_SITE_URL;
    const fromAddr = Deno.env.get("RESEND_FROM") || DEFAULT_FROM;

    // --- 3) Partidos próximos: kickoff en [now, now+36h], no finalizados,
    //        con AMBOS equipos definidos ---
    const now = new Date();
    const horizon = new Date(now.getTime() + HORIZON_HOURS * HOURS_TO_MS);

    const { data: matchesRaw, error: matchErr } = await admin
      .from("matches")
      .select(
        "id, kickoff, home:home_team(name_es, flag), away:away_team(name_es, flag)",
      )
      .neq("status", "finished")
      .not("home_team", "is", null)
      .not("away_team", "is", null)
      .gte("kickoff", now.toISOString())
      .lte("kickoff", horizon.toISOString())
      .order("kickoff", { ascending: true });

    if (matchErr) {
      console.error("Error consultando partidos:", matchErr);
      return json({ ok: false, error: "No se pudieron leer los partidos" }, 500);
    }

    const matches = (matchesRaw ?? []) as MatchRow[];
    // Si no hay partidos próximos, no hay nada que recordar.
    if (matches.length === 0) {
      return json({ ok: true, sent: 0 });
    }
    const matchIds = matches.map((m) => m.id);

    // --- 4) Usuarios con correo ---
    const { data: profilesRaw, error: profErr } = await admin
      .from("profiles")
      .select("id, display_name, email")
      .not("email", "is", null);

    if (profErr) {
      console.error("Error consultando perfiles:", profErr);
      return json({ ok: false, error: "No se pudieron leer los perfiles" }, 500);
    }
    const profiles = (profilesRaw ?? []) as ProfileRow[];

    // --- 5) Por cada usuario, contar partidos próximos SIN pick y avisar ---
    let sent = 0;
    for (const p of profiles) {
      if (!p.email) continue;

      // Picks del usuario sobre los partidos próximos.
      const { data: picksRaw, error: pickErr } = await admin
        .from("picks")
        .select("match_id")
        .eq("user_id", p.id)
        .in("match_id", matchIds);

      if (pickErr) {
        console.error(`Error leyendo picks de ${p.id}:`, pickErr);
        continue; // no bloqueamos al resto de usuarios
      }

      const picked = new Set((picksRaw ?? []).map((r) => r.match_id as number));
      const pending = matchIds.filter((id) => !picked.has(id)).length;
      if (pending <= 0) continue;

      const name = p.display_name?.trim() || "";
      const subject =
        pending === 1
          ? "⚽ Te falta 1 pronóstico para el Mundial 2026"
          : `⚽ Te faltan ${pending} pronósticos para el Mundial 2026`;
      const html = buildEmailHtml(name, pending, matches, siteUrl);

      const ok = await sendEmail(resendKey, fromAddr, p.email, subject, html);
      if (ok) sent++;
    }

    return json({ ok: true, sent });
  } catch (err) {
    console.error("daily-reminder falló:", err);
    return json({ ok: false, error: "Error interno" }, 500);
  }
});

// ============================================================
//  Configuración del cron (se aplica APARTE, en el SQL Editor de
//  Supabase). Requiere las extensiones pg_cron y pg_net habilitadas.
//  Ajusta la URL del proyecto y guarda el secreto/anon en Vault.
//
//  -- 1) Habilitar extensiones (una sola vez):
//  --    create extension if not exists pg_cron;
//  --    create extension if not exists pg_net;
//
//  -- 2) Programar el recordatorio diario (09:00 UTC todos los días):
//  --    select cron.schedule(
//  --      'daily-reminder',
//  --      '0 9 * * *',
//  --      $$
//  --        select net.http_post(
//  --          url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/daily-reminder',
//  --          headers := jsonb_build_object(
//  --                       'Content-Type',  'application/json',
//  --                       'x-cron-secret', '<CRON_SECRET>'
//  --                     ),
//  --          body    := '{}'::jsonb
//  --        );
//  --      $$
//  --    );
//
//  -- Para desprogramar:  select cron.unschedule('daily-reminder');
// ============================================================
