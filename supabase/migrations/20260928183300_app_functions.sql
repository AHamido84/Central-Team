-- ============================================================================
-- App schema: helper functions, triggers, audit, auth hook.
-- All helpers are SECURITY DEFINER with an empty search_path and fully
-- qualified names. They are owned by `postgres` (table owner), so they read
-- tables without recursing into RLS.
-- ============================================================================

create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------

create or replace function app.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'updated_at' and t.table_type = 'BASE TABLE'
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function app.set_updated_at()',
      r.table_name
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Membership & permission helpers
-- ---------------------------------------------------------------------------

create or replace function app.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function app.is_agency_member(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid()
      and m.status = 'active' and m.user_type = 'agency'
  );
$$;

create or replace function app.is_super_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_agency_member(p_org) and exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.organization_id = p_org and ur.user_id = auth.uid() and r.is_locked
  );
$$;

-- Effective agency permission: (roles ∪ grants) − denies. Super Admin (locked role) holds everything.
create or replace function app.has_permission(p_org uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_agency_member(p_org) and (
    app.is_super_admin(p_org)
    or (
      not exists (
        select 1 from public.user_permission_overrides o
        where o.organization_id = p_org and o.user_id = auth.uid()
          and o.permission_key = p_perm and o.effect = 'deny'
      )
      and (
        exists (
          select 1 from public.user_roles ur
          join public.role_permissions rp on rp.role_id = ur.role_id
          where ur.organization_id = p_org and ur.user_id = auth.uid() and rp.permission_key = p_perm
        )
        or exists (
          select 1 from public.user_permission_overrides o
          where o.organization_id = p_org and o.user_id = auth.uid()
            and o.permission_key = p_perm and o.effect = 'grant'
        )
      )
    )
  );
$$;

create or replace function app.effective_permissions(p_org uuid)
returns setof text language sql stable security definer set search_path = '' as $$
  select p.key from public.permissions p
  where p.side = 'agency' and app.has_permission(p_org, p.key)
  order by p.key;
$$;

create or replace function app.is_client_member(p_client uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.client_users cu
    join public.organization_members m
      on m.organization_id = cu.organization_id and m.user_id = cu.user_id
    where cu.client_id = p_client and cu.user_id = auth.uid()
      and cu.status = 'active' and m.status = 'active' and m.user_type = 'client'
  );
$$;

create or replace function app.has_client_permission(p_client uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_client_member(p_client) and exists (
    select 1 from public.client_users cu
    join public.role_permissions rp on rp.role_id = cu.role_id
    where cu.client_id = p_client and cu.user_id = auth.uid() and rp.permission_key = p_perm
  );
$$;

create or replace function app.client_effective_permissions(p_client uuid)
returns setof text language sql stable security definer set search_path = '' as $$
  select p.key from public.permissions p
  where p.side = 'client' and app.has_client_permission(p_client, p.key)
  order by p.key;
$$;

-- Agency-side access to a client: read_all, or read_assigned + (account manager | assignment).
create or replace function app.agency_can_access_client(p_client uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clients c
    where c.id = p_client and app.is_agency_member(c.organization_id) and (
      app.has_permission(c.organization_id, 'clients:read_all')
      or (
        app.has_permission(c.organization_id, 'clients:read_assigned')
        and (
          c.account_manager_id = auth.uid()
          or exists (
            select 1 from public.client_assignments a
            where a.client_id = c.id and a.user_id = auth.uid()
          )
        )
      )
    )
  );
$$;

create or replace function app.can_access_client(p_client uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.agency_can_access_client(p_client) or app.is_client_member(p_client);
$$;

create or replace function app.feature_enabled(p_org uuid, p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select f.enabled from public.organization_features f where f.organization_id = p_org and f.flag_key = p_key),
    (select ff.default_enabled from public.feature_flags ff where ff.key = p_key),
    false
  );
$$;

-- Profiles a user may see: self, anyone in an org where the viewer is agency staff,
-- teammates of the same client, and the agency people working with the viewer's client.
create or replace function app.can_see_profile(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user = auth.uid()
    or exists (
      select 1 from public.organization_members me
      join public.organization_members them on them.organization_id = me.organization_id
      where me.user_id = auth.uid() and me.status = 'active' and me.user_type = 'agency'
        and them.user_id = p_user
    )
    or exists (
      select 1 from public.client_users mine
      join public.client_users theirs on theirs.client_id = mine.client_id
      where mine.user_id = auth.uid() and mine.status = 'active' and theirs.user_id = p_user
    )
    or exists (
      select 1 from public.client_users mine
      join public.clients c on c.id = mine.client_id
      where mine.user_id = auth.uid() and mine.status = 'active' and (
        c.account_manager_id = p_user
        or exists (select 1 from public.client_assignments a where a.client_id = c.id and a.user_id = p_user)
        or exists (
          select 1 from public.comments cm
          where cm.client_id = c.id and cm.author_id = p_user and cm.visibility = 'client'
        )
        or exists (
          select 1 from public.files f
          where f.client_id = c.id and f.uploaded_by = p_user and f.visibility = 'client'
        )
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- Anti privilege-escalation (ADR-009)
-- ---------------------------------------------------------------------------

create or replace function app.assert_can_grant(p_org uuid, p_perms text[])
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  -- Service role / migrations / seed run without a user.
  if auth.uid() is null or app.is_super_admin(p_org) then
    return;
  end if;
  if exists (
    select 1 from unnest(p_perms) k
    join public.permissions p on p.key = k
    where p.side = 'agency' and not app.has_permission(p_org, k)
  ) then
    raise exception 'cannot_grant_unheld_permission' using errcode = '42501';
  end if;
end $$;

create or replace function app.role_permission_keys(p_role uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(rp.permission_key), '{}') from public.role_permissions rp where rp.role_id = p_role;
$$;

create or replace function app.tg_role_permissions_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role public.roles;
  v_perm_side text;
begin
  select * into v_role from public.roles where id = coalesce(new.role_id, old.role_id);
  if v_role.is_locked and auth.uid() is not null then
    raise exception 'role_locked' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    select side into v_perm_side from public.permissions where key = new.permission_key;
    if v_perm_side is distinct from v_role.side then
      raise exception 'permission_side_mismatch' using errcode = '22023';
    end if;
    if new.organization_id <> v_role.organization_id then
      raise exception 'organization_mismatch' using errcode = '22023';
    end if;
    if v_role.side = 'agency' then
      perform app.assert_can_grant(v_role.organization_id, array[new.permission_key]);
    end if;
    return new;
  end if;
  return old;
end $$;

create trigger role_permissions_guard
before insert or delete on public.role_permissions
for each row execute function app.tg_role_permissions_guard();

create or replace function app.tg_roles_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' and old.is_system then
    raise exception 'system_role_not_deletable' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (
    new.key <> old.key or new.side <> old.side or new.is_system <> old.is_system
    or new.is_locked <> old.is_locked or new.organization_id <> old.organization_id
  ) then
    raise exception 'role_immutable_fields' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and (new.is_system or new.is_locked) then
    raise exception 'role_immutable_fields' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

create trigger roles_guard
before insert or update or delete on public.roles
for each row execute function app.tg_roles_guard();

create or replace function app.active_super_admin_count(p_org uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(distinct ur.user_id)::int from public.user_roles ur
  join public.roles r on r.id = ur.role_id and r.is_locked
  join public.organization_members m on m.organization_id = ur.organization_id and m.user_id = ur.user_id
  where ur.organization_id = p_org and m.status = 'active';
$$;

create or replace function app.tg_user_roles_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role public.roles;
  v_member_type text;
begin
  if tg_op = 'INSERT' then
    select * into v_role from public.roles where id = new.role_id;
    if v_role.organization_id <> new.organization_id or v_role.side <> 'agency' then
      raise exception 'invalid_role' using errcode = '22023';
    end if;
    select user_type into v_member_type from public.organization_members
      where organization_id = new.organization_id and user_id = new.user_id;
    if v_member_type is distinct from 'agency' then
      raise exception 'not_agency_member' using errcode = '22023';
    end if;
    if v_role.is_locked and auth.uid() is not null and not app.is_super_admin(new.organization_id) then
      raise exception 'cannot_grant_unheld_permission' using errcode = '42501';
    end if;
    perform app.assert_can_grant(new.organization_id, app.role_permission_keys(new.role_id));
    return new;
  end if;
  -- DELETE: never remove the last active Super Admin.
  select * into v_role from public.roles where id = old.role_id;
  if v_role.is_locked and auth.uid() is not null then
    if not app.is_super_admin(old.organization_id) then
      raise exception 'cannot_grant_unheld_permission' using errcode = '42501';
    end if;
    if app.active_super_admin_count(old.organization_id) <= 1 then
      raise exception 'last_super_admin' using errcode = '42501';
    end if;
  end if;
  return old;
end $$;

create trigger user_roles_guard
before insert or delete on public.user_roles
for each row execute function app.tg_user_roles_guard();

create or replace function app.tg_overrides_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_side text;
begin
  select side into v_side from public.permissions where key = new.permission_key;
  if v_side <> 'agency' then
    raise exception 'permission_side_mismatch' using errcode = '22023';
  end if;
  if new.effect = 'grant' then
    perform app.assert_can_grant(new.organization_id, array[new.permission_key]);
  end if;
  return new;
end $$;

create trigger user_permission_overrides_guard
before insert or update on public.user_permission_overrides
for each row execute function app.tg_overrides_guard();

create or replace function app.tg_organization_members_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.user_id <> old.user_id or new.organization_id <> old.organization_id or new.user_type <> old.user_type then
    raise exception 'member_immutable_fields' using errcode = '42501';
  end if;
  if new.status = 'deactivated' and old.status = 'active' then
    if new.user_id = auth.uid() then
      raise exception 'cannot_deactivate_self' using errcode = '42501';
    end if;
    if exists (
      select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id and r.is_locked
      where ur.organization_id = new.organization_id and ur.user_id = new.user_id
    ) then
      if not app.is_super_admin(new.organization_id) then
        raise exception 'cannot_grant_unheld_permission' using errcode = '42501';
      end if;
      if app.active_super_admin_count(new.organization_id) <= 1 then
        raise exception 'last_super_admin' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger organization_members_guard
before update on public.organization_members
for each row execute function app.tg_organization_members_guard();

-- ---------------------------------------------------------------------------
-- Client-scoped integrity
-- ---------------------------------------------------------------------------

-- Every client-scoped row must carry the client's own organization_id.
create or replace function app.tg_enforce_client_org()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.client_id is not null and not exists (
    select 1 from public.clients c where c.id = new.client_id and c.organization_id = new.organization_id
  ) then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  return new;
end $$;

create or replace function app.tg_client_users_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_role public.roles;
begin
  select * into v_role from public.roles where id = new.role_id;
  if v_role.side <> 'client' or v_role.organization_id <> new.organization_id then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if new.client_id <> old.client_id or new.user_id <> old.user_id then
      raise exception 'member_immutable_fields' using errcode = '42501';
    end if;
    if auth.uid() is not null and new.user_id = auth.uid() and not app.is_agency_member(new.organization_id) then
      raise exception 'cannot_modify_self' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger client_users_guard
before insert or update on public.client_users
for each row execute function app.tg_client_users_guard();

-- Client users may edit their company profile, but not agency-managed fields.
create or replace function app.tg_clients_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not app.is_agency_member(old.organization_id) then
    if new.status is distinct from old.status
      or new.slug is distinct from old.slug
      or new.account_manager_id is distinct from old.account_manager_id
      or new.start_date is distinct from old.start_date
      or new.organization_id is distinct from old.organization_id then
      raise exception 'client_field_restricted' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger clients_guard
before update on public.clients
for each row execute function app.tg_clients_guard();

create or replace function app.tg_comments_integrity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_thread public.threads;
begin
  select * into v_thread from public.threads where id = new.thread_id;
  if v_thread.client_id <> new.client_id or v_thread.organization_id <> new.organization_id then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  if v_thread.visibility = 'internal' and new.visibility <> 'internal' then
    new.visibility := 'internal';
  end if;
  if tg_op = 'UPDATE' and (new.thread_id <> old.thread_id or new.author_id is distinct from old.author_id
      or new.visibility <> old.visibility or new.author_side <> old.author_side) then
    raise exception 'comment_immutable_fields' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger comments_integrity
before insert or update on public.comments
for each row execute function app.tg_comments_integrity();

create or replace function app.tg_comments_touch_thread()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.threads set last_comment_at = new.created_at where id = new.thread_id;
  return new;
end $$;

create trigger comments_touch_thread
after insert on public.comments
for each row execute function app.tg_comments_touch_thread();

create or replace function app.tg_invitations_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_role_id uuid; v_role public.roles;
begin
  if new.user_type = 'agency' then
    foreach v_role_id in array new.role_ids loop
      select * into v_role from public.roles where id = v_role_id;
      if v_role.id is null or v_role.side <> 'agency' or v_role.organization_id <> new.organization_id then
        raise exception 'invalid_role' using errcode = '22023';
      end if;
      if v_role.is_locked and auth.uid() is not null and not app.is_super_admin(new.organization_id) then
        raise exception 'cannot_grant_unheld_permission' using errcode = '42501';
      end if;
      perform app.assert_can_grant(new.organization_id, app.role_permission_keys(v_role_id));
    end loop;
  else
    select * into v_role from public.roles where id = new.client_role_id;
    if v_role.id is null or v_role.side <> 'client' or v_role.organization_id <> new.organization_id then
      raise exception 'invalid_role' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

create trigger invitations_guard
before insert or update on public.invitations
for each row execute function app.tg_invitations_guard();

-- ---------------------------------------------------------------------------
-- Audit trail (ADR-012)
-- ---------------------------------------------------------------------------

create or replace function app.audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_row jsonb;
  v_org uuid;
  v_changed text[];
begin
  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after := to_jsonb(new); end if;
  if tg_table_name = 'invitations' then
    v_before := v_before - 'token_hash';
    v_after := v_after - 'token_hash';
  end if;
  if tg_op = 'UPDATE' then
    select array_agg(a.key order by a.key) into v_changed
    from jsonb_each(v_after) a
    where a.value is distinct from (v_before -> a.key) and a.key <> 'updated_at';
    if v_changed is null then
      return new;
    end if;
  end if;
  v_row := coalesce(v_after, v_before);
  if tg_table_name = 'organizations' then
    v_org := (v_row ->> 'id')::uuid;
  elsif tg_table_name = 'profiles' then
    select m.organization_id into v_org from public.organization_members m
      where m.user_id = (v_row ->> 'id')::uuid order by m.created_at limit 1;
  else
    v_org := (v_row ->> 'organization_id')::uuid;
  end if;
  insert into public.activity_log (organization_id, actor_id, action, table_name, record_id, before, after, changed_fields)
  values (
    v_org, auth.uid(), lower(tg_op), tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'role_id', v_row ->> 'department_id', v_row ->> 'client_id', v_row ->> 'user_id'),
    v_before, v_after, v_changed
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'organizations', 'organization_members', 'profiles', 'roles', 'role_permissions', 'user_roles',
    'user_permission_overrides', 'departments', 'department_members', 'invitations', 'organization_features',
    'clients', 'client_notes', 'client_users', 'client_assignments', 'packages', 'package_items',
    'client_packages', 'file_folders', 'files'
  ] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function app.audit_trigger()', t);
  end loop;
  foreach t in array array[
    'client_notes', 'client_users', 'client_assignments', 'client_packages', 'package_usage_entries',
    'file_folders', 'files', 'threads', 'comments', 'comment_attachments', 'thread_reads'
  ] loop
    execute format('create trigger enforce_client_org before insert or update on public.%I for each row execute function app.tg_enforce_client_org()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Profiles mirror auth.users
-- ---------------------------------------------------------------------------

create or replace function app.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, locale)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when new.raw_user_meta_data ->> 'locale' = 'en' then 'en' else 'ar' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function app.handle_new_user();

create or replace function app.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_email_changed
after update of email on auth.users
for each row execute function app.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- Custom access token hook: adds app claims used by proxy.ts routing (ADR-014).
-- ---------------------------------------------------------------------------

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := (event ->> 'user_id')::uuid;
  v_claims jsonb := event -> 'claims';
  v_org uuid;
  v_type text;
  v_onboarded boolean;
begin
  select m.organization_id, m.user_type into v_org, v_type
  from public.organization_members m
  where m.user_id = v_user and m.status = 'active'
  order by (m.user_type = 'agency') desc, m.created_at
  limit 1;
  select p.onboarded_at is not null into v_onboarded from public.profiles p where p.id = v_user;
  v_claims := jsonb_set(v_claims, '{app}', jsonb_build_object(
    'org_id', v_org,
    'user_type', v_type,
    'onboarded', coalesce(v_onboarded, false)
  ));
  return jsonb_set(event, '{claims}', v_claims);
end $$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
