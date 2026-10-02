-- Feedback Round 1 (FR1.2): RLS performance (ADR-082).
--
-- Policies called per-row SECURITY DEFINER access functions — `(select app.agency_can_read_tasks(t.client_id))` — which
-- Postgres runs once per row (a correlated SubPlan, ~2 ms each), and once more per row of every table the query
-- touches. With 1,000 tasks the Tasks list took 5–8 s in the database. The same rules are now computed once per
-- statement as arrays (an uncorrelated `(select …)` becomes an InitPlan) and policies test `client_id = any(…)`.
-- The array functions use exactly the per-row functions' logic, so access is unchanged; tests/db cover allow and deny.

create or replace function app.agency_org_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(m.organization_id), '{}') from public.organization_members m
  where m.user_id = auth.uid() and m.status = 'active' and m.user_type = 'agency'
$$;

create or replace function app.org_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(m.organization_id), '{}') from public.organization_members m
  where m.user_id = auth.uid() and m.status = 'active'
$$;

-- Same rule as app.agency_can_access_client(), for every client at once.
create or replace function app.agency_client_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(c.id), '{}') from public.clients c
  where c.organization_id = any (app.agency_org_ids()) and (c.deleted_at is null or app.trash_mode()) and (
    app.has_permission(c.organization_id, 'clients:read_all')
    or (
      app.has_permission(c.organization_id, 'clients:read_assigned')
      and (
        c.account_manager_id = auth.uid()
        or exists (select 1 from public.client_assignments a where a.client_id = c.id and a.user_id = auth.uid())
      )
    )
  )
$$;

-- Same rule as app.agency_can_read_tasks().
create or replace function app.agency_task_client_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(c.id), '{}') from public.clients c
  where c.id = any (app.agency_client_ids()) and app.has_permission(c.organization_id, 'tasks:read')
$$;

-- Same rule as app.agency_can_read_requests().
create or replace function app.agency_request_client_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(c.id), '{}') from public.clients c
  where c.id = any (app.agency_client_ids()) and app.has_permission(c.organization_id, 'requests:read')
$$;

-- Same rule as app.is_client_member().
create or replace function app.member_client_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(cu.client_id), '{}') from public.client_users cu
  join public.organization_members m on m.organization_id = cu.organization_id and m.user_id = cu.user_id
  join public.clients c on c.id = cu.client_id
  where cu.user_id = auth.uid() and cu.status = 'active' and cu.deleted_at is null and m.status = 'active'
    and m.deleted_at is null and m.user_type = 'client' and c.deleted_at is null
$$;

grant execute on function app.agency_org_ids(), app.org_ids(), app.agency_client_ids(), app.agency_task_client_ids(),
  app.agency_request_client_ids(), app.member_client_ids() to authenticated, service_role;

-- Rewrites every policy expression that calls one of the per-row functions on a column into the array form.
create or replace function app.initplan_access(expr text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  r text := expr;
begin
  if r is null then
    return null;
  end if;
  r := regexp_replace(r, '\( SELECT app\.agency_can_access_client\(([\w.]+)\) AS agency_can_access_client\)',
    '(\1 = ANY ((SELECT app.agency_client_ids())::uuid[]))', 'g');
  r := regexp_replace(r, '\( SELECT app\.agency_can_read_tasks\(([\w.]+)\) AS agency_can_read_tasks\)',
    '(\1 = ANY ((SELECT app.agency_task_client_ids())::uuid[]))', 'g');
  r := regexp_replace(r, '\( SELECT app\.agency_can_read_requests\(([\w.]+)\) AS agency_can_read_requests\)',
    '(\1 = ANY ((SELECT app.agency_request_client_ids())::uuid[]))', 'g');
  r := regexp_replace(r, '\( SELECT app\.is_client_member\(([\w.]+)\) AS is_client_member\)',
    '(\1 = ANY ((SELECT app.member_client_ids())::uuid[]))', 'g');
  r := regexp_replace(r, '\( SELECT app\.can_access_client\(([\w.]+)\) AS can_access_client\)',
    '((\1 = ANY ((SELECT app.agency_client_ids())::uuid[])) OR (\1 = ANY ((SELECT app.member_client_ids())::uuid[])))', 'g');
  r := regexp_replace(r, '\( SELECT app\.is_agency_member\(([\w.]+)\) AS is_agency_member\)',
    '(\1 = ANY ((SELECT app.agency_org_ids())::uuid[]))', 'g');
  r := regexp_replace(r, '\( SELECT app\.is_org_member\(([\w.]+)\) AS is_org_member\)',
    '(\1 = ANY ((SELECT app.org_ids())::uuid[]))', 'g');
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
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ '\( SELECT app\.(agency_can_access_client|agency_can_read_tasks|agency_can_read_requests|is_client_member|can_access_client|is_agency_member|is_org_member)\('
  loop
    v_using := app.initplan_access(p.qual);
    v_check := app.initplan_access(p.with_check);
    execute format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename)
      || case when v_using is not null then format(' using (%s)', v_using) else '' end
      || case when v_check is not null then format(' with check (%s)', v_check) else '' end;
  end loop;
end $$;

-- Same rule as app.can_see_profile(), for every profile at once.
create or replace function app.visible_profile_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x.id), '{}') from (
    select auth.uid() as id
    union all
    select them.user_id from public.organization_members me
    join public.organization_members them on them.organization_id = me.organization_id
    where me.user_id = auth.uid() and me.status = 'active' and me.user_type = 'agency'
    union all
    select theirs.user_id from public.client_users mine
    join public.client_users theirs on theirs.client_id = mine.client_id
    where mine.user_id = auth.uid() and mine.status = 'active'
    union all
    select p.user_id from public.client_users mine
    join public.clients c on c.id = mine.client_id
    cross join lateral (
      select c.account_manager_id as user_id
      union all select a.user_id from public.client_assignments a where a.client_id = c.id
      union all select cm.author_id from public.comments cm where cm.client_id = c.id and cm.visibility = 'client'
      union all select f.uploaded_by from public.files f where f.client_id = c.id and f.visibility = 'client'
      union all select r.assignee_id from public.requests r where r.client_id = c.id
    ) p
    where mine.user_id = auth.uid() and mine.status = 'active' and p.user_id is not null
  ) x where x.id is not null
$$;
grant execute on function app.visible_profile_ids() to authenticated, service_role;

alter policy profiles_select on public.profiles
  using (id = (select auth.uid()) or id = any ((select app.visible_profile_ids())::uuid[]));
