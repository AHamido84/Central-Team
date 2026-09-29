-- ============================================================================
-- Phase 5 — Agency operations & SLA: permissions, working calendar, SLA policies on requests, breaches, RLS.
-- Tables come from the drizzle-kit migration 20260929194220_operations_sla.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Permission catalog + grants for existing organizations
-- ---------------------------------------------------------------------------

insert into public.permissions (key, resource, action, side, module, sort_order, label) values
  ('operations:read', 'operations', 'read',   'agency', 'operations', 170, '{"ar":"عرض لوحة العمليات والفريق ومتابعة مستوى الخدمة","en":"View the operations dashboard, team and SLA monitor"}'),
  ('sla:manage',      'sla',        'manage', 'agency', 'operations', 171, '{"ar":"إدارة سياسات مستوى الخدمة وساعات العمل والعطل","en":"Manage SLA policies, business hours and holidays"}');

insert into public.role_permissions (role_id, permission_key, organization_id)
select r.id, k, r.organization_id
from public.roles r
cross join lateral unnest(case r.key
  when 'super_admin'     then array['operations:read', 'sla:manage']
  when 'admin'           then array['operations:read', 'sla:manage']
  when 'account_manager' then array['operations:read']
  when 'team_lead'       then array['operations:read']
  else array[]::text[]
end) k
where r.is_system
on conflict do nothing;

-- New organizations get the same grants (same as the Phase 4 version plus `operations:read`).
create or replace function app.bootstrap_organization(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_role uuid;
begin
  for r in select * from (values
    ('super_admin',     'agency', true,  1, '{"ar":"مدير النظام","en":"Super Admin"}'::jsonb,              '{"ar":"كل الصلاحيات، ولا يمكن تقييده","en":"All permissions; cannot be restricted"}'::jsonb),
    ('admin',           'agency', false, 2, '{"ar":"مدير العمليات","en":"Admin / Operations Manager"}'::jsonb, '{"ar":"إدارة الفريق والعملاء والإعدادات","en":"Runs the team, clients and settings"}'::jsonb),
    ('account_manager', 'agency', false, 3, '{"ar":"مدير حساب","en":"Account Manager"}'::jsonb,             '{"ar":"يدير علاقة العملاء المسندين إليه","en":"Owns relationships with assigned clients"}'::jsonb),
    ('team_lead',       'agency', false, 4, '{"ar":"قائد فريق","en":"Team Lead"}'::jsonb,                    '{"ar":"يقود قسمًا ويطّلع على جميع العملاء","en":"Leads a department with visibility of all clients"}'::jsonb),
    ('specialist',      'agency', false, 5, '{"ar":"أخصائي","en":"Specialist"}'::jsonb,                      '{"ar":"ينفّذ الأعمال للعملاء المسندين","en":"Delivers work for assigned clients"}'::jsonb),
    ('client_owner',    'client', false, 6, '{"ar":"مالك حساب العميل","en":"Client Owner"}'::jsonb,           '{"ar":"يدير فريق الشركة وملفها","en":"Manages the company team and profile"}'::jsonb),
    ('client_member',   'client', false, 7, '{"ar":"عضو","en":"Client Member"}'::jsonb,                       '{"ar":"يرفع الملفات ويراسل الوكالة","en":"Uploads files and messages the agency"}'::jsonb),
    ('client_viewer',   'client', false, 8, '{"ar":"مشاهد","en":"Client Viewer"}'::jsonb,                     '{"ar":"اطلاع فقط","en":"Read-only access"}'::jsonb)
  ) as t(key, side, locked, sort, name, description)
  loop
    insert into public.roles (organization_id, key, name, description, side, is_system, is_locked, sort_order)
    values (p_org, r.key, r.name, r.description, r.side, true, r.locked, r.sort)
    on conflict (organization_id, key) do nothing;
  end loop;

  for r in select * from (values
    ('super_admin', array(select key from public.permissions where side = 'agency')),
    ('admin', array(select key from public.permissions where side = 'agency' and key <> 'feature_flags:manage')),
    ('account_manager', array[
      'organization:read', 'users:read', 'departments:read', 'design_system:view',
      'clients:read_assigned', 'clients:update', 'client_users:manage', 'packages:assign',
      'files:upload', 'files:manage', 'messages:send',
      'requests:read', 'requests:update', 'requests:triage',
      'tasks:read', 'tasks:create', 'tasks:update', 'tasks:delete', 'deliverables:manage', 'deliverables:review', 'time:read_all',
      'campaigns:read', 'campaigns:manage', 'metrics:manage', 'reports:manage', 'operations:read']),
    ('team_lead', array[
      'organization:read', 'users:read', 'departments:read', 'design_system:view',
      'clients:read_all', 'files:upload', 'files:manage', 'messages:send',
      'requests:read', 'requests:update', 'requests:triage',
      'tasks:read', 'tasks:create', 'tasks:update', 'tasks:delete', 'workflows:manage',
      'deliverables:manage', 'deliverables:review', 'time:read_all',
      'campaigns:read', 'campaigns:manage', 'metrics:manage', 'reports:manage', 'operations:read']),
    ('specialist', array[
      'organization:read', 'users:read', 'departments:read',
      'clients:read_assigned', 'files:upload', 'messages:send',
      'requests:read', 'requests:update',
      'tasks:read', 'tasks:create', 'tasks:update', 'deliverables:manage',
      'campaigns:read', 'metrics:manage']),
    ('client_owner', array(select key from public.permissions where side = 'client')),
    ('client_member', array['portal:access', 'portal_files:upload', 'portal_messages:send', 'portal_users:read', 'portal_requests:create']),
    ('client_viewer', array['portal:access', 'portal_users:read'])
  ) as t(key, perms)
  loop
    select id into v_role from public.roles where organization_id = p_org and key = r.key;
    insert into public.role_permissions (role_id, permission_key, organization_id)
    select v_role, k, p_org from unnest(r.perms) k
    on conflict do nothing;
  end loop;

  insert into public.departments (organization_id, key, name, color, icon, sort_order) values
    (p_org, 'account_management', '{"ar":"إدارة الحسابات","en":"Account Management"}', 'primary', 'briefcase', 1),
    (p_org, 'design',             '{"ar":"التصميم","en":"Design"}',                        'violet',  'palette',   2),
    (p_org, 'video',              '{"ar":"الفيديو","en":"Video"}',                          'rose',    'clapperboard', 3),
    (p_org, 'content',            '{"ar":"المحتوى","en":"Content"}',                        'amber',   'pen-line',  4),
    (p_org, 'media_buying',       '{"ar":"شراء الوسائط","en":"Media Buying"}',              'emerald', 'megaphone', 5)
  on conflict (organization_id, key) do nothing;

  perform app.seed_task_statuses(p_org);
end $$;

-- ---------------------------------------------------------------------------
-- Constraints drizzle can't express (FK that would make the schema modules circular, business hours)
-- ---------------------------------------------------------------------------

alter table public.requests
  add constraint requests_sla_policy_id_fk foreign key (sla_policy_id) references public.sla_policies (id) on delete set null;
create index requests_response_due_idx on public.requests (organization_id, response_due_at) where first_response_at is null;

alter table public.organizations
  add constraint organizations_business_hours_check
  check (business_hours_start between 0 and 1439 and business_hours_end between 1 and 1440 and business_hours_start < business_hours_end);

-- ---------------------------------------------------------------------------
-- Working calendar: Sunday–Thursday minus the organization's holidays (TS mirror: src/modules/sla/calendar.ts)
-- ---------------------------------------------------------------------------

create or replace function app.org_is_working_day(p_org uuid, p_date date)
returns boolean language sql stable security definer set search_path = '' as $$
  select extract(isodow from p_date) not in (5, 6)
    and not exists (select 1 from public.holidays h where h.organization_id = p_org and h.date = p_date);
$$;

create or replace function app.org_add_working_days(p_org uuid, p_date date, p_days integer)
returns date language plpgsql stable security definer set search_path = '' as $$
declare
  v date := p_date;
  v_left integer := p_days;
  v_guard integer := 0;
begin
  if p_date is null or p_days is null then
    return null;
  end if;
  while v_left > 0 and v_guard < 3660 loop
    v := v + 1;
    v_guard := v_guard + 1;
    if app.org_is_working_day(p_org, v) then
      v_left := v_left - 1;
    end if;
  end loop;
  return v;
end $$;

-- Working days in (p_from, p_to] — how long a request waited on the client.
create or replace function app.org_working_days_between(p_org uuid, p_from date, p_to date)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer
  from generate_series(p_from + 1, p_to, interval '1 day') d
  where p_to > p_from and app.org_is_working_day(p_org, d::date);
$$;

-- p_hours of business time after p_from: only minutes between the org's business start and end on working days,
-- in the org time zone. A request sent at night starts counting the next working morning.
create or replace function app.org_add_business_hours(p_org uuid, p_from timestamptz, p_hours integer)
returns timestamptz language plpgsql stable security definer set search_path = '' as $$
declare
  v_org public.organizations;
  v_local timestamp;
  v_day date;
  v_minute numeric;
  v_left numeric := p_hours * 60;
  v_start numeric;
  v_available numeric;
  v_guard integer := 0;
begin
  if p_from is null or p_hours is null then
    return null;
  end if;
  select * into v_org from public.organizations where id = p_org;
  v_local := p_from at time zone coalesce(v_org.default_timezone, 'Asia/Riyadh');
  v_day := v_local::date;
  v_minute := extract(epoch from (v_local - v_day::timestamp)) / 60;
  while v_guard < 3660 loop
    v_guard := v_guard + 1;
    if app.org_is_working_day(p_org, v_day) then
      v_start := greatest(v_minute, v_org.business_hours_start);
      if v_start < v_org.business_hours_end then
        v_available := v_org.business_hours_end - v_start;
        if v_available >= v_left then
          return (v_day::timestamp + (v_start + v_left) * interval '1 minute') at time zone coalesce(v_org.default_timezone, 'Asia/Riyadh');
        end if;
        v_left := v_left - v_available;
      end if;
    end if;
    v_day := v_day + 1;
    v_minute := 0;
  end loop;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Policy resolution: every non-null criterion must match; client (4) > request type (2) > priority (1).
-- ---------------------------------------------------------------------------

create or replace function app.sla_policy_for(p_org uuid, p_client uuid, p_type uuid, p_priority text)
returns public.sla_policies language sql stable security definer set search_path = '' as $$
  select p.* from public.sla_policies p
  where p.organization_id = p_org and p.is_active
    and (p.client_id is null or p.client_id = p_client)
    and (p.request_type_id is null or p.request_type_id = p_type)
    and (p.priority is null or p.priority = p_priority)
  order by (case when p.client_id is not null then 4 else 0 end)
         + (case when p.request_type_id is not null then 2 else 0 end)
         + (case when p.priority is not null then 1 else 0 end) desc,
    p.sort_order, p.created_at
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Requests: SLA targets at submit, pause while waiting on the client. Runs after requests_before_* (name order),
-- so the lifecycle guard has already validated the change.
-- ---------------------------------------------------------------------------

create or replace function app.tg_requests_sla()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_trusted boolean := auth.uid() is null and pg_trigger_depth() <= 1;
  v_system boolean := auth.uid() is null or pg_trigger_depth() > 1;
  v_submitting boolean;
  v_policy public.sla_policies;
  v_type public.request_types;
  v_tz text;
  v_days integer;
  v_paused integer;
begin
  -- Server-owned columns: user writes never set them directly.
  if tg_op = 'INSERT' and not v_trusted then
    new.sla_policy_id := null;
    new.response_due_at := null;
    new.sla_paused_at := null;
    new.sla_paused_days := 0;
  elsif tg_op = 'UPDATE' and not v_system then
    new.sla_policy_id := old.sla_policy_id;
    new.response_due_at := old.response_due_at;
    new.sla_paused_at := old.sla_paused_at;
    new.sla_paused_days := old.sla_paused_days;
  end if;

  select o.default_timezone into v_tz from public.organizations o where o.id = new.organization_id;
  v_tz := coalesce(v_tz, 'Asia/Riyadh');

  v_submitting := new.status <> 'draft' and (tg_op = 'INSERT' or old.status = 'draft');
  if v_submitting and new.submitted_at is not null and not (v_trusted and new.response_due_at is not null) then
    v_policy := app.sla_policy_for(new.organization_id, new.client_id, new.request_type_id, new.priority);
    select * into v_type from public.request_types where id = new.request_type_id;
    v_days := coalesce(v_policy.resolution_days, v_type.sla_days);
    new.sla_policy_id := v_policy.id;
    new.response_due_at := case when v_policy.id is null then null
      else app.org_add_business_hours(new.organization_id, new.submitted_at, v_policy.response_hours) end;
    -- Seeded rows may bring their own due date; everything else is computed on the holiday-aware calendar.
    if v_days is not null and not (v_trusted and new.due_date is not null) then
      new.due_date := app.org_add_working_days(new.organization_id, (new.submitted_at at time zone v_tz)::date, v_days);
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status <> old.status then
    if new.status = 'needs_info' and new.sla_policy_id is not null
      and exists (select 1 from public.sla_policies p where p.id = new.sla_policy_id and p.pause_on_client) then
      new.sla_paused_at := now();
    elsif old.status = 'needs_info' and old.sla_paused_at is not null then
      v_paused := app.org_working_days_between(new.organization_id,
        (old.sla_paused_at at time zone v_tz)::date, (now() at time zone v_tz)::date);
      if v_paused > 0 then
        if new.due_date is not null and new.due_date = old.due_date then
          new.due_date := app.org_add_working_days(new.organization_id, new.due_date, v_paused);
          -- Lets the after trigger log the due-date move as a system change, not the client's.
          perform set_config('app.sla_resumed', '1', true);
        end if;
        new.sla_paused_days := old.sla_paused_days + v_paused;
      end if;
      new.sla_paused_at := null;
    end if;
  end if;
  return new;
end $$;

create trigger requests_sla
before insert or update on public.requests
for each row execute function app.tg_requests_sla();

-- Same as Phase 2 except the due-date event: a move made by the SLA pause is logged as a system change.
create or replace function app.tg_requests_after()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_system boolean := auth.uid() is null or pg_trigger_depth() > 1;
  v_side text;
  v_actor uuid := case when auth.uid() is null or pg_trigger_depth() > 1 then null else auth.uid() end;
  v_reason text := nullif(trim(coalesce(current_setting('app.transition_reason', true), '')), '');
  v_sla_resumed boolean := coalesce(current_setting('app.sla_resumed', true), '') = '1';
begin
  v_side := case when v_system then 'system' when app.is_agency_member(new.organization_id) then 'agency' else 'client' end;

  if tg_op = 'INSERT' then
    if new.status = 'submitted' then
      insert into public.request_status_history (organization_id, client_id, request_id, from_status, to_status, actor_id, actor_side, created_at)
      values (new.organization_id, new.client_id, new.id, 'draft', 'submitted', coalesce(v_actor, new.submitted_by), coalesce(nullif(v_side, 'system'), 'client'), new.submitted_at);
    end if;
  else
    if new.status <> old.status then
      insert into public.request_status_history (organization_id, client_id, request_id, from_status, to_status, reason, actor_id, actor_side)
      values (new.organization_id, new.client_id, new.id, old.status, new.status, v_reason, v_actor, v_side);
      perform set_config('app.transition_reason', '', true);
    end if;
    if new.assignee_id is distinct from old.assignee_id and old.status <> 'draft' then
      insert into public.request_events (organization_id, client_id, request_id, actor_id, actor_side, type, from_value, to_value, visibility)
      values (new.organization_id, new.client_id, new.id, v_actor, v_side, 'assigned', old.assignee_id::text, new.assignee_id::text, 'internal');
    end if;
    if new.priority <> old.priority and old.status <> 'draft' then
      insert into public.request_events (organization_id, client_id, request_id, actor_id, actor_side, type, from_value, to_value, visibility)
      values (new.organization_id, new.client_id, new.id, v_actor, v_side, 'priority_changed', old.priority, new.priority, 'internal');
    end if;
    if new.due_date is distinct from old.due_date and old.status <> 'draft' and old.due_date is not null then
      insert into public.request_events (organization_id, client_id, request_id, actor_id, actor_side, type, from_value, to_value, visibility)
      values (new.organization_id, new.client_id, new.id,
        case when v_sla_resumed then null else v_actor end, case when v_sla_resumed then 'system' else v_side end,
        'due_date_changed', old.due_date::text, new.due_date::text, 'client');
      perform set_config('app.sla_resumed', '', true);
    end if;
    if (new.is_extra <> old.is_extra or new.is_billable <> old.is_billable) and old.status <> 'draft' then
      insert into public.request_events (organization_id, client_id, request_id, actor_id, actor_side, type, from_value, to_value, visibility)
      values (new.organization_id, new.client_id, new.id, v_actor, v_side, 'flags_changed',
        'extra:' || old.is_extra || ',billable:' || old.is_billable, 'extra:' || new.is_extra || ',billable:' || new.is_billable, 'internal');
    end if;
    if old.status = 'needs_info' and (new.title <> old.title or new.brief <> old.brief or new.reference_links <> old.reference_links
        or new.desired_date is distinct from old.desired_date) then
      insert into public.request_events (organization_id, client_id, request_id, actor_id, actor_side, type, visibility)
      values (new.organization_id, new.client_id, new.id, v_actor, v_side, 'brief_updated', 'client');
    end if;
    if new.title <> old.title then
      update public.threads set title = new.title where subject_type = 'request' and subject_id = new.id;
    end if;
  end if;

  if new.status <> 'draft' and (tg_op = 'INSERT' or old.status = 'draft') then
    insert into public.threads (organization_id, client_id, subject_type, subject_id, title, visibility, created_by, last_comment_at, created_at)
    values (new.organization_id, new.client_id, 'request', new.id, new.title, 'client', new.submitted_by, new.submitted_at, new.submitted_at)
    on conflict (subject_id) where subject_type = 'request' do nothing;
  end if;

  if tg_op = 'INSERT' or new.status <> old.status or new.is_extra <> old.is_extra then
    perform app.request_sync_usage(new.id);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Policies, holidays, business hours
-- ---------------------------------------------------------------------------

create or replace function app.tg_sla_policies_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.organization_id <> old.organization_id then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  if new.request_type_id is not null and not exists (
    select 1 from public.request_types t where t.id = new.request_type_id and t.organization_id = new.organization_id
  ) then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  if new.escalate_to is not null and not exists (
    select 1 from public.organization_members m
    where m.organization_id = new.organization_id and m.user_id = new.escalate_to and m.user_type = 'agency' and m.status = 'active'
  ) then
    raise exception 'invalid_assignee' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.created_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.created_by := old.created_by;
  end if;
  return new;
end $$;

create trigger sla_policies_guard
before insert or update on public.sla_policies
for each row execute function app.tg_sla_policies_guard();

-- Business hours live on `organizations`, whose update policy needs `organization:update`; SLA admins set them here.
create or replace function app.set_business_hours(p_org uuid, p_start integer, p_end integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_permission(p_org, 'sla:manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.organizations set business_hours_start = p_start, business_hours_end = p_end where id = p_org;
end $$;

-- ---------------------------------------------------------------------------
-- Breaches: only acknowledgement is writable by people; who/when are stamped by the server.
-- ---------------------------------------------------------------------------

create or replace function app.tg_sla_breaches_acknowledge()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.acknowledged_at := coalesce(old.acknowledged_at, now());
    new.acknowledged_by := coalesce(old.acknowledged_by, auth.uid());
  end if;
  return new;
end $$;

create trigger sla_breaches_acknowledge
before update on public.sla_breaches
for each row execute function app.tg_sla_breaches_acknowledge();

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['sla_policies'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t);
  end loop;
  foreach t in array array['sla_policies', 'holidays', 'sla_breaches'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function app.audit_trigger()', t);
  end loop;
  foreach t in array array['sla_policies', 'sla_breaches'] loop
    execute format('create trigger enforce_client_org before insert or update on public.%I for each row execute function app.tg_enforce_client_org()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS — nothing here reaches the portal.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['sla_policies', 'holidays', 'sla_breaches'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

create policy sla_policies_select on public.sla_policies for select to authenticated
  using ((select app.is_agency_member(organization_id)));
create policy sla_policies_write on public.sla_policies for all to authenticated
  using ((select app.has_permission(organization_id, 'sla:manage')))
  with check ((select app.has_permission(organization_id, 'sla:manage')));

create policy holidays_select on public.holidays for select to authenticated
  using ((select app.is_agency_member(organization_id)));
create policy holidays_write on public.holidays for all to authenticated
  using ((select app.has_permission(organization_id, 'sla:manage')))
  with check ((select app.has_permission(organization_id, 'sla:manage')));

revoke insert, update, delete on public.sla_breaches from authenticated;
grant update (acknowledged_at, acknowledged_by, note) on public.sla_breaches to authenticated;

create policy sla_breaches_select on public.sla_breaches for select to authenticated
  using ((select app.agency_can_read_requests(client_id)));
create policy sla_breaches_update on public.sla_breaches for update to authenticated
  using (
    (select app.agency_can_read_requests(client_id))
    and ((select app.has_permission(organization_id, 'operations:read')) or (select app.has_permission(organization_id, 'requests:triage')))
  )
  with check (
    (select app.agency_can_read_requests(client_id))
    and ((select app.has_permission(organization_id, 'operations:read')) or (select app.has_permission(organization_id, 'requests:triage')))
  );

-- ---------------------------------------------------------------------------
-- Function privileges (new functions)
-- ---------------------------------------------------------------------------

revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
revoke all on function app.bootstrap_organization(uuid) from public, anon, authenticated;
revoke all on function app.seed_task_statuses(uuid) from public, anon, authenticated;
revoke all on function app.deliverable_sync(uuid) from public, anon, authenticated;
revoke all on function app.request_sync_usage(uuid) from public, anon, authenticated;
revoke all on function app.request_submit_fields(public.requests) from public, anon, authenticated;
revoke all on function app.app_claims_for(uuid), app.sync_app_claims(uuid), app.sync_app_claims_trigger() from public, anon, authenticated;
