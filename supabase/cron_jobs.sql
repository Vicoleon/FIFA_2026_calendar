-- ============================================================
--  pg_cron jobs activos en el proyecto ozdjeotbfxnbisyedioq
--  Snapshot: 2026-07-20 (justo antes de dar de baja el proyecto).
--
--  Los secretos reales están REDACTADOS: sustituye <CRON_SECRET>
--  por el valor correspondiente si algún día se restaura el proyecto.
-- ============================================================

-- cada hora: ESPN modo completo (stats + goleadores)
select cron.schedule('sync-espn-hourly', '0 * * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-espn',
    headers := jsonb_build_object('Content-Type','application/json')
  );
$$);

-- cada minuto: ESPN modo rápido (marcador/minuto/estado en vivo).
-- Barato porque la función tiene guard de ventana en vivo.
select cron.schedule('sync-espn-scores', '* * * * *', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-espn?mode=scores',
    headers := jsonb_build_object('Content-Type','application/json')
  );
$$);

-- recordatorio diario 14:00 UTC
select cron.schedule('quiniela-daily-reminder', '0 14 * * *', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.functions.supabase.co/daily-reminder',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
    body    := '{}'::jsonb
  );
$$);

-- resumen semanal, lunes 14:00 UTC
select cron.schedule('quiniela-weekly-digest', '0 14 * * 1', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.functions.supabase.co/weekly-digest',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
    body    := '{}'::jsonb
  );
$$);

-- auto-pick cada 15 min para quienes activaron `profiles.autopick`
select cron.schedule('quiniela-auto-pick', '*/15 * * * *', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.functions.supabase.co/auto-pick',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
    body    := '{}'::jsonb
  );
$$);
