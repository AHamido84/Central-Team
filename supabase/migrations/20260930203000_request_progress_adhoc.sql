-- FR1.3: request progress follows the request's actual tasks. Tasks added outside the workflow (at conversion review
-- or later) count for the agency, named by their title; the portal keeps seeing workflow steps only, by step name.
create or replace function app.request_progress(p_request uuid)
returns table (step_order integer, name jsonb, state text, due_date date)
language sql stable security definer set search_path = '' as $$
  select t.step_order, coalesce(s.name, jsonb_build_object('ar', t.title, 'en', t.title)),
    case
      when t.status_category = 'done' then 'done'
      when exists (
        select 1 from public.task_dependencies dep join public.tasks b on b.id = dep.depends_on_id
        where dep.task_id = t.id and b.status_category <> 'done' and b.deleted_at is null
      ) then 'pending'
      when t.status_category = 'todo' then 'pending'
      when t.status_category = 'review' then 'review'
      else 'active'
    end,
    t.due_date
  from public.tasks t
  left join public.workflow_template_steps s on s.id = t.workflow_step_id
  join public.requests r on r.id = t.request_id
  where t.request_id = p_request and t.parent_id is null and t.deleted_at is null
    and (
      app.agency_can_read_requests(r.client_id)
      or (app.is_client_member(r.client_id) and t.workflow_step_id is not null)
    )
  order by t.step_order nulls last, t.created_at;
$$;
