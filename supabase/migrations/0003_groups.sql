-- ============================================================
--  Quiniela 2026 · 0003 · grupos, miembros e invitaciones
--  Membresía y pot gestionados vía RPCs security-definer
--  (evita recursión de RLS y self-insert no autorizado).
-- ============================================================

create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 60),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  join_code  text not null unique,
  buy_in     numeric not null default 0 check (buy_in >= 0),
  currency   text not null default 'MXN',
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  paid      boolean not null default false,
  role      text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user_idx on public.group_members(user_id);

create table if not exists public.invites (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  token       text not null unique,
  email       text,
  invited_by  uuid references auth.users(id) on delete set null,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '30 days')
);
create index if not exists invites_group_idx on public.invites(group_id);

alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.invites       enable row level security;

-- Helpers security-definer (sin recursión de RLS)
create or replace function public.is_group_member(p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.group_members gm
                where gm.group_id = p_group and gm.user_id = auth.uid());
$$;

create or replace function public.is_group_owner(p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.groups g
                where g.id = p_group and g.owner_id = auth.uid());
$$;

-- RLS: lectura para miembros; escritura controlada por RPCs/owner.
drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups
  for select to authenticated
  using (owner_id = auth.uid() or public.is_group_member(id));

drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists groups_delete on public.groups;
create policy groups_delete on public.groups
  for delete to authenticated using (owner_id = auth.uid());

drop policy if exists gm_select on public.group_members;
create policy gm_select on public.group_members
  for select to authenticated using (public.is_group_member(group_id));

drop policy if exists invites_select on public.invites;
create policy invites_select on public.invites
  for select to authenticated using (public.is_group_member(group_id));

-- El cliente solo puede editar buy_in/currency/name del grupo (owner). Membresía vía RPC.
revoke all on public.groups        from anon, authenticated;
revoke all on public.group_members from anon, authenticated;
revoke all on public.invites       from anon, authenticated;
grant select on public.groups        to authenticated;
grant update (name, buy_in, currency) on public.groups to authenticated;
grant select on public.group_members to authenticated;
grant select on public.invites       to authenticated;

-- ───────────────────────── RPCs ─────────────────────────

-- Crear grupo + alta del owner como miembro. Devuelve el grupo.
create or replace function public.create_group(p_name text, p_buy_in numeric default 0, p_currency text default 'MXN')
returns public.groups language plpgsql security definer set search_path = '' as $$
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
end; $$;

-- Unirse por código.
create or replace function public.join_group_by_code(p_code text)
returns public.groups language plpgsql security definer set search_path = '' as $$
declare v_g public.groups; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Debes iniciar sesión'; end if;
  select * into v_g from public.groups where join_code = upper(trim(p_code));
  if v_g.id is null then raise exception 'Código de grupo inválido'; end if;
  insert into public.group_members(group_id, user_id) values (v_g.id, v_uid)
    on conflict (group_id, user_id) do nothing;
  return v_g;
end; $$;

-- Crear invitación (link tokenizado). Devuelve el token.
create or replace function public.create_invite(p_group uuid, p_email text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_token text;
begin
  if not public.is_group_member(p_group) then raise exception 'No perteneces a este grupo'; end if;
  v_token := translate(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.invites(group_id, token, email, invited_by)
  values (p_group, v_token, nullif(trim(p_email),''), auth.uid());
  return v_token;
end; $$;

-- Resolver un token (para mostrar "te invitaron a X") sin ser miembro aún.
create or replace function public.invite_info(p_token text)
returns table(group_id uuid, group_name text, expired boolean)
language sql stable security definer set search_path = '' as $$
  select i.group_id, g.name, (i.expires_at < now())
  from public.invites i join public.groups g on g.id = i.group_id
  where i.token = p_token;
$$;

-- Aceptar invitación.
create or replace function public.accept_invite(p_token text)
returns public.groups language plpgsql security definer set search_path = '' as $$
declare v_inv public.invites; v_g public.groups; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Debes iniciar sesión'; end if;
  select * into v_inv from public.invites where token = p_token;
  if v_inv.id is null then raise exception 'Invitación inválida'; end if;
  if v_inv.expires_at < now() then raise exception 'La invitación expiró'; end if;
  insert into public.group_members(group_id, user_id) values (v_inv.group_id, v_uid)
    on conflict (group_id, user_id) do nothing;
  update public.invites set accepted_by = v_uid where id = v_inv.id and accepted_by is null;
  select * into v_g from public.groups where id = v_inv.group_id;
  return v_g;
end; $$;

-- Owner marca pagado / no pagado.
create or replace function public.set_member_paid(p_group uuid, p_user uuid, p_paid boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_group_owner(p_group) then raise exception 'Solo el dueño del grupo'; end if;
  update public.group_members set paid = p_paid where group_id = p_group and user_id = p_user;
end; $$;

-- Salir de un grupo (no el owner).
create or replace function public.leave_group(p_group uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.is_group_owner(p_group) then raise exception 'El dueño no puede salir; elimina el grupo'; end if;
  delete from public.group_members where group_id = p_group and user_id = auth.uid();
end; $$;

-- Owner expulsa a un miembro.
create or replace function public.remove_member(p_group uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_group_owner(p_group) then raise exception 'Solo el dueño del grupo'; end if;
  if p_user = auth.uid() then raise exception 'Usa eliminar grupo'; end if;
  delete from public.group_members where group_id = p_group and user_id = p_user;
end; $$;

grant execute on function public.create_group(text,numeric,text)   to authenticated;
grant execute on function public.join_group_by_code(text)          to authenticated;
grant execute on function public.create_invite(uuid,text)          to authenticated;
grant execute on function public.invite_info(text)                 to authenticated;
grant execute on function public.accept_invite(text)               to authenticated;
grant execute on function public.set_member_paid(uuid,uuid,boolean) to authenticated;
grant execute on function public.leave_group(uuid)                 to authenticated;
grant execute on function public.remove_member(uuid,uuid)          to authenticated;
