-- Feedback Round 5 (ADR-094): leads go to the Trash instead of being deleted for good. A lead's own activities go
-- with it; deals that came from it stay. Restore and permanent delete work like every other Trash type (ADR-080).

-- Permissions ---------------------------------------------------------------------------------------------------------
insert into public.permissions (key, resource, action, side, module, sort_order, label) values
  ('leads:delete', 'leads', 'delete', 'agency', 'crm', 186, '{"ar":"حذف العملاء المحتملين","en":"Delete leads"}'),
  ('leads:purge',  'leads', 'purge',  'agency', 'crm', 187, '{"ar":"حذف العملاء المحتملين نهائيًا","en":"Permanently delete leads"}')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key, organization_id)
select r.id, k, r.organization_id
from public.roles r
cross join lateral unnest(case
  when r.key in ('super_admin', 'admin') then array['leads:delete', 'leads:purge']
  when r.key = 'sales_manager' then array['leads:delete']
  else array[]::text[] end) k
where r.is_system
on conflict do nothing;

-- New organizations get them through the Feedback Round grants used by app.bootstrap_organization.
create or replace function app.fr1_role_grants(p_role_key text)
returns text[] language sql immutable set search_path = '' as $$
  select case
    when p_role_key in ('super_admin', 'admin') then array[
      'clients:delete', 'clients:purge', 'client_users:delete', 'client_users:purge', 'users:delete', 'users:purge',
      'packages:delete', 'packages:purge', 'request_types:delete', 'request_types:purge', 'workflows:delete',
      'workflows:purge', 'requests:delete', 'requests:purge', 'tasks:purge', 'files:delete', 'files:purge',
      'deliverables:delete', 'deliverables:purge', 'messages:delete', 'messages:purge', 'tasks:edit_all',
      'integrations:connect', 'mail:manage', 'client_users:update_email', 'leads:delete', 'leads:purge']
    when p_role_key = 'account_manager' then array['client_users:delete', 'requests:delete', 'files:delete', 'deliverables:delete',
      'messages:delete', 'tasks:edit_managed', 'integrations:connect', 'client_users:update_email']
    when p_role_key = 'team_lead' then array['requests:delete', 'files:delete', 'deliverables:delete', 'messages:delete',
      'tasks:edit_managed', 'integrations:connect']
    when p_role_key = 'sales_manager' then array['leads:delete']
    when p_role_key = 'specialist' then array['integrations:connect']
    else array[]::text[]
  end;
$$;

-- Deleted leads and their activities are out of sight (and frozen) except in the Trash view ------------------------
do $$
declare
  r record;
begin
  for r in select * from (values ('leads', 'leads:delete'), ('crm_activities', 'leads:delete')) as t(tbl, perm) loop
    execute format(
      'create policy %I on public.%I as restrictive for select to authenticated using (deleted_at is null or app.in_trash_view(organization_id, %L))',
      r.tbl || '_not_deleted', r.tbl, r.perm);
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated using (deleted_at is null)',
      r.tbl || '_not_deleted_update', r.tbl);
    execute format('create index if not exists %I on public.%I (delete_batch) where delete_batch is not null', r.tbl || '_delete_batch_idx', r.tbl);
  end loop;
end $$;

-- Only the Trash removes a lead for good (app.trash_purge, a security definer function).
drop policy if exists leads_delete on public.leads;

-- No new activities on a deleted lead.
create or replace function app.can_write_lead(p_lead uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.leads l where l.id = p_lead and l.deleted_at is null
    and app.crm_can_write(l.organization_id, l.owner_id, 'leads:manage'));
$$;

-- Trash functions, with the `lead` type ------------------------------------------------------------------------------
create or replace function app.trash_resource(p_type text)
returns text language sql immutable set search_path = '' as $$
  select case p_type
    when 'client' then 'clients' when 'client_user' then 'client_users' when 'member' then 'users'
    when 'package' then 'packages' when 'request_type' then 'request_types' when 'workflow_template' then 'workflows'
    when 'request' then 'requests' when 'task' then 'tasks' when 'folder' then 'files' when 'file' then 'files'
    when 'deliverable' then 'deliverables' when 'deliverable_version' then 'deliverables' when 'comment' then 'messages'
    when 'lead' then 'leads'
  end;
$$;

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
    when 'lead' then
      return query select x.organization_id, null::uuid, coalesce(nullif(x.full_name, ''), x.email, x.phone, '#' || x.number), x.created_by, x.deleted_at is not null
        from public.leads x where x.id = p_id;
    else
      return;
  end case;
end $$;

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
        'leads', (select count(*) from public.leads x where x.owner_id = v_user and x.organization_id = t.org and x.status in ('new', 'contacted', 'qualified') and x.deleted_at is null),
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
    when 'lead' then
      -- Its own activities go with it; deals that came from it stay (they keep the link for a restore).
      v_counts := jsonb_build_object('activities',
        (select count(*) from public.crm_activities a where a.lead_id = p_id and a.deal_id is null and a.deleted_at is null));
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
    when 'lead' then
      update public.leads set deleted_at = now(), deleted_by = v_uid, delete_batch = v_batch where id = p_id;
      update public.crm_activities set deleted_at = now(), deleted_by = v_uid, delete_batch = v_batch
        where lead_id = p_id and deal_id is null and deleted_at is null;
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
    'requests', 'tasks', 'file_folders', 'files', 'deliverables', 'deliverable_versions', 'comments', 'threads', 'leads', 'crm_activities'] loop
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
    when 'lead' then
      -- Activities shared with a deal stay with the deal (the lead link would cascade them away).
      update public.crm_activities set lead_id = null
        where lead_id = i.entity_id and deal_id is not null and delete_batch is distinct from p_batch;
      delete from public.crm_activities where delete_batch = p_batch;
      delete from public.leads where id = i.entity_id;
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
