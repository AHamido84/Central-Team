-- ============================================================================
-- Phase 2 — Requests: permissions, feature flag, lifecycle triggers, RLS.
-- Tables come from the drizzle-kit migration 20260928201141_requests.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Permission catalog + grants for existing organizations
-- ---------------------------------------------------------------------------

insert into public.permissions (key, resource, action, side, module, sort_order, label) values
  ('requests:read',           'requests',      'read',       'agency', 'requests',      140, '{"ar":"عرض طلبات العملاء","en":"View client requests"}'),
  ('requests:update',         'requests',      'update',     'agency', 'requests',      141, '{"ar":"تحديث حالة الطلبات المسندة","en":"Update status of assigned requests"}'),
  ('requests:triage',         'requests',      'triage',     'agency', 'requests',      142, '{"ar":"فرز الطلبات وإسنادها وتحديد أولويتها","en":"Triage, assign and prioritize requests"}'),
  ('request_forms:manage',    'request_forms', 'manage',     'agency', 'requests',      143, '{"ar":"إدارة نماذج الطلبات","en":"Manage request forms"}'),
  ('portal_requests:create',  'portal_requests','create',    'client', 'requests',      250, '{"ar":"تقديم الطلبات وإلغاؤها","en":"Submit and cancel requests"}');

insert into public.role_permissions (role_id, permission_key, organization_id)
select r.id, k, r.organization_id
from public.roles r
cross join lateral unnest(case r.key
  when 'super_admin'     then array['requests:read', 'requests:update', 'requests:triage', 'request_forms:manage']
  when 'admin'           then array['requests:read', 'requests:update', 'requests:triage', 'request_forms:manage']
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

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Agency transitions (keep identical to `agencyTransitions` in src/modules/requests/constants.ts).
create or replace function app.request_transition_allowed(p_from text, p_to text, p_side text)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when p_side = 'client' then p_to = 'cancelled' and p_from in ('submitted', 'in_review', 'waiting_client')
    else (p_from, p_to) in (values
      ('submitted', 'in_review'), ('submitted', 'in_progress'), ('submitted', 'declined'),
      ('in_review', 'in_progress'), ('in_review', 'waiting_client'), ('in_review', 'declined'),
      ('in_progress', 'waiting_client'), ('in_progress', 'completed'), ('in_progress', 'in_review'),
      ('waiting_client', 'in_progress'), ('waiting_client', 'completed'), ('waiting_client', 'declined'),
      ('completed', 'in_progress'), ('declined', 'in_review'), ('cancelled', 'in_review'))
  end;
$$;

-- SLA groundwork: adds `p_hours` hours counted on working days only (Friday and Saturday in the
-- organization's time zone don't count). Phase 5 replaces this with per-client SLA policies and calendars.
create or replace function app.sla_due(p_start timestamptz, p_hours integer, p_tz text)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  v timestamptz := p_start;
  v_left integer := p_hours;
begin
  if p_hours is null or p_start is null then
    return null;
  end if;
  while v_left > 0 loop
    if extract(isodow from v at time zone coalesce(p_tz, 'Asia/Riyadh')) not in (5, 6) then
      v_left := v_left - 1;
    end if;
    v := v + interval '1 hour';
  end loop;
  return v;
end $$;

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
-- Forms & versions
-- ---------------------------------------------------------------------------

create or replace function app.tg_request_forms_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.organization_id <> old.organization_id or new.key <> old.key) then
    raise exception 'form_immutable_fields' using errcode = '42501';
  end if;
  if new.current_version_id is not null and not exists (
    select 1 from public.request_form_versions v
    where v.id = new.current_version_id and v.form_id = new.id and v.published_at is not null
  ) then
    raise exception 'invalid_form_version' using errcode = '22023';
  end if;
  if new.status = 'published' and new.current_version_id is null then
    raise exception 'form_not_published' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger request_forms_guard
before insert or update on public.request_forms
for each row execute function app.tg_request_forms_guard();

-- Published versions are frozen: requests keep rendering with the questions they answered.
create or replace function app.tg_request_form_versions_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.published_at is not null then
      raise exception 'form_version_published' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.request_forms f where f.id = new.form_id and f.organization_id = new.organization_id) then
      raise exception 'organization_mismatch' using errcode = '22023';
    end if;
    -- Users create drafts; publishing is an explicit update.
    if auth.uid() is not null then
      new.published_at := null;
      new.published_by := null;
    end if;
    return new;
  end if;
  if old.published_at is not null then
    raise exception 'form_version_published' using errcode = '42501';
  end if;
  if new.form_id <> old.form_id or new.version <> old.version or new.organization_id <> old.organization_id then
    raise exception 'form_immutable_fields' using errcode = '42501';
  end if;
  if new.published_at is not null and auth.uid() is not null then
    new.published_at := now();
    new.published_by := auth.uid();
  end if;
  return new;
end $$;

create trigger request_form_versions_guard
before insert or update or delete on public.request_form_versions
for each row execute function app.tg_request_form_versions_guard();

-- ---------------------------------------------------------------------------
-- Requests lifecycle
-- ---------------------------------------------------------------------------

create or replace function app.tg_requests_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_form public.request_forms;
  v_version public.request_form_versions;
  v_uid uuid := auth.uid();
  v_tz text;
begin
  select * into v_form from public.request_forms where id = new.form_id;
  select * into v_version from public.request_form_versions where id = new.form_version_id;
  if v_form.id is null or v_version.id is null or v_version.form_id <> v_form.id
    or v_form.organization_id <> new.organization_id then
    raise exception 'invalid_form' using errcode = '22023';
  end if;

  if v_uid is not null then
    -- Users submit against the form's current published version; lifecycle fields are server-owned.
    if v_form.status <> 'published' or v_form.current_version_id is distinct from v_version.id then
      raise exception 'form_not_published' using errcode = '22023';
    end if;
    new.submitted_by := v_uid;
    new.submitted_side := case when app.is_agency_member(new.organization_id) then 'agency' else 'client' end;
    new.status := 'submitted';
    new.created_at := now();
    new.last_activity_at := now();
    new.first_response_at := null;
    new.resolved_at := null;
    new.cancelled_at := null;
    new.response_due_at := null;
    new.resolution_due_at := null;
    if new.submitted_side = 'client' then
      new.assignee_id := null;
      if new.priority not in ('normal', 'high') then
        raise exception 'request_field_restricted' using errcode = '42501';
      end if;
    end if;
  end if;

  if new.assignee_id is not null and not exists (
    select 1 from public.organization_members m
    where m.organization_id = new.organization_id and m.user_id = new.assignee_id
      and m.user_type = 'agency' and m.status = 'active'
  ) then
    raise exception 'invalid_assignee' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('requests:' || new.organization_id::text));
  select coalesce(max(r.number), 0) + 1 into new.number from public.requests r where r.organization_id = new.organization_id;

  select o.default_timezone into v_tz from public.organizations o where o.id = new.organization_id;
  new.response_due_at := coalesce(new.response_due_at, app.sla_due(new.created_at, v_form.response_sla_hours, v_tz));
  new.resolution_due_at := coalesce(new.resolution_due_at, app.sla_due(new.created_at, v_form.resolution_sla_hours, v_tz));
  return new;
end $$;

create trigger requests_before_insert
before insert on public.requests
for each row execute function app.tg_requests_before_insert();

create or replace function app.tg_requests_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  -- Nested inside another trigger (e.g. a comment in the request thread) = a system change.
  v_system boolean := pg_trigger_depth() > 1 or auth.uid() is null;
  v_agency boolean;
  v_server_owned text[] := array['status', 'updated_at', 'last_activity_at', 'cancelled_at', 'resolved_at', 'first_response_at'];
begin
  if new.organization_id <> old.organization_id or new.client_id <> old.client_id or new.number <> old.number
    or new.form_id <> old.form_id or new.form_version_id <> old.form_version_id
    or new.submitted_by is distinct from old.submitted_by or new.submitted_side <> old.submitted_side
    or new.created_at <> old.created_at or new.answers <> old.answers then
    raise exception 'request_immutable_fields' using errcode = '42501';
  end if;

  if not v_system then
    v_agency := app.is_agency_member(old.organization_id);
    if not v_agency then
      -- Client users can only cancel.
      if (to_jsonb(new) - v_server_owned) <> (to_jsonb(old) - v_server_owned) then
        raise exception 'request_field_restricted' using errcode = '42501';
      end if;
      if new.status <> old.status and not app.request_transition_allowed(old.status, new.status, 'client') then
        raise exception 'invalid_transition' using errcode = '22023';
      end if;
    else
      if (new.priority <> old.priority or new.assignee_id is distinct from old.assignee_id
          or new.title <> old.title or new.desired_date is distinct from old.desired_date)
        and not app.has_permission(old.organization_id, 'requests:triage') then
        raise exception 'request_field_restricted' using errcode = '42501';
      end if;
      if new.status <> old.status and not app.request_transition_allowed(old.status, new.status, 'agency') then
        raise exception 'invalid_transition' using errcode = '22023';
      end if;
    end if;
    -- SLA and lifecycle timestamps are derived, never written by users.
    new.response_due_at := old.response_due_at;
    new.resolution_due_at := old.resolution_due_at;
    new.first_response_at := old.first_response_at;
    new.resolved_at := old.resolved_at;
    new.cancelled_at := old.cancelled_at;
    new.last_activity_at := now();
    if v_agency and new.status <> old.status then
      new.first_response_at := coalesce(old.first_response_at, now());
    end if;
  end if;

  if new.status <> old.status then
    new.resolved_at := case when new.status in ('completed', 'declined') then now() end;
    new.cancelled_at := case when new.status = 'cancelled' then now() end;
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

-- History rows + the request's conversation thread.
create or replace function app.tg_requests_after()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_system boolean := pg_trigger_depth() > 1 or auth.uid() is null;
  v_side text;
  v_actor uuid;
begin
  if tg_op = 'INSERT' then
    insert into public.request_events (organization_id, client_id, request_id, actor_id, actor_side, type, to_value, visibility, created_at)
    values (new.organization_id, new.client_id, new.id, new.submitted_by, new.submitted_side, 'submitted', 'submitted', 'client', new.created_at);
    insert into public.threads (organization_id, client_id, subject_type, subject_id, title, visibility, created_by, last_comment_at, created_at)
    values (new.organization_id, new.client_id, 'request', new.id, new.title, 'client', new.submitted_by, new.created_at, new.created_at);
    return new;
  end if;

  v_side := case when v_system then 'system' when app.is_agency_member(new.organization_id) then 'agency' else 'client' end;
  v_actor := case when v_system then null else auth.uid() end;
  if new.status <> old.status then
    insert into public.request_events (organization_id, client_id, request_id, actor_id, actor_side, type, from_value, to_value, visibility)
    values (new.organization_id, new.client_id, new.id, v_actor, v_side, 'status_changed', old.status, new.status, 'client');
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    insert into public.request_events (organization_id, client_id, request_id, actor_id, actor_side, type, from_value, to_value, visibility)
    values (new.organization_id, new.client_id, new.id, v_actor, v_side, 'assigned', old.assignee_id::text, new.assignee_id::text, 'internal');
  end if;
  if new.priority <> old.priority then
    insert into public.request_events (organization_id, client_id, request_id, actor_id, actor_side, type, from_value, to_value, visibility)
    values (new.organization_id, new.client_id, new.id, v_actor, v_side, 'priority_changed', old.priority, new.priority, 'internal');
  end if;
  if new.title <> old.title then
    update public.threads set title = new.title where subject_type = 'request' and subject_id = new.id;
  end if;
  return new;
end $$;

create trigger requests_after
after insert or update on public.requests
for each row execute function app.tg_requests_after();

-- A comment in a request thread is request activity: bumps last activity, counts as the first response when
-- it's a client-visible agency reply, and a client reply to "waiting on you" puts the request back in progress.
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
      else r.first_response_at end,
    status = case when new.author_side = 'client' and r.status = 'waiting_client' then 'in_progress' else r.status end
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
  foreach t in array array['request_forms', 'request_form_versions', 'requests'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t);
  end loop;
  foreach t in array array['request_forms', 'request_form_versions', 'requests', 'request_attachments'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function app.audit_trigger()', t);
  end loop;
  foreach t in array array['requests', 'request_events', 'request_attachments'] loop
    execute format('create trigger enforce_client_org before insert or update on public.%I for each row execute function app.tg_enforce_client_org()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['request_forms', 'request_form_versions', 'requests', 'request_events', 'request_attachments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

revoke insert, update, delete on public.request_events from authenticated;
revoke update, delete on public.request_attachments from authenticated;
revoke delete on public.requests from authenticated;

create policy request_forms_select on public.request_forms for select to authenticated
  using (
    (select app.is_agency_member(organization_id))
    or (status = 'published' and (select app.is_org_member(organization_id))
      and (select app.feature_enabled(organization_id, 'module.requests')))
  );
create policy request_forms_insert on public.request_forms for insert to authenticated
  with check ((select app.has_permission(organization_id, 'request_forms:manage')));
create policy request_forms_update on public.request_forms for update to authenticated
  using ((select app.has_permission(organization_id, 'request_forms:manage')))
  with check ((select app.has_permission(organization_id, 'request_forms:manage')));
create policy request_forms_delete on public.request_forms for delete to authenticated
  using ((select app.has_permission(organization_id, 'request_forms:manage')));

create policy request_form_versions_select on public.request_form_versions for select to authenticated
  using (
    (select app.is_agency_member(organization_id))
    or (published_at is not null and (select app.is_org_member(organization_id)))
  );
create policy request_form_versions_insert on public.request_form_versions for insert to authenticated
  with check ((select app.has_permission(organization_id, 'request_forms:manage')));
create policy request_form_versions_update on public.request_form_versions for update to authenticated
  using ((select app.has_permission(organization_id, 'request_forms:manage')))
  with check ((select app.has_permission(organization_id, 'request_forms:manage')));
create policy request_form_versions_delete on public.request_form_versions for delete to authenticated
  using ((select app.has_permission(organization_id, 'request_forms:manage')));

create policy requests_select on public.requests for select to authenticated
  using (
    (select app.agency_can_read_requests(client_id))
    or ((select app.is_client_member(client_id)) and (select app.feature_enabled(organization_id, 'module.requests')))
  );
create policy requests_insert on public.requests for insert to authenticated
  with check (
    submitted_by = (select auth.uid()) and (
      ((select app.has_permission(organization_id, 'requests:triage')) and (select app.agency_can_access_client(client_id)))
      or ((select app.has_client_permission(client_id, 'portal_requests:create'))
        and (select app.feature_enabled(organization_id, 'module.requests')))
    )
  );
create policy requests_update on public.requests for update to authenticated
  using (
    ((select app.agency_can_access_client(client_id)) and (
      (select app.has_permission(organization_id, 'requests:triage'))
      or ((select app.has_permission(organization_id, 'requests:update')) and assignee_id = (select auth.uid()))
    ))
    or (select app.has_client_permission(client_id, 'portal_requests:create'))
  )
  with check (
    ((select app.agency_can_access_client(client_id)) and (
      (select app.has_permission(organization_id, 'requests:triage'))
      or ((select app.has_permission(organization_id, 'requests:update')) and assignee_id = (select auth.uid()))
    ))
    or (select app.has_client_permission(client_id, 'portal_requests:create'))
  );

create policy request_events_select on public.request_events for select to authenticated
  using (
    (select app.agency_can_read_requests(client_id))
    or (visibility = 'client' and (select app.is_client_member(client_id))
      and exists (select 1 from public.requests r where r.id = request_events.request_id))
  );

create policy request_attachments_select on public.request_attachments for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_attachments.request_id));
create policy request_attachments_insert on public.request_attachments for insert to authenticated
  with check (
    exists (
      select 1 from public.requests r
      where r.id = request_attachments.request_id and r.client_id = request_attachments.client_id
        and (r.submitted_by = (select auth.uid()) or (select app.has_permission(r.organization_id, 'requests:triage')))
    )
    and exists (
      select 1 from public.files f
      where f.id = request_attachments.file_id and f.client_id = request_attachments.client_id
        and f.uploaded_by = (select auth.uid()) and f.visibility = 'client' and f.deleted_at is null
    )
  );

-- Live status on the request pages (RLS decides who receives which row).
alter publication supabase_realtime add table public.requests;

-- ---------------------------------------------------------------------------
-- Function privileges (new functions)
-- ---------------------------------------------------------------------------

revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
revoke all on function app.bootstrap_organization(uuid) from public, anon, authenticated;
