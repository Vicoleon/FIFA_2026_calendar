-- ============================================================
--  Quiniela 2026 · 0012 · Realtime para marcadores EN VIVO
--  El frontend se suscribe a postgres_changes de `matches` y
--  `match_stats` (assets/js/app.js) y depende de Realtime para
--  refrescar la UI en todos los dispositivos. El cron
--  `sync-espn?mode=scores` (cada minuto) escribe marcador/minuto
--  en `matches`, pero si las tablas NO están en la publicación
--  `supabase_realtime` no se emite ningún evento y los marcadores
--  "en vivo" nunca llegan a los clientes (había que recargar).
--
--  Esto agrega las tablas a la publicación (equivale a activar
--  "Realtime" en el panel) y deja REPLICA IDENTITY FULL para que
--  los eventos UPDATE/DELETE lleven la fila completa.
--  Idempotente: seguro de re-ejecutar.
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matches'
  ) then
    alter publication supabase_realtime add table public.matches;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_stats'
  ) then
    alter publication supabase_realtime add table public.match_stats;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'goals'
  ) then
    alter publication supabase_realtime add table public.goals;
  end if;
end $$;

alter table public.matches     replica identity full;
alter table public.match_stats replica identity full;
alter table public.goals       replica identity full;
