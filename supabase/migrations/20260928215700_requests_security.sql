-- ============================================================================
-- Phase 2 — Requests: permissions, feature flags, lifecycle triggers, package consumption, RLS.
-- Tables come from the drizzle-kit migration 20260928215631_requests.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Permission catalog + grants for existing organizations
-- ---------------------------------------------------------------------------

insert into public.permissions (key, resource, action, side, module, sort_order, label) values
  ('requests:read',           'requests',      'read',       'agency', 'requests',      140, '{"ar":"عرض طلبات العملاء","en":"View client requests"}'),
  ('requests:update',         'requests',      'update',     'agency', 'requests',      141, '{"ar":"تحديث حالة الطلبات المسندة","en":"Update status of assigned requests"}'),
  ('requests:triage',         'requests',      'triage',     'agency', 'requests',      142, '{"ar":"فرز الطلبات وإسنادها وتحديد أولويتها","en":"Triage, assign and prioritize requests"}'),
  ('request_types:manage',    'request_types', 'manage',     'agency', 'requests',      143, '{"ar":"إدارة أنواع الطلبات ونماذجها","en":"Manage request types and their forms"}'),
  ('portal_requests:create',  'portal_requests','create',    'client', 'requests',      250, '{"ar":"تقديم الطلبات ومتابعتها وإلغاؤها","en":"Submit, update and cancel requests"}');

insert into public.role_permissions (role_id, permission_key, organization_id)
select r.id, k, r.organization_id
from public.roles r
cross join lateral unnest(case r.key
  when 'super_admin'     then array['requests:read', 'requests:update', 'requests:triage', 'request_types:manage']
  when 'admin'           then array['requests:read', 'requests:update', 'requests:triage', 'request_types:manage']
  when 'account_manager' then array['requests:read', 'requests:update', 'requests:triage']
  when 'team_lead'       then array['requests:read', 'requests:update', 'requests:triage']
  when 'specialist'      then array['requests:read', 'requests:update']
  when 'client_owner'    then array['portal_requests:create']
  when 'client_member'   then array['portal_requests:create']
  else array[]::text[]
end) k
where r.is_system
on conflict do nothing;

-- The module ships with this phase.
update public.feature_flags
set default_enabled = true, description = '{"ar":"الطلبات","en":"Requests"}'
where key = 'module.requests';

-- New organizations get the same grants.
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
      'requests:read', 'requests:update', 'requests:triage']),
    ('team_lead', array[
      'organization:read', 'users:read', 'departments:read', 'design_system:view',
      'clients:read_all', 'files:upload', 'files:manage', 'messages:send',
      'requests:read', 'requests:update', 'requests:triage']),
    ('specialist', array[
      'organization:read', 'users:read', 'departments:read',
      'clients:read_assigned', 'files:upload', 'messages:send',
      'requests:read', 'requests:update']),
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
end $$;


-- "Convert to tasks" on requests stays dark until the Tasks module ships (Phase 3).
insert into public.feature_flags (key, module, default_enabled, description) values
  ('module.tasks', 'tasks', false, '{"ar":"المهام (المرحلة 3)","en":"Tasks (Phase 3)"}')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Allowed transitions per side. Keep identical to `requestTransitions` in src/modules/requests/constants.ts
-- (tests/unit/requests.test.ts parses the two lists below).
create or replace function app.request_transition_allowed(p_from text, p_to text, p_side text)
returns boolean language sql immutable set search_path = '' as $$
  select case p_side
    -- client transitions
    when 'client' then (p_from, p_to) in (values
      ('draft', 'submitted'), ('submitted', 'cancelled'), ('under_review', 'cancelled'),
      ('needs_info', 'under_review'), ('needs_info', 'cancelled'), ('delivered', 'closed'))
    -- agency transitions
    when 'agency' then (p_from, p_to) in (values
      ('submitted', 'under_review'), ('submitted', 'needs_info'), ('submitted', 'accepted'), ('submitted', 'rejected'),
      ('under_review', 'needs_info'), ('under_review', 'accepted'), ('under_review', 'rejected'),
      ('needs_info', 'under_review'), ('accepted', 'in_progress'),
      ('in_progress', 'in_review'), ('in_progress', 'delivered'),
      ('in_review', 'in_progress'), ('in_review', 'delivered'),
      ('delivered', 'closed'), ('delivered', 'in_progress'), ('rejected', 'under_review'))
    -- end transitions
    else false
  end;
$$;

-- SLA groundwork: working days are Sunday–Thursday. Phase 5 replaces this with SLA policies and holiday calendars.
create or replace function app.add_working_days(p_date date, p_days integer)
returns date language plpgsql immutable set search_path = '' as $$
declare
  v date := p_date;
  v_left integer := p_days;
begin
  if p_date is null or p_days is null then
    return null;
  end if;
  while v_left > 0 loop
    v := v + 1;
    if extract(isodow from v) not in (5, 6) then
      v_left := v_left - 1;
    end if;
  end loop;
  return v;
end $$;

-- Package quota for an item type in the client's current period: allowed, used (ledger) and pending
-- (open, non-extra requests of that item not yet accepted). Only for callers who can access the client.
create or replace function app.request_quota(p_client uuid, p_item text, p_exclude uuid default null)
returns table (client_package_id uuid, allowed integer, used integer, pending integer)
language sql stable security definer set search_path = '' as $$
  with cp as (
    select cp.id, cp.package_id from public.client_packages cp
    where cp.client_id = p_client and current_date between cp.period_start and cp.period_end
      and (auth.uid() is null or app.can_access_client(p_client))
    order by cp.period_start desc
    limit 1
  )
  select cp.id,
    coalesce((select sum(pi.quantity)::int from public.package_items pi where pi.package_id = cp.package_id and pi.item_type = p_item), 0),
    coalesce((select sum(u.quantity)::int from public.package_usage_entries u where u.client_package_id = cp.id and u.item_type = p_item), 0),
    (select count(*)::int from public.requests r
      join public.request_types t on t.id = r.request_type_id
      where r.client_id = p_client and t.package_item_type = p_item and not r.is_extra
        and r.status in ('submitted', 'under_review', 'needs_info') and r.id is distinct from p_exclude)
  from cp;
$$;


create or replace function app.agency_can_read_requests(p_client uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clients c
    where c.id = p_client and app.has_permission(c.organization_id, 'requests:read') and app.agency_can_access_client(c.id)
  );
$$;

-- Client users additionally see the agency member assigned to one of their requests.
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
        or exists (select 1 from public.requests r where r.client_id = c.id and r.assignee_id = p_user)
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- Request types
-- ---------------------------------------------------------------------------

create or replace function app.tg_request_types_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id or new.key <> old.key then
      raise exception 'type_immutable_fields' using errcode = '42501';
    end if;
    -- Every change to the form is a new schema version (requests keep a snapshot of the one they used).
    if new.form_schema is distinct from old.form_schema then
      new.schema_version := old.schema_version + 1;
    else
      new.schema_version := old.schema_version;
    end if;
  end if;
  if new.package_item_type is not null and new.package_item_type not in
    ('post', 'reel', 'story', 'video', 'design', 'photo_shoot', 'ad_campaign', 'blog_article', 'revision_round') then
    raise exception 'invalid_package_item' using errcode = '22023';
  end if;
  if jsonb_typeof(new.form_schema -> 'fields') is distinct from 'array' then
    raise exception 'invalid_form_schema' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger request_types_guard
before insert or update on public.request_types
for each row execute function app.tg_request_types_guard();

-- ---------------------------------------------------------------------------
-- Requests lifecycle
-- ---------------------------------------------------------------------------

-- Fields set when a request leaves Draft: per-client number/reference, submit time, SLA due date,
-- default assignee (the client's account manager) and the package "extra" flag.
create or replace function app.request_submit_fields(p public.requests)
returns public.requests language plpgsql security definer set search_path = '' as $$
declare
  v_client public.clients;
  v_type public.request_types;
  v_tz text;
  v_prefix text;
  v_quota record;
  v_trusted boolean := auth.uid() is null and pg_trigger_depth() <= 1;
begin
  select * into v_client from public.clients where id = p.client_id;
  select * into v_type from public.request_types where id = p.request_type_id;
  select o.default_timezone into v_tz from public.organizations o where o.id = p.organization_id;

  perform pg_advisory_xact_lock(hashtext('requests:' || p.client_id::text));
  select coalesce(max(r.number), 0) + 1 into p.number from public.requests r where r.client_id = p.client_id;
  v_prefix := coalesce(nullif(v_client.request_prefix, ''),
    nullif(upper(left(regexp_replace(split_part(v_client.slug, '-', 1), '[^a-zA-Z0-9]', '', 'g'), 6)), ''), 'REQ');
  p.reference := v_prefix || '-' || lpad(p.number::text, 4, '0');

  p.submitted_at := case when v_trusted then coalesce(p.submitted_at, now()) else now() end;
  p.submitted_by := coalesce(auth.uid(), p.submitted_by, p.created_by);
  if not v_trusted or p.due_date is null then
    p.due_date := app.add_working_days((p.submitted_at at time zone coalesce(v_tz, 'Asia/Riyadh'))::date, v_type.sla_days);
  end if;
  p.assignee_id := coalesce(p.assignee_id, v_client.account_manager_id);

  if not v_trusted then
    p.is_extra := false;
    if v_type.package_item_type is not null then
      select * into v_quota from app.request_quota(p.client_id, v_type.package_item_type, p.id);
      -- No current package, the item isn't in it, or it's used up → the request is extra.
      p.is_extra := v_quota.client_package_id is null or v_quota.allowed - v_quota.used - v_quota.pending <= 0;
    end if;
  end if;
  return p;
end $$;

create or replace function app.tg_requests_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_type public.request_types;
  v_uid uuid := auth.uid();
begin
  select * into v_type from public.request_types where id = new.request_type_id;
  if v_type.id is null or v_type.organization_id <> new.organization_id then
    raise exception 'invalid_request_type' using errcode = '22023';
  end if;
  if v_uid is not null then
    if not v_type.is_active then
      raise exception 'request_type_inactive' using errcode = '22023';
    end if;
    if new.status not in ('draft', 'submitted') then
      raise exception 'invalid_transition' using errcode = '22023';
    end if;
    if not app.is_agency_member(new.organization_id) and new.priority = 'urgent' then
      raise exception 'request_field_restricted' using errcode = '42501';
    end if;
    -- Everything below is server-owned.
    new.created_by := v_uid;
    new.form_snapshot := v_type.form_schema -> 'fields';
    new.schema_version := v_type.schema_version;
    new.number := null;
    new.reference := null;
    new.submitted_by := null;
    new.submitted_at := null;
    new.first_response_at := null;
    new.accepted_at := null;
    new.delivered_at := null;
    new.closed_at := null;
    new.due_date := null;
    new.assignee_id := null;
    new.is_extra := false;
    new.is_billable := false;
    new.created_at := now();
    new.last_activity_at := now();
  elsif new.form_snapshot = '[]'::jsonb then
    new.form_snapshot := v_type.form_schema -> 'fields';
    new.schema_version := v_type.schema_version;
  end if;
  if new.status <> 'draft' and new.number is null then
    new := app.request_submit_fields(new);
  end if;
  return new;
end $$;

create trigger requests_before_insert
before insert on public.requests
for each row execute function app.tg_requests_before_insert();

create or replace function app.tg_requests_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  -- Service role (seed) or nested inside another trigger = a system change.
  v_system boolean := auth.uid() is null or pg_trigger_depth() > 1;
  v_agency boolean;
  v_type public.request_types;
  v_client_cols text[] := array['title', 'brief', 'reference_links', 'desired_date', 'priority', 'status', 'request_type_id',
    'form_snapshot', 'schema_version', 'updated_at', 'last_activity_at'];
  v_content_changed boolean := new.title <> old.title or new.brief <> old.brief or new.reference_links <> old.reference_links
    or new.desired_date is distinct from old.desired_date or new.request_type_id <> old.request_type_id;
  v_reason text := nullif(trim(coalesce(current_setting('app.transition_reason', true), '')), '');
begin
  if new.organization_id <> old.organization_id or new.client_id <> old.client_id
    or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'request_immutable_fields' using errcode = '42501';
  end if;
  if new.request_type_id <> old.request_type_id and old.status <> 'draft' then
    raise exception 'request_immutable_fields' using errcode = '42501';
  end if;

  if not v_system then
    v_agency := app.is_agency_member(old.organization_id);
    if not v_agency then
      if (to_jsonb(new) - v_client_cols) <> (to_jsonb(old) - v_client_cols) then
        raise exception 'request_field_restricted' using errcode = '42501';
      end if;
      if (v_content_changed or new.priority <> old.priority) and old.status not in ('draft', 'needs_info') then
        raise exception 'request_field_restricted' using errcode = '42501';
      end if;
      if new.priority = 'urgent' and old.priority <> 'urgent' then
        raise exception 'request_field_restricted' using errcode = '42501';
      end if;
      if new.status <> old.status and not app.request_transition_allowed(old.status, new.status, 'client') then
        raise exception 'invalid_transition' using errcode = '22023';
      end if;
    else
      if old.status = 'draft' or v_content_changed then
        raise exception 'request_field_restricted' using errcode = '42501';
      end if;
      if (new.priority <> old.priority or new.assignee_id is distinct from old.assignee_id
          or new.due_date is distinct from old.due_date or new.is_extra <> old.is_extra or new.is_billable <> old.is_billable
          or new.status in ('under_review', 'needs_info', 'accepted', 'rejected') and new.status <> old.status)
        and not app.has_permission(old.organization_id, 'requests:triage') then
        raise exception 'request_field_restricted' using errcode = '42501';
      end if;
      if new.status <> old.status and not app.request_transition_allowed(old.status, new.status, 'agency') then
        raise exception 'invalid_transition' using errcode = '22023';
      end if;
    end if;
    if new.status <> old.status and new.status in ('needs_info', 'rejected') and v_reason is null then
      raise exception 'reason_required' using errcode = '22023';
    end if;

    -- Server-owned fields.
    new.number := old.number;
    new.reference := old.reference;
    new.submitted_by := old.submitted_by;
    new.submitted_at := old.submitted_at;
    new.first_response_at := old.first_response_at;
    new.accepted_at := old.accepted_at;
    new.delivered_at := old.delivered_at;
    new.closed_at := old.closed_at;
    new.last_activity_at := now();
    if old.status = 'draft' then
      select * into v_type from public.request_types where id = new.request_type_id;
      if not v_type.is_active then
        raise exception 'request_type_inactive' using errcode = '22023';
      end if;
      new.form_snapshot := v_type.form_schema -> 'fields';
      new.schema_version := v_type.schema_version;
    else
      new.form_snapshot := old.form_snapshot;
      new.schema_version := old.schema_version;
    end if;
    if v_agency and new.status <> old.status then
      new.first_response_at := coalesce(old.first_response_at, now());
    end if;
  end if;

  if new.status <> old.status then
    if old.status = 'draft' then
      new := app.request_submit_fields(new);
    end if;
    if new.status = 'accepted' then new.accepted_at := coalesce(new.accepted_at, now()); end if;
    if new.status = 'delivered' then new.delivered_at := now(); end if;
    if new.status = 'closed' then new.closed_at := now(); end if;
  end if;

  if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null and not exists (
    select 1 from public.organization_members m
    where m.organization_id = new.organization_id and m.user_id = new.assignee_id
      and m.user_type = 'agency' and m.status = 'active'
  ) then
    raise exception 'invalid_assignee' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger requests_before_update
before update on public.requests
for each row execute function app.tg_requests_before_update();

-- Consumes (or releases) the request's package item: one ledger row while the request is accepted work,
-- counts against an item the current package includes, and isn't extra.
create or replace function app.request_sync_usage(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.requests;
  t public.request_types;
  v_cp uuid;
begin
  select * into r from public.requests where id = p_request;
  select * into t from public.request_types where id = r.request_type_id;
  if r.status in ('accepted', 'in_progress', 'in_review', 'delivered', 'closed') and not r.is_extra and t.package_item_type is not null then
    if exists (select 1 from public.package_usage_entries u where u.source_type = 'request' and u.source_id = r.id) then
      return;
    end if;
    select cp.id into v_cp from public.client_packages cp
    where cp.client_id = r.client_id and coalesce(r.accepted_at, now())::date between cp.period_start and cp.period_end
      and exists (select 1 from public.package_items pi where pi.package_id = cp.package_id and pi.item_type = t.package_item_type)
    order by cp.period_start desc
    limit 1;
    if v_cp is null then
      return;
    end if;
    insert into public.package_usage_entries (organization_id, client_id, client_package_id, item_type, quantity, source_type, source_id, note, created_by)
    values (r.organization_id, r.client_id, v_cp, t.package_item_type, 1, 'request', r.id, r.reference, auth.uid());
  else
    delete from public.package_usage_entries u where u.source_type = 'request' and u.source_id = r.id;
  end if;
end $$;

create unique index package_usage_entries_request_idx on public.package_usage_entries (source_id) where source_type = 'request';

-- History rows, internal events, the discussion thread and package consumption.
create or replace function app.tg_requests_after()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_system boolean := auth.uid() is null or pg_trigger_depth() > 1;
  v_side text;
  v_actor uuid := case when auth.uid() is null or pg_trigger_depth() > 1 then null else auth.uid() end;
  v_reason text := nullif(trim(coalesce(current_setting('app.transition_reason', true), '')), '');
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
      values (new.organization_id, new.client_id, new.id, v_actor, v_side, 'due_date_changed', old.due_date::text, new.due_date::text, 'client');
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

create trigger requests_after
after insert or update on public.requests
for each row execute function app.tg_requests_after();

-- A comment in a request thread is request activity, and a client-visible agency reply counts as the first response.
create or replace function app.tg_comments_request_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_thread public.threads;
begin
  select * into v_thread from public.threads where id = new.thread_id;
  if v_thread.subject_type <> 'request' or v_thread.subject_id is null then
    return new;
  end if;
  update public.requests r set
    last_activity_at = greatest(r.last_activity_at, new.created_at),
    first_response_at = case
      when new.author_side = 'agency' and new.visibility = 'client' then coalesce(r.first_response_at, new.created_at)
      else r.first_response_at end
  where r.id = v_thread.subject_id;
  return new;
end $$;

create trigger comments_request_activity
after insert on public.comments
for each row execute function app.tg_comments_request_activity();

create unique index threads_request_subject_idx on public.threads (subject_id) where subject_type = 'request';

-- ---------------------------------------------------------------------------
-- Generic triggers on the new tables
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['request_types', 'requests'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t);
  end loop;
  foreach t in array array['request_types', 'requests', 'request_attachments'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function app.audit_trigger()', t);
  end loop;
  foreach t in array array['requests', 'request_status_history', 'request_events', 'request_attachments'] loop
    execute format('create trigger enforce_client_org before insert or update on public.%I for each row execute function app.tg_enforce_client_org()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['request_types', 'requests', 'request_status_history', 'request_events', 'request_attachments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

revoke insert, update, delete on public.request_status_history, public.request_events from authenticated;
revoke update on public.request_attachments from authenticated;

create policy request_types_select on public.request_types for select to authenticated
  using (
    (select app.is_agency_member(organization_id))
    or (is_active and (select app.is_org_member(organization_id)) and (select app.feature_enabled(organization_id, 'module.requests')))
  );
create policy request_types_insert on public.request_types for insert to authenticated
  with check ((select app.has_permission(organization_id, 'request_types:manage')));
create policy request_types_update on public.request_types for update to authenticated
  using ((select app.has_permission(organization_id, 'request_types:manage')))
  with check ((select app.has_permission(organization_id, 'request_types:manage')));
create policy request_types_delete on public.request_types for delete to authenticated
  using ((select app.has_permission(organization_id, 'request_types:manage')));

-- Drafts are private to their author; the agency only ever sees submitted requests.
create policy requests_select on public.requests for select to authenticated
  using (
    (status <> 'draft' and (select app.agency_can_read_requests(client_id)))
    or ((select app.is_client_member(client_id)) and (select app.feature_enabled(organization_id, 'module.requests'))
      and (status <> 'draft' or created_by = (select auth.uid())))
  );
create policy requests_insert on public.requests for insert to authenticated
  with check (
    created_by = (select auth.uid()) and (
      ((select app.has_client_permission(client_id, 'portal_requests:create'))
        and (select app.feature_enabled(organization_id, 'module.requests')))
      or ((select app.has_permission(organization_id, 'requests:triage')) and (select app.agency_can_access_client(client_id)))
    )
  );
create policy requests_update on public.requests for update to authenticated
  using (
    (status <> 'draft' and (select app.agency_can_access_client(client_id)) and (
      (select app.has_permission(organization_id, 'requests:triage'))
      or ((select app.has_permission(organization_id, 'requests:update')) and assignee_id = (select auth.uid()))
    ))
    or ((select app.has_client_permission(client_id, 'portal_requests:create')) and (status <> 'draft' or created_by = (select auth.uid())))
  )
  with check (
    ((select app.agency_can_access_client(client_id)) and (
      (select app.has_permission(organization_id, 'requests:triage'))
      or ((select app.has_permission(organization_id, 'requests:update')) and assignee_id = (select auth.uid()))
    ))
    or (select app.has_client_permission(client_id, 'portal_requests:create'))
  );
create policy requests_delete on public.requests for delete to authenticated
  using (status = 'draft' and created_by = (select auth.uid()) and (select app.has_client_permission(client_id, 'portal_requests:create')));

create policy request_status_history_select on public.request_status_history for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_status_history.request_id));

create policy request_events_select on public.request_events for select to authenticated
  using (
    (select app.agency_can_read_requests(client_id))
    or (visibility = 'client' and exists (select 1 from public.requests r where r.id = request_events.request_id))
  );

create policy request_attachments_select on public.request_attachments for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_attachments.request_id));
create policy request_attachments_insert on public.request_attachments for insert to authenticated
  with check (
    exists (
      select 1 from public.requests r
      where r.id = request_attachments.request_id and r.client_id = request_attachments.client_id
        and (r.created_by = (select auth.uid()) or (select app.has_permission(r.organization_id, 'requests:triage')))
    )
    and exists (
      select 1 from public.files f
      where f.id = request_attachments.file_id and f.client_id = request_attachments.client_id
        and f.uploaded_by = (select auth.uid()) and f.visibility = 'client' and f.deleted_at is null
    )
  );
create policy request_attachments_delete on public.request_attachments for delete to authenticated
  using (exists (
    select 1 from public.requests r
    where r.id = request_attachments.request_id and r.created_by = (select auth.uid()) and r.status in ('draft', 'needs_info')
  ));

-- Live status on the request pages (RLS decides who receives which row).
alter publication supabase_realtime add table public.requests;

-- ---------------------------------------------------------------------------
-- Function privileges (new functions)
-- ---------------------------------------------------------------------------

revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
revoke all on function app.bootstrap_organization(uuid) from public, anon, authenticated;
revoke all on function app.request_sync_usage(uuid) from public, anon, authenticated;
revoke all on function app.request_submit_fields(public.requests) from public, anon, authenticated;
