// ============================================================
//  Edge Function: auto-pick  (red de seguridad)
//  --------------------------------------------------------
//  La invoca pg_cron cada ~15 min (ver supabase/migrations/0008_cron.sql).
//  Su trabajo: rellenar pronósticos faltantes JUSTO antes del kickoff
//  para los usuarios que activaron "autopick" en su perfil, usando la
//  predicción del modelo (tabla predictions). Es una RED DE SEGURIDAD:
//  evita que alguien se quede sin pick si olvidó pronosticar.
//
//  Seguridad:
//    - verify_jwt = false (no hay sesión de usuario; la llama el cron).
//    - Se exige la cabecera 'x-cron-secret' === CRON_SECRET. Sin ella, 401.
//    - Usa la SERVICE_ROLE key -> salta RLS para insertar picks de terceros.
//
//  Variables de entorno requeridas (secretos de la función):
//    - SUPABASE_URL                (lo inyecta Supabase automáticamente)
//    - SUPABASE_SERVICE_ROLE_KEY   (lo inyecta Supabase automáticamente)
//    - CRON_SECRET                 (cadena larga compartida con el cron)
//
//  Lógica:
//    1. Busca partidos que arrancan dentro de los próximos ~20 min
//       (now < kickoff <= now+20min), status='scheduled', con AMBOS
//       equipos definidos y con fila en predictions.
//    2. Para cada usuario con profiles.autopick = true que NO tenga
//       pick en ese partido, inserta un pick source='auto' con el
//       marcador redondeado del modelo.
//
//  NO envía correo. Devuelve { ok:true, inserted:n }.
// ============================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// --- Constantes de configuración ---------------------------------
// Ventana de anticipación: solo automatizamos partidos a punto de empezar.
const LOOKAHEAD_MINUTES = 20;
const MIN_GOALS = 0; // límites de cordura para el marcador insertado
const MAX_GOALS = 30; // (coincide con el check de la tabla picks)

// --- CORS: cabeceras compartidas para todas las respuestas ------
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

/** Construye una respuesta JSON con CORS y status indicado. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Redondea y acota un marcador del modelo al rango válido [0, 30]. */
function clampScore(value: number | null | undefined): number {
  const n = Math.round(Number(value ?? 0));
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_GOALS, Math.max(MIN_GOALS, n));
}

// --- Tipos auxiliares (forma de las filas que leemos) ------------
interface MatchRow {
  id: number;
  pred_home_score: number | null;
  pred_away_score: number | null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Preflight CORS.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // Solo aceptamos POST (el cron usa net.http_post).
  if (req.method !== "POST") {
    return json({ error: "Método no permitido. Usa POST." }, 405);
  }

  // --- Autorización por secreto compartido del cron --------------
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret) {
    return json(
      { error: "Falta CRON_SECRET en el entorno de la función." },
      500,
    );
  }
  if (req.headers.get("x-cron-secret") !== cronSecret) {
    // No revelamos detalles: simplemente no autorizado.
    return json({ error: "No autorizado." }, 401);
  }

  // --- Cliente service-role (salta RLS) --------------------------
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json(
      { error: "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY." },
      500,
    );
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // Ventana temporal: now < kickoff <= now + LOOKAHEAD_MINUTES.
    const now = new Date();
    const until = new Date(now.getTime() + LOOKAHEAD_MINUTES * 60_000);

    // 1) Partidos próximos, programados, con ambos equipos y con predicción.
    //    Hacemos inner join con predictions y exigimos marcador predicho.
    const { data: matches, error: matchErr } = await admin
      .from("matches")
      .select(
        "id, predictions!inner(pred_home_score, pred_away_score)",
      )
      .eq("status", "scheduled")
      .not("home_team", "is", null)
      .not("away_team", "is", null)
      .gt("kickoff", now.toISOString())
      .lte("kickoff", until.toISOString());

    if (matchErr) {
      return json(
        { error: `No se pudieron leer partidos: ${matchErr.message}` },
        502,
      );
    }

    // Normalizamos la forma anidada de la predicción a una fila plana.
    const candidates: MatchRow[] = (matches ?? [])
      .map((m: Record<string, unknown>) => {
        const pred = Array.isArray(m.predictions)
          ? (m.predictions[0] as Record<string, unknown> | undefined)
          : (m.predictions as Record<string, unknown> | undefined);
        return {
          id: Number(m.id),
          pred_home_score:
            pred?.pred_home_score == null ? null : Number(pred.pred_home_score),
          pred_away_score:
            pred?.pred_away_score == null ? null : Number(pred.pred_away_score),
        };
      })
      // Solo partidos con predicción de marcador completa.
      .filter((m) => m.pred_home_score != null && m.pred_away_score != null);

    if (candidates.length === 0) {
      return json({ ok: true, inserted: 0 });
    }

    // 2) Usuarios con autopick activo.
    const { data: autoUsers, error: usersErr } = await admin
      .from("profiles")
      .select("id")
      .eq("autopick", true);

    if (usersErr) {
      return json(
        { error: `No se pudieron leer perfiles: ${usersErr.message}` },
        502,
      );
    }
    const userIds: string[] = (autoUsers ?? []).map((u) => String(u.id));
    if (userIds.length === 0) {
      return json({ ok: true, inserted: 0 });
    }

    // 3) Construimos las filas a insertar (una por usuario × partido).
    //    El upsert con ignoreDuplicates respeta los picks manuales ya
    //    existentes (PK user_id,match_id), por lo que NO sobrescribe nada.
    const rows = candidates.flatMap((m) => {
      const home = clampScore(m.pred_home_score);
      const away = clampScore(m.pred_away_score);
      return userIds.map((uid) => ({
        user_id: uid,
        match_id: m.id,
        home_score: home,
        away_score: away,
        is_joker: false,
        source: "auto",
      }));
    });

    // 4) Upsert idempotente: inserta solo lo que falta.
    const { data: inserted, error: upsertErr } = await admin
      .from("picks")
      .upsert(rows, {
        onConflict: "user_id,match_id",
        ignoreDuplicates: true,
      })
      .select("user_id");

    if (upsertErr) {
      return json(
        { error: `No se pudieron insertar picks: ${upsertErr.message}` },
        502,
      );
    }

    return json({ ok: true, inserted: inserted?.length ?? 0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return json({ error: `Fallo interno en auto-pick: ${msg}` }, 500);
  }
});
