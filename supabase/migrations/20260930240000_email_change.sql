-- FR1.7 / ADR-087: email change.
-- * The signed-in user can read and cancel their own pending change (GoTrue has no endpoint for either).
-- * A completed change (self-service or by an admin) emits `user.email_changed` in every organization of the user, so
--   the user is notified and the change is on record. `profiles.email` sync already existed (handle_user_email_change).

-- The caller's pending change: the new address, when it was requested and whether one of the two links was used.
create or replace function app.my_email_change()
returns table (new_email text, sent_at timestamptz, confirmed_one boolean)
language sql stable security definer set search_path = '' as $$
  select nullif(u.email_change, ''), u.email_change_sent_at, coalesce(u.email_change_confirm_status, 0) > 0
  from auth.users u
  where u.id = auth.uid() and coalesce(u.email_change, '') <> ''
$$;
revoke all on function app.my_email_change() from public;
grant execute on function app.my_email_change() to authenticated;

-- Cancel the caller's pending change: both emailed links stop working.
create or replace function app.cancel_my_email_change()
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_found boolean;
begin
  update auth.users
  set email_change = '', email_change_token_new = '', email_change_token_current = '', email_change_confirm_status = 0,
      email_change_sent_at = null
  where id = auth.uid() and coalesce(email_change, '') <> '';
  get diagnostics v_found = row_count;
  return v_found;
end $$;
revoke all on function app.cancel_my_email_change() from public;
grant execute on function app.cancel_my_email_change() to authenticated;

create or replace function app.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
    insert into public.domain_events (organization_id, type, aggregate_type, aggregate_id, actor_id, payload)
    select m.organization_id, 'user.email_changed', 'user', new.id,
      -- GoTrue completes self-service changes on its own connection (no JWT): the user is the actor.
      coalesce(auth.uid(), new.id),
      jsonb_build_object('userId', new.id, 'from', old.email, 'to', new.email)
    from public.organization_members m
    where m.user_id = new.id;
  end if;
  return new;
end $$;
