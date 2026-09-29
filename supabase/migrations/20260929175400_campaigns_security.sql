-- ============================================================================
-- Phase 4 — Campaigns, metrics & reports: permissions, flag, scope triggers, health cache, RLS.
-- Tables come from the drizzle-kit migration 20260929175353_campaigns.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Permission catalog + grants for existing organizations
-- ---------------------------------------------------------------------------

insert into public.permissions (key, resource, action, side, module, sort_order, label) values
  ('campaigns:read',   'campaigns', 'read',   'agency', 'campaigns', 160, '{"ar":"عرض الحملات والتقارير","en":"View campaigns and reports"}'),
  ('campaigns:manage', 'campaigns', 'manage', 'agency', 'campaigns', 161, '{"ar":"إنشاء الحملات وتعديلها","en":"Create and edit campaigns"}'),
  ('metrics:manage',   'metrics',   'manage', 'agency', 'campaigns', 162, '{"ar":"إدخال أرقام الحملات واستيرادها","en":"Enter and import campaign metrics"}'),
  ('reports:manage',   'reports',   'manage', 'agency', 'campaigns', 163, '{"ar":"إعداد تقارير العملاء ونشرها","en":"Build and publish client reports"}');

insert into public.role_permissions (role_id, permission_key, organization_id)
select r.id, k, r.organization_id
from public.roles r
cross join lateral unnest(case r.key
  when 'super_admin'     then array['campaigns:read', 'campaigns:manage', 'metrics:manage', 'reports:manage']
  when 'admin'           then array['campaigns:read', 'campaigns:manage', 'metrics:manage', 'reports:manage']
  when 'account_manager' then array['campaigns:read', 'campaigns:manage', 'metrics:manage', 'reports:manage']
  when 'team_lead'       then array['campaigns:read', 'campaigns:manage', 'metrics:manage', 'reports:manage']
  when 'specialist'      then array['campaigns:read', 'metrics:manage']
  else array[]::text[]
end) k
where r.is_system
on conflict do nothing;

insert into public.feature_flags (key, module, default_enabled, description) values
  ('module.campaigns', 'campaigns', true, '{"ar":"الحملات والتقارير","en":"Campaigns & reports"}')
on conflict (key) do update set default_enabled = true, description = excluded.description;

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
      'requests:read', 'requests:update', 'requests:triage',
      'tasks:read', 'tasks:create', 'tasks:update', 'tasks:delete', 'deliverables:manage', 'deliverables:review', 'time:read_all',
      'campaigns:read', 'campaigns:manage', 'metrics:manage', 'reports:manage']),
    ('team_lead', array[
      'organization:read', 'users:read', 'departments:read', 'design_system:view',
      'clients:read_all', 'files:upload', 'files:manage', 'messages:send',
      'requests:read', 'requests:update', 'requests:triage',
      'tasks:read', 'tasks:create', 'tasks:update', 'tasks:delete', 'workflows:manage',
      'deliverables:manage', 'deliverables:review', 'time:read_all',
      'campaigns:read', 'campaigns:manage', 'metrics:manage', 'reports:manage']),
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
-- Helpers
-- ---------------------------------------------------------------------------

-- A client user may see a campaign once it is client-visible and past the draft stage.
create or replace function app.client_can_see_campaign(p_campaign uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.campaigns c
    where c.id = p_campaign
      and c.visibility = 'client'
      and c.status in ('planned', 'active', 'paused', 'completed')
      and app.is_client_member(c.client_id)
      and app.feature_enabled(c.organization_id, 'module.campaigns')
  );
$$;

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------

create or replace function app.tg_campaigns_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_system boolean := auth.uid() is null or pg_trigger_depth() > 1;
  -- Set by app.campaign_store_health() so the cached health can only come from the analysis.
  v_health_write boolean := coalesce(current_setting('app.campaign_health_write', true), '') = '1';
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('campaigns:' || new.organization_id::text));
    select coalesce(max(c.number), 0) + 1 into new.number from public.campaigns c where c.organization_id = new.organization_id;
    if not v_system then
      new.created_by := auth.uid();
      new.health := 'no_data';
      new.health_notified := null;
      new.metrics_through := null;
      new.stale_notified_at := null;
    end if;
  else
    if new.organization_id <> old.organization_id or new.client_id <> old.client_id or new.number <> old.number
      or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'campaign_immutable_fields' using errcode = '42501';
    end if;
    if not v_system and not v_health_write then
      new.health := old.health;
      new.health_notified := old.health_notified;
      new.metrics_through := old.metrics_through;
      new.stale_notified_at := old.stale_notified_at;
    end if;
  end if;
  if new.owner_id is not null and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id)
    and not app.is_active_agency_user(new.organization_id, new.owner_id) then
    raise exception 'invalid_assignee' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger campaigns_before
before insert or update on public.campaigns
for each row execute function app.tg_campaigns_before();

-- Writes the cached analysis (computed in TypeScript, src/modules/campaigns/metrics.ts) for callers who may
-- change the campaign or its metrics. Security definer so metric editors without `campaigns:manage` can refresh it.
create or replace function app.campaign_store_health(p_campaign uuid, p_health text, p_through date)
returns void language plpgsql security definer set search_path = '' as $$
declare v_campaign public.campaigns;
begin
  select * into v_campaign from public.campaigns where id = p_campaign;
  if v_campaign.id is null then
    raise exception 'not_found' using errcode = '22023';
  end if;
  if auth.uid() is not null and not (
    app.agency_can_task(v_campaign.client_id, 'metrics:manage') or app.agency_can_task(v_campaign.client_id, 'campaigns:manage')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_health not in ('on_track', 'at_risk', 'off_track', 'no_data') then
    raise exception 'invalid_health' using errcode = '22023';
  end if;
  perform set_config('app.campaign_health_write', '1', true);
  update public.campaigns set health = p_health, metrics_through = p_through where id = p_campaign;
  perform set_config('app.campaign_health_write', '', true);
end $$;

-- Child rows take organization, client (and, for metrics/imports, the campaign) from their parent, so they can't be
-- attached across clients or to another campaign's channel.
create or replace function app.tg_campaign_child_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_campaign public.campaigns;
  v_channel public.campaign_channels;
begin
  if tg_table_name in ('metrics_daily', 'metric_imports') then
    select * into v_channel from public.campaign_channels where id = new.channel_id;
    if v_channel.id is null then
      raise exception 'not_found' using errcode = '22023';
    end if;
    new.campaign_id := v_channel.campaign_id;
  end if;
  select * into v_campaign from public.campaigns where id = new.campaign_id;
  if v_campaign.id is null then
    raise exception 'not_found' using errcode = '22023';
  end if;
  new.organization_id := v_campaign.organization_id;
  new.client_id := v_campaign.client_id;
  if tg_table_name = 'campaign_kpis' and new.channel_id is not null and not exists (
    select 1 from public.campaign_channels ch where ch.id = new.channel_id and ch.campaign_id = new.campaign_id
  ) then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  if tg_table_name = 'metrics_daily' and auth.uid() is not null then
    new.updated_by := auth.uid();
    if new.source = 'api' then
      raise exception 'invalid_source' using errcode = '22023';
    end if;
  end if;
  if tg_table_name = 'metric_imports' and auth.uid() is not null then
    new.imported_by := auth.uid();
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['campaign_channels', 'campaign_kpis', 'metrics_daily', 'metric_imports'] loop
    execute format('create trigger campaign_child_scope before insert or update on public.%I for each row execute function app.tg_campaign_child_scope()', t);
  end loop;
end $$;

-- Requests and deliverables may point at a campaign of the same client; a deliverable inherits its request's.
-- (Two functions: PL/pgSQL doesn't short-circuit, so a shared one can't mention `new.request_id` on requests.)
create or replace function app.tg_campaign_link()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.campaign_id is not null and (tg_op = 'INSERT' or new.campaign_id is distinct from old.campaign_id) and not exists (
    select 1 from public.campaigns c where c.id = new.campaign_id and c.client_id = new.client_id
  ) then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  return new;
end $$;

create or replace function app.tg_deliverables_inherit_campaign()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.campaign_id is null and new.request_id is not null then
    select r.campaign_id into new.campaign_id from public.requests r where r.id = new.request_id;
  end if;
  return new;
end $$;

create trigger campaign_link
before insert or update of campaign_id on public.requests
for each row execute function app.tg_campaign_link();
-- Runs before `deliverables_campaign_link` (triggers fire in name order).
create trigger deliverables_campaign_inherit
before insert on public.deliverables
for each row execute function app.tg_deliverables_inherit_campaign();
create trigger deliverables_campaign_link
before insert or update of campaign_id on public.deliverables
for each row execute function app.tg_campaign_link();

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

create or replace function app.tg_reports_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_system boolean := auth.uid() is null or pg_trigger_depth() > 1;
begin
  if tg_op = 'INSERT' then
    if not v_system then
      new.created_by := auth.uid();
    end if;
  else
    if new.organization_id <> old.organization_id or new.client_id <> old.client_id or new.created_by is distinct from old.created_by then
      raise exception 'report_immutable_fields' using errcode = '42501';
    end if;
    -- A published report is frozen; the only change allowed is taking it back to draft.
    if old.status = 'published' and new.status = 'published' and (
      new.title <> old.title or new.period_start <> old.period_start or new.period_end <> old.period_end
      or new.campaign_id is distinct from old.campaign_id or new.snapshot is distinct from old.snapshot or new.locale <> old.locale
    ) then
      raise exception 'report_published' using errcode = '42501';
    end if;
  end if;
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then
    new.published_at := now();
    if not v_system then
      new.published_by := auth.uid();
    end if;
  elsif new.status = 'draft' then
    new.snapshot := null;
    new.published_at := null;
    new.published_by := null;
  end if;
  if new.campaign_id is not null and not exists (select 1 from public.campaigns c where c.id = new.campaign_id and c.client_id = new.client_id) then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  if new.schedule_id is not null and not exists (select 1 from public.report_schedules s where s.id = new.schedule_id and s.client_id = new.client_id) then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger reports_before
before insert or update on public.reports
for each row execute function app.tg_reports_before();

create or replace function app.tg_report_sections_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_report public.reports;
begin
  select * into v_report from public.reports where id = coalesce(new.report_id, old.report_id);
  if v_report.id is null then
    if tg_op = 'DELETE' then return old; end if;
    raise exception 'not_found' using errcode = '22023';
  end if;
  if v_report.status = 'published' then
    raise exception 'report_published' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  new.organization_id := v_report.organization_id;
  new.client_id := v_report.client_id;
  return new;
end $$;

create trigger report_sections_before
before insert or update or delete on public.report_sections
for each row execute function app.tg_report_sections_before();

create or replace function app.tg_report_schedules_before()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  if tg_op = 'UPDATE' and (new.organization_id <> old.organization_id or new.client_id <> old.client_id) then
    raise exception 'schedule_immutable_fields' using errcode = '42501';
  end if;
  if new.campaign_id is not null and not exists (select 1 from public.campaigns c where c.id = new.campaign_id and c.client_id = new.client_id) then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger report_schedules_before
before insert or update on public.report_schedules
for each row execute function app.tg_report_schedules_before();

-- ---------------------------------------------------------------------------
-- Generic triggers on the new tables
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['campaigns', 'campaign_channels', 'metrics_daily', 'report_schedules', 'reports', 'report_sections'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t);
  end loop;
  -- Metrics are high-volume and carry their own trail (`metric_imports`, `updated_by`), so they aren't audited.
  foreach t in array array['campaigns', 'campaign_channels', 'campaign_kpis', 'reports', 'report_schedules'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function app.audit_trigger()', t);
  end loop;
  foreach t in array array['campaigns', 'reports', 'report_schedules'] loop
    execute format('create trigger enforce_client_org before insert or update on public.%I for each row execute function app.tg_enforce_client_org()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['campaigns', 'campaign_channels', 'campaign_kpis', 'metrics_daily', 'metric_imports',
    'reports', 'report_sections', 'report_schedules'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

revoke update, delete on public.metric_imports from authenticated;

-- Campaigns: agency with `campaigns:read` + client access; clients only client-visible, non-draft campaigns.
create policy campaigns_select on public.campaigns for select to authenticated
  using ((select app.agency_can_task(client_id, 'campaigns:read')) or (select app.client_can_see_campaign(id)));
create policy campaigns_insert on public.campaigns for insert to authenticated
  with check ((select app.agency_can_task(client_id, 'campaigns:manage')));
create policy campaigns_update on public.campaigns for update to authenticated
  using ((select app.agency_can_task(client_id, 'campaigns:manage')))
  with check ((select app.agency_can_task(client_id, 'campaigns:manage')));
create policy campaigns_delete on public.campaigns for delete to authenticated
  using ((select app.agency_can_task(client_id, 'campaigns:manage')) and status in ('draft', 'archived'));

do $$
declare t text;
begin
  foreach t in array array['campaign_channels', 'campaign_kpis'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select app.agency_can_task(client_id, ''campaigns:read'')) or (select app.client_can_see_campaign(campaign_id)))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select app.agency_can_task(client_id, ''campaigns:manage'')))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select app.agency_can_task(client_id, ''campaigns:manage''))) with check ((select app.agency_can_task(client_id, ''campaigns:manage'')))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select app.agency_can_task(client_id, ''campaigns:manage'')))', t || '_delete', t);
  end loop;
end $$;

create policy metrics_daily_select on public.metrics_daily for select to authenticated
  using ((select app.agency_can_task(client_id, 'campaigns:read')) or (select app.client_can_see_campaign(campaign_id)));
create policy metrics_daily_insert on public.metrics_daily for insert to authenticated
  with check ((select app.agency_can_task(client_id, 'metrics:manage')));
create policy metrics_daily_update on public.metrics_daily for update to authenticated
  using ((select app.agency_can_task(client_id, 'metrics:manage')))
  with check ((select app.agency_can_task(client_id, 'metrics:manage')));
create policy metrics_daily_delete on public.metrics_daily for delete to authenticated
  using ((select app.agency_can_task(client_id, 'metrics:manage')));

create policy metric_imports_select on public.metric_imports for select to authenticated
  using ((select app.agency_can_task(client_id, 'campaigns:read')));
create policy metric_imports_insert on public.metric_imports for insert to authenticated
  with check ((select app.agency_can_task(client_id, 'metrics:manage')));

-- Reports: agency drafts and published; clients only published ones.
create policy reports_select on public.reports for select to authenticated
  using (
    (select app.agency_can_task(client_id, 'campaigns:read'))
    or (status = 'published' and (select app.is_client_member(client_id))
      and (select app.feature_enabled(organization_id, 'module.campaigns')))
  );
create policy reports_insert on public.reports for insert to authenticated
  with check ((select app.agency_can_task(client_id, 'reports:manage')));
create policy reports_update on public.reports for update to authenticated
  using ((select app.agency_can_task(client_id, 'reports:manage')))
  with check ((select app.agency_can_task(client_id, 'reports:manage')));
create policy reports_delete on public.reports for delete to authenticated
  using ((select app.agency_can_task(client_id, 'reports:manage')) and status = 'draft');

create policy report_sections_select on public.report_sections for select to authenticated
  using (exists (select 1 from public.reports r where r.id = report_sections.report_id));
create policy report_sections_insert on public.report_sections for insert to authenticated
  with check ((select app.agency_can_task(client_id, 'reports:manage')));
create policy report_sections_update on public.report_sections for update to authenticated
  using ((select app.agency_can_task(client_id, 'reports:manage')))
  with check ((select app.agency_can_task(client_id, 'reports:manage')));
create policy report_sections_delete on public.report_sections for delete to authenticated
  using ((select app.agency_can_task(client_id, 'reports:manage')));

create policy report_schedules_select on public.report_schedules for select to authenticated
  using ((select app.agency_can_task(client_id, 'campaigns:read')));
create policy report_schedules_write on public.report_schedules for all to authenticated
  using ((select app.agency_can_task(client_id, 'reports:manage')))
  with check ((select app.agency_can_task(client_id, 'reports:manage')));

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
