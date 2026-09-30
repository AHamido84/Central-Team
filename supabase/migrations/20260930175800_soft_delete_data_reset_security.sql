-- ============================================================================
-- Feedback Round 1 — soft delete, Trash, data reset (ADR-080/081).
-- Columns and tables come from the drizzle-kit migration 20260930174832_soft_delete_data_reset.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Permissions: <resource>:delete (to Trash) and <resource>:purge (permanent)
-- ---------------------------------------------------------------------------

insert into public.permissions (key, resource, action, side, module, sort_order, label) values
  ('clients:delete',        'clients',       'delete', 'agency', 'clients',   260, '{"ar":"حذف العملاء (إلى سلة المحذوفات)","en":"Delete clients (to Trash)"}'),
  ('clients:purge',         'clients',       'purge',  'agency', 'clients',   261, '{"ar":"حذف العملاء نهائيًا","en":"Permanently delete clients"}'),
  ('client_users:delete',   'client_users',  'delete', 'agency', 'clients',   262, '{"ar":"إزالة مستخدمي البوابة","en":"Remove portal users"}'),
  ('client_users:purge',    'client_users',  'purge',  'agency', 'clients',   263, '{"ar":"حذف مستخدمي البوابة نهائيًا","en":"Permanently delete portal users"}'),
  ('users:delete',          'users',         'delete', 'agency', 'identity',  264, '{"ar":"إزالة أعضاء الفريق","en":"Remove team members"}'),
  ('users:purge',           'users',         'purge',  'agency', 'identity',  265, '{"ar":"حذف أعضاء الفريق نهائيًا","en":"Permanently delete team members"}'),
  ('packages:delete',       'packages',      'delete', 'agency', 'clients',   266, '{"ar":"حذف الباقات","en":"Delete packages"}'),
  ('packages:purge',        'packages',      'purge',  'agency', 'clients',   267, '{"ar":"حذف الباقات نهائيًا","en":"Permanently delete packages"}'),
  ('request_types:delete',  'request_types', 'delete', 'agency', 'requests',  268, '{"ar":"حذف أنواع الطلبات","en":"Delete request types"}'),
  ('request_types:purge',   'request_types', 'purge',  'agency', 'requests',  269, '{"ar":"حذف أنواع الطلبات نهائيًا","en":"Permanently delete request types"}'),
  ('workflows:delete',      'workflows',     'delete', 'agency', 'tasks',     270, '{"ar":"حذف قوالب سير العمل","en":"Delete workflow templates"}'),
  ('workflows:purge',       'workflows',     'purge',  'agency', 'tasks',     271, '{"ar":"حذف قوالب سير العمل نهائيًا","en":"Permanently delete workflow templates"}'),
  ('requests:delete',       'requests',      'delete', 'agency', 'requests',  272, '{"ar":"حذف الطلبات","en":"Delete requests"}'),
  ('requests:purge',        'requests',      'purge',  'agency', 'requests',  273, '{"ar":"حذف الطلبات نهائيًا","en":"Permanently delete requests"}'),
  ('tasks:purge',           'tasks',         'purge',  'agency', 'tasks',     274, '{"ar":"حذف المهام نهائيًا","en":"Permanently delete tasks"}'),
  ('files:delete',          'files',         'delete', 'agency', 'files',     275, '{"ar":"حذف الملفات والمجلدات","en":"Delete files and folders"}'),
  ('files:purge',           'files',         'purge',  'agency', 'files',     276, '{"ar":"حذف الملفات نهائيًا","en":"Permanently delete files"}'),
  ('deliverables:delete',   'deliverables',  'delete', 'agency', 'tasks',     277, '{"ar":"حذف التسليمات والإصدارات","en":"Delete deliverables and versions"}'),
  ('deliverables:purge',    'deliverables',  'purge',  'agency', 'tasks',     278, '{"ar":"حذف التسليمات نهائيًا","en":"Permanently delete deliverables"}'),
  ('messages:delete',       'messages',      'delete', 'agency', 'messaging', 279, '{"ar":"حذف رسائل الآخرين","en":"Delete other people''s messages"}'),
  ('messages:purge',        'messages',      'purge',  'agency', 'messaging', 280, '{"ar":"حذف الرسائل نهائيًا","en":"Permanently delete messages"}');

-- Everyone else keeps what they had; Specialists get nothing new (they can still remove their own comments and
-- uploads — an ownership rule below, never other people's work).
create or replace function app.fr1_role_grants(p_role_key text)
returns text[] language sql immutable set search_path = '' as $$
  select case
    when p_role_key in ('super_admin', 'admin') then array[
      'clients:delete', 'clients:purge', 'client_users:delete', 'client_users:purge', 'users:delete', 'users:purge',
      'packages:delete', 'packages:purge', 'request_types:delete', 'request_types:purge', 'workflows:delete',
      'workflows:purge', 'requests:delete', 'requests:purge', 'tasks:purge', 'files:delete', 'files:purge',
      'deliverables:delete', 'deliverables:purge', 'messages:delete', 'messages:purge']
    when p_role_key = 'account_manager' then array['client_users:delete', 'requests:delete', 'files:delete', 'deliverables:delete', 'messages:delete']
    when p_role_key = 'team_lead' then array['requests:delete', 'files:delete', 'deliverables:delete', 'messages:delete']
    else array[]::text[]
  end;
$$;

create or replace function app.seed_fr1_grants(p_org uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.role_permissions (role_id, permission_key, organization_id)
  select r.id, k, r.organization_id
  from public.roles r
  cross join lateral unnest(app.fr1_role_grants(r.key)) k
  where r.is_system and r.organization_id = p_org
  on conflict do nothing;
$$;

select app.seed_fr1_grants(id) from public.organizations;

-- New organizations: the Phase 8 bootstrap plus the Feedback Round 1 grants.
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
end $$;
-- ---------------------------------------------------------------------------
-- Visibility: deleted rows are hidden by a RESTRICTIVE policy (ANDed with every existing SELECT policy), except in
-- Trash mode — a transaction-local setting the Trash screen turns on — for people who may delete that kind of row.
-- ---------------------------------------------------------------------------

-- Set (transaction-local) while a purge or a data reset deletes rows for good: guard triggers that protect live data
-- (published reports, workflow step assignees, capacity members) stand aside for rows that are being wiped.
create or replace function app.purging()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(current_setting('app.purging', true), '') = 'on'
$$;
grant execute on function app.purging() to authenticated, service_role;

create or replace function app.trash_mode()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(current_setting('app.trash_mode', true), '') = 'on';
$$;

create or replace function app.in_trash_view(p_org uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.trash_mode() and app.is_agency_member(p_org) and app.has_permission(p_org, p_perm);
$$;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('clients', 'clients:delete'), ('client_users', 'client_users:delete'), ('organization_members', 'users:delete'),
    ('packages', 'packages:delete'), ('request_types', 'request_types:delete'), ('workflow_templates', 'workflows:delete'),
    ('requests', 'requests:delete'), ('tasks', 'tasks:delete'), ('file_folders', 'files:delete'), ('files', 'files:delete'),
    ('deliverables', 'deliverables:delete'), ('deliverable_versions', 'deliverables:delete'), ('comments', 'messages:delete'),
    ('threads', 'messages:delete')
  ) as t(tbl, perm)
  loop
    execute format(
      'create policy %I on public.%I as restrictive for select to authenticated using (deleted_at is null or app.in_trash_view(organization_id, %L))',
      r.tbl || '_not_deleted', r.tbl, r.perm);
    -- Deleted rows are frozen for users: only restore (a security definer function) brings them back.
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated using (deleted_at is null)',
      r.tbl || '_not_deleted_update', r.tbl);
    execute format('create index if not exists %I on public.%I (delete_batch) where delete_batch is not null', r.tbl || '_delete_batch_idx', r.tbl);
  end loop;
end $$;

-- A deleted client takes all its data out of sight at once: every client-scoped policy goes through these.
create or replace function app.agency_can_access_client(p_client uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clients c
    where c.id = p_client and (c.deleted_at is null or app.trash_mode()) and app.is_agency_member(c.organization_id) and (
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

create or replace function app.is_client_member(p_client uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.client_users cu
    join public.organization_members m
      on m.organization_id = cu.organization_id and m.user_id = cu.user_id
    join public.clients c on c.id = cu.client_id
    where cu.client_id = p_client and cu.user_id = auth.uid()
      and cu.status = 'active' and cu.deleted_at is null and m.status = 'active' and m.deleted_at is null
      and m.user_type = 'client' and c.deleted_at is null
  );
$$;

-- Readers that bypass RLS skip deleted rows too.
create or replace function app.capacity_tasks(p_org uuid)
returns table (task_id uuid, client_id uuid, department_id uuid, estimate_minutes integer, start_date date, due_date date, assignee_ids uuid[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_permission(p_org, 'capacity:read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select t.id, t.client_id, t.department_id, t.estimate_minutes, t.start_date, t.due_date,
      coalesce((select array_agg(m.user_id) from public.task_members m where m.task_id = t.id and m.role = 'assignee'), '{}'::uuid[])
    from public.tasks t
    join public.clients c on c.id = t.client_id and c.deleted_at is null
    where t.organization_id = p_org and t.status_category <> 'done' and t.deleted_at is null
      and t.estimate_minutes is not null and t.estimate_minutes > 0 and t.due_date is not null;
end;
$$;

create or replace function app.request_progress(p_request uuid)
returns table (step_order integer, name jsonb, state text, due_date date)
language sql stable security definer set search_path = '' as $$
  select t.step_order, s.name,
    case
      when t.status_category = 'done' then 'done'
      when exists (
        select 1 from public.task_dependencies dep join public.tasks b on b.id = dep.depends_on_id
        where dep.task_id = t.id and b.status_category <> 'done' and b.deleted_at is null
      ) then 'pending'
      when t.status_category = 'todo' then 'pending'
      when t.status_category = 'review' then 'review'
      else 'active'
    end,
    t.due_date
  from public.tasks t
  join public.workflow_template_steps s on s.id = t.workflow_step_id
  join public.requests r on r.id = t.request_id
  where t.request_id = p_request and t.parent_id is null and t.deleted_at is null
    and (app.is_client_member(r.client_id) or app.agency_can_read_requests(r.client_id))
  order by t.step_order;
$$;

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
      where r.client_id = p_client and t.package_item_type = p_item and not r.is_extra and r.deleted_at is null
        and r.status in ('submitted', 'under_review', 'needs_info') and r.id is distinct from p_exclude)
  from cp;
$$;

create or replace function app.audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_row jsonb;
  v_org uuid;
  v_changed text[];
begin
  -- A data reset (ADR-081) writes one summary entry instead of one per removed row.
  if coalesce(current_setting('app.audit_skip', true), '') = 'on' then
    return coalesce(new, old);
  end if;
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

-- ---------------------------------------------------------------------------
-- Trash (ADR-080): one entry point per operation, permission-checked in the database.
--   app.trash_impact(type, id)            → what a delete would take with it, and what blocks it
--   app.trash_delete(type, id, reassign)  → soft-deletes the row and its children as one batch
--   app.trash_restore(batch)              → brings the batch back
--   app.trash_purge(batch)                → deletes it for good; returns Storage paths for the caller to remove
-- ---------------------------------------------------------------------------

create or replace function app.trash_resource(p_type text)
returns text language sql immutable set search_path = '' as $$
  select case p_type
    when 'client' then 'clients' when 'client_user' then 'client_users' when 'member' then 'users'
    when 'package' then 'packages' when 'request_type' then 'request_types' when 'workflow_template' then 'workflows'
    when 'request' then 'requests' when 'task' then 'tasks' when 'folder' then 'files' when 'file' then 'files'
    when 'deliverable' then 'deliverables' when 'deliverable_version' then 'deliverables' when 'comment' then 'messages'
  end;
$$;

-- The row behind a Trash target, deleted or not: organization, client, display title and owner (for "your own").
create or replace function app.trash_target(p_type text, p_id uuid)
returns table (org uuid, client uuid, title text, owner uuid, is_deleted boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  case p_type
    when 'client' then
      return query select c.organization_id, c.id, coalesce(nullif(c.name ->> 'ar', ''), c.name ->> 'en'), null::uuid, c.deleted_at is not null
        from public.clients c where c.id = p_id;
    when 'client_user' then
      return query select cu.organization_id, cu.client_id, coalesce(nullif(p.full_name, ''), p.email), null::uuid, cu.deleted_at is not null
        from public.client_users cu join public.profiles p on p.id = cu.user_id where cu.id = p_id;
    when 'member' then
      return query select m.organization_id, null::uuid, coalesce(nullif(p.full_name, ''), p.email), null::uuid, m.deleted_at is not null
        from public.organization_members m join public.profiles p on p.id = m.user_id where m.id = p_id and m.user_type = 'agency';
    when 'package' then
      return query select x.organization_id, null::uuid, coalesce(nullif(x.name ->> 'ar', ''), x.name ->> 'en'), null::uuid, x.deleted_at is not null
        from public.packages x where x.id = p_id;
    when 'request_type' then
      return query select x.organization_id, null::uuid, coalesce(nullif(x.name ->> 'ar', ''), x.name ->> 'en'), null::uuid, x.deleted_at is not null
        from public.request_types x where x.id = p_id;
    when 'workflow_template' then
      return query select x.organization_id, null::uuid, coalesce(nullif(x.name ->> 'ar', ''), x.name ->> 'en'), null::uuid, x.deleted_at is not null
        from public.workflow_templates x where x.id = p_id;
    when 'request' then
      return query select x.organization_id, x.client_id, concat_ws(' · ', x.reference, x.title), x.created_by, x.deleted_at is not null
        from public.requests x where x.id = p_id and x.status <> 'draft';
    when 'task' then
      return query select x.organization_id, x.client_id, x.title, x.created_by, x.deleted_at is not null from public.tasks x where x.id = p_id;
    when 'folder' then
      return query select x.organization_id, x.client_id, x.name, x.created_by, x.deleted_at is not null from public.file_folders x where x.id = p_id;
    when 'file' then
      return query select x.organization_id, x.client_id, x.name, x.uploaded_by, x.deleted_at is not null from public.files x where x.id = p_id;
    when 'deliverable' then
      return query select x.organization_id, x.client_id, x.title, x.created_by, x.deleted_at is not null from public.deliverables x where x.id = p_id;
    when 'deliverable_version' then
      return query select v.organization_id, v.client_id, d.title || ' · v' || v.number, v.uploaded_by, v.deleted_at is not null
        from public.deliverable_versions v join public.deliverables d on d.id = v.deliverable_id where v.id = p_id;
    when 'comment' then
      return query select x.organization_id, x.client_id, left(regexp_replace(x.body, '\s+', ' ', 'g'), 80), x.author_id, x.deleted_at is not null
        from public.comments x where x.id = p_id;
    else
      return;
  end case;
end $$;

-- May the caller delete (or purge) this row? Permission + client access; your own comment or upload is always yours.
create or replace function app.trash_can(p_type text, p_id uuid, p_action text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  t record;
begin
  select * into t from app.trash_target(p_type, p_id);
  if t.org is null then
    return false;
  end if;
  if p_action = 'delete' and p_type in ('comment', 'file') and t.owner = auth.uid() then
    return (t.client is null or app.can_access_client(t.client))
      and (p_type = 'comment' or app.has_permission(t.org, 'files:upload'));
  end if;
  return app.is_agency_member(t.org)
    and app.has_permission(t.org, app.trash_resource(p_type) || ':' || p_action)
    and (t.client is null or app.agency_can_access_client(t.client));
end $$;

-- Rows of a delete: the root and the children that go with it (ids per table).
create or replace function app.trash_scope(p_type text, p_id uuid)
returns table (tbl text, ids uuid[]) language plpgsql stable security definer set search_path = '' as $$
declare
  v_tasks uuid[] := '{}';
  v_requests uuid[] := '{}';
  v_deliverables uuid[] := '{}';
  v_versions uuid[] := '{}';
  v_files uuid[] := '{}';
  v_folders uuid[] := '{}';
  v_threads uuid[] := '{}';
begin
  case p_type
    when 'request' then
      v_requests := array[p_id];
      select coalesce(array_agg(id), '{}') into v_tasks from public.tasks where request_id = p_id and deleted_at is null;
    when 'task' then
      with recursive tree as (
        select id from public.tasks where id = p_id
        union all select c.id from public.tasks c join tree on c.parent_id = tree.id where c.deleted_at is null
      ) select coalesce(array_agg(id), '{}') into v_tasks from tree;
    when 'folder' then
      with recursive tree as (
        select id from public.file_folders where id = p_id
        union all select c.id from public.file_folders c join tree on c.parent_id = tree.id where c.deleted_at is null
      ) select coalesce(array_agg(id), '{}') into v_folders from tree;
      select coalesce(array_agg(id), '{}') into v_files from public.files where folder_id = any(v_folders) and deleted_at is null;
    when 'file' then
      v_files := array[p_id];
    when 'deliverable' then
      v_deliverables := array[p_id];
    when 'deliverable_version' then
      v_versions := array[p_id];
      select coalesce(array_agg(vf.file_id), '{}') into v_files
        from public.deliverable_version_files vf join public.files f on f.id = vf.file_id
        where vf.version_id = p_id and f.deleted_at is null;
    else
      null;
  end case;
  if p_type in ('request', 'task') then
    select coalesce(array_agg(id), '{}') into v_deliverables from public.deliverables
      where deleted_at is null and (task_id = any(v_tasks) or request_id = any(v_requests));
    select coalesce(array_agg(id), '{}') into v_threads from public.threads
      where deleted_at is null and ((subject_type = 'task' and subject_id = any(v_tasks)) or (subject_type = 'request' and subject_id = any(v_requests)));
    -- Files uploaded as attachments of this request / these tasks go with them (library files stay).
    select coalesce(array_agg(distinct f.id), '{}') into v_files from public.files f
      where f.deleted_at is null and f.source = 'attachment' and (
        exists (select 1 from public.request_attachments ra where ra.file_id = f.id and ra.request_id = any(v_requests))
        or exists (select 1 from public.task_attachments ta where ta.file_id = f.id and ta.task_id = any(v_tasks)));
  end if;
  if cardinality(v_deliverables) > 0 then
    select coalesce(array_agg(id), '{}') into v_versions from public.deliverable_versions
      where deliverable_id = any(v_deliverables) and deleted_at is null;
    select v_files || coalesce(array_agg(vf.file_id), '{}') into v_files
      from public.deliverable_version_files vf join public.files f on f.id = vf.file_id
      where vf.version_id = any(v_versions) and f.deleted_at is null;
  end if;
  return query values ('requests', v_requests), ('tasks', v_tasks), ('deliverables', v_deliverables),
    ('deliverable_versions', v_versions), ('files', v_files), ('file_folders', v_folders), ('threads', v_threads);
end $$;

-- What would a delete take with it, what blocks it, and (for a team member) what open work needs a new owner.
create or replace function app.trash_impact(p_type text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t record;
  v_counts jsonb := '{}';
  v_blockers jsonb := '{}';
  v_work jsonb := '{}';
  v_user uuid;
  r record;
  n integer;
begin
  select * into t from app.trash_target(p_type, p_id);
  if t.org is null or t.is_deleted then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not app.trash_can(p_type, p_id, 'delete') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  case p_type
    when 'client' then
      v_counts := jsonb_build_object(
        'requests', (select count(*) from public.requests where client_id = p_id and deleted_at is null and status <> 'draft'),
        'tasks', (select count(*) from public.tasks where client_id = p_id and deleted_at is null),
        'deliverables', (select count(*) from public.deliverables where client_id = p_id and deleted_at is null),
        'files', (select count(*) from public.files where client_id = p_id and deleted_at is null),
        'campaigns', (select count(*) from public.campaigns where client_id = p_id),
        'reports', (select count(*) from public.reports where client_id = p_id),
        'portal_users', (select count(*) from public.client_users where client_id = p_id and deleted_at is null),
        'messages', (select count(*) from public.comments where client_id = p_id and deleted_at is null));
    when 'member' then
      select m.user_id into v_user from public.organization_members m where m.id = p_id;
      if v_user = auth.uid() then
        v_blockers := v_blockers || '{"self": 1}';
      end if;
      if exists (select 1 from public.user_roles ur join public.roles ro on ro.id = ur.role_id
                 where ur.user_id = v_user and ur.organization_id = t.org and ro.key = 'super_admin')
         and (select count(*) from public.user_roles ur join public.roles ro on ro.id = ur.role_id
              join public.organization_members m on m.user_id = ur.user_id and m.organization_id = ur.organization_id
              where ur.organization_id = t.org and ro.key = 'super_admin' and m.status = 'active' and m.deleted_at is null) <= 1 then
        v_blockers := v_blockers || '{"last_super_admin": 1}';
      end if;
      v_work := jsonb_build_object(
        'tasks', (select count(distinct tm.task_id) from public.task_members tm join public.tasks x on x.id = tm.task_id
                  where tm.user_id = v_user and tm.role = 'assignee' and x.status_category <> 'done' and x.deleted_at is null and x.organization_id = t.org),
        'requests', (select count(*) from public.requests x where x.assignee_id = v_user and x.organization_id = t.org and x.deleted_at is null
                     and x.status not in ('closed', 'rejected', 'cancelled', 'delivered', 'draft')),
        'clients', (select count(*) from public.clients x where x.account_manager_id = v_user and x.organization_id = t.org and x.deleted_at is null),
        'leads', (select count(*) from public.leads x where x.owner_id = v_user and x.organization_id = t.org and x.status in ('new', 'contacted', 'qualified')),
        'deals', (select count(*) from public.deals x where x.owner_id = v_user and x.organization_id = t.org and x.status = 'open'));
    when 'package' then
      select count(*) into n from public.client_packages cp join public.clients c on c.id = cp.client_id
        where cp.package_id = p_id and cp.period_end >= current_date and c.deleted_at is null;
      if n > 0 then v_blockers := jsonb_build_object('client_packages', n); end if;
    when 'request_type' then
      select count(*) into n from public.requests where request_type_id = p_id and deleted_at is null;
      if n > 0 then v_blockers := jsonb_build_object('requests', n); end if;
    when 'workflow_template' then
      select count(*) into n from public.tasks where workflow_template_id = p_id and deleted_at is null and status_category <> 'done';
      if n > 0 then v_blockers := jsonb_build_object('tasks', n); end if;
      if exists (select 1 from public.crm_settings s where s.onboarding_template_id = p_id) then
        v_blockers := v_blockers || '{"crm_settings": 1}';
      end if;
    when 'deliverable_version' then
      if exists (select 1 from public.deliverable_versions v where v.id = p_id and (v.sent_to_client_at is not null or v.status = 'approved')) then
        v_blockers := '{"sent_to_client": 1}';
      end if;
    when 'client_user', 'file', 'comment' then
      null;
    else
      for r in select * from app.trash_scope(p_type, p_id) loop
        n := coalesce(cardinality(r.ids), 0);
        if r.tbl = 'tasks' and p_type = 'task' then n := n - 1; end if;
        if r.tbl = 'file_folders' and p_type = 'folder' then n := n - 1; end if;
        if r.tbl in ('requests') or (r.tbl = 'deliverables' and p_type = 'deliverable') or n <= 0 then continue; end if;
        v_counts := v_counts || jsonb_build_object(case r.tbl when 'tasks' then case when p_type = 'task' then 'subtasks' else 'tasks' end
          when 'file_folders' then 'folders' when 'deliverable_versions' then 'versions' when 'threads' then 'threads' else r.tbl end, n);
      end loop;
      if p_type = 'deliverable' then
        v_counts := v_counts || jsonb_build_object('versions', (select count(*) from public.deliverable_versions where deliverable_id = p_id and deleted_at is null));
      end if;
  end case;
  -- Empty categories aren't news.
  select coalesce(jsonb_object_agg(key, value), '{}') into v_counts from jsonb_each(v_counts) where (value #>> '{}')::int > 0;
  select coalesce(jsonb_object_agg(key, value), '{}') into v_work from jsonb_each(v_work) where (value #>> '{}')::int > 0;
  return jsonb_build_object('title', t.title, 'counts', v_counts, 'blockers', v_blockers, 'openWork', v_work);
end $$;

create or replace function app.trash_delete(p_type text, p_id uuid, p_reassign_to uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  t record;
  v_batch uuid := gen_random_uuid();
  v_uid uuid := auth.uid();
  v_impact jsonb;
  v_meta jsonb := '{}';
  v_user uuid;
  r record;
begin
  select * into t from app.trash_target(p_type, p_id);
  if t.org is null or t.is_deleted then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not app.trash_can(p_type, p_id, 'delete') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_impact := app.trash_impact(p_type, p_id);
  if v_impact -> 'blockers' <> '{}'::jsonb then
    raise exception 'in_use' using errcode = '22023', detail = (v_impact -> 'blockers')::text;
  end if;

  case p_type
    when 'client' then
      update public.clients set deleted_at = now(), deleted_by = v_uid, delete_batch = v_batch where id = p_id;
    when 'client_user' then
      select user_id, jsonb_build_object('status', status) into v_user, v_meta from public.client_users where id = p_id;
      update public.client_users set deleted_at = now(), deleted_by = v_uid, delete_batch = v_batch, status = 'deactivated' where id = p_id;
      -- Their portal membership goes too when this was their last company here.
      if not exists (select 1 from public.client_users where user_id = v_user and organization_id = t.org and deleted_at is null) then
        v_meta := v_meta || jsonb_build_object('membership_status',
          (select status from public.organization_members where user_id = v_user and organization_id = t.org and user_type = 'client'));
        update public.organization_members set deleted_at = now(), deleted_by = v_uid, delete_batch = v_batch, status = 'deactivated'
          where user_id = v_user and organization_id = t.org and user_type = 'client' and deleted_at is null;
      end if;
    when 'member' then
      select user_id, jsonb_build_object('status', status) into v_user, v_meta from public.organization_members where id = p_id;
      if v_impact -> 'openWork' <> '{}'::jsonb then
        if p_reassign_to is null then
          raise exception 'reassign_required' using errcode = '22023';
        end if;
        if p_reassign_to = v_user or not exists (
          select 1 from public.organization_members m where m.user_id = p_reassign_to and m.organization_id = t.org
            and m.user_type = 'agency' and m.status = 'active' and m.deleted_at is null) then
          raise exception 'invalid_assignee' using errcode = '22023';
        end if;
        -- Open tasks: hand over the assignment (skipping tasks the new owner already has).
        delete from public.task_members tm using public.tasks x
          where tm.task_id = x.id and tm.user_id = v_user and tm.role = 'assignee' and x.status_category <> 'done'
            and x.organization_id = t.org
            and exists (select 1 from public.task_members o where o.task_id = tm.task_id and o.user_id = p_reassign_to and o.role = 'assignee');
        update public.task_members tm set user_id = p_reassign_to from public.tasks x
          where tm.task_id = x.id and tm.user_id = v_user and tm.role = 'assignee' and x.status_category <> 'done' and x.organization_id = t.org;
        update public.requests set assignee_id = p_reassign_to where assignee_id = v_user and organization_id = t.org
          and status not in ('closed', 'rejected', 'cancelled', 'delivered', 'draft');
        update public.clients set account_manager_id = p_reassign_to where account_manager_id = v_user and organization_id = t.org;
        update public.leads set owner_id = p_reassign_to where owner_id = v_user and organization_id = t.org and status in ('new', 'contacted', 'qualified');
        update public.deals set owner_id = p_reassign_to where owner_id = v_user and organization_id = t.org and status = 'open';
        v_meta := v_meta || jsonb_build_object('reassigned_to', p_reassign_to, 'reassigned', v_impact -> 'openWork');
      end if;
      update public.organization_members set deleted_at = now(), deleted_by = v_uid, delete_batch = v_batch, status = 'deactivated' where id = p_id;
    when 'package' then
      update public.packages set deleted_at = now(), deleted_by = v_uid, delete_batch = v_batch where id = p_id;
    when 'request_type' then
      update public.request_types set deleted_at = now(), deleted_by = v_uid, delete_batch = v_batch where id = p_id;
    when 'workflow_template' then
      update public.workflow_templates set deleted_at = now(), deleted_by = v_uid, delete_batch = v_batch where id = p_id;
    when 'comment' then
      update public.comments set deleted_at = now(), deleted_by = v_uid, delete_batch = v_batch where id = p_id;
    else
      -- request, task, folder, file, deliverable, deliverable_version: the root and its children.
      for r in select * from app.trash_scope(p_type, p_id) loop
        if coalesce(cardinality(r.ids), 0) > 0 then
          execute format('update public.%I set deleted_at = now(), deleted_by = $1, delete_batch = $2 where id = any($3) and deleted_at is null', r.tbl)
            using v_uid, v_batch, r.ids;
        end if;
      end loop;
      if p_type = 'deliverable' then
        update public.deliverables set deleted_at = now(), deleted_by = v_uid, delete_batch = v_batch where id = p_id and deleted_at is null;
      end if;
  end case;

  insert into public.trash_items (batch, organization_id, entity_type, entity_id, title, client_id, counts, meta, deleted_by)
  values (v_batch, t.org, p_type, p_id, coalesce(t.title, ''), case when p_type = 'client' then p_id else t.client end,
    coalesce(v_impact -> 'counts', '{}'), v_meta, v_uid);
  return v_batch;
end $$;

create or replace function app.trash_restore(p_batch uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  i public.trash_items;
  v_tbl text;
begin
  select * into i from public.trash_items where batch = p_batch;
  if i.batch is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform set_config('app.trash_mode', 'on', true);
  if not app.trash_can(i.entity_type, i.entity_id, 'delete') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- A child can't come back into a parent that is itself in the Trash.
  if i.entity_type <> 'client' and i.client_id is not null
     and exists (select 1 from public.clients c where c.id = i.client_id and c.deleted_at is not null) then
    raise exception 'parent_deleted' using errcode = '22023';
  end if;
  if i.entity_type = 'task' and exists (
      select 1 from public.tasks x left join public.tasks p on p.id = x.parent_id left join public.requests rq on rq.id = x.request_id
      where x.id = i.entity_id and (p.deleted_at is not null or rq.deleted_at is not null)) then
    raise exception 'parent_deleted' using errcode = '22023';
  end if;
  if i.entity_type in ('deliverable', 'deliverable_version') and exists (
      select 1 from public.deliverable_versions v join public.deliverables d on d.id = v.deliverable_id
      where v.id = i.entity_id and d.deleted_at is not null) then
    raise exception 'parent_deleted' using errcode = '22023';
  end if;
  foreach v_tbl in array array['clients', 'client_users', 'organization_members', 'packages', 'request_types', 'workflow_templates',
    'requests', 'tasks', 'file_folders', 'files', 'deliverables', 'deliverable_versions', 'comments', 'threads'] loop
    execute format('update public.%I set deleted_at = null, deleted_by = null, delete_batch = null where delete_batch = $1', v_tbl) using p_batch;
  end loop;
  -- Files whose folder stayed in the Trash land at the top level instead of disappearing.
  update public.files f set folder_id = null
    where f.folder_id is not null and f.id in (select id from public.files where client_id = i.client_id)
      and exists (select 1 from public.file_folders ff where ff.id = f.folder_id and ff.deleted_at is not null);
  if i.entity_type = 'client_user' then
    update public.client_users set status = coalesce(i.meta ->> 'status', 'active') where id = i.entity_id;
    if i.meta ? 'membership_status' then
      update public.organization_members m set status = coalesce(i.meta ->> 'membership_status', 'active')
        from public.client_users cu where cu.id = i.entity_id and m.user_id = cu.user_id and m.organization_id = i.organization_id and m.user_type = 'client';
    end if;
  elsif i.entity_type = 'member' then
    update public.organization_members set status = coalesce(i.meta ->> 'status', 'active') where id = i.entity_id;
  end if;
  delete from public.trash_items where batch = p_batch;
  return jsonb_build_object('entityType', i.entity_type, 'entityId', i.entity_id, 'clientId', i.client_id);
end $$;

-- Permanent delete. Returns the Storage paths of removed files (the caller removes the objects after commit).
create or replace function app.trash_purge(p_batch uuid)
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  i public.trash_items;
  v_paths text[];
  v_user uuid;
begin
  select * into i from public.trash_items where batch = p_batch;
  if i.batch is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform set_config('app.trash_mode', 'on', true);
  perform set_config('app.purging', 'on', true);
  if not app.trash_can(i.entity_type, i.entity_id, 'purge') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(array_agg(p), '{}') into v_paths from (
    select storage_path as p from public.files
      where delete_batch = p_batch or (i.entity_type = 'client' and client_id = i.entity_id)
    union all
    select thumbnail_path from public.files
      where thumbnail_path is not null and (delete_batch = p_batch or (i.entity_type = 'client' and client_id = i.entity_id))
  ) s where p is not null;

  case i.entity_type
    when 'client' then
      delete from public.clients where id = i.entity_id;
    when 'client_user', 'member' then
      select user_id into v_user from public.client_users where id = i.entity_id and i.entity_type = 'client_user';
      if i.entity_type = 'member' then
        select user_id into v_user from public.organization_members where id = i.entity_id;
      end if;
      delete from public.client_users where delete_batch = p_batch;
      delete from public.organization_members where delete_batch = p_batch;
      -- The login goes when nothing else holds it.
      if not exists (select 1 from public.organization_members where user_id = v_user)
         and not exists (select 1 from public.client_users where user_id = v_user) then
        delete from auth.users where id = v_user;
      end if;
    when 'package' then
      if exists (select 1 from public.client_packages where package_id = i.entity_id) then
        raise exception 'in_use' using errcode = '22023';
      end if;
      delete from public.packages where id = i.entity_id;
    when 'request_type' then
      if exists (select 1 from public.requests where request_type_id = i.entity_id) then
        raise exception 'in_use' using errcode = '22023';
      end if;
      delete from public.request_types where id = i.entity_id;
    when 'workflow_template' then
      delete from public.workflow_templates where id = i.entity_id;
    else
      delete from public.comments where delete_batch = p_batch;
      delete from public.threads where delete_batch = p_batch;
      delete from public.deliverable_versions where delete_batch = p_batch;
      delete from public.deliverables where delete_batch = p_batch;
      delete from public.files where delete_batch = p_batch;
      delete from public.file_folders where delete_batch = p_batch;
      delete from public.tasks where delete_batch = p_batch;
      delete from public.requests where delete_batch = p_batch;
  end case;
  delete from public.trash_items where batch = p_batch;
  return v_paths;
end $$;

revoke all on function app.trash_delete(text, uuid, uuid), app.trash_restore(uuid), app.trash_purge(uuid), app.trash_impact(text, uuid) from public, anon;
grant execute on function app.trash_delete(text, uuid, uuid), app.trash_restore(uuid), app.trash_purge(uuid), app.trash_impact(text, uuid) to authenticated, service_role;

-- Trash list: an entry is visible to whoever may delete that kind of row (and can reach its client).
alter table public.trash_items enable row level security;
revoke all on public.trash_items from anon;
revoke insert, update, delete on public.trash_items from authenticated;
create policy trash_items_select on public.trash_items for select to authenticated
  using (
    (select app.is_agency_member(organization_id))
    and app.has_permission(organization_id, app.trash_resource(entity_type) || ':delete')
    and (client_id is null or app.trash_mode() and app.agency_can_access_client(client_id))
  );

-- ---------------------------------------------------------------------------
-- Demo data and data reset (ADR-081)
-- ---------------------------------------------------------------------------

-- Tables whose rows are "roots" of demo data; everything client-scoped goes with its client.
create or replace function app.demo_root_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['clients', 'packages', 'request_types', 'workflow_templates', 'leads', 'deals', 'lead_forms',
    'lead_assignment_rules', 'crm_webhook_tokens', 'sales_targets', 'sla_policies', 'holidays', 'automations',
    'integration_connections'];
$$;

-- Marks everything that exists in an organization as demo data (the seed calls it; so does this migration for the
-- demo agency, whose data is all seeded or test data today).
create or replace function app.mark_demo_data(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  foreach t in array app.demo_root_tables() loop
    execute format('update public.%I set is_demo = true where organization_id = $1 and not is_demo', t) using p_org;
  end loop;
  update public.profiles set is_demo = true
    where not is_demo and id in (select user_id from public.organization_members where organization_id = p_org);
end $$;

do $$
begin
  if exists (select 1 from public.organizations where id = '00000000-0000-4000-8000-000000000001' and slug = 'ofoq') then
    perform app.mark_demo_data('00000000-0000-4000-8000-000000000001');
  end if;
end $$;

-- Users a reset removes (their login goes too unless they belong elsewhere). Never the person running it.
create or replace function app.data_reset_users(p_org uuid, p_mode text, p_keep uuid)
returns table (user_id uuid) language sql stable security definer set search_path = '' as $$
  select m.user_id from public.organization_members m join public.profiles p on p.id = m.user_id
  where m.organization_id = p_org and m.user_id <> p_keep and (
    (p_mode = 'demo' and p.is_demo)
    or (p_mode = 'operational' and m.user_type = 'client')
    or p_mode = 'factory'
  );
$$;

-- What each reset option would remove, per category (the screen's checklist).
create or replace function app.data_reset_preview(p_org uuid, p_mode text, p_keep uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_demo boolean := p_mode = 'demo';
  v_clients uuid[];
begin
  if not app.is_super_admin(p_org) and app.is_user_write() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(array_agg(id), '{}') into v_clients from public.clients where organization_id = p_org and (not v_demo or is_demo);
  return jsonb_strip_nulls(jsonb_build_object(
    'clients', cardinality(v_clients),
    'users', (select count(*) from app.data_reset_users(p_org, p_mode, p_keep)),
    'requests', (select count(*) from public.requests where client_id = any(v_clients)),
    'tasks', (select count(*) from public.tasks where client_id = any(v_clients)),
    'deliverables', (select count(*) from public.deliverables where client_id = any(v_clients)),
    'files', (select count(*) from public.files where client_id = any(v_clients)),
    'messages', (select count(*) from public.comments where client_id = any(v_clients)),
    'campaigns', (select count(*) from public.campaigns where client_id = any(v_clients)),
    'time_entries', (select count(*) from public.time_entries where client_id = any(v_clients)),
    'leads', (select count(*) from public.leads where organization_id = p_org and (not v_demo or is_demo)),
    'deals', (select count(*) from public.deals where organization_id = p_org and (not v_demo or is_demo)),
    'notifications', case when v_demo then null else (select count(*) from public.notifications where organization_id = p_org) end,
    'activity', case when v_demo then null else (select count(*) from public.activity_log where organization_id = p_org) end,
    'packages', case when p_mode = 'operational' then null else (select count(*) from public.packages where organization_id = p_org and (not v_demo or is_demo)) end,
    'request_types', case when p_mode = 'operational' then null else (select count(*) from public.request_types where organization_id = p_org and (not v_demo or is_demo)) end,
    'workflow_templates', case when p_mode = 'operational' then null else (select count(*) from public.workflow_templates where organization_id = p_org and (not v_demo or is_demo)) end,
    'automations', case when p_mode = 'operational' then null else (select count(*) from public.automations where organization_id = p_org and (not v_demo or is_demo)) end,
    'integrations', case when p_mode = 'operational' then null else (select count(*) from public.integration_connections where organization_id = p_org and (not v_demo or is_demo)) end,
    'sla_policies', case when p_mode = 'operational' then null else (select count(*) from public.sla_policies where organization_id = p_org and (not v_demo or is_demo)) end,
    'roles', case when p_mode = 'factory' then (select count(*) from public.roles where organization_id = p_org) end,
    'departments', case when p_mode = 'factory' then (select count(*) from public.departments where organization_id = p_org) end
  ));
end $$;

-- Storage objects a reset leaves behind (bucket, path) — collected before the rows go.
create or replace function app.data_reset_paths(p_org uuid, p_mode text)
returns table (bucket text, path text) language sql stable security definer set search_path = '' as $$
  select 'client-files', p from public.files f cross join lateral (values (f.storage_path), (f.thumbnail_path)) v(p)
    where f.organization_id = p_org and p is not null
      and (p_mode <> 'demo' or f.client_id in (select id from public.clients where organization_id = p_org and is_demo))
  union all
  select 'crm-files', cf.storage_path from public.crm_files cf
    where cf.organization_id = p_org
      and (p_mode <> 'demo' or cf.deal_id in (select id from public.deals where organization_id = p_org and is_demo));
$$;

-- The wipe itself, in one transaction. Service path only (the server action checks the Super Admin, password and
-- phrase first); per-row audit is skipped and one summary entry is written afterwards by the caller.
create or replace function app.data_reset_run(p_org uuid, p_mode text, p_keep uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_counts jsonb;
  v_users uuid[];
  t text;
  v_left text[];
  v_pass integer := 0;
  v_role uuid;
begin
  if app.is_user_write() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_mode not in ('demo', 'operational', 'factory') then
    raise exception 'invalid_mode' using errcode = '22023';
  end if;
  if exists (select 1 from public.organizations where id = p_org and data_reset_locked_at is not null) then
    raise exception 'reset_locked' using errcode = '22023';
  end if;
  v_counts := app.data_reset_preview(p_org, p_mode, p_keep);
  select coalesce(array_agg(user_id), '{}') into v_users from app.data_reset_users(p_org, p_mode, p_keep);
  perform set_config('app.audit_skip', 'on', true);
  perform set_config('app.purging', 'on', true);

  if p_mode = 'demo' then
    delete from public.clients where organization_id = p_org and is_demo;
    delete from public.deals where organization_id = p_org and is_demo;
    delete from public.leads where organization_id = p_org and is_demo;
    foreach t in array array['lead_forms', 'lead_assignment_rules', 'crm_webhook_tokens', 'sales_targets', 'sla_policies',
      'holidays', 'automations', 'integration_connections', 'workflow_templates'] loop
      execute format('delete from public.%I where organization_id = $1 and is_demo', t) using p_org;
    end loop;
    -- Configuration still used by real records stays.
    delete from public.packages p where p.organization_id = p_org and p.is_demo
      and not exists (select 1 from public.client_packages cp where cp.package_id = p.id);
    delete from public.request_types r where r.organization_id = p_org and r.is_demo
      and not exists (select 1 from public.requests q where q.request_type_id = r.id);
  elsif p_mode = 'operational' then
    delete from public.clients where organization_id = p_org;
    delete from public.deals where organization_id = p_org;
    delete from public.leads where organization_id = p_org;
    foreach t in array array['notifications', 'domain_events', 'whatsapp_messages', 'integration_sync_runs',
      'integration_webhook_events', 'ai_conversations', 'ai_chunks', 'trash_items', 'crm_files'] loop
      execute format('delete from public.%I where organization_id = $1', t) using p_org;
    end loop;
  else
    -- Factory: every organization-scoped row except the kept person's membership, in as many passes as foreign keys
    -- need; then the organization is bootstrapped again like a new one.
    select coalesce(array_agg(c.table_name::text), '{}') into v_left
      from information_schema.columns c join information_schema.tables tb
        on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.column_name = 'organization_id'
        and c.table_name not in ('organizations', 'data_reset_jobs', 'activity_log', 'organization_members');
    while cardinality(v_left) > 0 and v_pass < 10 loop
      v_pass := v_pass + 1;
      foreach t in array v_left loop
        begin
          execute format('delete from public.%I where organization_id = $1', t) using p_org;
          v_left := array_remove(v_left, t);
        exception when foreign_key_violation then
          null;
        end;
      end loop;
    end loop;
    if cardinality(v_left) > 0 then
      raise exception 'reset_incomplete: %', array_to_string(v_left, ', ') using errcode = '23503';
    end if;
    delete from public.organization_members where organization_id = p_org and user_id <> p_keep;
    perform app.bootstrap_organization(p_org);
    select id into v_role from public.roles where organization_id = p_org and key = 'super_admin';
    insert into public.user_roles (organization_id, user_id, role_id) values (p_org, p_keep, v_role) on conflict do nothing;
  end if;

  -- People: their memberships here, and their login when nothing else holds it.
  delete from public.organization_members where organization_id = p_org and user_id = any(v_users);
  delete from auth.users u where u.id = any(v_users)
    and not exists (select 1 from public.organization_members m where m.user_id = u.id);
  if p_mode <> 'demo' then
    delete from public.activity_log where organization_id = p_org;
  end if;
  return v_counts;
end $$;

revoke all on function app.data_reset_run(uuid, text, uuid), app.data_reset_preview(uuid, text, uuid), app.data_reset_paths(uuid, text),
  app.mark_demo_data(uuid), app.data_reset_users(uuid, text, uuid) from public, anon, authenticated;
grant execute on function app.data_reset_run(uuid, text, uuid), app.data_reset_preview(uuid, text, uuid), app.data_reset_paths(uuid, text),
  app.mark_demo_data(uuid), app.data_reset_users(uuid, text, uuid) to service_role;

alter table public.data_reset_jobs enable row level security;
revoke all on public.data_reset_jobs from anon;
revoke insert, update, delete on public.data_reset_jobs from authenticated;
create policy data_reset_jobs_select on public.data_reset_jobs for select to authenticated
  using ((select app.is_super_admin(organization_id)));

-- Guard triggers skip rows that a purge or data reset is wiping (app.purging(), see above).
drop trigger report_sections_before on public.report_sections;
CREATE TRIGGER report_sections_before BEFORE INSERT OR DELETE OR UPDATE ON public.report_sections FOR EACH ROW WHEN (NOT app.purging()) EXECUTE FUNCTION app.tg_report_sections_before();

drop trigger member_capacity_guard on public.member_capacity;
CREATE TRIGGER member_capacity_guard BEFORE INSERT OR UPDATE ON public.member_capacity FOR EACH ROW WHEN (NOT app.purging()) EXECUTE FUNCTION app.tg_capacity_member_guard();

drop trigger time_off_guard on public.time_off;
CREATE TRIGGER time_off_guard BEFORE INSERT OR UPDATE ON public.time_off FOR EACH ROW WHEN (NOT app.purging()) EXECUTE FUNCTION app.tg_capacity_member_guard();

drop trigger workflow_template_steps_scope on public.workflow_template_steps;
CREATE TRIGGER workflow_template_steps_scope BEFORE INSERT OR UPDATE ON public.workflow_template_steps FOR EACH ROW WHEN (NOT app.purging()) EXECUTE FUNCTION app.tg_workflow_template_steps_scope();
drop trigger comments_integrity on public.comments;

CREATE TRIGGER comments_integrity BEFORE INSERT OR UPDATE ON public.comments FOR EACH ROW WHEN (NOT app.purging()) EXECUTE FUNCTION app.tg_comments_integrity();

drop trigger requests_before_update on public.requests;

CREATE TRIGGER requests_before_update BEFORE UPDATE ON public.requests FOR EACH ROW WHEN (NOT app.purging()) EXECUTE FUNCTION app.tg_requests_before_update();

drop trigger annotations_before on public.annotations;

CREATE TRIGGER annotations_before BEFORE INSERT OR UPDATE ON public.annotations FOR EACH ROW WHEN (NOT app.purging()) EXECUTE FUNCTION app.tg_annotations_before();

drop trigger deliverables_before on public.deliverables;

CREATE TRIGGER deliverables_before BEFORE INSERT OR UPDATE ON public.deliverables FOR EACH ROW WHEN (NOT app.purging()) EXECUTE FUNCTION app.tg_deliverables_before();

drop trigger tasks_before on public.tasks;

CREATE TRIGGER tasks_before BEFORE INSERT OR UPDATE ON public.tasks FOR EACH ROW WHEN (NOT app.purging()) EXECUTE FUNCTION app.tg_tasks_before();

drop trigger campaigns_before on public.campaigns;

CREATE TRIGGER campaigns_before BEFORE INSERT OR UPDATE ON public.campaigns FOR EACH ROW WHEN (NOT app.purging()) EXECUTE FUNCTION app.tg_campaigns_before();

drop trigger reports_before on public.reports;

CREATE TRIGGER reports_before BEFORE INSERT OR UPDATE ON public.reports FOR EACH ROW WHEN (NOT app.purging()) EXECUTE FUNCTION app.tg_reports_before();

drop trigger ai_recommendations_guard on public.ai_recommendations;

CREATE TRIGGER ai_recommendations_guard BEFORE INSERT OR UPDATE ON public.ai_recommendations FOR EACH ROW WHEN (NOT app.purging()) EXECUTE FUNCTION app.tg_ai_recommendations_guard();

drop trigger deliverable_versions_before on public.deliverable_versions;

CREATE TRIGGER deliverable_versions_before BEFORE INSERT OR UPDATE ON public.deliverable_versions FOR EACH ROW WHEN (NOT app.purging()) EXECUTE FUNCTION app.tg_deliverable_versions_before();

drop trigger deals_before on public.deals;

CREATE TRIGGER deals_before BEFORE INSERT OR UPDATE ON public.deals FOR EACH ROW WHEN (NOT app.purging()) EXECUTE FUNCTION app.tg_deals_before();

drop trigger leads_before on public.leads;

CREATE TRIGGER leads_before BEFORE INSERT OR UPDATE ON public.leads FOR EACH ROW WHEN (NOT app.purging()) EXECUTE FUNCTION app.tg_leads_before();

