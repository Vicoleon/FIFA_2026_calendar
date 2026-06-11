-- ============================================================
--  Quiniela 2026 · 0004 · logros (achievements / badges)
--  Evaluados por funciones security-definer desde el motor de puntaje.
-- ============================================================

create table if not exists public.achievements (
  code        text primary key,
  name        text not null,
  description text not null,
  emoji       text
);

insert into public.achievements(code, name, description, emoji) values
  ('jornada_perfecta','Jornada Perfecta','Acertaste el marcador exacto de TODOS los partidos de una jornada','🎯'),
  ('racha',           'En Racha',        '3 marcadores exactos consecutivos','🔥'),
  ('mataguigantes',   'Mataguigantes',   'Acertaste un resultado que el modelo daba con menos de 25% de probabilidad','🐲'),
  ('el_profeta',      'El Profeta',      'Fuiste quien más puntos hizo en una jornada dentro de un grupo','🔮'),
  ('pleno',           'Pleno',           'Llenaste tu quiniela completa de una jornada','✅')
on conflict (code) do nothing;

create table if not exists public.user_achievements (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  code      text not null references public.achievements(code),
  match_id  int,
  matchday  smallint,
  group_id  uuid,
  earned_at timestamptz not null default now()
);

create unique index if not exists ua_unique on public.user_achievements
  (user_id, code, coalesce(match_id, -1), coalesce(matchday, -1::smallint),
   coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.achievements      enable row level security;
alter table public.user_achievements enable row level security;

drop policy if exists ach_select on public.achievements;
create policy ach_select on public.achievements for select using (true);
drop policy if exists ua_select on public.user_achievements;
create policy ua_select on public.user_achievements for select using (true);

revoke all on public.achievements      from anon, authenticated;
revoke all on public.user_achievements from anon, authenticated;
grant select on public.achievements      to anon, authenticated;
grant select on public.user_achievements to anon, authenticated;

-- Otorgar (idempotente).
create or replace function public._award(p_user uuid, p_code text, p_match int, p_md smallint, p_group uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_achievements(user_id, code, match_id, matchday, group_id)
  values (p_user, p_code, p_match, p_md, p_group)
  on conflict do nothing;
end; $$;

-- Logros de jornada completa (solo fase de grupos).
create or replace function public._evaluate_matchday(p_md smallint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_n int; r record; g record;
begin
  select count(*) into v_n from public.matches where stage='group' and matchday=p_md;
  if v_n = 0 then return; end if;

  -- Pleno (llenó toda la jornada) y Jornada Perfecta (todos exactos).
  for r in
    select p.user_id,
           count(*) as c,
           count(*) filter (where p.exact) as e
    from public.picks p
    join public.matches m on m.id = p.match_id
    where m.stage='group' and m.matchday=p_md
    group by p.user_id
  loop
    if r.c = v_n then
      perform public._award(r.user_id, 'pleno', null, p_md, null);
      if r.e = v_n then
        perform public._award(r.user_id, 'jornada_perfecta', null, p_md, null);
      end if;
    end if;
  end loop;

  -- El Profeta: máximo de puntos de la jornada por grupo.
  for g in select id from public.groups loop
    for r in
      with pts as (
        select gm.user_id,
               coalesce(sum(p.points) filter (where m.stage='group' and m.matchday=p_md), 0) as s
        from public.group_members gm
        left join public.picks p on p.user_id = gm.user_id
        left join public.matches m on m.id = p.match_id
        where gm.group_id = g.id
        group by gm.user_id
      )
      select user_id from pts where s > 0 and s = (select max(s) from pts)
    loop
      perform public._award(r.user_id, 'el_profeta', null, p_md, g.id);
    end loop;
  end loop;
end; $$;

-- Evaluación por partido (Racha + Mataguigantes; dispara jornada si se completa).
create or replace function public.evaluate_achievements_for_match(p_match_id int)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m record; v_out int; v_phw numeric; v_pd numeric; v_paw numeric; v_prob numeric; r record;
begin
  select * into m from public.matches where id = p_match_id;
  if m is null or m.status <> 'finished' or m.home_score is null or m.away_score is null then
    return;
  end if;
  v_out := sign(m.home_score - m.away_score);

  -- Mataguigantes
  select p_home_win, p_draw, p_away_win into v_phw, v_pd, v_paw
  from public.predictions where match_id = p_match_id;
  if v_phw is not null then
    v_prob := case when v_out > 0 then v_phw when v_out = 0 then v_pd else v_paw end;
    if v_prob is not null and v_prob < 0.25 then
      for r in select user_id from public.picks where match_id = p_match_id and coalesce(outcome_pts,0) > 0 loop
        perform public._award(r.user_id, 'mataguigantes', p_match_id, null, null);
      end loop;
    end if;
  end if;

  -- Racha: 3 exactos consecutivos por kickoff terminando en este partido.
  for r in select user_id from public.picks where match_id = p_match_id and exact is true loop
    if (
      select count(*) = 3 and bool_and(t.exact)
      from (
        select p.exact
        from public.picks p
        join public.matches mm on mm.id = p.match_id
        where p.user_id = r.user_id and mm.status='finished' and mm.kickoff is not null
        order by mm.kickoff desc
        limit 3
      ) t
    ) then
      perform public._award(r.user_id, 'racha', p_match_id, null, null);
    end if;
  end loop;

  -- ¿Se completó la jornada de grupos? Entonces evalúa logros de jornada.
  if m.stage = 'group' and m.matchday is not null then
    if not exists (
      select 1 from public.matches mm
      where mm.stage='group' and mm.matchday=m.matchday and mm.status <> 'finished'
    ) then
      perform public._evaluate_matchday(m.matchday);
    end if;
  end if;
end; $$;
