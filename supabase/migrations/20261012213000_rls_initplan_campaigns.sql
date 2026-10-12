-- FR7 (ADR-098): the ADR-082 treatment for the remaining per-row access functions. Policies called
-- `(select app.agency_can_task(x.client_id, '<permission>'))`, `(select app.client_can_see_campaign(x.campaign_id))`
-- and `(select app.has_permission(x.organization_id, '<permission>'))` — correlated SubPlans run once per row
-- (~0.5–2 ms each). Twelve months of daily metrics made the campaign list (and the Executive Center, which reuses it)
-- take ~18 s, and a year of time entries ~1 s. The same rules are now computed once per statement as arrays; the
-- logic is unchanged and tests/db cover allow and deny.

-- Same rule as app.agency_can_task(client, permission), for every client at once.
create or replace function app.agency_permission_client_ids(p_permission text)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(c.id), '{}') from public.clients c
  where c.id = any (app.agency_client_ids()) and app.has_permission(c.organization_id, p_permission)
$$;

-- Same rule as app.client_can_see_campaign(campaign), for every campaign at once.
create or replace function app.client_visible_campaign_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(c.id), '{}') from public.campaigns c
  where c.visibility = 'client'
    and c.status in ('planned', 'active', 'paused', 'completed')
    and c.client_id = any (app.member_client_ids())
    and app.feature_enabled(c.organization_id, 'module.campaigns')
$$;

-- Same rule as app.has_permission(org, permission), for every organization at once (it requires agency membership).
create or replace function app.permission_org_ids(p_permission text)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(o), '{}') from unnest(app.agency_org_ids()) o where app.has_permission(o, p_permission)
$$;

grant execute on function app.agency_permission_client_ids(text), app.client_visible_campaign_ids(), app.permission_org_ids(text)
  to authenticated, service_role;

create or replace function app.initplan_access_v2(expr text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  r text := expr;
begin
  if r is null then
    return null;
  end if;
  r := regexp_replace(r, '\( SELECT app\.agency_can_task\(([\w.]+), ''([\w:]+)''::text\) AS agency_can_task\)',
    '(\1 = ANY ((SELECT app.agency_permission_client_ids(''\2''::text))::uuid[]))', 'g');
  r := regexp_replace(r, '\( SELECT app\.client_can_see_campaign\(([\w.]+)\) AS client_can_see_campaign\)',
    '(\1 = ANY ((SELECT app.client_visible_campaign_ids())::uuid[]))', 'g');
  r := regexp_replace(r, '\( SELECT app\.has_permission\(([\w.]+), ''([\w:]+)''::text\) AS has_permission\)',
    '(\1 = ANY ((SELECT app.permission_org_ids(''\2''::text))::uuid[]))', 'g');
  return r;
end $$;

do $$
declare
  p record;
  v_using text;
  v_check text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check from pg_policies
    where schemaname in ('public', 'storage')
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ '\( SELECT app\.(agency_can_task|client_can_see_campaign|has_permission)\('
  loop
    v_using := app.initplan_access_v2(p.qual);
    v_check := app.initplan_access_v2(p.with_check);
    execute format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename)
      || case when v_using is not null then format(' using (%s)', v_using) else '' end
      || case when v_check is not null then format(' with check (%s)', v_check) else '' end;
  end loop;
end $$;

drop function app.initplan_access_v2(text);
