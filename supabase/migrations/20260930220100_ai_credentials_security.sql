-- FR1.5 / ADR-085: AI provider credentials. Keys are stored in Supabase Vault; users with `ai:manage` can add, rename,
-- limit, switch and rotate them but never read them back — only the service path decrypts (to call the provider).

alter table public.ai_credentials enable row level security;
revoke all on public.ai_credentials from anon, authenticated;
-- Every column except the Vault reference.
grant select (id, organization_id, provider, display_name, key_hint, default_model, monthly_token_limit, is_active,
  last_tested_at, last_test_ok, last_test_error, created_by, updated_by, created_at, updated_at) on public.ai_credentials to authenticated;
grant insert (id, organization_id, provider, display_name, key_hint, default_model, monthly_token_limit, is_active, created_by, updated_by)
  on public.ai_credentials to authenticated;
grant update (display_name, default_model, monthly_token_limit, is_active, updated_by) on public.ai_credentials to authenticated;
grant delete on public.ai_credentials to authenticated;

create policy ai_credentials_select on public.ai_credentials for select to authenticated
  using (organization_id = any ((select app.agency_org_ids())::uuid[]) and app.has_permission(organization_id, 'ai:manage'));
create policy ai_credentials_insert on public.ai_credentials for insert to authenticated
  with check (organization_id = any ((select app.agency_org_ids())::uuid[]) and app.has_permission(organization_id, 'ai:manage'));
create policy ai_credentials_update on public.ai_credentials for update to authenticated
  using (organization_id = any ((select app.agency_org_ids())::uuid[]) and app.has_permission(organization_id, 'ai:manage'))
  with check (organization_id = any ((select app.agency_org_ids())::uuid[]) and app.has_permission(organization_id, 'ai:manage'));
create policy ai_credentials_delete on public.ai_credentials for delete to authenticated
  using (organization_id = any ((select app.agency_org_ids())::uuid[]) and app.has_permission(organization_id, 'ai:manage'));

-- "sk-ant-api03-…a1b2": enough to recognise a key, useless to anyone who sees it.
create or replace function app.mask_secret(p_secret text)
returns text language sql immutable set search_path = '' as $$
  select case when char_length(p_secret) <= 8 then '••••' else left(p_secret, 3) || '…' || right(p_secret, 4) end
$$;

-- Stores (or rotates) a credential's key in Vault; write-only for users with ai:manage.
create or replace function app.ai_credential_put_key(p_credential uuid, p_key text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  c public.ai_credentials;
  v_id uuid;
begin
  select * into c from public.ai_credentials where id = p_credential;
  if c.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if app.is_user_write() and not (app.is_agency_member(c.organization_id) and app.has_permission(c.organization_id, 'ai:manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(coalesce(p_key, '')) < 8 or char_length(p_key) > 500 then
    raise exception 'validation' using errcode = '22023';
  end if;
  if c.secret_id is null then
    v_id := vault.create_secret(p_key, 'ai:' || p_credential::text, 'Central AI provider key');
  else
    v_id := c.secret_id;
    perform vault.update_secret(v_id, p_key);
  end if;
  update public.ai_credentials
  set secret_id = v_id, key_hint = app.mask_secret(p_key), last_tested_at = null, last_test_ok = null, last_test_error = null,
    updated_at = now()
  where id = p_credential;
  return app.mask_secret(p_key);
end $$;

-- Decrypts a key: the service path only (provider calls). Users get "forbidden" even for their own organization.
create or replace function app.ai_credential_get_key(p_credential uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_key text;
begin
  if app.is_user_write() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select d.decrypted_secret into v_key
  from public.ai_credentials c join vault.decrypted_secrets d on d.id = c.secret_id
  where c.id = p_credential;
  return v_key;
end $$;

-- Test results are bookkeeping written by the service path after calling the provider.
create or replace function app.ai_credential_record_test(p_credential uuid, p_ok boolean, p_error text)
returns void language sql security definer set search_path = '' as $$
  update public.ai_credentials set last_tested_at = now(), last_test_ok = p_ok, last_test_error = left(p_error, 300)
  where id = p_credential and not app.is_user_write();
$$;

create or replace function app.tg_ai_credentials_after_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.secret_id is not null then
    delete from vault.secrets where id = old.secret_id;
  end if;
  return old;
end $$;

create trigger ai_credentials_after_delete after delete on public.ai_credentials
for each row execute function app.tg_ai_credentials_after_delete();

create trigger audit after insert or update or delete on public.ai_credentials
for each row execute function app.audit_trigger();

create trigger set_updated_at before update on public.ai_credentials
for each row execute function app.set_updated_at();

revoke all on function app.ai_credential_put_key(uuid, text) from public, anon;
revoke all on function app.ai_credential_get_key(uuid) from public, anon, authenticated;
revoke all on function app.ai_credential_record_test(uuid, boolean, text) from public, anon, authenticated;
grant execute on function app.ai_credential_put_key(uuid, text) to authenticated, service_role;
grant execute on function app.ai_credential_get_key(uuid), app.ai_credential_record_test(uuid, boolean, text) to service_role;
