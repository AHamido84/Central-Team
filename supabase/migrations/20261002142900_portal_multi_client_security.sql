-- Feedback Round 4 (ADR-091…093): several clients per portal user, the selected client enforced in the database, a
-- portal user's email changed by an admin, and notifications per client.

-- Foreign keys Drizzle can't declare without an import cycle ------------------------------------------------------
alter table public.notifications
  add constraint notifications_client_id_clients_id_fk foreign key (client_id) references public.clients(id) on delete set null;
create index notifications_user_client_idx on public.notifications (user_id, client_id);
alter table public.notification_client_preferences
  add constraint notification_client_preferences_client_id_clients_id_fk foreign key (client_id) references public.clients(id) on delete cascade;

-- Permission: change a portal user's email (FR4.1) ----------------------------------------------------------------
insert into public.permissions (key, resource, action, side, module, sort_order, label) values
  ('client_users:update_email', 'client_users', 'update_email', 'agency', 'clients', 105,
   '{"ar":"تغيير بريد دخول مستخدمي البوابة","en":"Change portal users'' sign-in email"}')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key, organization_id)
select r.id, 'client_users:update_email', r.organization_id from public.roles r
where r.is_system and r.key in ('super_admin', 'admin', 'account_manager')
on conflict do nothing;

-- New organizations get it through the Feedback Round grants used by app.bootstrap_organization.
create or replace function app.fr1_role_grants(p_role_key text)
returns text[] language sql immutable set search_path = '' as $$
  select case
    when p_role_key in ('super_admin', 'admin') then array[
      'clients:delete', 'clients:purge', 'client_users:delete', 'client_users:purge', 'users:delete', 'users:purge',
      'packages:delete', 'packages:purge', 'request_types:delete', 'request_types:purge', 'workflows:delete',
      'workflows:purge', 'requests:delete', 'requests:purge', 'tasks:purge', 'files:delete', 'files:purge',
      'deliverables:delete', 'deliverables:purge', 'messages:delete', 'messages:purge', 'tasks:edit_all',
      'integrations:connect', 'mail:manage', 'client_users:update_email']
    when p_role_key = 'account_manager' then array['client_users:delete', 'requests:delete', 'files:delete', 'deliverables:delete',
      'messages:delete', 'tasks:edit_managed', 'integrations:connect', 'client_users:update_email']
    when p_role_key = 'team_lead' then array['requests:delete', 'files:delete', 'deliverables:delete', 'messages:delete',
      'tasks:edit_managed', 'integrations:connect']
    when p_role_key = 'specialist' then array['integrations:connect']
    else array[]::text[]
  end;
$$;

-- The selected client (FR4.3, ADR-091) ------------------------------------------------------------------------------
-- `withRls` sets `app.active_client` for portal users from a server-validated choice. When it is set, a portal user is
-- a member of that client only: every portal policy and `app.has_client_permission` go through the two functions
-- below, so membership in client A gives no access to client B while A is selected. Unset (agency users, scripts, the
-- service path) keeps the full membership set, as before.
create or replace function app.active_client()
returns uuid language sql stable set search_path = '' as $$
  select case when v ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v::uuid end
  from (select current_setting('app.active_client', true) as v) s
$$;
grant execute on function app.active_client() to authenticated, service_role;

create or replace function app.is_client_member(p_client uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (app.active_client() is null or p_client = app.active_client()) and exists (
    select 1 from public.client_users cu
    join public.organization_members m
      on m.organization_id = cu.organization_id and m.user_id = cu.user_id
    join public.clients c on c.id = cu.client_id
    where cu.client_id = p_client and cu.user_id = auth.uid()
      and cu.status = 'active' and cu.deleted_at is null and m.status = 'active' and m.deleted_at is null
      and m.user_type = 'client' and c.deleted_at is null
  );
$$;

create or replace function app.member_client_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(cu.client_id), '{}') from public.client_users cu
  join public.organization_members m on m.organization_id = cu.organization_id and m.user_id = cu.user_id
  join public.clients c on c.id = cu.client_id
  where cu.user_id = auth.uid() and cu.status = 'active' and cu.deleted_at is null and m.status = 'active'
    and m.deleted_at is null and m.user_type = 'client' and c.deleted_at is null
    and (app.active_client() is null or cu.client_id = app.active_client())
$$;

-- Profiles a portal user can see follow the selected client too (colleagues and agency people of that client only).
create or replace function app.visible_profile_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x.id), '{}') from (
    select auth.uid() as id
    union all
    select them.user_id from public.organization_members me
    join public.organization_members them on them.organization_id = me.organization_id
    where me.user_id = auth.uid() and me.status = 'active' and me.user_type = 'agency'
    union all
    select theirs.user_id from public.client_users mine
    join public.client_users theirs on theirs.client_id = mine.client_id
    where mine.user_id = auth.uid() and mine.status = 'active'
      and (app.active_client() is null or mine.client_id = app.active_client())
    union all
    select p.user_id from public.client_users mine
    join public.clients c on c.id = mine.client_id
    cross join lateral (
      select c.account_manager_id as user_id
      union all select a.user_id from public.client_assignments a where a.client_id = c.id
      union all select cm.author_id from public.comments cm where cm.client_id = c.id and cm.visibility = 'client'
      union all select f.uploaded_by from public.files f where f.client_id = c.id and f.visibility = 'client'
      union all select r.assignee_id from public.requests r where r.client_id = c.id
    ) p
    where mine.user_id = auth.uid() and mine.status = 'active' and p.user_id is not null
      and (app.active_client() is null or mine.client_id = app.active_client())
  ) x where x.id is not null
$$;

-- Every client of the caller, ignoring the selection: the switcher, the "choose an account" screen and the per-client
-- badges need the whole list. Display fields only; the data of each client stays behind the scoped policies.
create or replace function app.my_portal_clients()
returns table (client_id uuid, name jsonb, logo_path text, role_key text, role_name jsonb, can_approve boolean,
  last_used_at timestamptz, pending_approvals int)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.logo_path, r.key, r.name, cu.can_approve, v.last_used_at,
    (select count(*)::int from public.deliverables d
      where d.client_id = c.id and d.status = 'client_review' and d.deleted_at is null)
  from public.client_users cu
  join public.organization_members m on m.organization_id = cu.organization_id and m.user_id = cu.user_id
  join public.clients c on c.id = cu.client_id
  join public.roles r on r.id = cu.role_id
  left join public.portal_client_visits v on v.user_id = cu.user_id and v.client_id = cu.client_id
  where cu.user_id = auth.uid() and cu.status = 'active' and cu.deleted_at is null and m.status = 'active'
    and m.deleted_at is null and m.user_type = 'client' and c.deleted_at is null
  order by cu.created_at
$$;
revoke all on function app.my_portal_clients() from public, anon;
grant execute on function app.my_portal_clients() to authenticated, service_role;

-- portal_client_visits: the caller's own rows; written only through app.touch_portal_client --------------------------
alter table public.portal_client_visits enable row level security;
revoke all on public.portal_client_visits from anon, authenticated;
grant select on public.portal_client_visits to authenticated;
create policy portal_client_visits_select on public.portal_client_visits for select to authenticated
  using (user_id = (select auth.uid()));

-- Remembers the client a portal user opened; refuses a client they don't belong to.
create or replace function app.touch_portal_client(p_client uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select cu.organization_id into v_org from public.client_users cu
  join public.organization_members m on m.organization_id = cu.organization_id and m.user_id = cu.user_id
  join public.clients c on c.id = cu.client_id
  where cu.client_id = p_client and cu.user_id = auth.uid() and cu.status = 'active' and cu.deleted_at is null
    and m.status = 'active' and m.deleted_at is null and m.user_type = 'client' and c.deleted_at is null;
  if v_org is null then
    return false;
  end if;
  insert into public.portal_client_visits (user_id, client_id, organization_id, last_used_at)
  values (auth.uid(), p_client, v_org, now())
  on conflict (user_id, client_id) do update set last_used_at = excluded.last_used_at;
  return true;
end $$;
revoke all on function app.touch_portal_client(uuid) from public, anon;
grant execute on function app.touch_portal_client(uuid) to authenticated;

-- notification_client_preferences: own rows, for clients the caller belongs to --------------------------------------
alter table public.notification_client_preferences enable row level security;
revoke all on public.notification_client_preferences from anon, authenticated;
grant select, insert, update, delete on public.notification_client_preferences to authenticated;
create policy notification_client_preferences_select on public.notification_client_preferences for select to authenticated
  using (user_id = (select auth.uid()));
create policy notification_client_preferences_write on public.notification_client_preferences for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.client_users cu where cu.user_id = (select auth.uid()) and cu.client_id = notification_client_preferences.client_id
      and cu.organization_id = notification_client_preferences.organization_id and cu.status = 'active' and cu.deleted_at is null));
create policy notification_client_preferences_update on public.notification_client_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notification_client_preferences_delete on public.notification_client_preferences for delete to authenticated
  using (user_id = (select auth.uid()));

-- portal_email_changes: written by the service path; admins who may change emails read their organization's rows ----
alter table public.portal_email_changes enable row level security;
revoke all on public.portal_email_changes from anon, authenticated;
grant select (id, organization_id, user_id, client_id, from_email, to_email, expires_at, requested_by, status, completed_at,
  created_at) on public.portal_email_changes to authenticated;
create policy portal_email_changes_select on public.portal_email_changes for select to authenticated
  using (organization_id = any ((select app.agency_org_ids())::uuid[])
    and app.has_permission(organization_id, 'client_users:update_email'));

-- Who may change this portal user's email (FR4.1): the permission, and — for Account Managers — access to one of the
-- user's clients. Never agency team members (they are edited in Admin → Users).
create or replace function app.can_update_portal_email(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.user_id = p_user and m.user_type = 'client' and m.deleted_at is null
      and m.organization_id = any (app.agency_org_ids())
      and app.has_permission(m.organization_id, 'client_users:update_email')
      and (
        app.has_permission(m.organization_id, 'clients:read_all')
        or exists (select 1 from public.client_users cu where cu.user_id = p_user and cu.deleted_at is null
          and cu.client_id = any (app.agency_client_ids()))
      )
  )
$$;
grant execute on function app.can_update_portal_email(uuid) to authenticated, service_role;
