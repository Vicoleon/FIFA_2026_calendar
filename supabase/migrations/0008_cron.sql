-- ============================================================
--  Quiniela 2026 · 0008 · programación de tareas (pg_cron)  [PLANTILLA]
--  ⚠️  NO se aplica automáticamente: requiere que ya estén
--      desplegadas las Edge Functions y configurado CRON_SECRET.
--
--  Cómo usar (una sola vez, en el SQL Editor de Supabase):
--   1) Despliega las funciones: daily-reminder, weekly-digest, auto-pick, send-email.
--   2) Define los secretos de las funciones (Dashboard → Edge Functions → Secrets):
--        RESEND_API_KEY = re_xxx           (tu API key de Resend)
--        CRON_SECRET     = <cadena-larga>  (inventa una; debe coincidir abajo)
--        SITE_URL        = https://tu-sitio  (URL pública del front)
--   3) Sustituye <CRON_SECRET> abajo por el MISMO valor y ejecuta este archivo.
-- ============================================================

create extension if not exists pg_cron;
-- pg_net ya viene instalado en Supabase (esquema public/extensions).

-- Recordatorio diario (14:00 UTC ≈ mañana en México)
select cron.schedule(
  'quiniela-daily-reminder', '0 14 * * *', $cron$
    select net.http_post(
      url     := 'https://ozdjeotbfxnbisyedioq.functions.supabase.co/daily-reminder',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
      body    := '{}'::jsonb
    );
  $cron$
);

-- Resumen semanal (lunes 14:00 UTC)
select cron.schedule(
  'quiniela-weekly-digest', '0 14 * * 1', $cron$
    select net.http_post(
      url     := 'https://ozdjeotbfxnbisyedioq.functions.supabase.co/weekly-digest',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
      body    := '{}'::jsonb
    );
  $cron$
);

-- Red de seguridad Auto-pick (cada 15 min)
select cron.schedule(
  'quiniela-auto-pick', '*/15 * * * *', $cron$
    select net.http_post(
      url     := 'https://ozdjeotbfxnbisyedioq.functions.supabase.co/auto-pick',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
      body    := '{}'::jsonb
    );
  $cron$
);

-- Para ver / borrar tareas:
--   select * from cron.job;
--   select cron.unschedule('quiniela-daily-reminder');
