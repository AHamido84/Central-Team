-- Feedback Round 7 (ADR-096): the Executive / Board and Executive Viewer roles and the Executive Intelligence Center.
-- Read-only by construction: the roles hold every read permission and no write permission, and every write policy in
-- the schema requires a write permission (tests/db/rls-executive.test.ts checks each operational table).

-- Permissions ---------------------------------------------------------------------------------------------------------
insert into public.permissions (key, resource, action, side, module, sort_order, label) values
  ('executive:view',     'executive', 'view',     'agency', 'executive', 300, '{"ar":"مركز المعلومات التنفيذي","en":"Executive Intelligence Center"}'),
  ('executive:export',   'executive', 'export',   'agency', 'executive', 301, '{"ar":"تصدير تقارير مجلس الإدارة","en":"Export board reports"}'),
  ('executive:schedule', 'executive', 'schedule', 'agency', 'executive', 302, '{"ar":"جدولة تقارير مجلس الإدارة والأهداف","en":"Schedule board reports and set targets"}')
on conflict (key) do nothing;

-- Roles ---------------------------------------------------------------------------------------------------------------
create or replace function app.executive_role_grants(p_role_key text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_role_key
    when 'executive_board' then array['organization:read', 'users:read', 'invitations:read', 'roles:read', 'departments:read', 'design_system:view',
    'clients:read_all', 'requests:read', 'tasks:read', 'time:read_all', 'campaigns:read', 'operations:read',
    'leads:read', 'deals:read', 'capacity:read', 'integrations:read', 'automations:read', 'ai:use', 'audit_log:read',
      'executive:view', 'executive:export', 'executive:schedule']
    -- A lighter seat for other board members: the Center and the reads, no exports, schedules or audit log.
    when 'executive_viewer' then array['organization:read', 'users:read', 'invitations:read', 'roles:read', 'departments:read', 'design_system:view',
    'clients:read_all', 'requests:read', 'tasks:read', 'time:read_all', 'campaigns:read', 'operations:read',
    'leads:read', 'deals:read', 'capacity:read', 'integrations:read', 'automations:read', 'ai:use', 'executive:view']
    -- Super Admins hold every agency permission.
    when 'super_admin' then array['executive:view', 'executive:export', 'executive:schedule']
    else array[]::text[]
  end;
$$;

create or replace function app.seed_executive_roles(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.roles (organization_id, key, name, description, side, is_system, is_locked, sort_order) values
    (p_org, 'executive_board', '{"ar":"رئيس مجلس الإدارة / الإدارة العليا","en":"Executive / Board"}',
      '{"ar":"يطّلع على كل شيء كتقارير وإحصاءات، دون تعديل البيانات التشغيلية","en":"Sees everything as reports and statistics, without changing operational data"}',
      'agency', true, false, 11),
    (p_org, 'executive_viewer', '{"ar":"عضو مجلس الإدارة (اطلاع)","en":"Executive Viewer"}',
      '{"ar":"اطلاع على مركز المعلومات التنفيذي دون تصدير أو جدولة","en":"Views the Executive Center without exports or schedules"}',
      'agency', true, false, 12)
  on conflict (organization_id, key) do nothing;
  insert into public.role_permissions (role_id, permission_key, organization_id)
  select r.id, k, r.organization_id
  from public.roles r
  cross join lateral unnest(app.executive_role_grants(r.key)) k
  where r.is_system and r.organization_id = p_org
  on conflict do nothing;
end $$;

select app.seed_executive_roles(id) from public.organizations;

-- New organizations: the previous bootstrap plus the executive roles.
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
    ('client_viewer',   'client', false, 8, '{"ar":"مشاهد","en":"Client Viewer"}'::jsonb,                     '{"ar":"اطلاع فقط","en":"Read-only access"}'::jsonb),
    ('sales_manager',   'agency', false, 9, '{"ar":"مدير المبيعات","en":"Sales Manager"}'::jsonb,            '{"ar":"يقود فريق المبيعات ويحوّل الصفقات الرابحة إلى عملاء","en":"Leads sales and turns won deals into clients"}'::jsonb),
    ('sales_rep',       'agency', false, 10, '{"ar":"مندوب مبيعات","en":"Sales Rep"}'::jsonb,                '{"ar":"يتابع العملاء المحتملين وصفقاته","en":"Works their own leads and deals"}'::jsonb)
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
      'campaigns:read', 'campaigns:manage', 'metrics:manage', 'reports:manage', 'operations:read',
      'leads:read', 'deals:read', 'capacity:read']),
    ('team_lead', array[
      'organization:read', 'users:read', 'departments:read', 'design_system:view',
      'clients:read_all', 'files:upload', 'files:manage', 'messages:send',
      'requests:read', 'requests:update', 'requests:triage',
      'tasks:read', 'tasks:create', 'tasks:update', 'tasks:delete', 'workflows:manage',
      'deliverables:manage', 'deliverables:review', 'time:read_all',
      'campaigns:read', 'campaigns:manage', 'metrics:manage', 'reports:manage', 'operations:read',
      'capacity:read', 'capacity:manage']),
    ('specialist', array[
      'organization:read', 'users:read', 'departments:read',
      'clients:read_assigned', 'files:upload', 'messages:send',
      'requests:read', 'requests:update',
      'tasks:read', 'tasks:create', 'tasks:update', 'deliverables:manage',
      'campaigns:read', 'metrics:manage']),
    ('sales_manager', app.phase6_role_grants('sales_manager')),
    ('sales_rep', app.phase6_role_grants('sales_rep')),
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
    (p_org, 'media_buying',       '{"ar":"شراء الوسائط","en":"Media Buying"}',              'emerald', 'megaphone', 5),
    (p_org, 'sales',              '{"ar":"المبيعات","en":"Sales"}',                          'sky',     'handshake', 6)
  on conflict (organization_id, key) do nothing;

  perform app.seed_task_statuses(p_org);
  perform app.seed_crm_defaults(p_org);
  perform app.seed_phase7_grants(p_org);
  perform app.seed_phase8_defaults(p_org);
  perform app.seed_fr1_grants(p_org);
  -- Feedback Round 7: the Executive / Board and Executive Viewer roles.
  perform app.seed_executive_roles(p_org);
end $$;

-- Who is an executive (FR7): the Center, its tables and the few reads that were tied to a manage right.
create or replace function app.is_executive(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_agency_member(p_org) and app.has_permission(p_org, 'executive:view');
$$;
grant execute on function app.is_executive(uuid) to authenticated, service_role;

-- AI spend against the monthly budget is part of the risk register.
create policy ai_usage_select_executive on public.ai_usage for select to authenticated
  using ((select app.is_executive(organization_id)));

-- Executive tables -----------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['kpi_targets', 'kpi_snapshots', 'executive_views', 'executive_notes', 'executive_schedules'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
  foreach t in array array['kpi_targets', 'executive_views', 'executive_schedules'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t);
  end loop;
  foreach t in array array['kpi_targets', 'executive_schedules', 'executive_notes'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function app.audit_trigger()', t);
  end loop;
end $$;

-- Targets: read by executives and admins; set by whoever schedules board reports, or manages the organization.
create policy kpi_targets_select on public.kpi_targets for select to authenticated
  using ((select app.is_executive(organization_id)) or (select app.has_permission(organization_id, 'organization:update')));
create policy kpi_targets_write on public.kpi_targets for all to authenticated
  using ((select app.has_permission(organization_id, 'executive:schedule')) or (select app.has_permission(organization_id, 'organization:update')))
  with check ((select app.has_permission(organization_id, 'executive:schedule')) or (select app.has_permission(organization_id, 'organization:update')));

-- Snapshots: written only by the snapshot job (service path); executives read them.
create policy kpi_snapshots_select on public.kpi_snapshots for select to authenticated
  using ((select app.is_executive(organization_id)));

-- Saved views: private to their owner.
create policy executive_views_own on public.executive_views for all to authenticated
  using (user_id = (select auth.uid()) and (select app.is_executive(organization_id)))
  with check (user_id = (select auth.uid()) and (select app.is_executive(organization_id)));

-- Notes: executives read them all; the person a note is addressed to reads it and marks it resolved.
create policy executive_notes_select on public.executive_notes for select to authenticated
  using ((select app.is_executive(organization_id)) or owner_id = (select auth.uid()));
create policy executive_notes_insert on public.executive_notes for insert to authenticated
  with check (author_id = (select auth.uid()) and (select app.is_executive(organization_id)));
create policy executive_notes_update on public.executive_notes for update to authenticated
  using (author_id = (select auth.uid()) or owner_id = (select auth.uid()))
  with check (author_id = (select auth.uid()) or owner_id = (select auth.uid()));
create policy executive_notes_delete on public.executive_notes for delete to authenticated
  using (author_id = (select auth.uid()));

-- Schedules: whoever may schedule board reports.
create policy executive_schedules_all on public.executive_schedules for all to authenticated
  using ((select app.has_permission(organization_id, 'executive:schedule')))
  with check ((select app.has_permission(organization_id, 'executive:schedule')));

-- Board report files (scheduled PDFs, attachments): private; written and signed by the server only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('exports', 'exports', false, 52428800, array['application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

-- Audit of executive sign-ins and exports (FR7): written as the caller, only for executives, one row per event.
create or replace function app.log_executive_event(p_action text, p_details jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  if p_action not in ('executive_login', 'executive_export', 'executive_schedule_sent') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  select m.organization_id into v_org from public.organization_members m
    where m.user_id = auth.uid() and m.user_type = 'agency' and m.status = 'active' and m.deleted_at is null
    order by m.created_at limit 1;
  if v_org is null or not app.has_permission(v_org, 'executive:view') then
    return;
  end if;
  insert into public.activity_log (organization_id, actor_id, action, table_name, record_id, before, after, changed_fields)
  values (v_org, auth.uid(), p_action, 'executive', auth.uid()::text, null, coalesce(p_details, '{}'), null);
end $$;
revoke all on function app.log_executive_event(text, jsonb) from public, anon;
grant execute on function app.log_executive_event(text, jsonb) to authenticated, service_role;
