-- ============================================================
--  Quiniela 2026 · 0011 · tema visual por usuario
--  Guarda el tema elegido (neon/fiesta/editorial) en el perfil
--  para recordarlo en cualquier dispositivo.
-- ============================================================
alter table public.profiles
  add column if not exists theme text not null default 'neon'
  check (theme in ('neon','fiesta','editorial'));

-- El cliente ya puede actualizar columnas del propio perfil; añadimos 'theme'.
grant update (theme) on public.profiles to authenticated;
