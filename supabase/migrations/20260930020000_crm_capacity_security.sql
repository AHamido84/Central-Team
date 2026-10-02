-- ============================================================================
-- Phase 6 — CRM & capacity: permissions, sales roles, flag, bucket, numbering / stage triggers, RLS.
-- Tables come from the drizzle-kit migration 20260930015948_crm_capacity.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Permission catalog, flag, bucket
-- ---------------------------------------------------------------------------

insert into public.permissions (key, resource, action, side, module, sort_order, label) values
  ('leads:read',      'leads',    'read',       'agency', 'crm',      180, '{"ar":"عرض العملاء المحتملين","en":"View leads"}'),
  ('leads:manage',    'leads',    'manage',     'agency', 'crm',      181, '{"ar":"إضافة العملاء المحتملين وتعديلهم","en":"Create and edit leads"}'),
  ('deals:read',      'deals',    'read',       'agency', 'crm',      182, '{"ar":"عرض الصفقات ومسار المبيعات","en":"View deals and the pipeline"}'),
  ('deals:manage',    'deals',    'manage',     'agency', 'crm',      183, '{"ar":"إنشاء الصفقات وتحريكها","en":"Create and move deals"}'),
  ('crm:manage_all',  'crm',      'manage_all', 'agency', 'crm',      184, '{"ar":"إدارة صفقات وعملاء الجميع وإعادة إسنادها","en":"Manage and reassign everyone''s leads and deals"}'),
  ('crm:admin',       'crm',      'admin',      'agency', 'crm',      185, '{"ar":"إعداد المبيعات: المسارات والنماذج والقواعد والأهداف","en":"Sales settings: pipelines, forms, rules, targets"}'),
  ('capacity:read',   'capacity', 'read',       'agency', 'capacity', 190, '{"ar":"عرض تخطيط الطاقة الاستيعابية","en":"View capacity planning"}'),
  ('capacity:manage', 'capacity', 'manage',     'agency', 'capacity', 191, '{"ar":"تعديل ساعات الفريق والإجازات وجهد الخدمات","en":"Edit team hours, time off and service effort"}');

insert into public.feature_flags (key, module, default_enabled, description) values
  ('module.crm', 'crm', true, '{"ar":"المبيعات وتخطيط الطاقة","en":"Sales & capacity"}')
on conflict (key) do update set default_enabled = true, description = excluded.description;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('crm-files', 'crm-files', false, 52428800, null)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Sales roles and department for existing organizations; grants for every system role
-- ---------------------------------------------------------------------------

insert into public.roles (organization_id, key, name, description, side, is_system, is_locked, sort_order)
select o.id, r.key, r.name, r.description, 'agency', true, false, r.sort
from public.organizations o
cross join (values
  ('sales_manager', '{"ar":"مدير المبيعات","en":"Sales Manager"}'::jsonb, '{"ar":"يقود فريق المبيعات ويحوّل الصفقات الرابحة إلى عملاء","en":"Leads sales and turns won deals into clients"}'::jsonb, 9),
  ('sales_rep',     '{"ar":"مندوب مبيعات","en":"Sales Rep"}'::jsonb,       '{"ar":"يتابع العملاء المحتملين وصفقاته","en":"Works their own leads and deals"}'::jsonb, 10)
) as r(key, name, description, sort)
on conflict (organization_id, key) do nothing;

insert into public.departments (organization_id, key, name, color, icon, sort_order)
select o.id, 'sales', '{"ar":"المبيعات","en":"Sales"}', 'sky', 'handshake', 6 from public.organizations o
on conflict (organization_id, key) do nothing;

create or replace function app.phase6_role_grants(p_role_key text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_role_key
    when 'super_admin'     then array['leads:read', 'leads:manage', 'deals:read', 'deals:manage', 'crm:manage_all', 'crm:admin', 'capacity:read', 'capacity:manage']
    when 'admin'           then array['leads:read', 'leads:manage', 'deals:read', 'deals:manage', 'crm:manage_all', 'crm:admin', 'capacity:read', 'capacity:manage']
    when 'account_manager' then array['leads:read', 'deals:read', 'capacity:read']
    when 'team_lead'       then array['capacity:read', 'capacity:manage']
    when 'sales_manager'   then array['organization:read', 'users:read', 'departments:read', 'design_system:view',
      'clients:read_all', 'clients:create', 'clients:update', 'client_users:manage', 'packages:assign',
      'requests:read', 'requests:triage', 'tasks:read', 'tasks:create', 'tasks:update',
      -- A new client starts with its default folders and general thread (same as creating one by hand).
      'files:upload', 'messages:send',
      'leads:read', 'leads:manage', 'deals:read', 'deals:manage', 'crm:manage_all', 'crm:admin', 'capacity:read']
    when 'sales_rep'       then array['organization:read', 'users:read', 'departments:read',
      'leads:read', 'leads:manage', 'deals:read', 'deals:manage']
    else array[]::text[]
  end;
$$;

insert into public.role_permissions (role_id, permission_key, organization_id)
select r.id, k, r.organization_id
from public.roles r
cross join lateral unnest(app.phase6_role_grants(r.key)) k
where r.is_system
on conflict do nothing;

-- New organizations: the Phase 5 bootstrap plus the sales roles, department and CRM defaults.
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
end $$;

-- Default pipeline (New → Contacted → Meeting → Proposal → Negotiation → Won / Lost) and CRM settings.
create or replace function app.seed_crm_defaults(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_pipeline uuid;
begin
  insert into public.crm_settings (organization_id) values (p_org) on conflict do nothing;
  if exists (select 1 from public.pipelines where organization_id = p_org) then
    return;
  end if;
  insert into public.pipelines (organization_id, name, is_default, sort_order)
  values (p_org, '{"ar":"مسار المبيعات","en":"Sales pipeline"}', true, 1)
  returning id into v_pipeline;
  insert into public.pipeline_stages (organization_id, pipeline_id, name, kind, probability, sort_order) values
    (p_org, v_pipeline, '{"ar":"جديد","en":"New"}',                'open', 10, 1),
    (p_org, v_pipeline, '{"ar":"تم التواصل","en":"Contacted"}',     'open', 20, 2),
    (p_org, v_pipeline, '{"ar":"اجتماع","en":"Meeting"}',          'open', 40, 3),
    (p_org, v_pipeline, '{"ar":"عرض سعر","en":"Proposal"}',        'open', 60, 4),
    (p_org, v_pipeline, '{"ar":"تفاوض","en":"Negotiation"}',       'open', 80, 5),
    (p_org, v_pipeline, '{"ar":"رابحة","en":"Won"}',               'won', 100, 6),
    (p_org, v_pipeline, '{"ar":"خاسرة","en":"Lost"}',              'lost',  0, 7);
end $$;

select app.seed_crm_defaults(id) from public.organizations;

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

-- Write rule for CRM records: the permission, and the record is yours, unassigned, or you may manage everyone's.
create or replace function app.crm_can_write(p_org uuid, p_owner uuid, p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_agency_member(p_org) and app.has_permission(p_org, p_permission)
    and (p_owner is null or p_owner = auth.uid() or app.has_permission(p_org, 'crm:manage_all'));
$$;

create or replace function app.can_write_deal(p_deal uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.deals d where d.id = p_deal and app.crm_can_write(d.organization_id, d.owner_id, 'deals:manage'));
$$;

create or replace function app.can_write_lead(p_lead uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.leads l where l.id = p_lead and app.crm_can_write(l.organization_id, l.owner_id, 'leads:manage'));
$$;

create or replace function app.crm_can_read(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_agency_member(p_org) and (app.has_permission(p_org, 'leads:read') or app.has_permission(p_org, 'deals:read'));
$$;

-- Same rule as app.has_permission, for another member (assignment eligibility, notification recipients).
create or replace function app.member_has_permission(p_org uuid, p_user uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
      select 1 from public.organization_members m
      where m.organization_id = p_org and m.user_id = p_user and m.status = 'active' and m.user_type = 'agency'
    ) and (
      exists (
        select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
        where ur.organization_id = p_org and ur.user_id = p_user and r.is_locked
      )
      or (
        not exists (
          select 1 from public.user_permission_overrides o
          where o.organization_id = p_org and o.user_id = p_user and o.permission_key = p_perm and o.effect = 'deny'
        )
        and (
          exists (
            select 1 from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
            where ur.organization_id = p_org and ur.user_id = p_user and rp.permission_key = p_perm
          )
          or exists (
            select 1 from public.user_permission_overrides o
            where o.organization_id = p_org and o.user_id = p_user and o.permission_key = p_perm and o.effect = 'grant'
          )
        )
      )
    );
$$;

-- Active agency members who can own leads (round-robin candidates). Callers must be CRM users (or the service role).
create or replace function app.crm_eligible_owners(p_org uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.user_id from public.organization_members m
  where m.organization_id = p_org and m.status = 'active' and m.user_type = 'agency'
    and (auth.uid() is null or app.has_permission(p_org, 'leads:manage'))
    and app.member_has_permission(p_org, m.user_id, 'leads:manage');
$$;

-- Round-robin bookkeeping: anyone who may create leads advances the rule's cursor (rules themselves stay crm:admin).
create or replace function app.crm_advance_rule(p_rule uuid, p_cursor integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.lead_assignment_rules where id = p_rule;
  if v_org is null then
    return;
  end if;
  if auth.uid() is not null and not app.has_permission(v_org, 'leads:manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.lead_assignment_rules set cursor = greatest(0, p_cursor) where id = p_rule;
end $$;

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------

create or replace function app.tg_leads_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_system boolean := auth.uid() is null or pg_trigger_depth() > 1;
begin
  new.email := nullif(lower(trim(new.email)), '');
  new.phone := nullif(trim(new.phone), '');
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('leads:' || new.organization_id::text));
    select coalesce(max(l.number), 0) + 1 into new.number from public.leads l where l.organization_id = new.organization_id;
    if not v_system then
      new.created_by := auth.uid();
      new.merged_into_id := null;
      if new.status = 'merged' then new.status := 'new'; end if;
    end if;
  else
    if new.organization_id <> old.organization_id or new.number <> old.number
      or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'crm_immutable_fields' using errcode = '42501';
    end if;
  end if;
  if new.merged_into_id is not null and new.merged_into_id = new.id then
    raise exception 'invalid_merge' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger leads_before
before insert or update on public.leads
for each row execute function app.tg_leads_before();

-- ---------------------------------------------------------------------------
-- Deals: numbering, stage → status / probability / stamps, stage history
-- ---------------------------------------------------------------------------

create or replace function app.tg_deals_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_system boolean := auth.uid() is null or pg_trigger_depth() > 1;
  v_stage public.pipeline_stages;
  v_stage_changed boolean := tg_op = 'INSERT' or new.stage_id <> old.stage_id;
begin
  select * into v_stage from public.pipeline_stages where id = new.stage_id;
  if v_stage.id is null or v_stage.pipeline_id <> new.pipeline_id or v_stage.organization_id <> new.organization_id then
    raise exception 'invalid_stage' using errcode = '22023';
  end if;
  if new.package_id is not null and not exists (
    select 1 from public.packages p where p.id = new.package_id and p.organization_id = new.organization_id
  ) then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('deals:' || new.organization_id::text));
    select coalesce(max(d.number), 0) + 1 into new.number from public.deals d where d.organization_id = new.organization_id;
    if not v_system then
      new.created_by := auth.uid();
      new.client_id := null;
      new.converted_at := null;
      new.stale_notified_at := null;
    end if;
  else
    if new.organization_id <> old.organization_id or new.number <> old.number
      or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'crm_immutable_fields' using errcode = '42501';
    end if;
    -- A converted deal stays won: the client exists now.
    if old.converted_at is not null and v_stage.kind <> 'won' then
      raise exception 'invalid_transition' using errcode = '22023';
    end if;
    if not v_system then
      new.stale_notified_at := case when new.stage_id <> old.stage_id then null else old.stale_notified_at end;
      -- Conversion fields are set once, and only on a won deal.
      if old.converted_at is not null then
        new.client_id := old.client_id;
        new.converted_at := old.converted_at;
      elsif new.converted_at is not null and v_stage.kind <> 'won' then
        raise exception 'invalid_transition' using errcode = '22023';
      end if;
    end if;
  end if;

  new.status := v_stage.kind;
  if v_stage_changed then
    new.probability := v_stage.probability;
    new.last_activity_at := now();
  end if;
  if v_stage.kind = 'won' then
    new.won_at := case when tg_op = 'UPDATE' and old.status = 'won' then old.won_at else coalesce(case when v_system then new.won_at end, now()) end;
    new.lost_at := null;
    new.lost_reason := null;
    new.lost_note := null;
  elsif v_stage.kind = 'lost' then
    if new.lost_reason is null then
      raise exception 'reason_required' using errcode = '22023';
    end if;
    new.lost_at := case when tg_op = 'UPDATE' and old.status = 'lost' then old.lost_at else coalesce(case when v_system then new.lost_at end, now()) end;
    new.won_at := null;
  else
    new.won_at := null;
    new.lost_at := null;
    new.lost_reason := null;
    new.lost_note := null;
  end if;
  return new;
end $$;

create trigger deals_before
before insert or update on public.deals
for each row execute function app.tg_deals_before();

create or replace function app.tg_deals_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.stage_id <> old.stage_id then
    insert into public.deal_stage_history (organization_id, deal_id, from_stage_id, to_stage_id, actor_id, created_at)
    values (new.organization_id, new.id, case when tg_op = 'UPDATE' then old.stage_id end, new.stage_id,
      auth.uid(), case when tg_op = 'INSERT' then new.created_at else now() end);
  end if;
  return new;
end $$;

create trigger deals_after
after insert or update on public.deals
for each row execute function app.tg_deals_after();

-- Child rows take the organization of their deal / quote.
create or replace function app.tg_crm_child_org()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  if tg_table_name = 'quote_items' then
    select organization_id into v_org from public.quotes where id = new.quote_id;
  elsif tg_table_name = 'crm_activities' then
    if new.deal_id is not null then
      select organization_id into v_org from public.deals where id = new.deal_id;
    else
      select organization_id into v_org from public.leads where id = new.lead_id;
    end if;
  else
    select organization_id into v_org from public.deals where id = new.deal_id;
  end if;
  if v_org is null or v_org <> new.organization_id then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['deal_contacts', 'crm_activities', 'crm_files', 'quotes', 'quote_items'] loop
    execute format('create trigger crm_child_org before insert or update on public.%I for each row execute function app.tg_crm_child_org()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Activities keep their lead / deal "last activity" fresh (no-activity alerts read it)
-- ---------------------------------------------------------------------------

create or replace function app.tg_crm_activities_before()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.created_by := auth.uid();
    new.owner_id := coalesce(new.owner_id, auth.uid());
    new.reminded_at := null;
  end if;
  if tg_op = 'UPDATE' and (new.due_at is distinct from old.due_at) then
    new.reminded_at := null;
  end if;
  return new;
end $$;

create trigger crm_activities_before
before insert or update on public.crm_activities
for each row execute function app.tg_crm_activities_before();

create or replace function app.tg_crm_activities_after()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_at timestamptz := coalesce(new.completed_at, new.created_at);
begin
  -- Scheduled, not yet done activities don't count as contact.
  if new.due_at is not null and new.completed_at is null and new.type <> 'note' then
    return new;
  end if;
  if new.deal_id is not null then
    update public.deals set last_activity_at = greatest(last_activity_at, v_at), stale_notified_at = null where id = new.deal_id;
  end if;
  if new.lead_id is not null then
    update public.leads set last_activity_at = greatest(last_activity_at, v_at),
      status = case when status = 'new' then 'contacted' else status end
    where id = new.lead_id;
  end if;
  return new;
end $$;

create trigger crm_activities_after
after insert or update on public.crm_activities
for each row execute function app.tg_crm_activities_after();

-- ---------------------------------------------------------------------------
-- Quotes: numbering and totals (from items)
-- ---------------------------------------------------------------------------

create or replace function app.quote_recalculate(p_quote uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_subtotal bigint;
begin
  select coalesce(sum(round(i.quantity * i.unit_price_minor)), 0) into v_subtotal from public.quote_items i where i.quote_id = p_quote;
  perform set_config('app.quote_totals_write', '1', true);
  update public.quotes q set subtotal_minor = v_subtotal, total_minor = greatest(0, v_subtotal - q.discount_minor) where q.id = p_quote;
  perform set_config('app.quote_totals_write', '', true);
end $$;

create or replace function app.tg_quotes_before()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('quotes:' || new.organization_id::text));
    select coalesce(max(q.number), 0) + 1 into new.number from public.quotes q where q.organization_id = new.organization_id;
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
    new.subtotal_minor := 0;
    new.total_minor := 0;
  else
    if new.deal_id <> old.deal_id or new.number <> old.number or new.organization_id <> old.organization_id then
      raise exception 'crm_immutable_fields' using errcode = '42501';
    end if;
    if coalesce(current_setting('app.quote_totals_write', true), '') <> '1' then
      new.subtotal_minor := old.subtotal_minor;
      new.total_minor := greatest(0, old.subtotal_minor - new.discount_minor);
    end if;
    if new.status = 'sent' and old.status = 'draft' then new.sent_at := coalesce(new.sent_at, now()); end if;
  end if;
  return new;
end $$;

create trigger quotes_before
before insert or update on public.quotes
for each row execute function app.tg_quotes_before();

create or replace function app.tg_quote_items_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.quote_recalculate(coalesce(new.quote_id, old.quote_id));
  return null;
end $$;

create trigger quote_items_after
after insert or update or delete on public.quote_items
for each row execute function app.tg_quote_items_after();

-- ---------------------------------------------------------------------------
-- Settings guards
-- ---------------------------------------------------------------------------

create or replace function app.tg_crm_settings_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.onboarding_request_type_id is not null and not exists (
    select 1 from public.request_types t where t.id = new.onboarding_request_type_id and t.organization_id = new.organization_id
  ) then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  if new.onboarding_template_id is not null and not exists (
    select 1 from public.workflow_templates t where t.id = new.onboarding_template_id and t.organization_id = new.organization_id
  ) then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger crm_settings_guard
before insert or update on public.crm_settings
for each row execute function app.tg_crm_settings_guard();

create or replace function app.tg_capacity_member_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = new.organization_id and m.user_id = new.user_id and m.user_type = 'agency'
  ) then
    raise exception 'invalid_assignee' using errcode = '22023';
  end if;
  if tg_table_name = 'time_off' and tg_op = 'INSERT' and auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end $$;

create trigger member_capacity_guard before insert or update on public.member_capacity
for each row execute function app.tg_capacity_member_guard();
create trigger time_off_guard before insert or update on public.time_off
for each row execute function app.tg_capacity_member_guard();

create or replace function app.tg_service_efforts_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.departments d where d.id = new.department_id and d.organization_id = new.organization_id) then
    raise exception 'organization_mismatch' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger service_efforts_guard before insert or update on public.service_efforts
for each row execute function app.tg_service_efforts_guard();

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['lead_forms', 'leads', 'pipelines', 'deals', 'crm_activities', 'quotes', 'lead_assignment_rules',
    'sales_targets', 'crm_settings', 'member_capacity', 'service_efforts'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t);
  end loop;
  -- Activities and stage history carry their own trail; quote items are covered by the quote.
  foreach t in array array['lead_forms', 'leads', 'pipelines', 'pipeline_stages', 'deals', 'deal_contacts', 'quotes',
    'lead_assignment_rules', 'crm_webhook_tokens', 'sales_targets', 'crm_settings', 'member_capacity', 'time_off', 'service_efforts'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function app.audit_trigger()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS — agency only; nothing here reaches the portal.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['lead_forms', 'leads', 'pipelines', 'pipeline_stages', 'deals', 'deal_stage_history', 'deal_contacts',
    'crm_activities', 'crm_files', 'quotes', 'quote_items', 'lead_assignment_rules', 'crm_webhook_tokens', 'sales_targets',
    'crm_settings', 'member_capacity', 'time_off', 'service_efforts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Leads
create policy leads_select on public.leads for select to authenticated
  using ((select app.is_agency_member(organization_id)) and (select app.has_permission(organization_id, 'leads:read')));
create policy leads_insert on public.leads for insert to authenticated
  with check ((select app.crm_can_write(organization_id, owner_id, 'leads:manage')));
create policy leads_update on public.leads for update to authenticated
  using ((select app.crm_can_write(organization_id, owner_id, 'leads:manage')))
  with check ((select app.crm_can_write(organization_id, owner_id, 'leads:manage')));
create policy leads_delete on public.leads for delete to authenticated
  using ((select app.has_permission(organization_id, 'crm:manage_all')));

-- Deals
create policy deals_select on public.deals for select to authenticated
  using ((select app.is_agency_member(organization_id)) and (select app.has_permission(organization_id, 'deals:read')));
create policy deals_insert on public.deals for insert to authenticated
  with check ((select app.crm_can_write(organization_id, owner_id, 'deals:manage')));
create policy deals_update on public.deals for update to authenticated
  using ((select app.crm_can_write(organization_id, owner_id, 'deals:manage')))
  with check ((select app.crm_can_write(organization_id, owner_id, 'deals:manage')));
create policy deals_delete on public.deals for delete to authenticated
  using ((select app.has_permission(organization_id, 'crm:manage_all')) and converted_at is null);

revoke insert, update, delete on public.deal_stage_history from authenticated;
create policy deal_stage_history_select on public.deal_stage_history for select to authenticated
  using ((select app.is_agency_member(organization_id)) and (select app.has_permission(organization_id, 'deals:read')));

-- Deal children
do $$
declare t text;
begin
  foreach t in array array['deal_contacts', 'crm_files', 'quotes'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select app.is_agency_member(organization_id)) and (select app.has_permission(organization_id, ''deals:read'')))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select app.can_write_deal(deal_id)))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select app.can_write_deal(deal_id))) with check ((select app.can_write_deal(deal_id)))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select app.can_write_deal(deal_id)))', t || '_delete', t);
  end loop;
end $$;
revoke update on public.crm_files from authenticated;

create policy quote_items_select on public.quote_items for select to authenticated
  using ((select app.is_agency_member(organization_id)) and (select app.has_permission(organization_id, 'deals:read')));
create policy quote_items_write on public.quote_items for all to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_items.quote_id and (select app.can_write_deal(q.deal_id))))
  with check (exists (select 1 from public.quotes q where q.id = quote_items.quote_id and (select app.can_write_deal(q.deal_id))));

-- Activities: through their lead or deal.
create policy crm_activities_select on public.crm_activities for select to authenticated
  using (
    (select app.is_agency_member(organization_id)) and (
      (deal_id is not null and (select app.has_permission(organization_id, 'deals:read')))
      or (deal_id is null and (select app.has_permission(organization_id, 'leads:read')))
    )
  );
create policy crm_activities_insert on public.crm_activities for insert to authenticated
  with check (
    (deal_id is not null and (select app.can_write_deal(deal_id)))
    or (deal_id is null and lead_id is not null and (select app.can_write_lead(lead_id)))
  );
create policy crm_activities_update on public.crm_activities for update to authenticated
  using (
    (deal_id is not null and (select app.can_write_deal(deal_id)))
    or (deal_id is null and lead_id is not null and (select app.can_write_lead(lead_id)))
  )
  with check (
    (deal_id is not null and (select app.can_write_deal(deal_id)))
    or (deal_id is null and lead_id is not null and (select app.can_write_lead(lead_id)))
  );
create policy crm_activities_delete on public.crm_activities for delete to authenticated
  using (created_by = (select auth.uid()) or (select app.has_permission(organization_id, 'crm:manage_all')));

-- Settings-like tables: readable by CRM users, written by crm:admin.
do $$
declare t text;
begin
  foreach t in array array['lead_forms', 'pipelines', 'pipeline_stages', 'lead_assignment_rules', 'sales_targets', 'crm_settings'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select app.crm_can_read(organization_id)))', t || '_select', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select app.has_permission(organization_id, ''crm:admin''))) with check ((select app.has_permission(organization_id, ''crm:admin'')))', t || '_write', t);
  end loop;
end $$;

create policy crm_webhook_tokens_all on public.crm_webhook_tokens for all to authenticated
  using ((select app.has_permission(organization_id, 'crm:admin')))
  with check ((select app.has_permission(organization_id, 'crm:admin')));

-- Capacity
create policy member_capacity_select on public.member_capacity for select to authenticated
  using ((select app.has_permission(organization_id, 'capacity:read')) or user_id = (select auth.uid()));
create policy member_capacity_write on public.member_capacity for all to authenticated
  using ((select app.has_permission(organization_id, 'capacity:manage')))
  with check ((select app.has_permission(organization_id, 'capacity:manage')));
create policy time_off_select on public.time_off for select to authenticated
  using ((select app.has_permission(organization_id, 'capacity:read')) or user_id = (select auth.uid()));
create policy time_off_write on public.time_off for all to authenticated
  using ((select app.has_permission(organization_id, 'capacity:manage')))
  with check ((select app.has_permission(organization_id, 'capacity:manage')));
create policy service_efforts_select on public.service_efforts for select to authenticated
  using ((select app.has_permission(organization_id, 'capacity:read')));
create policy service_efforts_write on public.service_efforts for all to authenticated
  using ((select app.has_permission(organization_id, 'capacity:manage')))
  with check ((select app.has_permission(organization_id, 'capacity:manage')));

-- ---------------------------------------------------------------------------
-- Function privileges (new functions)
-- ---------------------------------------------------------------------------

revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
revoke all on function app.bootstrap_organization(uuid) from public, anon, authenticated;
revoke all on function app.seed_task_statuses(uuid) from public, anon, authenticated;
revoke all on function app.seed_crm_defaults(uuid) from public, anon, authenticated;
revoke all on function app.quote_recalculate(uuid) from public, anon, authenticated;
revoke all on function app.deliverable_sync(uuid) from public, anon, authenticated;
revoke all on function app.request_sync_usage(uuid) from public, anon, authenticated;
revoke all on function app.request_submit_fields(public.requests) from public, anon, authenticated;
revoke all on function app.app_claims_for(uuid), app.sync_app_claims(uuid), app.sync_app_claims_trigger() from public, anon, authenticated;
