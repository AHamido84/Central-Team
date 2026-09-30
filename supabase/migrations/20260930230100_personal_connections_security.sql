-- FR1.6 / ADR-086: personal platform connections ("My connected accounts").
-- Owners (with `integrations:connect`) see and use their own connections, their ad accounts and campaigns; people with
-- `integrations:read` / `integrations:manage` see every connection (tokens stay in Vault either way) and managers can
-- reassign them. Client users see nothing (the existing policies already require agency membership).

insert into public.permissions (key, resource, action, side, module, sort_order, label) values
  ('integrations:connect', 'integrations', 'connect', 'agency', 'integrations', 212,
   '{"ar":"ربط حساباته الشخصية على المنصات","en":"Connect their own platform accounts"}')
on conflict (key) do nothing;

-- Media and account people connect their own ad accounts; admins can too.
insert into public.role_permissions (role_id, permission_key, organization_id)
select r.id, 'integrations:connect', r.organization_id from public.roles r
where r.is_system and r.key in ('super_admin', 'admin', 'account_manager', 'team_lead', 'specialist')
on conflict do nothing;

create or replace function app.fr1_role_grants(p_role_key text)
returns text[] language sql immutable set search_path = '' as $$
  select case
    when p_role_key in ('super_admin', 'admin') then array[
      'clients:delete', 'clients:purge', 'client_users:delete', 'client_users:purge', 'users:delete', 'users:purge',
      'packages:delete', 'packages:purge', 'request_types:delete', 'request_types:purge', 'workflows:delete',
      'workflows:purge', 'requests:delete', 'requests:purge', 'tasks:purge', 'files:delete', 'files:purge',
      'deliverables:delete', 'deliverables:purge', 'messages:delete', 'messages:purge', 'tasks:edit_all',
      'integrations:connect']
    when p_role_key = 'account_manager' then array['client_users:delete', 'requests:delete', 'files:delete', 'deliverables:delete',
      'messages:delete', 'tasks:edit_managed', 'integrations:connect']
    when p_role_key = 'team_lead' then array['requests:delete', 'files:delete', 'deliverables:delete', 'messages:delete',
      'tasks:edit_managed', 'integrations:connect']
    when p_role_key = 'specialist' then array['integrations:connect']
    else array[]::text[]
  end;
$$;

-- Is this the signed-in user's own personal connection (and may they still connect accounts)?
create or replace function app.owns_connection(p_connection uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.integration_connections c
    where c.id = p_connection and c.owner_id = auth.uid()
      and c.organization_id = any (app.agency_org_ids())
      and app.has_permission(c.organization_id, 'integrations:connect')
  )
$$;
grant execute on function app.owns_connection(uuid) to authenticated;

create policy integration_connections_select_own on public.integration_connections for select to authenticated
  using (owner_id = (select auth.uid()) and (select app.owns_connection(id)));

create policy integration_accounts_select_own on public.integration_accounts for select to authenticated
  using ((select app.owns_connection(connection_id)));
-- Owners map their ad accounts to clients they can reach (and switch sync on/off for them).
create policy integration_accounts_update_own on public.integration_accounts for update to authenticated
  using ((select app.owns_connection(connection_id)))
  with check ((select app.owns_connection(connection_id)) and (client_id is null or app.agency_can_access_client(client_id)));

create policy integration_campaign_links_select_own on public.integration_campaign_links for select to authenticated
  using (exists (select 1 from public.integration_accounts a where a.id = account_id and app.owns_connection(a.connection_id)));

-- Users may rename a connection; integration managers may also hand a personal connection to someone else.
create or replace function app.tg_integration_connections_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id or new.provider <> old.provider then
      raise exception 'integration_immutable_fields' using errcode = '42501';
    end if;
    if app.is_user_write() then
      if new.owner_id is distinct from old.owner_id
        and (old.owner_id is null or new.owner_id is null
          or not app.has_permission(old.organization_id, 'integrations:manage')
          or not app.member_has_permission(old.organization_id, new.owner_id, 'integrations:connect')) then
        raise exception 'integration_owner_change_denied' using errcode = '42501';
      end if;
      -- Tokens, status and health change only through the service path.
      new := jsonb_populate_record(old, jsonb_build_object('name', new.name, 'updated_at', new.updated_at, 'owner_id', new.owner_id));
    end if;
  end if;
  return new;
end $$;
