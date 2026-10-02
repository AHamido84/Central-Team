-- ============================================================================
-- Phase 3 — Tasks, workflows, deliverables & approvals: permissions, statuses, lifecycle triggers, RLS.
-- Tables come from the drizzle-kit migration 20260929042447_tasks_deliverables.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Permission catalog + grants for existing organizations
-- ---------------------------------------------------------------------------

insert into public.permissions (key, resource, action, side, module, sort_order, label) values
  ('tasks:read',           'tasks',        'read',     'agency', 'tasks', 150, '{"ar":"عرض المهام","en":"View tasks"}'),
  ('tasks:create',         'tasks',        'create',   'agency', 'tasks', 151, '{"ar":"إنشاء المهام وتحويل الطلبات إلى مهام","en":"Create tasks and convert requests"}'),
  ('tasks:update',         'tasks',        'update',   'agency', 'tasks', 152, '{"ar":"تحديث المهام","en":"Update tasks"}'),
  ('tasks:delete',         'tasks',        'delete',   'agency', 'tasks', 153, '{"ar":"حذف المهام","en":"Delete tasks"}'),
  ('workflows:manage',     'workflows',    'manage',   'agency', 'tasks', 154, '{"ar":"إدارة مسارات العمل وحالات المهام","en":"Manage workflows and task statuses"}'),
  ('deliverables:manage',  'deliverables', 'manage',   'agency', 'tasks', 155, '{"ar":"رفع التسليمات ونسخها","en":"Upload deliverables and versions"}'),
  ('deliverables:review',  'deliverables', 'review',   'agency', 'tasks', 156, '{"ar":"المراجعة الداخلية للتسليمات","en":"Internal review of deliverables"}'),
  ('time:read_all',        'time',         'read_all', 'agency', 'tasks', 157, '{"ar":"عرض وقت الفريق كله","en":"View everyone''s time"}');

insert into public.role_permissions (role_id, permission_key, organization_id)
select r.id, k, r.organization_id
from public.roles r
cross join lateral unnest(case r.key
  when 'super_admin'     then array['tasks:read', 'tasks:create', 'tasks:update', 'tasks:delete', 'workflows:manage', 'deliverables:manage', 'deliverables:review', 'time:read_all']
  when 'admin'           then array['tasks:read', 'tasks:create', 'tasks:update', 'tasks:delete', 'workflows:manage', 'deliverables:manage', 'deliverables:review', 'time:read_all']
  when 'account_manager' then array['tasks:read', 'tasks:create', 'tasks:update', 'tasks:delete', 'deliverables:manage', 'deliverables:review', 'time:read_all']
  when 'team_lead'       then array['tasks:read', 'tasks:create', 'tasks:update', 'tasks:delete', 'workflows:manage', 'deliverables:manage', 'deliverables:review', 'time:read_all']
  when 'specialist'      then array['tasks:read', 'tasks:create', 'tasks:update', 'deliverables:manage']
  else array[]::text[]
end) k
where r.is_system
on conflict do nothing;

-- The modules ship with this phase.
update public.feature_flags set default_enabled = true, description = '{"ar":"المهام والتسليمات","en":"Tasks & deliverables"}'
where key = 'module.tasks';
update public.feature_flags set default_enabled = true, description = '{"ar":"الاعتمادات","en":"Approvals"}'
where key = 'module.approvals';
update public.feature_flags set default_enabled = true, description = '{"ar":"تقويم المحتوى","en":"Content calendar"}'
where key = 'module.calendar';

-- Finished videos are large: the private bucket accepts up to 2 GB (per-type limits are enforced by the app).
update storage.buckets set file_size_limit = 2147483648 where id = 'client-files';

-- ---------------------------------------------------------------------------
-- Default task statuses (per organization, editable) + bootstrap
-- ---------------------------------------------------------------------------

create or replace function app.seed_task_statuses(p_org uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.task_statuses (organization_id, key, name, category, color, sort_order, is_default) values
    (p_org, 'todo',              '{"ar":"للتنفيذ","en":"To do"}',                  'todo',    'neutral', 1, true),
    (p_org, 'in_progress',       '{"ar":"قيد التنفيذ","en":"In progress"}',        'active',  'info',    2, false),
    (p_org, 'in_review',         '{"ar":"قيد المراجعة","en":"In review"}',         'review',  'accent',  3, false),
    (p_org, 'changes_requested', '{"ar":"مطلوب تعديلات","en":"Changes requested"}', 'changes', 'warning', 4, false),
    (p_org, 'blocked',           '{"ar":"متوقفة","en":"Blocked"}',                 'blocked', 'danger',  5, false),
    (p_org, 'done',              '{"ar":"منجزة","en":"Done"}',                     'done',    'success', 6, false)
  on conflict (organization_id, key) do nothing;
$$;

select app.seed_task_statuses(id) from public.organizations;

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
      'tasks:read', 'tasks:create', 'tasks:update', 'tasks:delete', 'deliverables:manage', 'deliverables:review', 'time:read_all']),
    ('team_lead', array[
      'organization:read', 'users:read', 'departments:read', 'design_system:view',
      'clients:read_all', 'files:upload', 'files:manage', 'messages:send',
      'requests:read', 'requests:update', 'requests:triage',
      'tasks:read', 'tasks:create', 'tasks:update', 'tasks:delete', 'workflows:manage',
      'deliverables:manage', 'deliverables:review', 'time:read_all']),
    ('specialist', array[
      'organization:read', 'users:read', 'departments:read',
      'clients:read_assigned', 'files:upload', 'messages:send',
      'requests:read', 'requests:update',
      'tasks:read', 'tasks:create', 'tasks:update', 'deliverables:manage']),
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
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function app.agency_can_read_tasks(p_client uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clients c
    where c.id = p_client and app.has_permission(c.organization_id, 'tasks:read') and app.agency_can_access_client(c.id)
  );
$$;

create or replace function app.agency_can_task(p_client uuid, p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clients c
    where c.id = p_client and app.has_permission(c.organization_id, p_permission) and app.agency_can_access_client(c.id)
  );
$$;

-- Client users who may approve on behalf of their company (Phase 1 `client_users.can_approve`).
create or replace function app.can_approve_for(p_client uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_client_member(p_client) and exists (
    select 1 from public.client_users cu
    where cu.client_id = p_client and cu.user_id = auth.uid() and cu.status = 'active' and cu.can_approve
  );
$$;

-- The organization's status for a category (first by sort order).
create or replace function app.task_status_for(p_org uuid, p_category text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.task_statuses where organization_id = p_org and category = p_category order by sort_order, created_at limit 1;
$$;

create or replace function app.is_active_agency_user(p_org uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = p_user and m.user_type = 'agency' and m.status = 'active'
  );
$$;

-- ---------------------------------------------------------------------------
-- Task statuses & workflow templates
-- ---------------------------------------------------------------------------

create or replace function app.tg_task_statuses_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.organization_id <> old.organization_id or new.key <> old.key) then
    raise exception 'status_immutable_fields' using errcode = '42501';
  end if;
  -- Category changes re-sync tasks that use the status.
  if tg_op = 'UPDATE' and new.category <> old.category then
    update public.tasks set status_category = new.category where status_id = new.id;
  end if;
  return new;
end $$;

create trigger task_statuses_guard
before insert or update on public.task_statuses
for each row execute function app.tg_task_statuses_guard();

create or replace function app.tg_task_statuses_keep_one_done()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.task_statuses where organization_id = old.organization_id and category = 'done')
    and exists (select 1 from public.organizations where id = old.organization_id) then
    raise exception 'status_done_required' using errcode = '22023';
  end if;
  return null;
end $$;

create constraint trigger task_statuses_keep_one_done
after delete or update on public.task_statuses
deferrable initially deferred
for each row execute function app.tg_task_statuses_keep_one_done();

create or replace function app.tg_workflow_template_steps_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_template public.workflow_templates;
begin
  select * into v_template from public.workflow_templates where id = new.template_id;
  new.organization_id := v_template.organization_id;
  if new.department_id is not null and not exists (
    select 1 from public.departments d where d.id = new.department_id and d.organization_id = new.organization_id
  ) then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  if new.assignee_mode = 'user' and (new.assignee_user_id is null or not app.is_active_agency_user(new.organization_id, new.assignee_user_id)) then
    raise exception 'invalid_assignee' using errcode = '22023';
  end if;
  if new.assignee_mode = 'role' and not exists (
    select 1 from public.roles r where r.id = new.assignee_role_id and r.organization_id = new.organization_id and r.side = 'agency'
  ) then
    raise exception 'invalid_assignee' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger workflow_template_steps_scope
before insert or update on public.workflow_template_steps
for each row execute function app.tg_workflow_template_steps_scope();

-- Dependencies must point at steps of the same template and must not form a cycle. Deferred, because the
-- builder saves the whole step list in one transaction.
create or replace function app.tg_workflow_steps_dependencies()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_template uuid := coalesce(new.template_id, old.template_id);
begin
  if exists (
    select 1 from public.workflow_template_steps s, unnest(s.depends_on) d
    where s.template_id = v_template
      and (d = s.id or not exists (select 1 from public.workflow_template_steps x where x.id = d and x.template_id = v_template))
  ) then
    raise exception 'invalid_dependency' using errcode = '22023';
  end if;
  if exists (
    with recursive walk (origin, step) as (
      select s.id, d from public.workflow_template_steps s, unnest(s.depends_on) d where s.template_id = v_template
      union
      select w.origin, d from walk w join public.workflow_template_steps s on s.id = w.step, unnest(s.depends_on) d
    )
    select 1 from walk where origin = step
  ) then
    raise exception 'dependency_cycle' using errcode = '22023';
  end if;
  return null;
end $$;

create constraint trigger workflow_steps_dependencies
after insert or update or delete on public.workflow_template_steps
deferrable initially deferred
for each row execute function app.tg_workflow_steps_dependencies();

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------

create or replace function app.tg_tasks_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_status public.task_statuses;
  v_system boolean := auth.uid() is null or pg_trigger_depth() > 1;
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('tasks:' || new.organization_id::text));
    select coalesce(max(t.number), 0) + 1 into new.number from public.tasks t where t.organization_id = new.organization_id;
    if not v_system then
      new.created_by := auth.uid();
      new.completed_at := null;
    end if;
    if new.position = 0 then
      new.position := extract(epoch from clock_timestamp());
    end if;
  else
    if new.organization_id <> old.organization_id or new.number <> old.number or new.created_by is distinct from old.created_by
      or new.created_at <> old.created_at then
      raise exception 'task_immutable_fields' using errcode = '42501';
    end if;
    if new.client_id <> old.client_id and (new.request_id is not null or exists (select 1 from public.tasks c where c.parent_id = new.id)) then
      raise exception 'task_immutable_fields' using errcode = '42501';
    end if;
  end if;

  select * into v_status from public.task_statuses where id = new.status_id;
  if v_status.id is null or v_status.organization_id <> new.organization_id then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  new.status_category := v_status.category;
  if new.status_category = 'done' then
    new.completed_at := case when tg_op = 'UPDATE' and old.status_category = 'done' then old.completed_at else coalesce(new.completed_at, now()) end;
  else
    new.completed_at := null;
  end if;
  if tg_op = 'UPDATE' and new.due_date is distinct from old.due_date then
    new.due_soon_notified_for := null;
    new.overdue_notified_for := null;
  end if;

  if new.parent_id is not null and not exists (
    select 1 from public.tasks p where p.id = new.parent_id and p.client_id = new.client_id and p.parent_id is null
  ) then
    raise exception 'invalid_parent' using errcode = '22023';
  end if;
  if new.request_id is not null and not exists (
    select 1 from public.requests r where r.id = new.request_id and r.client_id = new.client_id
  ) then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  if new.department_id is not null and not exists (
    select 1 from public.departments d where d.id = new.department_id and d.organization_id = new.organization_id
  ) then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  if new.reviewer_id is not null and (tg_op = 'INSERT' or new.reviewer_id is distinct from old.reviewer_id)
    and not app.is_active_agency_user(new.organization_id, new.reviewer_id) then
    raise exception 'invalid_assignee' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger tasks_before
before insert or update on public.tasks
for each row execute function app.tg_tasks_before();

-- Child rows take their organization and client from the task, so they can't be attached across clients.
create or replace function app.tg_task_child_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_task public.tasks;
begin
  select * into v_task from public.tasks where id = new.task_id;
  if v_task.id is null then
    raise exception 'not_found' using errcode = '22023';
  end if;
  new.organization_id := v_task.organization_id;
  new.client_id := v_task.client_id;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['task_members', 'task_dependencies', 'task_checklist_items', 'task_attachments', 'time_entries'] loop
    execute format('create trigger task_child_scope before insert or update on public.%I for each row execute function app.tg_task_child_scope()', t);
  end loop;
end $$;

create or replace function app.tg_task_members_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_active_agency_user(new.organization_id, new.user_id) then
    raise exception 'invalid_assignee' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger task_members_guard
before insert on public.task_members
for each row execute function app.tg_task_members_guard();

create or replace function app.tg_task_dependencies_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.tasks t where t.id = new.depends_on_id and t.client_id = new.client_id) then
    raise exception 'invalid_dependency' using errcode = '22023';
  end if;
  if exists (
    with recursive walk (id) as (
      select new.depends_on_id
      union
      select d.depends_on_id from public.task_dependencies d join walk w on d.task_id = w.id
    )
    select 1 from walk where id = new.task_id
  ) then
    raise exception 'dependency_cycle' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger task_dependencies_guard
before insert on public.task_dependencies
for each row execute function app.tg_task_dependencies_guard();

create or replace function app.tg_task_checklist_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_done and (tg_op = 'INSERT' or not old.is_done) then
    new.done_by := auth.uid();
    new.done_at := now();
  elsif not new.is_done then
    new.done_by := null;
    new.done_at := null;
  end if;
  return new;
end $$;

create trigger task_checklist_guard
before insert or update on public.task_checklist_items
for each row execute function app.tg_task_checklist_guard();

create or replace function app.tg_task_attachments_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.files f
    where f.id = new.file_id and f.client_id = new.client_id and f.deleted_at is null and f.visibility = 'internal'
      and f.source = 'attachment'
  ) then
    raise exception 'invalid_file' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger task_attachments_guard
before insert on public.task_attachments
for each row execute function app.tg_task_attachments_guard();

-- Time entries belong to their author; a stopped timer's minutes come from the clock.
create or replace function app.tg_time_entries_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and pg_trigger_depth() <= 1 then
    if tg_op = 'INSERT' then
      new.user_id := auth.uid();
    elsif new.user_id <> old.user_id then
      raise exception 'time_entry_immutable_fields' using errcode = '42501';
    end if;
  end if;
  if new.source = 'timer' then
    if tg_op = 'INSERT' and auth.uid() is not null and pg_trigger_depth() <= 1 then
      new.ended_at := null;
      new.minutes := 0;
    elsif new.ended_at is not null then
      new.minutes := least(1440, greatest(1, ceil(extract(epoch from (new.ended_at - new.started_at)) / 60)::int));
    end if;
  elsif new.ended_at is null then
    new.ended_at := new.started_at;
  end if;
  return new;
end $$;

create trigger time_entries_guard
before insert or update on public.time_entries
for each row execute function app.tg_time_entries_guard();

-- Every task has an internal discussion thread (comments with @mentions), like requests do.
create or replace function app.tg_tasks_thread()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.threads (organization_id, client_id, subject_type, subject_id, title, visibility, created_by)
  values (new.organization_id, new.client_id, 'task', new.id, new.title, 'internal', new.created_by)
  on conflict (subject_id) where subject_type = 'task' do nothing;
  return null;
end $$;

create unique index threads_task_subject_idx on public.threads (subject_id) where subject_type = 'task';

create trigger tasks_thread
after insert on public.tasks
for each row execute function app.tg_tasks_thread();

create or replace function app.tg_tasks_thread_title()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.threads set title = new.title, client_id = new.client_id where subject_type = 'task' and subject_id = new.id;
  return null;
end $$;

create trigger tasks_thread_title
after update of title, client_id on public.tasks
for each row when (new.title is distinct from old.title or new.client_id is distinct from old.client_id)
execute function app.tg_tasks_thread_title();

-- ---------------------------------------------------------------------------
-- Deliverables, versions and the approval state machine
-- (mirrors src/modules/deliverables/constants.ts — `submitTarget`, `applyDecision`, `taskCategoryFor`)
-- ---------------------------------------------------------------------------

create or replace function app.tg_deliverables_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_system boolean := auth.uid() is null or pg_trigger_depth() > 1;
begin
  if tg_op = 'INSERT' then
    if not v_system then
      new.created_by := auth.uid();
      new.status := 'in_progress';
      new.current_version_id := null;
      new.version_count := 0;
      new.revision_rounds := 0;
      new.approved_at := null;
      new.client_visible_at := null;
      new.reminded_at := null;
    end if;
  else
    if new.organization_id <> old.organization_id or new.client_id <> old.client_id or new.created_by is distinct from old.created_by then
      raise exception 'deliverable_immutable_fields' using errcode = '42501';
    end if;
    if not v_system then
      new.status := old.status;
      new.current_version_id := old.current_version_id;
      new.version_count := old.version_count;
      new.revision_rounds := old.revision_rounds;
      new.approved_at := old.approved_at;
      new.client_visible_at := old.client_visible_at;
      new.reminded_at := old.reminded_at;
    end if;
  end if;
  if new.task_id is not null and not exists (select 1 from public.tasks t where t.id = new.task_id and t.client_id = new.client_id) then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  if new.request_id is not null and not exists (select 1 from public.requests r where r.id = new.request_id and r.client_id = new.client_id) then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger deliverables_before
before insert or update on public.deliverables
for each row execute function app.tg_deliverables_before();

create or replace function app.tg_deliverable_versions_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_deliverable public.deliverables;
  v_system boolean := auth.uid() is null or pg_trigger_depth() > 1;
begin
  if tg_op = 'INSERT' then
    select * into v_deliverable from public.deliverables where id = new.deliverable_id for update;
    if v_deliverable.id is null then
      raise exception 'not_found' using errcode = '22023';
    end if;
    new.organization_id := v_deliverable.organization_id;
    new.client_id := v_deliverable.client_id;
    new.number := v_deliverable.version_count + 1;
    if not v_system then
      new.uploaded_by := auth.uid();
      new.status := 'draft';
      new.submitted_at := null;
      new.sent_to_client_at := null;
      new.decided_at := null;
    end if;
    return new;
  end if;

  if new.deliverable_id <> old.deliverable_id or new.number <> old.number or new.uploaded_by is distinct from old.uploaded_by then
    raise exception 'version_immutable_fields' using errcode = '42501';
  end if;
  if v_system then
    return new;
  end if;
  new.submitted_at := old.submitted_at;
  new.sent_to_client_at := old.sent_to_client_at;
  new.decided_at := old.decided_at;
  if old.status <> 'draft' and new.notes <> old.notes then
    raise exception 'version_locked' using errcode = '22023';
  end if;
  if new.status <> old.status then
    -- The only user transition is "submit": draft → the first review stage the deliverable needs.
    select * into v_deliverable from public.deliverables where id = new.deliverable_id;
    if old.status <> 'draft' or v_deliverable.current_version_id <> new.id then
      raise exception 'invalid_transition' using errcode = '22023';
    end if;
    if v_deliverable.type <> 'copy' and not exists (select 1 from public.deliverable_version_files f where f.version_id = new.id) then
      raise exception 'version_empty' using errcode = '22023';
    end if;
    if v_deliverable.type = 'copy' and char_length(trim(new.notes)) = 0
      and not exists (select 1 from public.deliverable_version_files f where f.version_id = new.id) then
      raise exception 'version_empty' using errcode = '22023';
    end if;
    new.status := case
      when v_deliverable.requires_internal_review then 'internal_review'
      when v_deliverable.requires_client_approval then 'client_review'
      else 'approved' end;
    new.submitted_at := now();
    if new.status = 'client_review' then new.sent_to_client_at := now(); end if;
    if new.status = 'approved' then new.decided_at := now(); end if;
  end if;
  return new;
end $$;

create trigger deliverable_versions_before
before insert or update on public.deliverable_versions
for each row execute function app.tg_deliverable_versions_before();

-- Keeps the deliverable, its task and the request in step with the current version.
create or replace function app.deliverable_sync(p_version uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.deliverable_versions;
  d public.deliverables;
  v_status text;
  v_category text;
begin
  select * into v from public.deliverable_versions where id = p_version;
  select * into d from public.deliverables where id = v.deliverable_id;
  if d.current_version_id is distinct from v.id or v.status = 'superseded' then
    return;
  end if;
  v_status := case v.status when 'draft' then 'in_progress' else v.status end;
  update public.deliverables set
    status = v_status,
    approved_at = case when v_status = 'approved' then coalesce(v.decided_at, now()) else null end,
    client_visible_at = case when v_status = 'client_review' then coalesce(client_visible_at, now()) else client_visible_at end,
    reminded_at = case when v_status = 'client_review' then null else reminded_at end
  where id = d.id;

  v_category := case v_status
    when 'in_progress' then 'active' when 'internal_review' then 'review' when 'client_review' then 'review'
    when 'internal_changes' then 'changes' when 'client_changes' then 'changes' when 'approved' then 'done' end;
  if d.task_id is not null then
    update public.tasks set status_id = app.task_status_for(d.organization_id, v_category)
    where id = d.task_id and status_category <> v_category and app.task_status_for(d.organization_id, v_category) is not null;
  end if;

  -- Every deliverable of the request approved → the request is delivered.
  if v_status = 'approved' and d.request_id is not null and not exists (
    select 1 from public.deliverables x where x.request_id = d.request_id and x.status <> 'approved'
  ) then
    update public.requests set status = 'delivered' where id = d.request_id and status in ('in_progress', 'in_review');
  end if;
end $$;

create or replace function app.tg_deliverable_versions_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- A new version restarts the review: undecided older versions are superseded; decided ones keep their decision.
    update public.deliverable_versions set status = 'superseded'
    where deliverable_id = new.deliverable_id and id <> new.id and status in ('draft', 'internal_review', 'client_review');
    update public.deliverables set version_count = new.number, current_version_id = new.id where id = new.deliverable_id;
    perform app.deliverable_sync(new.id);
  elsif new.status <> old.status then
    perform app.deliverable_sync(new.id);
  end if;
  return null;
end $$;

create trigger deliverable_versions_after
after insert or update on public.deliverable_versions
for each row execute function app.tg_deliverable_versions_after();

create or replace function app.tg_deliverable_version_files_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v public.deliverable_versions;
begin
  select * into v from public.deliverable_versions where id = new.version_id;
  if v.id is null or (v.status <> 'draft' and auth.uid() is not null and pg_trigger_depth() <= 1) then
    raise exception 'version_locked' using errcode = '22023';
  end if;
  new.organization_id := v.organization_id;
  new.client_id := v.client_id;
  if not exists (
    select 1 from public.files f
    where f.id = new.file_id and f.client_id = v.client_id and f.source = 'deliverable' and f.deleted_at is null
  ) then
    raise exception 'invalid_file' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger deliverable_version_files_guard
before insert on public.deliverable_version_files
for each row execute function app.tg_deliverable_version_files_guard();

create or replace function app.tg_approvals_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v public.deliverable_versions;
  d public.deliverables;
begin
  select * into v from public.deliverable_versions where id = new.version_id for update;
  select * into d from public.deliverables where id = v.deliverable_id;
  if v.id is null or d.current_version_id is distinct from v.id then
    raise exception 'version_not_current' using errcode = '22023';
  end if;
  new.deliverable_id := d.id;
  new.organization_id := d.organization_id;
  new.client_id := d.client_id;
  if auth.uid() is not null and pg_trigger_depth() <= 1 then
    new.reviewer_id := auth.uid();
    new.created_at := now();
  end if;
  if (new.stage = 'internal' and v.status <> 'internal_review') or (new.stage = 'client' and v.status <> 'client_review') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  new.comment := trim(new.comment);
  if new.decision = 'changes_requested' and char_length(new.comment) < 3 then
    raise exception 'comment_required' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger approvals_before
before insert on public.approvals
for each row execute function app.tg_approvals_before();

create or replace function app.tg_approvals_after()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  d public.deliverables;
  v_target text;
  v_cp uuid;
begin
  select * into d from public.deliverables where id = new.deliverable_id;
  v_target := case
    when new.stage = 'internal' and new.decision = 'changes_requested' then 'internal_changes'
    when new.stage = 'internal' and d.requires_client_approval then 'client_review'
    when new.stage = 'internal' then 'approved'
    when new.decision = 'changes_requested' then 'client_changes'
    else 'approved' end;
  update public.deliverable_versions set
    status = v_target,
    decided_at = case when v_target in ('approved', 'internal_changes', 'client_changes') then now() else decided_at end,
    sent_to_client_at = case when v_target = 'client_review' then now() else sent_to_client_at end
  where id = new.version_id;

  -- A client revision round uses one "revision_round" item of the current package (ADR-039).
  if new.stage = 'client' and new.decision = 'changes_requested' then
    update public.deliverables set revision_rounds = revision_rounds + 1 where id = d.id;
    select cp.id into v_cp from public.client_packages cp
    where cp.client_id = d.client_id and current_date between cp.period_start and cp.period_end
    order by cp.period_start desc limit 1;
    if v_cp is not null then
      insert into public.package_usage_entries (organization_id, client_id, client_package_id, item_type, quantity, source_type, source_id, note, created_by)
      values (d.organization_id, d.client_id, v_cp, 'revision_round', 1, 'approval', new.id, d.title, new.reviewer_id);
    end if;
  end if;
  return null;
end $$;

create trigger approvals_after
after insert on public.approvals
for each row execute function app.tg_approvals_after();

create or replace function app.tg_annotations_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v public.deliverable_versions;
  v_user boolean := auth.uid() is not null and pg_trigger_depth() <= 1;
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['resolved_at', 'resolved_by', 'updated_at']) <> (to_jsonb(old) - array['resolved_at', 'resolved_by', 'updated_at']) then
      raise exception 'annotation_immutable_fields' using errcode = '42501';
    end if;
    if v_user then
      new.resolved_by := case when new.resolved_at is null then null else auth.uid() end;
      if new.resolved_at is not null and old.resolved_at is null then new.resolved_at := now(); end if;
    end if;
    return new;
  end if;
  select * into v from public.deliverable_versions where id = new.version_id;
  if v.id is null then
    raise exception 'not_found' using errcode = '22023';
  end if;
  new.deliverable_id := v.deliverable_id;
  new.organization_id := v.organization_id;
  new.client_id := v.client_id;
  if new.file_id is not null and not exists (
    select 1 from public.deliverable_version_files f where f.version_id = v.id and f.file_id = new.file_id
  ) then
    raise exception 'invalid_file' using errcode = '22023';
  end if;
  if v_user then
    new.author_id := auth.uid();
    new.author_side := case when app.is_agency_member(v.organization_id) then 'agency' else 'client' end;
    new.resolved_at := null;
    new.resolved_by := null;
    -- Client comments are always shared; agency comments stay internal until the client has seen the version.
    if new.author_side = 'client' then
      new.visibility := 'client';
    elsif v.sent_to_client_at is null then
      new.visibility := 'internal';
    end if;
  end if;
  return new;
end $$;

create trigger annotations_before
before insert or update on public.annotations
for each row execute function app.tg_annotations_before();

create or replace function app.tg_annotation_replies_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.annotations;
begin
  select * into a from public.annotations where id = new.annotation_id;
  if a.id is null then
    raise exception 'not_found' using errcode = '22023';
  end if;
  new.organization_id := a.organization_id;
  new.client_id := a.client_id;
  if auth.uid() is not null and pg_trigger_depth() <= 1 then
    new.author_id := auth.uid();
    new.author_side := case when app.is_agency_member(a.organization_id) then 'agency' else 'client' end;
    new.created_at := now();
  end if;
  return new;
end $$;

create trigger annotation_replies_before
before insert on public.annotation_replies
for each row execute function app.tg_annotation_replies_before();

-- ---------------------------------------------------------------------------
-- Portal progress: the workflow's step names and states for a request the caller can see — nothing else.
-- ---------------------------------------------------------------------------

create or replace function app.request_progress(p_request uuid)
returns table (step_order integer, name jsonb, state text, due_date date)
language sql stable security definer set search_path = '' as $$
  select t.step_order, s.name,
    case
      when t.status_category = 'done' then 'done'
      when exists (
        select 1 from public.task_dependencies dep join public.tasks b on b.id = dep.depends_on_id
        where dep.task_id = t.id and b.status_category <> 'done'
      ) then 'pending'
      when t.status_category = 'todo' then 'pending'
      when t.status_category = 'review' then 'review'
      else 'active'
    end,
    t.due_date
  from public.tasks t
  join public.workflow_template_steps s on s.id = t.workflow_step_id
  join public.requests r on r.id = t.request_id
  where t.request_id = p_request and t.parent_id is null
    and (app.is_client_member(r.client_id) or app.agency_can_read_requests(r.client_id))
  order by t.step_order;
$$;

-- ---------------------------------------------------------------------------
-- Generic triggers on the new tables
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['task_statuses', 'workflow_templates', 'workflow_template_steps', 'tasks', 'time_entries', 'saved_views',
    'deliverables', 'deliverable_versions', 'annotations'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t);
  end loop;
  foreach t in array array['task_statuses', 'workflow_templates', 'workflow_template_steps', 'tasks', 'task_members', 'task_dependencies',
    'time_entries', 'deliverables', 'deliverable_versions', 'approvals'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function app.audit_trigger()', t);
  end loop;
  foreach t in array array['tasks', 'deliverables'] loop
    execute format('create trigger enforce_client_org before insert or update on public.%I for each row execute function app.tg_enforce_client_org()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['task_statuses', 'workflow_templates', 'workflow_template_steps', 'tasks', 'task_members', 'task_dependencies',
    'task_checklist_items', 'task_attachments', 'time_entries', 'saved_views', 'deliverables', 'deliverable_versions',
    'deliverable_version_files', 'approvals', 'annotations', 'annotation_replies'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

revoke update, delete on public.approvals from authenticated;
revoke update on public.annotation_replies, public.deliverable_version_files, public.task_dependencies, public.task_attachments from authenticated;

-- Statuses & workflows: agency reads; `workflows:manage` writes.
create policy task_statuses_select on public.task_statuses for select to authenticated
  using ((select app.is_agency_member(organization_id)));
create policy task_statuses_write on public.task_statuses for all to authenticated
  using ((select app.has_permission(organization_id, 'workflows:manage')))
  with check ((select app.has_permission(organization_id, 'workflows:manage')));

create policy workflow_templates_select on public.workflow_templates for select to authenticated
  using ((select app.is_agency_member(organization_id)));
create policy workflow_templates_write on public.workflow_templates for all to authenticated
  using ((select app.has_permission(organization_id, 'workflows:manage')))
  with check ((select app.has_permission(organization_id, 'workflows:manage')));

create policy workflow_template_steps_select on public.workflow_template_steps for select to authenticated
  using ((select app.is_agency_member(organization_id)));
create policy workflow_template_steps_write on public.workflow_template_steps for all to authenticated
  using ((select app.has_permission(organization_id, 'workflows:manage')))
  with check ((select app.has_permission(organization_id, 'workflows:manage')));

-- Tasks: agency only, per client access. Client users have no policy at all.
create policy tasks_select on public.tasks for select to authenticated
  using ((select app.agency_can_read_tasks(client_id)));
create policy tasks_insert on public.tasks for insert to authenticated
  with check ((select app.agency_can_task(client_id, 'tasks:create')));
create policy tasks_update on public.tasks for update to authenticated
  using ((select app.agency_can_task(client_id, 'tasks:update')))
  with check ((select app.agency_can_task(client_id, 'tasks:update')));
create policy tasks_delete on public.tasks for delete to authenticated
  using ((select app.agency_can_task(client_id, 'tasks:delete')));

do $$
declare t text;
begin
  foreach t in array array['task_members', 'task_dependencies', 'task_checklist_items', 'task_attachments'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select app.agency_can_read_tasks(client_id)))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select app.agency_can_task(client_id, ''tasks:update'')))', t || '_insert', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select app.agency_can_task(client_id, ''tasks:update'')))', t || '_delete', t);
  end loop;
end $$;
create policy task_checklist_items_update on public.task_checklist_items for update to authenticated
  using ((select app.agency_can_task(client_id, 'tasks:update')))
  with check ((select app.agency_can_task(client_id, 'tasks:update')));

-- Time: your own entries; everyone's with `time:read_all`. Only ever your own to write.
create policy time_entries_select on public.time_entries for select to authenticated
  using (
    (select app.agency_can_read_tasks(client_id))
    and (user_id = (select auth.uid()) or (select app.has_permission(organization_id, 'time:read_all')))
  );
create policy time_entries_insert on public.time_entries for insert to authenticated
  with check (user_id = (select auth.uid()) and (select app.agency_can_read_tasks(client_id)));
create policy time_entries_update on public.time_entries for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy time_entries_delete on public.time_entries for delete to authenticated
  using (user_id = (select auth.uid()));

create policy saved_views_select on public.saved_views for select to authenticated
  using ((select app.is_agency_member(organization_id)) and (owner_id = (select auth.uid()) or is_shared));
create policy saved_views_insert on public.saved_views for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select app.is_agency_member(organization_id)));
create policy saved_views_update on public.saved_views for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy saved_views_delete on public.saved_views for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Deliverables: the agency sees them with task access; clients only once something was sent to them.
create policy deliverables_select on public.deliverables for select to authenticated
  using (
    (select app.agency_can_read_tasks(client_id))
    or (client_visible_at is not null and (select app.is_client_member(client_id))
      and (select app.feature_enabled(organization_id, 'module.approvals')))
  );
create policy deliverables_insert on public.deliverables for insert to authenticated
  with check ((select app.agency_can_task(client_id, 'deliverables:manage')));
create policy deliverables_update on public.deliverables for update to authenticated
  using ((select app.agency_can_task(client_id, 'deliverables:manage')))
  with check ((select app.agency_can_task(client_id, 'deliverables:manage')));
create policy deliverables_delete on public.deliverables for delete to authenticated
  using ((select app.agency_can_task(client_id, 'deliverables:manage')) and client_visible_at is null);

create policy deliverable_versions_select on public.deliverable_versions for select to authenticated
  using (
    (select app.agency_can_read_tasks(client_id))
    or (sent_to_client_at is not null and exists (select 1 from public.deliverables d where d.id = deliverable_versions.deliverable_id))
  );
create policy deliverable_versions_insert on public.deliverable_versions for insert to authenticated
  with check ((select app.agency_can_task(client_id, 'deliverables:manage')));
create policy deliverable_versions_update on public.deliverable_versions for update to authenticated
  using ((select app.agency_can_task(client_id, 'deliverables:manage')))
  with check ((select app.agency_can_task(client_id, 'deliverables:manage')));
create policy deliverable_versions_delete on public.deliverable_versions for delete to authenticated
  using ((select app.agency_can_task(client_id, 'deliverables:manage')) and status = 'draft');

create policy deliverable_version_files_select on public.deliverable_version_files for select to authenticated
  using (exists (select 1 from public.deliverable_versions v where v.id = deliverable_version_files.version_id));
create policy deliverable_version_files_insert on public.deliverable_version_files for insert to authenticated
  with check ((select app.agency_can_task(client_id, 'deliverables:manage')));
create policy deliverable_version_files_delete on public.deliverable_version_files for delete to authenticated
  using (
    (select app.agency_can_task(client_id, 'deliverables:manage'))
    and exists (select 1 from public.deliverable_versions v where v.id = deliverable_version_files.version_id and v.status = 'draft')
  );

-- Approvals: the client sees (and makes) only client-stage decisions.
create policy approvals_select on public.approvals for select to authenticated
  using (
    (select app.agency_can_read_tasks(client_id))
    or (stage = 'client' and exists (select 1 from public.deliverables d where d.id = approvals.deliverable_id))
  );
create policy approvals_insert on public.approvals for insert to authenticated
  with check (
    reviewer_id = (select auth.uid()) and (
      (stage = 'internal' and (select app.agency_can_task(client_id, 'deliverables:review')))
      or (stage = 'client' and (select app.can_approve_for(client_id))
        and (select app.feature_enabled(organization_id, 'module.approvals')))
    )
  );

-- Annotations: internal ones never reach the portal; anyone who can see a version may comment on it.
create policy annotations_select on public.annotations for select to authenticated
  using (
    (select app.agency_can_read_tasks(client_id))
    or (visibility = 'client' and exists (select 1 from public.deliverable_versions v where v.id = annotations.version_id))
  );
create policy annotations_insert on public.annotations for insert to authenticated
  with check (
    author_id = (select auth.uid()) and (
      (select app.agency_can_read_tasks(client_id))
      or (visibility = 'client' and (select app.is_client_member(client_id))
        and exists (select 1 from public.deliverable_versions v where v.id = annotations.version_id and v.status = 'client_review'))
    )
  );
create policy annotations_update on public.annotations for update to authenticated
  using (
    (select app.agency_can_read_tasks(client_id))
    or (visibility = 'client' and author_side = 'client' and (select app.is_client_member(client_id)))
  )
  with check (
    (select app.agency_can_read_tasks(client_id))
    or (visibility = 'client' and author_side = 'client' and (select app.is_client_member(client_id)))
  );

create policy annotation_replies_select on public.annotation_replies for select to authenticated
  using (exists (select 1 from public.annotations a where a.id = annotation_replies.annotation_id));
create policy annotation_replies_insert on public.annotation_replies for insert to authenticated
  with check (
    author_id = (select auth.uid()) and exists (select 1 from public.annotations a where a.id = annotation_replies.annotation_id)
    and ((select app.agency_can_read_tasks(client_id)) or (select app.is_client_member(client_id)))
  );

-- Deliverable files stay internal; the client reaches them only through a version that was sent to them.
drop policy files_select on public.files;
create policy files_select on public.files for select to authenticated
  using (
    (select app.agency_can_access_client(client_id))
    or (
      source <> 'deliverable' and visibility = 'client' and deleted_at is null and (select app.is_client_member(client_id))
      and (folder_id is null or exists (
        select 1 from public.file_folders ff where ff.id = files.folder_id and ff.visibility = 'client'
      ))
    )
    or (
      source = 'deliverable' and deleted_at is null and (select app.is_client_member(client_id))
      and exists (
        select 1 from public.deliverable_version_files vf
        join public.deliverable_versions v on v.id = vf.version_id
        where vf.file_id = files.id and v.sent_to_client_at is not null
      )
    )
  );

-- Live boards and review screens (RLS decides who receives which row).
alter publication supabase_realtime add table public.tasks, public.deliverables, public.deliverable_versions, public.annotations, public.annotation_replies;

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
