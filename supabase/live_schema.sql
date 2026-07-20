-- Snapshot of the LIVE public schema of Supabase project ozdjeotbfxnbisyedioq
-- Taken 2026-07-20, immediately before decommissioning the project.
-- Reconstructed from catalog introspection (not pg_dump): tables, constraints,
-- indexes, RLS, policies, views, triggers and functions.

-- ===== TABLES =====

create table public.achievements (
  code text not null,
  name text not null,
  description text not null,
  emoji text
);

create table public.goals (
  id bigint not null,
  match_id integer,
  team_id text,
  player text,
  minute smallint,
  own_goal boolean not null default false,
  penalty boolean not null default false
);

create table public.group_members (
  group_id uuid not null,
  user_id uuid not null,
  paid boolean not null default false,
  role text not null default 'member'::text,
  joined_at timestamp with time zone not null default now()
);

create table public.groups (
  id uuid not null default gen_random_uuid(),
  name text not null,
  owner_id uuid not null,
  join_code text not null,
  buy_in numeric not null default 0,
  currency text not null default 'MXN'::text,
  created_at timestamp with time zone not null default now()
);

create table public.invites (
  id uuid not null default gen_random_uuid(),
  group_id uuid not null,
  token text not null,
  email text,
  invited_by uuid,
  accepted_by uuid,
  created_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null default (now() + '30 days'::interval)
);

create table public.match_stats (
  match_id integer not null,
  team_id text not null,
  possession smallint,
  shots smallint,
  shots_on_target smallint,
  corners smallint,
  fouls smallint,
  offsides smallint,
  yellow_cards smallint,
  red_cards smallint
);

create table public.matches (
  id integer not null,
  stage text not null,
  group_code text,
  matchday smallint,
  home_team text,
  away_team text,
  home_placeholder text,
  away_placeholder text,
  venue text,
  venue_code text,
  kickoff timestamp with time zone,
  home_score smallint,
  away_score smallint,
  status text not null default 'scheduled'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  minute smallint,
  home_pens smallint,
  away_pens smallint
);

create table public.picks (
  user_id uuid not null,
  match_id integer not null,
  home_score smallint not null,
  away_score smallint not null,
  is_joker boolean not null default false,
  source text not null default 'manual'::text,
  points smallint,
  outcome_pts smallint,
  exact boolean,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.predictions (
  match_id integer not null,
  p_home_win numeric,
  p_draw numeric,
  p_away_win numeric,
  pred_home_score numeric,
  pred_away_score numeric,
  model text default 'elo-poisson-v1'::text,
  updated_at timestamp with time zone not null default now()
);

create table public.profiles (
  id uuid not null,
  display_name text,
  avatar_url text,
  country text,
  email text,
  autopick boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  theme text not null default 'neon'::text
);

create table public.teams (
  id text not null,
  name text not null,
  name_es text not null,
  flag text,
  group_code text,
  seed_pos smallint,
  confederation text,
  fifa_rank integer,
  elo numeric not null default 1700
);

create table public.user_achievements (
  id bigint not null,
  user_id uuid not null,
  code text not null,
  match_id integer,
  matchday smallint,
  group_id uuid,
  earned_at timestamp with time zone not null default now()
);

-- ===== CONSTRAINTS =====

alter table public.achievements add constraint achievements_pkey PRIMARY KEY (code);
alter table public.goals add constraint goals_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;
alter table public.goals add constraint goals_pkey PRIMARY KEY (id);
alter table public.goals add constraint goals_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id);
alter table public.group_members add constraint group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
alter table public.group_members add constraint group_members_pkey PRIMARY KEY (group_id, user_id);
alter table public.group_members add constraint group_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'member'::text])));
alter table public.group_members add constraint group_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.groups add constraint groups_buy_in_check CHECK ((buy_in >= (0)::numeric));
alter table public.groups add constraint groups_join_code_key UNIQUE (join_code);
alter table public.groups add constraint groups_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 60)));
alter table public.groups add constraint groups_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.groups add constraint groups_pkey PRIMARY KEY (id);
alter table public.invites add constraint invites_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.invites add constraint invites_group_id_fkey FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
alter table public.invites add constraint invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.invites add constraint invites_pkey PRIMARY KEY (id);
alter table public.invites add constraint invites_token_key UNIQUE (token);
alter table public.match_stats add constraint match_stats_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;
alter table public.match_stats add constraint match_stats_pkey PRIMARY KEY (match_id, team_id);
alter table public.match_stats add constraint match_stats_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id);
alter table public.matches add constraint matches_away_team_fkey FOREIGN KEY (away_team) REFERENCES teams(id);
alter table public.matches add constraint matches_home_team_fkey FOREIGN KEY (home_team) REFERENCES teams(id);
alter table public.matches add constraint matches_pkey PRIMARY KEY (id);
alter table public.picks add constraint picks_away_score_check CHECK (((away_score >= 0) AND (away_score <= 30)));
alter table public.picks add constraint picks_home_score_check CHECK (((home_score >= 0) AND (home_score <= 30)));
alter table public.picks add constraint picks_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;
alter table public.picks add constraint picks_pkey PRIMARY KEY (user_id, match_id);
alter table public.picks add constraint picks_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'auto'::text])));
alter table public.picks add constraint picks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.predictions add constraint predictions_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;
alter table public.predictions add constraint predictions_pkey PRIMARY KEY (match_id);
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_theme_check CHECK ((theme = ANY (ARRAY['neon'::text, 'fiesta'::text, 'editorial'::text])));
alter table public.teams add constraint teams_pkey PRIMARY KEY (id);
alter table public.user_achievements add constraint user_achievements_code_fkey FOREIGN KEY (code) REFERENCES achievements(code);
alter table public.user_achievements add constraint user_achievements_pkey PRIMARY KEY (id);
alter table public.user_achievements add constraint user_achievements_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ===== INDEXES =====

CREATE UNIQUE INDEX achievements_pkey ON public.achievements USING btree (code);
CREATE INDEX goals_match_idx ON public.goals USING btree (match_id);
CREATE UNIQUE INDEX goals_pkey ON public.goals USING btree (id);
CREATE UNIQUE INDEX group_members_pkey ON public.group_members USING btree (group_id, user_id);
CREATE INDEX group_members_user_idx ON public.group_members USING btree (user_id);
CREATE UNIQUE INDEX groups_join_code_key ON public.groups USING btree (join_code);
CREATE UNIQUE INDEX groups_pkey ON public.groups USING btree (id);
CREATE INDEX invites_group_idx ON public.invites USING btree (group_id);
CREATE UNIQUE INDEX invites_pkey ON public.invites USING btree (id);
CREATE UNIQUE INDEX invites_token_key ON public.invites USING btree (token);
CREATE UNIQUE INDEX match_stats_pkey ON public.match_stats USING btree (match_id, team_id);
CREATE INDEX matches_group_idx ON public.matches USING btree (group_code);
CREATE INDEX matches_kickoff_idx ON public.matches USING btree (kickoff);
CREATE UNIQUE INDEX matches_pkey ON public.matches USING btree (id);
CREATE INDEX matches_stage_idx ON public.matches USING btree (stage);
CREATE INDEX picks_match_idx ON public.picks USING btree (match_id);
CREATE UNIQUE INDEX picks_pkey ON public.picks USING btree (user_id, match_id);
CREATE INDEX picks_user_idx ON public.picks USING btree (user_id);
CREATE UNIQUE INDEX predictions_pkey ON public.predictions USING btree (match_id);
CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (id);
CREATE UNIQUE INDEX teams_pkey ON public.teams USING btree (id);
CREATE UNIQUE INDEX ua_unique ON public.user_achievements USING btree (user_id, code, COALESCE(match_id, '-1'::integer), COALESCE(matchday, (- (1)::smallint)), COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE UNIQUE INDEX user_achievements_pkey ON public.user_achievements USING btree (id);

-- ===== RLS =====

alter table public.achievements enable row level security;
alter table public.goals enable row level security;
alter table public.group_members enable row level security;
alter table public.groups enable row level security;
alter table public.invites enable row level security;
alter table public.match_stats enable row level security;
alter table public.matches enable row level security;
alter table public.picks enable row level security;
alter table public.predictions enable row level security;
alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.user_achievements enable row level security;

-- ===== POLICIES =====

create policy ach_select on public.achievements as PERMISSIVE for SELECT to public
  using (true);

create policy "editor write goals" on public.goals as PERMISSIVE for ALL to authenticated
  using (is_editor())
  with check (is_editor());

create policy "public read goals" on public.goals as PERMISSIVE for SELECT to public
  using (true);

create policy gm_select on public.group_members as PERMISSIVE for SELECT to authenticated
  using (is_group_member(group_id));

create policy groups_delete on public.groups as PERMISSIVE for DELETE to authenticated
  using ((owner_id = auth.uid()));

create policy groups_select on public.groups as PERMISSIVE for SELECT to authenticated
  using (((owner_id = auth.uid()) OR is_group_member(id)));

create policy groups_update on public.groups as PERMISSIVE for UPDATE to authenticated
  using ((owner_id = auth.uid()))
  with check ((owner_id = auth.uid()));

create policy invites_select on public.invites as PERMISSIVE for SELECT to authenticated
  using (is_group_member(group_id));

create policy "editor write stats" on public.match_stats as PERMISSIVE for ALL to authenticated
  using (is_editor())
  with check (is_editor());

create policy "public read stats" on public.match_stats as PERMISSIVE for SELECT to public
  using (true);

create policy "editor write matches" on public.matches as PERMISSIVE for ALL to authenticated
  using (is_editor())
  with check (is_editor());

create policy "public read matches" on public.matches as PERMISSIVE for SELECT to public
  using (true);

create policy picks_delete on public.picks as PERMISSIVE for DELETE to authenticated
  using (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM matches m
  WHERE ((m.id = picks.match_id) AND ((m.kickoff IS NULL) OR (m.kickoff > now())))))));

create policy picks_insert on public.picks as PERMISSIVE for INSERT to authenticated
  with check (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM matches m
  WHERE ((m.id = picks.match_id) AND ((m.kickoff IS NULL) OR (m.kickoff > now())))))));

create policy picks_select on public.picks as PERMISSIVE for SELECT to authenticated
  using (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM matches m
  WHERE ((m.id = picks.match_id) AND (m.kickoff IS NOT NULL) AND (m.kickoff <= now()))))));

create policy picks_update on public.picks as PERMISSIVE for UPDATE to authenticated
  using (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM matches m
  WHERE ((m.id = picks.match_id) AND ((m.kickoff IS NULL) OR (m.kickoff > now())))))))
  with check (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM matches m
  WHERE ((m.id = picks.match_id) AND ((m.kickoff IS NULL) OR (m.kickoff > now())))))));

create policy "editor write preds" on public.predictions as PERMISSIVE for ALL to authenticated
  using (is_editor())
  with check (is_editor());

create policy "public read preds" on public.predictions as PERMISSIVE for SELECT to public
  using (true);

create policy profiles_insert_self on public.profiles as PERMISSIVE for INSERT to authenticated
  with check ((id = auth.uid()));

create policy profiles_select_auth on public.profiles as PERMISSIVE for SELECT to authenticated
  using (true);

create policy profiles_update_self on public.profiles as PERMISSIVE for UPDATE to authenticated
  using ((id = auth.uid()))
  with check ((id = auth.uid()));

create policy "editor write teams" on public.teams as PERMISSIVE for ALL to authenticated
  using (is_editor())
  with check (is_editor());

create policy "public read teams" on public.teams as PERMISSIVE for SELECT to public
  using (true);

create policy ua_select on public.user_achievements as PERMISSIVE for SELECT to public
  using (true);

-- ===== VIEWS =====

create or replace view public.leaderboard_global as
 SELECT p.user_id,
    pr.display_name,
    pr.avatar_url,
    pr.country,
    (COALESCE(sum(p.points), (0)::bigint))::integer AS total_pts,
    (count(*) FILTER (WHERE p.exact))::integer AS exact_count,
    (count(*) FILTER (WHERE (p.points IS NOT NULL)))::integer AS played,
    max(p.updated_at) FILTER (WHERE (COALESCE((p.points)::integer, 0) > 0)) AS last_correct_at
   FROM (picks p
     JOIN profiles pr ON ((pr.id = p.user_id)))
  GROUP BY p.user_id, pr.display_name, pr.avatar_url, pr.country;

create or replace view public.leaderboard_group as
 SELECT gm.group_id,
    gm.user_id,
    gm.paid,
    pr.display_name,
    pr.avatar_url,
    pr.country,
    (COALESCE(sum(p.points), (0)::bigint))::integer AS total_pts,
    (count(*) FILTER (WHERE p.exact))::integer AS exact_count,
    (count(*) FILTER (WHERE (p.points IS NOT NULL)))::integer AS played,
    max(p.updated_at) FILTER (WHERE (COALESCE((p.points)::integer, 0) > 0)) AS last_correct_at
   FROM ((group_members gm
     JOIN profiles pr ON ((pr.id = gm.user_id)))
     LEFT JOIN picks p ON ((p.user_id = gm.user_id)))
  GROUP BY gm.group_id, gm.user_id, gm.paid, pr.display_name, pr.avatar_url, pr.country;

-- ===== TRIGGERS =====

CREATE TRIGGER matches_resolve_knockout AFTER UPDATE OF status, home_score, away_score, home_pens, away_pens ON public.matches FOR EACH ROW WHEN ((new.status = 'finished'::text)) EXECUTE FUNCTION trg_resolve_knockout();
CREATE TRIGGER matches_score_change AFTER UPDATE OF home_score, away_score, status ON public.matches FOR EACH ROW WHEN (((new.status IS DISTINCT FROM old.status) OR (new.home_score IS DISTINCT FROM old.home_score) OR (new.away_score IS DISTINCT FROM old.away_score))) EXECUTE FUNCTION trg_match_score_change();
CREATE TRIGGER matches_touch BEFORE UPDATE ON public.matches FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER picks_one_joker BEFORE INSERT OR UPDATE ON public.picks FOR EACH ROW EXECUTE FUNCTION enforce_one_joker();

-- ===== FUNCTIONS =====

CREATE OR REPLACE FUNCTION public._award(p_user uuid, p_code text, p_match integer, p_md smallint, p_group uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.user_achievements(user_id, code, match_id, matchday, group_id)
  values (p_user, p_code, p_match, p_md, p_group) on conflict do nothing;
end; $function$

;

CREATE OR REPLACE FUNCTION public._evaluate_matchday(p_md smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_n int; r record; g record;
begin
  select count(*) into v_n from public.matches where stage='group' and matchday=p_md;
  if v_n = 0 then return; end if;
  for r in
    select p.user_id, count(*) as c, count(*) filter (where p.exact) as e
    from public.picks p join public.matches m on m.id = p.match_id
    where m.stage='group' and m.matchday=p_md group by p.user_id
  loop
    if r.c = v_n then
      perform public._award(r.user_id, 'pleno', null, p_md, null);
      if r.e = v_n then perform public._award(r.user_id, 'jornada_perfecta', null, p_md, null); end if;
    end if;
  end loop;
  for g in select id from public.groups loop
    for r in
      with pts as (
        select gm.user_id,
               coalesce(sum(p.points) filter (where m.stage='group' and m.matchday=p_md), 0) as s
        from public.group_members gm
        left join public.picks p on p.user_id = gm.user_id
        left join public.matches m on m.id = p.match_id
        where gm.group_id = g.id group by gm.user_id
      )
      select user_id from pts where s > 0 and s = (select max(s) from pts)
    loop
      perform public._award(r.user_id, 'el_profeta', null, p_md, g.id);
    end loop;
  end loop;
end; $function$

;

CREATE OR REPLACE FUNCTION public.accept_invite(p_token text)
 RETURNS groups
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_inv public.invites; v_g public.groups; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Debes iniciar sesión'; end if;
  select * into v_inv from public.invites where token = p_token;
  if v_inv.id is null then raise exception 'Invitación inválida'; end if;
  if v_inv.expires_at < now() then raise exception 'La invitación expiró'; end if;
  insert into public.group_members(group_id, user_id) values (v_inv.group_id, v_uid) on conflict (group_id, user_id) do nothing;
  update public.invites set accepted_by = v_uid where id = v_inv.id and accepted_by is null;
  select * into v_g from public.groups where id = v_inv.group_id;
  return v_g;
end; $function$

;

CREATE OR REPLACE FUNCTION public.create_group(p_name text, p_buy_in numeric DEFAULT 0, p_currency text DEFAULT 'MXN'::text)
 RETURNS groups
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_code text; v_g public.groups; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Debes iniciar sesión'; end if;
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from public.groups where join_code = v_code);
  end loop;
  insert into public.groups(name, owner_id, join_code, buy_in, currency)
  values (trim(p_name), v_uid, v_code, coalesce(p_buy_in,0), coalesce(nullif(trim(p_currency),''),'MXN'))
  returning * into v_g;
  insert into public.group_members(group_id, user_id, role) values (v_g.id, v_uid, 'owner');
  return v_g;
end; $function$

;

CREATE OR REPLACE FUNCTION public.create_invite(p_group uuid, p_email text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_token text;
begin
  if not public.is_group_member(p_group) then raise exception 'No perteneces a este grupo'; end if;
  v_token := translate(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.invites(group_id, token, email, invited_by) values (p_group, v_token, nullif(trim(p_email),''), auth.uid());
  return v_token;
end; $function$

;

CREATE OR REPLACE FUNCTION public.delete_group(p_group uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_group_owner(p_group) then
    raise exception 'Solo el dueño del grupo puede eliminarlo';
  end if;
  delete from public.groups where id = p_group;
end; $function$

;

CREATE OR REPLACE FUNCTION public.enforce_one_joker()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_md smallint; v_stage text;
begin
  if new.is_joker then
    select matchday, stage into v_md, v_stage from public.matches where id = new.match_id;
    if exists (
      select 1 from public.picks p
      join public.matches m on m.id = p.match_id
      where p.user_id = new.user_id and p.is_joker and p.match_id <> new.match_id
        and m.stage = v_stage and ((v_md is not null and m.matchday = v_md) or (v_md is null))
    ) then
      raise exception 'Solo puedes tener un Joker por jornada/ronda';
    end if;
  end if;
  return new;
end; $function$

;

CREATE OR REPLACE FUNCTION public.evaluate_achievements_for_match(p_match_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m record; v_out int; v_phw numeric; v_pd numeric; v_paw numeric; v_prob numeric; r record;
begin
  select * into m from public.matches where id = p_match_id;
  if m is null or m.status <> 'finished' or m.home_score is null or m.away_score is null then return; end if;
  v_out := sign(m.home_score - m.away_score);
  select p_home_win, p_draw, p_away_win into v_phw, v_pd, v_paw from public.predictions where match_id = p_match_id;
  if v_phw is not null then
    v_prob := case when v_out > 0 then v_phw when v_out = 0 then v_pd else v_paw end;
    if v_prob is not null and v_prob < 0.25 then
      for r in select user_id from public.picks where match_id = p_match_id and coalesce(outcome_pts,0) > 0 loop
        perform public._award(r.user_id, 'mataguigantes', p_match_id, null, null);
      end loop;
    end if;
  end if;
  for r in select user_id from public.picks where match_id = p_match_id and exact is true loop
    if (
      select count(*) = 3 and bool_and(t.exact)
      from (
        select p.exact from public.picks p join public.matches mm on mm.id = p.match_id
        where p.user_id = r.user_id and mm.status='finished' and mm.kickoff is not null
        order by mm.kickoff desc limit 3
      ) t
    ) then
      perform public._award(r.user_id, 'racha', p_match_id, null, null);
    end if;
  end loop;
  if m.stage = 'group' and m.matchday is not null then
    if not exists (select 1 from public.matches mm where mm.stage='group' and mm.matchday=m.matchday and mm.status <> 'finished') then
      perform public._evaluate_matchday(m.matchday);
    end if;
  end if;
end; $function$

;

CREATE OR REPLACE FUNCTION public.group_pick_distribution(p_group uuid, p_match integer)
 RETURNS TABLE(outcome text, n integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_group_member(p_group) then raise exception 'No perteneces a este grupo'; end if;
  if not exists (select 1 from public.matches where id = p_match and kickoff is not null and kickoff <= now()) then
    raise exception 'Disponible después del inicio del partido';
  end if;
  return query
    select case when sign(pk.home_score - pk.away_score) > 0 then 'home'
                when sign(pk.home_score - pk.away_score) = 0 then 'draw'
                else 'away' end as outcome,
           count(*)::int
    from public.picks pk
    join public.group_members gm on gm.user_id = pk.user_id and gm.group_id = p_group
    where pk.match_id = p_match group by 1;
end; $function$

;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.profiles (id, display_name, avatar_url, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name',
             new.raw_user_meta_data ->> 'name',
             split_part(coalesce(new.email,''), '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url',
    new.email
  )
  on conflict (id) do nothing;
  return new;
end; $function$

;

CREATE OR REPLACE FUNCTION public.invite_info(p_token text)
 RETURNS TABLE(group_id uuid, group_name text, expired boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select i.group_id, g.name, (i.expires_at < now())
  from public.invites i join public.groups g on g.id = i.group_id where i.token = p_token;
$function$

;

CREATE OR REPLACE FUNCTION public.is_editor()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(auth.jwt() ->> 'email', '') = any (array[
    'joseleonsalgado@gmail.com'
  ]);
$function$

;

CREATE OR REPLACE FUNCTION public.is_group_member(p_group uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists(select 1 from public.group_members gm where gm.group_id = p_group and gm.user_id = auth.uid());
$function$

;

CREATE OR REPLACE FUNCTION public.is_group_owner(p_group uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists(select 1 from public.groups g where g.id = p_group and g.owner_id = auth.uid());
$function$

;

CREATE OR REPLACE FUNCTION public.join_group_by_code(p_code text)
 RETURNS groups
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_g public.groups; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Debes iniciar sesión'; end if;
  select * into v_g from public.groups where join_code = upper(trim(p_code));
  if v_g.id is null then raise exception 'Código de grupo inválido'; end if;
  insert into public.group_members(group_id, user_id) values (v_g.id, v_uid) on conflict (group_id, user_id) do nothing;
  return v_g;
end; $function$

;

CREATE OR REPLACE FUNCTION public.knockout_outcome(ph text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m record; home_won boolean;
begin
  if ph is null or ph !~ '^[WL][0-9]+$' then return null; end if;
  select * into m from public.matches where id = substring(ph from 2)::int;
  if not found or m.status <> 'finished' or m.home_score is null or m.away_score is null
     or m.home_team is null or m.away_team is null then
    return null;
  end if;
  if m.home_score = m.away_score then
    -- empate: definido por penales
    if m.home_pens is null or m.away_pens is null or m.home_pens = m.away_pens then return null; end if;
    home_won := m.home_pens > m.away_pens;
  else
    home_won := m.home_score > m.away_score;
  end if;
  if left(ph, 1) = 'W' then
    return case when home_won then m.home_team else m.away_team end;
  else
    return case when home_won then m.away_team else m.home_team end;
  end if;
end; $function$

;

CREATE OR REPLACE FUNCTION public.leave_group(p_group uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if public.is_group_owner(p_group) then raise exception 'El dueño no puede salir; elimina el grupo'; end if;
  delete from public.group_members where group_id = p_group and user_id = auth.uid();
end; $function$

;

CREATE OR REPLACE FUNCTION public.race_meta(p_join_code text)
 RETURNS TABLE(name text, currency text, buy_in numeric, members integer, finished_days integer, last_day date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select g.name, g.currency, g.buy_in,
    (select count(*)::int from public.group_members gm where gm.group_id = g.id),
    (select count(distinct (kickoff at time zone 'America/Mexico_City')::date)::int
       from public.matches where status = 'finished'),
    (select max(kickoff)::date from public.matches where status = 'finished')
  from public.groups g
  where g.join_code = p_join_code
  limit 1;
$function$

;

CREATE OR REPLACE FUNCTION public.race_my_groups()
 RETURNS TABLE(name text, join_code text, members integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select g.name, g.join_code,
    (select count(*)::int from public.group_members gm2 where gm2.group_id = g.id)
  from public.groups g
  join public.group_members gm on gm.group_id = g.id
  where gm.user_id = auth.uid()
  order by g.name;
$function$

;

CREATE OR REPLACE FUNCTION public.race_timeline(p_join_code text)
 RETURNS TABLE(user_id uuid, display_name text, avatar_url text, country text, day date, cum_points integer, cum_exact integer, rnk integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with g as (
    select id from public.groups where join_code = p_join_code limit 1
  ),
  days as (
    select distinct (kickoff at time zone 'America/Mexico_City')::date as d
    from public.matches where status = 'finished'
  ),
  members as (
    select gm.user_id, pr.display_name, pr.avatar_url, pr.country
    from public.group_members gm
    join public.profiles pr on pr.id = gm.user_id
    where gm.group_id = (select id from g)
  ),
  per_day as (
    select pk.user_id,
           (m.kickoff at time zone 'America/Mexico_City')::date as d,
           sum(pk.points)          as pts,
           sum((pk.exact)::int)    as ex
    from public.picks pk
    join public.matches m on m.id = pk.match_id and m.status = 'finished'
    where pk.user_id in (select user_id from members)
    group by pk.user_id, (m.kickoff at time zone 'America/Mexico_City')::date
  ),
  grid as (
    select mm.user_id, mm.display_name, mm.avatar_url, mm.country, d.d,
           coalesce(sum(pd.pts) over (partition by mm.user_id order by d.d
             rows between unbounded preceding and current row), 0)::int as cum_points,
           coalesce(sum(pd.ex)  over (partition by mm.user_id order by d.d
             rows between unbounded preceding and current row), 0)::int as cum_exact
    from members mm
    cross join days d
    left join per_day pd on pd.user_id = mm.user_id and pd.d = d.d
  )
  select user_id, display_name, avatar_url, country, d as day, cum_points, cum_exact,
         rank() over (partition by d order by cum_points desc)::int as rnk
  from grid
  order by d, cum_points desc, display_name;
$function$

;

CREATE OR REPLACE FUNCTION public.recompute_match_scores(p_match_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m record;
begin
  select * into m from public.matches where id = p_match_id;
  if m is null then return; end if;
  if m.status = 'finished' and m.home_score is not null and m.away_score is not null then
    update public.picks p set
      exact = (p.home_score = m.home_score and p.away_score = m.away_score),
      outcome_pts = case when sign(p.home_score - p.away_score) = sign(m.home_score - m.away_score) then 1 else 0 end,
      points = (
        case
          when (p.home_score = m.home_score and p.away_score = m.away_score) then 3
          when sign(p.home_score - p.away_score) = sign(m.home_score - m.away_score) then 1
          else 0
        end * case when p.is_joker then 2 else 1 end
      ),
      updated_at = now()
    where p.match_id = p_match_id;
  else
    update public.picks p set points = null, exact = null, outcome_pts = null, updated_at = now()
    where p.match_id = p_match_id and (p.points is not null or p.exact is not null);
  end if;
  perform public.evaluate_achievements_for_match(p_match_id);
end; $function$

;

CREATE OR REPLACE FUNCTION public.remove_member(p_group uuid, p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_group_owner(p_group) then raise exception 'Solo el dueño del grupo'; end if;
  if p_user = auth.uid() then raise exception 'Usa eliminar grupo'; end if;
  delete from public.group_members where group_id = p_group and user_id = p_user;
end; $function$

;

CREATE OR REPLACE FUNCTION public.resolve_knockout_teams()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare total int := 0; n int;
begin
  for _i in 1..8 loop
    update public.matches d set
      home_team = coalesce(d.home_team, public.knockout_outcome(d.home_placeholder)),
      away_team = coalesce(d.away_team, public.knockout_outcome(d.away_placeholder))
    where d.stage <> 'group'
      and ( (d.home_team is null and public.knockout_outcome(d.home_placeholder) is not null)
         or (d.away_team is null and public.knockout_outcome(d.away_placeholder) is not null) );
    get diagnostics n = row_count;
    total := total + n;
    exit when n = 0;
  end loop;
  return total;
end; $function$

;

CREATE OR REPLACE FUNCTION public.save_pick(p_match_id integer, p_home integer, p_away integer, p_joker boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_kick timestamptz;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión'; end if;
  if p_home is null or p_away is null or p_home < 0 or p_away < 0 or p_home > 30 or p_away > 30 then
    raise exception 'Marcador inválido';
  end if;
  select kickoff into v_kick from public.matches where id = p_match_id;
  if v_kick is null then
    if not exists (select 1 from public.matches where id = p_match_id) then
      raise exception 'Partido inexistente';
    end if;
  elsif v_kick <= now() then
    raise exception 'El partido ya inició; ya no puedes cambiar tu pronóstico';
  end if;
  insert into public.picks (user_id, match_id, home_score, away_score, is_joker, source)
  values (v_uid, p_match_id, p_home, p_away, coalesce(p_joker, false), 'manual')
  on conflict (user_id, match_id) do update
    set home_score = excluded.home_score,
        away_score = excluded.away_score,
        is_joker   = excluded.is_joker,
        updated_at = now();
end; $function$

;

CREATE OR REPLACE FUNCTION public.set_member_paid(p_group uuid, p_user uuid, p_paid boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_group_owner(p_group) then raise exception 'Solo el dueño del grupo'; end if;
  update public.group_members set paid = p_paid where group_id = p_group and user_id = p_user;
end; $function$

;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at = now();
  return new;
end $function$

;

CREATE OR REPLACE FUNCTION public.trg_match_score_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.recompute_match_scores(new.id);
  return new;
end; $function$

;

CREATE OR REPLACE FUNCTION public.trg_resolve_knockout()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.resolve_knockout_teams();
  return null;
end; $function$
