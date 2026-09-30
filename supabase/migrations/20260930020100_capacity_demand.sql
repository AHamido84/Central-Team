-- Phase 6 — capacity demand readers.
-- Capacity is an org-wide aggregate: a team lead planning the video department needs every estimated task, every
-- active package and every weighted deal, even for clients and deals their own RLS doesn't show. These definer
-- functions return only the numbers the planner needs (no titles, names, notes or deal values), and only to members
-- holding `capacity:read` (ADR-060).

create or replace function app.capacity_tasks(p_org uuid)
returns table (task_id uuid, client_id uuid, department_id uuid, estimate_minutes integer, start_date date, due_date date, assignee_ids uuid[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_permission(p_org, 'capacity:read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select t.id, t.client_id, t.department_id, t.estimate_minutes, t.start_date, t.due_date,
      coalesce((select array_agg(m.user_id) from public.task_members m where m.task_id = t.id and m.role = 'assignee'), '{}'::uuid[])
    from public.tasks t
    where t.organization_id = p_org and t.status_category <> 'done'
      and t.estimate_minutes is not null and t.estimate_minutes > 0 and t.due_date is not null;
end;
$$;

-- The current package period of each client that is onboarding or active, with what was used so far.
create or replace function app.capacity_packages(p_org uuid, p_today date)
returns table (client_id uuid, period_start date, period_end date, item_type text, quantity integer, used integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_permission(p_org, 'capacity:read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select cp.client_id, cp.period_start, cp.period_end, pi.item_type, pi.quantity,
      coalesce((select sum(u.quantity)::integer from public.package_usage_entries u
        where u.client_package_id = cp.id and u.item_type = pi.item_type), 0)
    from public.client_packages cp
    join public.clients c on c.id = cp.client_id and c.status in ('onboarding', 'active')
    join public.package_items pi on pi.package_id = cp.package_id
    where cp.organization_id = p_org and p_today between cp.period_start and cp.period_end;
end;
$$;

-- Open deals with a target package: probability, expected close and the package's items.
create or replace function app.capacity_deals(p_org uuid)
returns table (deal_id uuid, probability integer, expected_close_date date, item_type text, quantity integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_permission(p_org, 'capacity:read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select d.id, d.probability, d.expected_close_date, pi.item_type, pi.quantity
    from public.deals d
    join public.package_items pi on pi.package_id = d.package_id
    where d.organization_id = p_org and d.status = 'open';
end;
$$;

revoke all on function app.capacity_tasks(uuid), app.capacity_packages(uuid, date), app.capacity_deals(uuid) from public, anon;
grant execute on function app.capacity_tasks(uuid), app.capacity_packages(uuid, date), app.capacity_deals(uuid) to authenticated, service_role;
