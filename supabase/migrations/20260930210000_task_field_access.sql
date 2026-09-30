-- Feedback Round 1 (FR1.4): who may change which task fields (ADR-084).
--
--   full    — every field, members, dependencies, attachments: `tasks:edit_all` (Super Admin, Admin / Ops Manager), or
--             `tasks:edit_managed` (Account Manager, Team Lead) on tasks of clients they manage or are assigned to, or
--             in a department they lead.
--   limited — status (incl. board position) and the checklist, on tasks assigned to you (`tasks:update`).
--   none    — anything else is read-only.
-- Comments and time entries keep their own rules (anyone who can read the task comments; time is your own).
-- The database enforces it (guard triggers); the UI mirrors it (`src/modules/tasks/access.ts`).

insert into public.permissions (key, resource, action, side, module, sort_order, label) values
  ('tasks:edit_all',     'tasks', 'edit_all',     'agency', 'tasks', 154, '{"ar":"تعديل كل حقول أي مهمة","en":"Edit every field of any task"}'),
  ('tasks:edit_managed', 'tasks', 'edit_managed', 'agency', 'tasks', 155, '{"ar":"تعديل كل حقول مهام عملائه أو قسمه","en":"Edit every field of tasks of their clients or department"}')
on conflict (key) do nothing;

update public.permissions set label = '{"ar":"تحديث حالة مهامه وقائمة المهام فيها","en":"Update the status and checklist of own tasks"}'
where key = 'tasks:update';

create or replace function app.fr1_role_grants(p_role_key text)
returns text[] language sql immutable set search_path = '' as $$
  select case
    when p_role_key in ('super_admin', 'admin') then array[
      'clients:delete', 'clients:purge', 'client_users:delete', 'client_users:purge', 'users:delete', 'users:purge',
      'packages:delete', 'packages:purge', 'request_types:delete', 'request_types:purge', 'workflows:delete',
      'workflows:purge', 'requests:delete', 'requests:purge', 'tasks:purge', 'files:delete', 'files:purge',
      'deliverables:delete', 'deliverables:purge', 'messages:delete', 'messages:purge', 'tasks:edit_all']
    when p_role_key = 'account_manager' then array['client_users:delete', 'requests:delete', 'files:delete', 'deliverables:delete',
      'messages:delete', 'tasks:edit_managed']
    when p_role_key = 'team_lead' then array['requests:delete', 'files:delete', 'deliverables:delete', 'messages:delete',
      'tasks:edit_managed']
    else array[]::text[]
  end;
$$;

select app.seed_fr1_grants(id) from public.organizations;

-- 'full' | 'limited' | 'none' for the signed-in user on one task.
create or replace function app.task_edit_scope(p_task uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when t.id is null or not app.agency_can_task(t.client_id, 'tasks:update') then 'none'
    when app.has_permission(t.organization_id, 'tasks:edit_all') then 'full'
    when app.has_permission(t.organization_id, 'tasks:edit_managed') and (
      c.account_manager_id = auth.uid()
      or exists (select 1 from public.client_assignments a where a.client_id = t.client_id and a.user_id = auth.uid())
      or exists (select 1 from public.department_members d where d.department_id = t.department_id and d.user_id = auth.uid() and d.is_lead)
    ) then 'full'
    when exists (select 1 from public.task_members m where m.task_id = t.id and m.user_id = auth.uid() and m.role = 'assignee')
      then 'limited'
    else 'none'
  end
  from public.tasks t join public.clients c on c.id = t.client_id
  where t.id = p_task
$$;
grant execute on function app.task_edit_scope(uuid) to authenticated, service_role;

-- What the UI needs to mirror the rule for many tasks at once.
create or replace function app.task_edit_context(p_org uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'editAll', app.has_permission(p_org, 'tasks:edit_all'),
    'canUpdate', app.has_permission(p_org, 'tasks:update'),
    'managedClientIds', case when app.has_permission(p_org, 'tasks:edit_managed') then coalesce((
      select jsonb_agg(c.id) from public.clients c
      where c.organization_id = p_org and (c.account_manager_id = auth.uid()
        or exists (select 1 from public.client_assignments a where a.client_id = c.id and a.user_id = auth.uid()))
    ), '[]'::jsonb) else '[]'::jsonb end,
    'ledDepartmentIds', case when app.has_permission(p_org, 'tasks:edit_managed') then coalesce((
      select jsonb_agg(d.department_id) from public.department_members d
      where d.organization_id = p_org and d.user_id = auth.uid() and d.is_lead
    ), '[]'::jsonb) else '[]'::jsonb end
  )
$$;
grant execute on function app.task_edit_context(uuid) to authenticated, service_role;

-- User edits only (service paths, cascades from other triggers, purges and resets are not field edits).
create or replace function app.is_user_field_edit()
returns boolean language sql stable set search_path = '' as $$
  select auth.uid() is not null and pg_trigger_depth() = 1 and not app.purging()
$$;

create or replace function app.tg_task_field_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_scope text;
begin
  if not app.is_user_field_edit() then
    return new;
  end if;
  v_scope := app.task_edit_scope(old.id);
  if v_scope = 'full' then
    return new;
  end if;
  -- Status (with its derived columns and the board position), Trash bookkeeping and reminders are not "fields".
  if v_scope = 'limited' and (
    new.title, new.description, new.department_id, new.priority, new.start_date, new.due_date, new.estimate_minutes,
    new.tags, new.reviewer_id, new.parent_id, new.request_id, new.client_id, new.requires_internal_review,
    new.requires_client_approval, new.workflow_step_id, new.workflow_template_id
  ) is not distinct from (
    old.title, old.description, old.department_id, old.priority, old.start_date, old.due_date, old.estimate_minutes,
    old.tags, old.reviewer_id, old.parent_id, old.request_id, old.client_id, old.requires_internal_review,
    old.requires_client_approval, old.workflow_step_id, old.workflow_template_id
  ) then
    return new;
  end if;
  -- Moving to/from the Trash is checked by the Trash functions.
  if (new.deleted_at is distinct from old.deleted_at) and (
    new.title, new.status_id, new.due_date, new.priority
  ) is not distinct from (old.title, old.status_id, old.due_date, old.priority) then
    return new;
  end if;
  raise exception 'field_forbidden' using errcode = '42501';
end $$;

drop trigger if exists tasks_field_guard on public.tasks;
create trigger tasks_field_guard before update on public.tasks
for each row when (NOT app.purging()) execute function app.tg_task_field_guard();

-- Members, dependencies and attachments need full access — except while creating the task in the same transaction
-- (a specialist may assign a task they are creating).
create or replace function app.tg_task_child_field_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_task uuid := coalesce(new.task_id, old.task_id);
begin
  if not app.is_user_field_edit() then
    return coalesce(new, old);
  end if;
  if exists (select 1 from public.tasks t where t.id = v_task and t.created_at = now()) then
    return coalesce(new, old);
  end if;
  if app.task_edit_scope(v_task) <> 'full' then
    raise exception 'field_forbidden' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists task_members_field_guard on public.task_members;
create trigger task_members_field_guard before insert or delete on public.task_members
for each row when (NOT app.purging()) execute function app.tg_task_child_field_guard();
drop trigger if exists task_dependencies_field_guard on public.task_dependencies;
create trigger task_dependencies_field_guard before insert or delete on public.task_dependencies
for each row when (NOT app.purging()) execute function app.tg_task_child_field_guard();
drop trigger if exists task_attachments_field_guard on public.task_attachments;
create trigger task_attachments_field_guard before insert or delete on public.task_attachments
for each row when (NOT app.purging()) execute function app.tg_task_child_field_guard();

-- Checklist items: limited or full.
create or replace function app.tg_task_checklist_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_task uuid := coalesce(new.task_id, old.task_id);
begin
  if app.is_user_field_edit()
    and not exists (select 1 from public.tasks t where t.id = v_task and t.created_at = now())
    and app.task_edit_scope(v_task) = 'none' then
    raise exception 'field_forbidden' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists task_checklist_field_guard on public.task_checklist_items;
create trigger task_checklist_field_guard before insert or update or delete on public.task_checklist_items
for each row when (NOT app.purging()) execute function app.tg_task_checklist_guard();

-- History: checklists and dependencies are audited too, so the task's history shows every change.
do $$
declare t text;
begin
  foreach t in array array['task_checklist_items', 'task_dependencies'] loop
    execute format('drop trigger if exists audit on public.%I', t);
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function app.audit_trigger()', t);
  end loop;
end $$;

-- A task's history for anyone who can read the task (the audit log itself stays for `audit_log:read`).
create or replace function app.task_history(p_task uuid)
returns table (id bigint, actor_id uuid, action text, table_name text, before jsonb, after jsonb, changed_fields text[], created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.id, l.actor_id, l.action, l.table_name, l.before, l.after, l.changed_fields, l.created_at
  from public.activity_log l
  join public.tasks t on t.id = p_task
  where app.agency_can_read_tasks(t.client_id)
    and l.organization_id = t.organization_id
    and (
      (l.table_name = 'tasks' and l.record_id = p_task::text)
      or (l.table_name in ('task_members', 'task_checklist_items', 'task_dependencies')
        and coalesce(l.after ->> 'task_id', l.before ->> 'task_id') = p_task::text)
    )
  order by l.created_at desc, l.id desc
  limit 200
$$;
grant execute on function app.task_history(uuid) to authenticated;
