-- The invitations guard re-validated role grants on every UPDATE, so an unrelated update (a department deleted →
-- `department_id` set null by its foreign key, e.g. during the factory reset, ADR-081) failed with `invalid_role` once
-- the roles were gone. Roles are checked when an invitation is created or its roles change; other updates pass.
create or replace function app.tg_invitations_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_role_id uuid; v_role public.roles;
begin
  if tg_op = 'UPDATE' and new.user_type = old.user_type and new.role_ids is not distinct from old.role_ids
    and new.client_role_id is not distinct from old.client_role_id then
    return new;
  end if;
  if new.user_type = 'agency' then
    foreach v_role_id in array new.role_ids loop
      select * into v_role from public.roles where id = v_role_id;
      if v_role.id is null or v_role.side <> 'agency' or v_role.organization_id <> new.organization_id then
        raise exception 'invalid_role' using errcode = '22023';
      end if;
      if v_role.is_locked and auth.uid() is not null and not app.is_super_admin(new.organization_id) then
        raise exception 'cannot_grant_unheld_permission' using errcode = '42501';
      end if;
      perform app.assert_can_grant(new.organization_id, app.role_permission_keys(v_role_id));
    end loop;
  else
    select * into v_role from public.roles where id = new.client_role_id;
    if v_role.id is null or v_role.side <> 'client' or v_role.organization_id <> new.organization_id then
      raise exception 'invalid_role' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
