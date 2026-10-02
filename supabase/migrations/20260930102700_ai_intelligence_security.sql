-- ============================================================================
-- Phase 8 — AI intelligence: permissions, flag, settings defaults, guards, permission-aware retrieval, RLS.
-- Tables come from the drizzle-kit migration 20260930102618_ai_intelligence.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Permission catalog, flag, grants (ADR-078)
-- ---------------------------------------------------------------------------

insert into public.permissions (key, resource, action, side, module, sort_order, label) values
  ('ai:use',    'ai', 'use',    'agency', 'ai', 210, '{"ar":"استخدام المساعد الذكي والمسودات الذكية","en":"Use the AI assistant and AI drafts"}'),
  ('ai:manage', 'ai', 'manage', 'agency', 'ai', 211, '{"ar":"إدارة إعدادات الذكاء الاصطناعي والاستهلاك والفهرس","en":"Manage AI settings, usage and the index"}');

insert into public.feature_flags (key, module, default_enabled, description) values
  ('module.ai', 'ai', true, '{"ar":"الذكاء الاصطناعي: الرؤى والمساعد","en":"AI: insights and assistant"}')
on conflict (key) do update set default_enabled = true, description = excluded.description;

create or replace function app.phase8_role_grants(p_role_key text)
returns text[] language sql immutable set search_path = '' as $$
  select case
    when p_role_key in ('super_admin', 'admin') then array['ai:use', 'ai:manage']
    when p_role_key in ('account_manager', 'team_lead', 'specialist', 'sales_manager', 'sales_rep') then array['ai:use']
    else array[]::text[]
  end;
$$;

-- Grants for the system roles plus the organization's AI settings row (AI starts switched off — ADR-076).
create or replace function app.seed_phase8_defaults(p_org uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.role_permissions (role_id, permission_key, organization_id)
  select r.id, k, r.organization_id
  from public.roles r
  cross join lateral unnest(app.phase8_role_grants(r.key)) k
  where r.is_system and r.organization_id = p_org
  on conflict do nothing;
  insert into public.ai_settings (organization_id) values (p_org) on conflict do nothing;
$$;

select app.seed_phase8_defaults(id) from public.organizations;

-- New organizations: the Phase 7 bootstrap plus the Phase 8 defaults.

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
end $$;

create or replace function app.ai_can(p_org uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_agency_member(p_org) and app.has_permission(p_org, p_perm);
$$;

-- ---------------------------------------------------------------------------
-- Guards: users change only what is theirs; detection facts, severity and dates are server-owned.
-- ---------------------------------------------------------------------------

create or replace function app.tg_ai_settings_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.organization_id <> old.organization_id then
    raise exception 'ai_immutable_fields' using errcode = '42501';
  end if;
  if app.is_user_write() then
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

create trigger ai_settings_guard
before insert or update on public.ai_settings
for each row execute function app.tg_ai_settings_guard();

create or replace function app.tg_ai_insights_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.campaigns c
      where c.id = new.campaign_id and c.organization_id = new.organization_id and c.client_id = new.client_id
    ) then
      raise exception 'organization_mismatch' using errcode = '22023';
    end if;
    if new.channel_id is not null and not exists (
      select 1 from public.campaign_channels ch where ch.id = new.channel_id and ch.campaign_id = new.campaign_id
    ) then
      raise exception 'organization_mismatch' using errcode = '22023';
    end if;
    return new;
  end if;
  if app.is_user_write() then
    -- People triage: open ↔ acknowledged ↔ dismissed (with an optional reason). Resolution is the detectors' call.
    if new.status not in ('open', 'acknowledged', 'dismissed') then
      raise exception 'invalid_status' using errcode = '22023';
    end if;
    new := jsonb_populate_record(old, jsonb_build_object(
      'status', new.status,
      'dismiss_reason', case when new.status = 'dismissed' then new.dismiss_reason end,
      'acted_by', auth.uid(),
      'acted_at', now(),
      'updated_at', new.updated_at));
  end if;
  return new;
end $$;

create trigger ai_insights_guard
before insert or update on public.ai_insights
for each row execute function app.tg_ai_insights_guard();

create or replace function app.tg_ai_recommendations_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_insight public.ai_insights;
begin
  if tg_op = 'INSERT' then
    select * into v_insight from public.ai_insights where id = new.insight_id;
    if v_insight.id is null or v_insight.organization_id <> new.organization_id
      or v_insight.campaign_id <> new.campaign_id or v_insight.client_id <> new.client_id then
      raise exception 'organization_mismatch' using errcode = '22023';
    end if;
    return new;
  end if;
  if app.is_user_write() then
    -- A decision is made once: proposed → accepted (with the task it created) or dismissed.
    if old.status <> 'proposed' or new.status not in ('accepted', 'dismissed') then
      raise exception 'invalid_status' using errcode = '22023';
    end if;
    if new.task_id is not null and not exists (
      select 1 from public.tasks t where t.id = new.task_id and t.client_id = old.client_id
    ) then
      raise exception 'organization_mismatch' using errcode = '22023';
    end if;
    new := jsonb_populate_record(old, jsonb_build_object(
      'status', new.status,
      'task_id', case when new.status = 'accepted' then new.task_id end,
      'dismiss_reason', case when new.status = 'dismissed' then new.dismiss_reason end,
      'decided_by', auth.uid(),
      'decided_at', now(),
      'updated_at', new.updated_at));
  end if;
  return new;
end $$;

create trigger ai_recommendations_guard
before insert or update on public.ai_recommendations
for each row execute function app.tg_ai_recommendations_guard();

create or replace function app.tg_ai_conversations_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if app.is_user_write() then
    if tg_op = 'INSERT' then
      new.user_id := auth.uid();
    elsif new.user_id <> old.user_id or new.organization_id <> old.organization_id then
      raise exception 'ai_immutable_fields' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger ai_conversations_guard
before insert or update on public.ai_conversations
for each row execute function app.tg_ai_conversations_guard();

create or replace function app.tg_ai_messages_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.ai_conversations c where c.id = new.conversation_id and c.organization_id = new.organization_id
  ) then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  update public.ai_conversations set last_message_at = now() where id = new.conversation_id;
  return new;
end $$;

create trigger ai_messages_guard
before insert on public.ai_messages
for each row execute function app.tg_ai_messages_guard();

do $$
declare t text;
begin
  foreach t in array array['ai_settings', 'ai_insights', 'ai_recommendations', 'ai_conversations'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t);
  end loop;
  -- Settings and decisions on recommendations are audited; detections are their own trail (first / last detected).
  foreach t in array array['ai_settings', 'ai_recommendations'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function app.audit_trigger()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Permission-aware retrieval (ADR-075). SECURITY INVOKER on purpose: the lookup runs as the caller, so each source
-- table's own policies decide whether its chunk is visible.
-- ---------------------------------------------------------------------------

create or replace function app.ai_source_visible(p_type text, p_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select case p_type
    when 'client'   then exists (select 1 from public.clients x where x.id = p_id)
    when 'campaign' then exists (select 1 from public.campaigns x where x.id = p_id)
    when 'request'  then exists (select 1 from public.requests x where x.id = p_id)
    when 'task'     then exists (select 1 from public.tasks x where x.id = p_id)
    when 'report'   then exists (select 1 from public.reports x where x.id = p_id)
    when 'lead'     then exists (select 1 from public.leads x where x.id = p_id)
    when 'deal'     then exists (select 1 from public.deals x where x.id = p_id)
    when 'insight'  then exists (select 1 from public.ai_insights x where x.id = p_id)
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- RLS — agency only; nothing here reaches the portal.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['ai_settings', 'ai_usage', 'ai_insights', 'ai_recommendations', 'ai_chunks', 'ai_conversations', 'ai_messages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Settings: everyone with ai:use reads the switch; ai:manage changes it. Rows come from bootstrap / the migration.
revoke insert, delete on public.ai_settings from authenticated;
create policy ai_settings_select on public.ai_settings for select to authenticated
  using ((select app.ai_can(organization_id, 'ai:use')) or (select app.ai_can(organization_id, 'ai:manage')));
create policy ai_settings_update on public.ai_settings for update to authenticated
  using ((select app.ai_can(organization_id, 'ai:manage')))
  with check ((select app.ai_can(organization_id, 'ai:manage')));

-- Usage: read with ai:manage; written by the service path only.
revoke insert, update, delete on public.ai_usage from authenticated;
create policy ai_usage_select on public.ai_usage for select to authenticated
  using ((select app.ai_can(organization_id, 'ai:manage')));

-- Insights and recommendations follow campaign access; detected and resolved by the service path.
revoke insert, delete on public.ai_insights, public.ai_recommendations from authenticated;
do $$
declare t text;
begin
  foreach t in array array['ai_insights', 'ai_recommendations'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select app.agency_can_task(client_id, ''campaigns:read'')))', t || '_select', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select app.agency_can_task(client_id, ''campaigns:manage''))) with check ((select app.agency_can_task(client_id, ''campaigns:manage'')))', t || '_update', t);
  end loop;
end $$;

-- Chunks: ai:use and the source row visible to the caller. Written by the indexer (service path) only.
revoke insert, update, delete on public.ai_chunks from authenticated;
create policy ai_chunks_select on public.ai_chunks for select to authenticated
  using ((select app.ai_can(organization_id, 'ai:use')) and app.ai_source_visible(source_type, source_id));

-- Conversations: private to their author.
create policy ai_conversations_select on public.ai_conversations for select to authenticated
  using (user_id = (select auth.uid()) and (select app.ai_can(organization_id, 'ai:use')));
create policy ai_conversations_insert on public.ai_conversations for insert to authenticated
  with check (user_id = (select auth.uid()) and (select app.ai_can(organization_id, 'ai:use')));
create policy ai_conversations_update on public.ai_conversations for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and (select app.ai_can(organization_id, 'ai:use')));
create policy ai_conversations_delete on public.ai_conversations for delete to authenticated
  using (user_id = (select auth.uid()));

-- Messages: inside your own conversations (append-only).
revoke update, delete on public.ai_messages from authenticated;
create policy ai_messages_select on public.ai_messages for select to authenticated
  using (exists (select 1 from public.ai_conversations c where c.id = ai_messages.conversation_id and c.user_id = (select auth.uid())));
create policy ai_messages_insert on public.ai_messages for insert to authenticated
  with check (
    (select app.ai_can(organization_id, 'ai:use'))
    and exists (select 1 from public.ai_conversations c where c.id = ai_messages.conversation_id and c.user_id = (select auth.uid()))
  );
