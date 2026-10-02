-- Mirror the access-token app claims into auth.users.raw_app_meta_data.app (ADR-046). Supabase copies app metadata
-- into every token as `app_metadata`, so sign-in and routing work even where the custom access token hook is not
-- enabled (a hosted project needs it switched on in the dashboard). The hook stays the primary source.

create or replace function app.app_claims_for(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
  v_type text;
  v_onboarded boolean;
begin
  -- Same choice as public.custom_access_token_hook: an active agency membership wins, then the oldest one.
  select m.organization_id, m.user_type into v_org, v_type
  from public.organization_members m
  where m.user_id = p_user and m.status = 'active'
  order by (m.user_type = 'agency') desc, m.created_at
  limit 1;
  select p.onboarded_at is not null into v_onboarded from public.profiles p where p.id = p_user;
  return jsonb_build_object('org_id', v_org, 'user_type', v_type, 'onboarded', coalesce(v_onboarded, false));
end $$;

create or replace function app.sync_app_claims(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update auth.users u
  set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('app', app.app_claims_for(p_user))
  where u.id = p_user;
end $$;

create or replace function app.sync_app_claims_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'profiles' then
    perform app.sync_app_claims(coalesce(new.id, old.id));
  else
    if tg_op <> 'INSERT' then perform app.sync_app_claims(old.user_id); end if;
    if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id) then
      perform app.sync_app_claims(new.user_id);
    end if;
  end if;
  return null;
end $$;

create trigger sync_app_claims
after insert or delete or update of user_id, organization_id, user_type, status on public.organization_members
for each row execute function app.sync_app_claims_trigger();

create trigger sync_app_claims
after update of onboarded_at on public.profiles
for each row execute function app.sync_app_claims_trigger();

revoke execute on function app.app_claims_for(uuid), app.sync_app_claims(uuid), app.sync_app_claims_trigger()
  from public, anon, authenticated;

-- Backfill existing users.
select app.sync_app_claims(u.id) from auth.users u;
