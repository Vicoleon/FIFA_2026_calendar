-- ============================================================
--  Quiniela 2026 · 0013 · tanda de penales (eliminatorias)
--  Marcador de penales para partidos de eliminación definidos
--  tras empate en tiempo reglamentario/prórroga.
--
--  La quiniela NO cambia: se sigue puntuando el marcador
--  reglamentario (home_score/away_score, un empate). Estas
--  columnas solo sirven para MOSTRAR la tanda y AVANZAR el
--  cuadro (gana quien tiene más penales). sync-espn las llena
--  desde el `shootoutScore` de ESPN; standings.js resuelve
--  W##/L## por penales cuando el marcador quedó empatado.
-- ============================================================
alter table public.matches
  add column if not exists home_pens smallint,
  add column if not exists away_pens smallint;
