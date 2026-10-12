-- FR7 (ADR-096): the data reset also clears the Executive Center's derived rows. Same function as
-- 20260930175800_soft_delete_data_reset_security.sql plus kpi_snapshots and executive_notes (demo and operational
-- modes); factory mode already removes every organization-scoped table.
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
    -- Executive Center (FR7): snapshots and notes describe the data being removed; targets, views and schedules stay.
    delete from public.kpi_snapshots where organization_id = p_org;
    delete from public.executive_notes where organization_id = p_org;
  elsif p_mode = 'operational' then
    delete from public.clients where organization_id = p_org;
    delete from public.deals where organization_id = p_org;
    delete from public.leads where organization_id = p_org;
    foreach t in array array['notifications', 'domain_events', 'whatsapp_messages', 'integration_sync_runs',
      'integration_webhook_events', 'ai_conversations', 'ai_chunks', 'trash_items', 'crm_files',
      'kpi_snapshots', 'executive_notes'] loop
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
