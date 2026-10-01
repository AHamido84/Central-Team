-- FR2.1 / ADR-088: the organization's sender and the outgoing email queue / log.
-- Secrets (password, app password, API key) live in Vault: users with `mail:manage` write them but never read them back;
-- only the service path decrypts (to send). The outbox is written only by the service path; admins read its metadata.

insert into public.permissions (key, resource, action, side, module, sort_order, label) values
  ('mail:manage', 'mail', 'manage', 'agency', 'settings', 95,
   '{"ar":"إدارة إعدادات البريد وسجل الرسائل","en":"Manage mail settings and the email log"}')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key, organization_id)
select r.id, 'mail:manage', r.organization_id from public.roles r
where r.is_system and r.key in ('super_admin', 'admin')
on conflict do nothing;

-- New organizations get it through the Feedback Round grants used by app.bootstrap_organization.
create or replace function app.fr1_role_grants(p_role_key text)
returns text[] language sql immutable set search_path = '' as $$
  select case
    when p_role_key in ('super_admin', 'admin') then array[
      'clients:delete', 'clients:purge', 'client_users:delete', 'client_users:purge', 'users:delete', 'users:purge',
      'packages:delete', 'packages:purge', 'request_types:delete', 'request_types:purge', 'workflows:delete',
      'workflows:purge', 'requests:delete', 'requests:purge', 'tasks:purge', 'files:delete', 'files:purge',
      'deliverables:delete', 'deliverables:purge', 'messages:delete', 'messages:purge', 'tasks:edit_all',
      'integrations:connect', 'mail:manage']
    when p_role_key = 'account_manager' then array['client_users:delete', 'requests:delete', 'files:delete', 'deliverables:delete',
      'messages:delete', 'tasks:edit_managed', 'integrations:connect']
    when p_role_key = 'team_lead' then array['requests:delete', 'files:delete', 'deliverables:delete', 'messages:delete',
      'tasks:edit_managed', 'integrations:connect']
    when p_role_key = 'specialist' then array['integrations:connect']
    else array[]::text[]
  end;
$$;

-- mail_settings ---------------------------------------------------------------------------------------------------
alter table public.mail_settings enable row level security;
revoke all on public.mail_settings from anon, authenticated;
grant select (id, organization_id, preset, host, port, security, username, from_name, from_email, reply_to, daily_limit,
  is_active, secret_hint, last_tested_at, last_test_ok, last_test_error, last_success_at, fallback_since, limit_warned_on,
  updated_by, created_at, updated_at) on public.mail_settings to authenticated;
grant insert (id, organization_id, preset, host, port, security, username, from_name, from_email, reply_to, daily_limit,
  is_active, updated_by) on public.mail_settings to authenticated;
grant update (preset, host, port, security, username, from_name, from_email, reply_to, daily_limit, is_active, updated_by)
  on public.mail_settings to authenticated;
grant delete on public.mail_settings to authenticated;

create policy mail_settings_select on public.mail_settings for select to authenticated
  using (organization_id = any ((select app.agency_org_ids())::uuid[]) and app.has_permission(organization_id, 'mail:manage'));
create policy mail_settings_insert on public.mail_settings for insert to authenticated
  with check (organization_id = any ((select app.agency_org_ids())::uuid[]) and app.has_permission(organization_id, 'mail:manage'));
create policy mail_settings_update on public.mail_settings for update to authenticated
  using (organization_id = any ((select app.agency_org_ids())::uuid[]) and app.has_permission(organization_id, 'mail:manage'))
  with check (organization_id = any ((select app.agency_org_ids())::uuid[]) and app.has_permission(organization_id, 'mail:manage'));
create policy mail_settings_delete on public.mail_settings for delete to authenticated
  using (organization_id = any ((select app.agency_org_ids())::uuid[]) and app.has_permission(organization_id, 'mail:manage'));

-- Stores (or rotates) the sender's secret in Vault; write-only for `mail:manage`. Returns the masked hint.
create or replace function app.mail_put_secret(p_settings uuid, p_secret text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  m public.mail_settings;
  v_id uuid;
begin
  select * into m from public.mail_settings where id = p_settings;
  if m.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if app.is_user_write() and not (app.is_agency_member(m.organization_id) and app.has_permission(m.organization_id, 'mail:manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(coalesce(p_secret, '')) < 4 or char_length(p_secret) > 500 then
    raise exception 'validation' using errcode = '22023';
  end if;
  if m.secret_id is null then
    v_id := vault.create_secret(p_secret, 'mail:' || p_settings::text, 'Central mail sender secret');
  else
    v_id := m.secret_id;
    perform vault.update_secret(v_id, p_secret);
  end if;
  update public.mail_settings
  set secret_id = v_id, secret_hint = app.mask_secret(p_secret), last_tested_at = null, last_test_ok = null,
    last_test_error = null, updated_at = now()
  where id = p_settings;
  return app.mask_secret(p_secret);
end $$;

-- Decrypts the secret: the service path only (sending, connection tests).
create or replace function app.mail_get_secret(p_settings uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_secret text;
begin
  if app.is_user_write() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select d.decrypted_secret into v_secret
  from public.mail_settings m join vault.decrypted_secrets d on d.id = m.secret_id
  where m.id = p_settings;
  return v_secret;
end $$;

create or replace function app.tg_mail_settings_after_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.secret_id is not null then
    delete from vault.secrets where id = old.secret_id;
  end if;
  return old;
end $$;

create trigger mail_settings_after_delete after delete on public.mail_settings
for each row execute function app.tg_mail_settings_after_delete();
create trigger audit after insert or update or delete on public.mail_settings
for each row execute function app.audit_trigger();
create trigger set_updated_at before update on public.mail_settings
for each row execute function app.set_updated_at();

revoke all on function app.mail_put_secret(uuid, text) from public, anon;
revoke all on function app.mail_get_secret(uuid) from public, anon, authenticated;
grant execute on function app.mail_put_secret(uuid, text) to authenticated, service_role;
grant execute on function app.mail_get_secret(uuid) to service_role;

-- email_outbox ----------------------------------------------------------------------------------------------------
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;
-- Metadata only: bodies (which may hold sign-in links) are never readable by users.
grant select (id, organization_id, kind, to_email, user_id, locale, subject, reply_to, tags, sensitive, status, attempts,
  next_attempt_at, error_code, error_message, provider, sender, provider_message_id, sent_at, resent_from, created_by,
  created_at, updated_at) on public.email_outbox to authenticated;

create policy email_outbox_select on public.email_outbox for select to authenticated
  using (organization_id = any ((select app.agency_org_ids())::uuid[]) and app.has_permission(organization_id, 'mail:manage'));

create trigger set_updated_at before update on public.email_outbox
for each row execute function app.set_updated_at();
