-- ============================================================================
-- Phase 7 — Integrations & automation: permissions, flag, Vault token storage, guards, loop-guard columns, RLS.
-- Tables come from the drizzle-kit migration 20260930060653_integrations_automations.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Permission catalog, flag
-- ---------------------------------------------------------------------------

insert into public.permissions (key, resource, action, side, module, sort_order, label) values
  ('integrations:read',   'integrations', 'read',   'agency', 'integrations', 200, '{"ar":"عرض التكاملات وسجل المزامنة","en":"View integrations and the sync log"}'),
  ('integrations:manage', 'integrations', 'manage', 'agency', 'integrations', 201, '{"ar":"ربط المنصات وفصلها وربط الحسابات والحملات","en":"Connect platforms, map accounts and campaigns"}'),
  ('automations:read',    'automations',  'read',   'agency', 'automations',  202, '{"ar":"عرض الأتمتة وسجل التشغيل","en":"View automations and their runs"}'),
  ('automations:manage',  'automations',  'manage', 'agency', 'automations',  203, '{"ar":"إنشاء قواعد الأتمتة وتعديلها وتشغيلها","en":"Create, edit and run automations"}'),
  ('whatsapp:send',       'whatsapp',     'send',   'agency', 'integrations', 204, '{"ar":"إرسال رسائل واتساب للعملاء المحتملين","en":"Send WhatsApp messages to leads"}');

insert into public.feature_flags (key, module, default_enabled, description) values
  ('module.integrations', 'integrations', true, '{"ar":"التكاملات والأتمتة","en":"Integrations & automation"}')
on conflict (key) do update set default_enabled = true, description = excluded.description;

create or replace function app.phase7_role_grants(p_role_key text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_role_key
    when 'super_admin'     then array['integrations:read', 'integrations:manage', 'automations:read', 'automations:manage', 'whatsapp:send']
    when 'admin'           then array['integrations:read', 'integrations:manage', 'automations:read', 'automations:manage', 'whatsapp:send']
    when 'account_manager' then array['integrations:read', 'automations:read', 'whatsapp:send']
    when 'team_lead'       then array['integrations:read', 'automations:read']
    when 'sales_manager'   then array['integrations:read', 'automations:read', 'automations:manage', 'whatsapp:send']
    when 'sales_rep'       then array['whatsapp:send']
    else array[]::text[]
  end;
$$;

create or replace function app.seed_phase7_grants(p_org uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.role_permissions (role_id, permission_key, organization_id)
  select r.id, k, r.organization_id
  from public.roles r
  cross join lateral unnest(app.phase7_role_grants(r.key)) k
  where r.is_system and r.organization_id = p_org
  on conflict do nothing;
$$;

select app.seed_phase7_grants(id) from public.organizations;

-- New organizations: the Phase 6 bootstrap plus the Phase 7 grants.
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
end $$;

-- ---------------------------------------------------------------------------
-- Who is writing: a signed-in user through withRls (role authenticated / anon) or the service path.
-- Security definer functions run as their owner, but the `role` setting still reports the caller's SET ROLE.
-- ---------------------------------------------------------------------------

create or replace function app.is_user_write()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(current_setting('role', true), '') in ('authenticated', 'anon');
$$;

-- ---------------------------------------------------------------------------
-- Vault token storage (ADR-067). Only these functions touch integration_secrets / vault.
-- put: service path, or a member with integrations:manage (write-only — nobody but the service path reads).
-- get / drop: service path only.
-- ---------------------------------------------------------------------------

create or replace function app.integration_put_secret(p_connection uuid, p_secret text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_id uuid;
begin
  select organization_id into v_org from public.integration_connections where id = p_connection;
  if v_org is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if app.is_user_write() and not (app.is_agency_member(v_org) and app.has_permission(v_org, 'integrations:manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select secret_id into v_id from public.integration_secrets where connection_id = p_connection;
  if v_id is null then
    v_id := vault.create_secret(p_secret, 'integration:' || p_connection::text, 'Central integration token set');
    insert into public.integration_secrets (connection_id, secret_id) values (p_connection, v_id);
  else
    perform vault.update_secret(v_id, p_secret);
    update public.integration_secrets set updated_at = now() where connection_id = p_connection;
  end if;
end $$;

create or replace function app.integration_get_secret(p_connection uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_secret text;
begin
  if app.is_user_write() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select d.decrypted_secret into v_secret
  from public.integration_secrets s join vault.decrypted_secrets d on d.id = s.secret_id
  where s.connection_id = p_connection;
  return v_secret;
end $$;

create or replace function app.integration_drop_secret(p_connection uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if app.is_user_write() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.integration_secrets where connection_id = p_connection;
end $$;

-- The Vault entry goes with its mapping row (disconnect, or a cascaded connection / organization delete).
create or replace function app.tg_integration_secrets_after_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where id = old.secret_id;
  return old;
end $$;

create trigger integration_secrets_after_delete
after delete on public.integration_secrets
for each row execute function app.tg_integration_secrets_after_delete();

revoke all on function app.integration_put_secret(uuid, text) from public, anon;
revoke all on function app.integration_get_secret(uuid) from public, anon, authenticated;
revoke all on function app.integration_drop_secret(uuid) from public, anon, authenticated;
grant execute on function app.integration_put_secret(uuid, text) to authenticated, service_role;
grant execute on function app.integration_get_secret(uuid) to service_role;
grant execute on function app.integration_drop_secret(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Guards: users change only the columns that are theirs; the rest is server-owned.
-- ---------------------------------------------------------------------------

create or replace function app.tg_integration_connections_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id or new.provider <> old.provider then
      raise exception 'integration_immutable_fields' using errcode = '42501';
    end if;
    if app.is_user_write() then
      -- Users rename; tokens, status and health change only through the service path.
      new := jsonb_populate_record(old, jsonb_build_object('name', new.name, 'updated_at', new.updated_at));
    end if;
  end if;
  return new;
end $$;

create trigger integration_connections_guard
before insert or update on public.integration_connections
for each row execute function app.tg_integration_connections_guard();

create or replace function app.tg_integration_accounts_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  if tg_op = 'UPDATE' and app.is_user_write() then
    -- Users map the account to a client and switch its sync on or off.
    new := jsonb_populate_record(old, jsonb_build_object('client_id', new.client_id, 'sync_enabled', new.sync_enabled, 'updated_at', new.updated_at));
  end if;
  select organization_id into v_org from public.integration_connections where id = new.connection_id;
  if v_org is null or v_org <> new.organization_id then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  if new.client_id is not null and not exists (
    select 1 from public.clients c where c.id = new.client_id and c.organization_id = new.organization_id
  ) then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger integration_accounts_guard
before insert or update on public.integration_accounts
for each row execute function app.tg_integration_accounts_guard();

-- Campaign links that pointed into another client's campaigns no longer apply when the account is re-mapped.
create or replace function app.tg_integration_accounts_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.client_id is distinct from old.client_id then
    update public.integration_campaign_links set channel_id = null where account_id = new.id and channel_id is not null;
  end if;
  return new;
end $$;

create trigger integration_accounts_after
after update on public.integration_accounts
for each row execute function app.tg_integration_accounts_after();

create or replace function app.tg_integration_campaign_links_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_account public.integration_accounts;
begin
  if tg_op = 'UPDATE' and app.is_user_write() and pg_trigger_depth() = 1 then
    new := jsonb_populate_record(old, jsonb_build_object('channel_id', new.channel_id, 'updated_at', new.updated_at));
  end if;
  select * into v_account from public.integration_accounts where id = new.account_id;
  if v_account.id is null or v_account.organization_id <> new.organization_id then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  if new.channel_id is not null and not exists (
    select 1 from public.campaign_channels ch
    where ch.id = new.channel_id and ch.organization_id = new.organization_id and ch.client_id = v_account.client_id
  ) then
    raise exception 'channel_client_mismatch' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger integration_campaign_links_guard
before insert or update on public.integration_campaign_links
for each row execute function app.tg_integration_campaign_links_guard();

create or replace function app.tg_integration_sync_runs_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.integration_connections where id = new.connection_id;
  if v_org is null or v_org <> new.organization_id then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  if new.account_id is not null and not exists (
    select 1 from public.integration_accounts a where a.id = new.account_id and a.connection_id = new.connection_id
  ) then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' and app.is_user_write() then
    if new.trigger not in ('manual', 'backfill') then
      raise exception 'invalid_trigger' using errcode = '22023';
    end if;
    if not exists (select 1 from public.integration_connections c where c.id = new.connection_id and c.status = 'connected') then
      raise exception 'connection_not_connected' using errcode = '22023';
    end if;
    new.status := 'queued';
    new.attempts := 0;
    new.next_attempt_at := now();
    new.rows_written := 0;
    new.campaigns := 0;
    new.error_code := null;
    new.error_message := null;
    new.started_at := null;
    new.finished_at := null;
    new.requested_by := auth.uid();
  end if;
  return new;
end $$;

create trigger integration_sync_runs_guard
before insert or update on public.integration_sync_runs
for each row execute function app.tg_integration_sync_runs_guard();

create or replace function app.tg_whatsapp_templates_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and app.is_user_write() then
    new := jsonb_populate_record(old, jsonb_build_object('is_notification', new.is_notification, 'updated_at', new.updated_at));
  end if;
  if new.is_notification and new.status <> 'approved' then
    raise exception 'template_not_approved' using errcode = '22023';
  end if;
  if not exists (select 1 from public.integration_connections c where c.id = new.connection_id and c.organization_id = new.organization_id) then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger whatsapp_templates_guard
before insert or update on public.whatsapp_templates
for each row execute function app.tg_whatsapp_templates_guard();

-- Delivery status only moves forward (status webhooks arrive out of order); failed is terminal once sent.
create or replace function app.tg_whatsapp_messages_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_rank constant jsonb := '{"queued":0,"sent":1,"delivered":2,"read":3,"failed":4}';
begin
  if tg_op = 'UPDATE' and new.status <> old.status then
    if (old.status = 'failed' and old.external_id is not null)
      or (new.status <> 'failed' and (v_rank ->> new.status)::int < (v_rank ->> old.status)::int) then
      new.status := old.status;
    end if;
  end if;
  return new;
end $$;

create trigger whatsapp_messages_status
before insert or update on public.whatsapp_messages
for each row execute function app.tg_whatsapp_messages_status();

create or replace function app.tg_whatsapp_opt_ins_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = new.organization_id and m.user_id = new.user_id and m.user_type = 'agency'
  ) then
    raise exception 'invalid_assignee' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger whatsapp_opt_ins_guard
before insert or update on public.whatsapp_opt_ins
for each row execute function app.tg_whatsapp_opt_ins_guard();

create or replace function app.tg_automations_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.organization_id <> old.organization_id then
    raise exception 'integration_immutable_fields' using errcode = '42501';
  end if;
  if app.is_user_write() then
    new.updated_by := auth.uid();
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
      new.run_count := 0;
      new.failure_count := 0;
      new.last_run_at := null;
    else
      new.created_by := old.created_by;
      new.run_count := old.run_count;
      new.failure_count := old.failure_count;
      new.last_run_at := old.last_run_at;
    end if;
  end if;
  return new;
end $$;

create trigger automations_guard
before insert or update on public.automations
for each row execute function app.tg_automations_guard();

-- Users can't forge the loop-guard columns: only automation actions (service path) set them.
create or replace function app.tg_domain_events_automation_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if app.is_user_write() then
    new.automation_depth := 0;
    new.automation_chain := '{}';
  end if;
  return new;
end $$;

create trigger domain_events_automation_guard
before insert on public.domain_events
for each row execute function app.tg_domain_events_automation_guard();

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['integration_connections', 'integration_accounts', 'integration_campaign_links', 'whatsapp_templates',
    'whatsapp_messages', 'whatsapp_opt_ins', 'automations', 'integration_secrets'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t);
  end loop;
  -- Every connection change is audited (the rows hold no secret); runs, messages and webhook logs are their own trail.
  foreach t in array array['integration_connections', 'integration_accounts', 'integration_campaign_links', 'whatsapp_templates',
    'whatsapp_opt_ins', 'automations'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function app.audit_trigger()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS — agency only; nothing here reaches the portal.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['integration_connections', 'integration_secrets', 'integration_accounts', 'integration_campaign_links',
    'integration_sync_runs', 'integration_webhook_events', 'whatsapp_templates', 'whatsapp_messages', 'whatsapp_opt_ins',
    'automations', 'automation_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Secrets: no policy, no grant. Only the security definer functions above reach them.
revoke all on public.integration_secrets from authenticated;

create or replace function app.integrations_can(p_org uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_agency_member(p_org) and app.has_permission(p_org, p_perm);
$$;

-- Connections: read with integrations:read; rename with integrations:manage; created / disconnected by the service path.
revoke insert, delete on public.integration_connections from authenticated;
create policy integration_connections_select on public.integration_connections for select to authenticated
  using ((select app.integrations_can(organization_id, 'integrations:read')) or (select app.integrations_can(organization_id, 'integrations:manage')));
create policy integration_connections_update on public.integration_connections for update to authenticated
  using ((select app.integrations_can(organization_id, 'integrations:manage')))
  with check ((select app.integrations_can(organization_id, 'integrations:manage')));

-- Accounts, campaign links, templates: discovered by the service path, mapped by managers.
revoke insert, delete on public.integration_accounts, public.integration_campaign_links, public.whatsapp_templates from authenticated;
do $$
declare t text;
begin
  foreach t in array array['integration_accounts', 'integration_campaign_links', 'whatsapp_templates'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select app.integrations_can(organization_id, ''integrations:read'')) or (select app.integrations_can(organization_id, ''integrations:manage'')))', t || '_select', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select app.integrations_can(organization_id, ''integrations:manage''))) with check ((select app.integrations_can(organization_id, ''integrations:manage'')))', t || '_update', t);
  end loop;
end $$;

-- Senders pick a template: approved templates are readable with whatsapp:send too.
create policy whatsapp_templates_select_senders on public.whatsapp_templates for select to authenticated
  using (status = 'approved' and (select app.integrations_can(organization_id, 'whatsapp:send')));

-- Sync runs: read; managers queue manual / backfill runs (the guard trigger owns the rest).
revoke update, delete on public.integration_sync_runs from authenticated;
create policy integration_sync_runs_select on public.integration_sync_runs for select to authenticated
  using ((select app.integrations_can(organization_id, 'integrations:read')) or (select app.integrations_can(organization_id, 'integrations:manage')));
create policy integration_sync_runs_insert on public.integration_sync_runs for insert to authenticated
  with check ((select app.integrations_can(organization_id, 'integrations:manage')));

-- Webhook log: read only.
revoke insert, update, delete on public.integration_webhook_events from authenticated;
create policy integration_webhook_events_select on public.integration_webhook_events for select to authenticated
  using (organization_id is not null and ((select app.integrations_can(organization_id, 'integrations:read'))
    or (select app.integrations_can(organization_id, 'integrations:manage'))));

-- WhatsApp messages: senders, integration readers, whoever can read the lead / deal, and the notified person.
revoke insert, update, delete on public.whatsapp_messages from authenticated;
create policy whatsapp_messages_select on public.whatsapp_messages for select to authenticated
  using (
    (select app.integrations_can(organization_id, 'whatsapp:send'))
    or (select app.integrations_can(organization_id, 'integrations:read'))
    or (lead_id is not null and (select app.integrations_can(organization_id, 'leads:read')))
    or (deal_id is not null and (select app.integrations_can(organization_id, 'deals:read')))
    or recipient_user_id = (select auth.uid())
  );

-- Opt-ins: your own row only.
revoke delete on public.whatsapp_opt_ins from authenticated;
create policy whatsapp_opt_ins_select on public.whatsapp_opt_ins for select to authenticated
  using (user_id = (select auth.uid()));
create policy whatsapp_opt_ins_insert on public.whatsapp_opt_ins for insert to authenticated
  with check (user_id = (select auth.uid()) and (select app.is_agency_member(organization_id)));
create policy whatsapp_opt_ins_update on public.whatsapp_opt_ins for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and (select app.is_agency_member(organization_id)));

-- Automations
create policy automations_select on public.automations for select to authenticated
  using ((select app.integrations_can(organization_id, 'automations:read')) or (select app.integrations_can(organization_id, 'automations:manage')));
create policy automations_insert on public.automations for insert to authenticated
  with check ((select app.integrations_can(organization_id, 'automations:manage')));
create policy automations_update on public.automations for update to authenticated
  using ((select app.integrations_can(organization_id, 'automations:manage')))
  with check ((select app.integrations_can(organization_id, 'automations:manage')));
create policy automations_delete on public.automations for delete to authenticated
  using ((select app.integrations_can(organization_id, 'automations:manage')));

revoke insert, update, delete on public.automation_runs from authenticated;
create policy automation_runs_select on public.automation_runs for select to authenticated
  using ((select app.integrations_can(organization_id, 'automations:read')) or (select app.integrations_can(organization_id, 'automations:manage')));
