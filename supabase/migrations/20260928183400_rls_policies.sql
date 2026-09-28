-- ============================================================================
-- Row Level Security. One policy per command; every tenant policy goes
-- through app.* helpers. `anon` has no access to any table.
-- ============================================================================

do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
    execute format('revoke all on public.%I from anon', r.tablename);
  end loop;
end $$;

-- Append-only / system-written tables.
revoke insert, update, delete on public.activity_log from authenticated;
revoke update, delete on public.domain_events from authenticated;
revoke all on public.domain_event_deliveries, public.rate_limits from authenticated;
revoke insert, delete on public.notifications from authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke update on public.comments from authenticated;
grant update (body, edited_at, deleted_at) on public.comments to authenticated;

-- ---------------------------------------------------------------------------
-- Organizations & members
-- ---------------------------------------------------------------------------

create policy organizations_select on public.organizations for select to authenticated
  using ((select app.is_org_member(id)));
create policy organizations_update on public.organizations for update to authenticated
  using ((select app.has_permission(id, 'organization:update')))
  with check ((select app.has_permission(id, 'organization:update')));

create policy profiles_select on public.profiles for select to authenticated
  using ((select app.can_see_profile(id)));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy organization_members_select on public.organization_members for select to authenticated
  using (user_id = (select auth.uid()) or (select app.is_agency_member(organization_id)));
create policy organization_members_update on public.organization_members for update to authenticated
  using ((select app.has_permission(organization_id, 'users:update'))
      or (select app.has_permission(organization_id, 'users:deactivate')))
  with check ((select app.has_permission(organization_id, 'users:update'))
      or (select app.has_permission(organization_id, 'users:deactivate')));

create policy feature_flags_select on public.feature_flags for select to authenticated using (true);

create policy organization_features_select on public.organization_features for select to authenticated
  using ((select app.is_org_member(organization_id)));
create policy organization_features_insert on public.organization_features for insert to authenticated
  with check ((select app.has_permission(organization_id, 'feature_flags:manage')));
create policy organization_features_update on public.organization_features for update to authenticated
  using ((select app.has_permission(organization_id, 'feature_flags:manage')))
  with check ((select app.has_permission(organization_id, 'feature_flags:manage')));

-- ---------------------------------------------------------------------------
-- RBAC
-- ---------------------------------------------------------------------------

create policy permissions_select on public.permissions for select to authenticated using (true);

create policy roles_select on public.roles for select to authenticated
  using ((select app.is_agency_member(organization_id))
      or (side = 'client' and (select app.is_org_member(organization_id))));
create policy roles_insert on public.roles for insert to authenticated
  with check ((select app.has_permission(organization_id, 'roles:create')));
create policy roles_update on public.roles for update to authenticated
  using ((select app.has_permission(organization_id, 'roles:update')))
  with check ((select app.has_permission(organization_id, 'roles:update')));
create policy roles_delete on public.roles for delete to authenticated
  using ((select app.has_permission(organization_id, 'roles:delete')));

create policy role_permissions_select on public.role_permissions for select to authenticated
  using ((select app.is_agency_member(organization_id)));
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check ((select app.has_permission(organization_id, 'roles:update')));
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using ((select app.has_permission(organization_id, 'roles:update')));

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select app.is_agency_member(organization_id)));
create policy user_roles_insert on public.user_roles for insert to authenticated
  with check ((select app.has_permission(organization_id, 'roles:assign')));
create policy user_roles_delete on public.user_roles for delete to authenticated
  using ((select app.has_permission(organization_id, 'roles:assign')));

create policy overrides_select on public.user_permission_overrides for select to authenticated
  using (user_id = (select auth.uid()) or (select app.has_permission(organization_id, 'roles:read')));
create policy overrides_insert on public.user_permission_overrides for insert to authenticated
  with check ((select app.has_permission(organization_id, 'permissions:override')));
create policy overrides_update on public.user_permission_overrides for update to authenticated
  using ((select app.has_permission(organization_id, 'permissions:override')))
  with check ((select app.has_permission(organization_id, 'permissions:override')));
create policy overrides_delete on public.user_permission_overrides for delete to authenticated
  using ((select app.has_permission(organization_id, 'permissions:override')));

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------

create policy departments_select on public.departments for select to authenticated
  using ((select app.is_agency_member(organization_id)));
create policy departments_insert on public.departments for insert to authenticated
  with check ((select app.has_permission(organization_id, 'departments:manage')));
create policy departments_update on public.departments for update to authenticated
  using ((select app.has_permission(organization_id, 'departments:manage')))
  with check ((select app.has_permission(organization_id, 'departments:manage')));
create policy departments_delete on public.departments for delete to authenticated
  using ((select app.has_permission(organization_id, 'departments:manage')));

create policy department_members_select on public.department_members for select to authenticated
  using ((select app.is_agency_member(organization_id)));
create policy department_members_insert on public.department_members for insert to authenticated
  with check ((select app.has_permission(organization_id, 'departments:manage')));
create policy department_members_update on public.department_members for update to authenticated
  using ((select app.has_permission(organization_id, 'departments:manage')))
  with check ((select app.has_permission(organization_id, 'departments:manage')));
create policy department_members_delete on public.department_members for delete to authenticated
  using ((select app.has_permission(organization_id, 'departments:manage')));

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------

create or replace function app.can_manage_invitation(p_org uuid, p_user_type text, p_client uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_user_type = 'agency' then app.has_permission(p_org, 'invitations:create')
    else (app.has_permission(p_org, 'client_users:manage') and app.agency_can_access_client(p_client))
      or app.has_client_permission(p_client, 'portal_users:manage')
  end;
$$;
grant execute on function app.can_manage_invitation(uuid, text, uuid) to authenticated;

create policy invitations_select on public.invitations for select to authenticated
  using (
    (user_type = 'agency' and (select app.has_permission(organization_id, 'invitations:read')))
    or (user_type = 'client' and (
      (select app.agency_can_access_client(client_id))
      or (select app.has_client_permission(client_id, 'portal_users:read'))
    ))
  );
create policy invitations_insert on public.invitations for insert to authenticated
  with check (invited_by = (select auth.uid())
    and (select app.can_manage_invitation(organization_id, user_type, client_id)));
create policy invitations_update on public.invitations for update to authenticated
  using ((select app.can_manage_invitation(organization_id, user_type, client_id)))
  with check ((select app.can_manage_invitation(organization_id, user_type, client_id)));

-- ---------------------------------------------------------------------------
-- Platform: events, audit, notifications
-- ---------------------------------------------------------------------------

create policy domain_events_insert on public.domain_events for insert to authenticated
  with check (actor_id = (select auth.uid()) and (select app.is_org_member(organization_id)));

create policy activity_log_select on public.activity_log for select to authenticated
  using (organization_id is not null and (select app.has_permission(organization_id, 'audit_log:read')));

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy notification_preferences_select on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()));
create policy notification_preferences_insert on public.notification_preferences for insert to authenticated
  with check (user_id = (select auth.uid()) and (select app.is_org_member(organization_id)));
create policy notification_preferences_update on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notification_preferences_delete on public.notification_preferences for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------

create policy clients_select on public.clients for select to authenticated
  using ((select app.can_access_client(id)));
create policy clients_insert on public.clients for insert to authenticated
  with check ((select app.has_permission(organization_id, 'clients:create')));
create policy clients_update on public.clients for update to authenticated
  using (
    ((select app.has_permission(organization_id, 'clients:update')) and (select app.agency_can_access_client(id)))
    or (select app.has_client_permission(id, 'portal_company:update'))
  )
  with check (
    ((select app.has_permission(organization_id, 'clients:update')) and (select app.agency_can_access_client(id)))
    or (select app.has_client_permission(id, 'portal_company:update'))
  );

create policy client_notes_select on public.client_notes for select to authenticated
  using ((select app.agency_can_access_client(client_id)));
create policy client_notes_insert on public.client_notes for insert to authenticated
  with check ((select app.agency_can_access_client(client_id))
    and (select app.has_permission(organization_id, 'clients:update')));
create policy client_notes_update on public.client_notes for update to authenticated
  using ((select app.agency_can_access_client(client_id))
    and (select app.has_permission(organization_id, 'clients:update')))
  with check ((select app.agency_can_access_client(client_id))
    and (select app.has_permission(organization_id, 'clients:update')));

create policy client_users_select on public.client_users for select to authenticated
  using ((select app.can_access_client(client_id)));
create policy client_users_insert on public.client_users for insert to authenticated
  with check (
    ((select app.has_permission(organization_id, 'client_users:manage')) and (select app.agency_can_access_client(client_id)))
    or (select app.has_client_permission(client_id, 'portal_users:manage'))
  );
create policy client_users_update on public.client_users for update to authenticated
  using (
    ((select app.has_permission(organization_id, 'client_users:manage')) and (select app.agency_can_access_client(client_id)))
    or (select app.has_client_permission(client_id, 'portal_users:manage'))
  )
  with check (
    ((select app.has_permission(organization_id, 'client_users:manage')) and (select app.agency_can_access_client(client_id)))
    or (select app.has_client_permission(client_id, 'portal_users:manage'))
  );

create policy client_assignments_select on public.client_assignments for select to authenticated
  using ((select app.can_access_client(client_id)));
create policy client_assignments_insert on public.client_assignments for insert to authenticated
  with check ((select app.has_permission(organization_id, 'clients:update'))
    and (select app.agency_can_access_client(client_id)));
create policy client_assignments_delete on public.client_assignments for delete to authenticated
  using ((select app.has_permission(organization_id, 'clients:update'))
    and (select app.agency_can_access_client(client_id)));

-- Packages catalog: agency staff see all; client users see only packages assigned to their client.
create policy packages_select on public.packages for select to authenticated
  using ((select app.is_agency_member(organization_id)) or exists (
    select 1 from public.client_packages cp where cp.package_id = packages.id and app.is_client_member(cp.client_id)
  ));
create policy packages_insert on public.packages for insert to authenticated
  with check ((select app.has_permission(organization_id, 'packages:manage')));
create policy packages_update on public.packages for update to authenticated
  using ((select app.has_permission(organization_id, 'packages:manage')))
  with check ((select app.has_permission(organization_id, 'packages:manage')));
create policy packages_delete on public.packages for delete to authenticated
  using ((select app.has_permission(organization_id, 'packages:manage')));

create policy package_items_select on public.package_items for select to authenticated
  using ((select app.is_agency_member(organization_id)) or exists (
    select 1 from public.client_packages cp where cp.package_id = package_items.package_id and app.is_client_member(cp.client_id)
  ));
create policy package_items_insert on public.package_items for insert to authenticated
  with check ((select app.has_permission(organization_id, 'packages:manage')));
create policy package_items_update on public.package_items for update to authenticated
  using ((select app.has_permission(organization_id, 'packages:manage')))
  with check ((select app.has_permission(organization_id, 'packages:manage')));
create policy package_items_delete on public.package_items for delete to authenticated
  using ((select app.has_permission(organization_id, 'packages:manage')));

create policy client_packages_select on public.client_packages for select to authenticated
  using ((select app.can_access_client(client_id)));
create policy client_packages_insert on public.client_packages for insert to authenticated
  with check ((select app.has_permission(organization_id, 'packages:assign'))
    and (select app.agency_can_access_client(client_id)));
create policy client_packages_update on public.client_packages for update to authenticated
  using ((select app.has_permission(organization_id, 'packages:assign'))
    and (select app.agency_can_access_client(client_id)))
  with check ((select app.has_permission(organization_id, 'packages:assign'))
    and (select app.agency_can_access_client(client_id)));
create policy client_packages_delete on public.client_packages for delete to authenticated
  using ((select app.has_permission(organization_id, 'packages:assign'))
    and (select app.agency_can_access_client(client_id)));

create policy package_usage_select on public.package_usage_entries for select to authenticated
  using ((select app.can_access_client(client_id)));
create policy package_usage_insert on public.package_usage_entries for insert to authenticated
  with check ((select app.has_permission(organization_id, 'packages:assign'))
    and (select app.agency_can_access_client(client_id)));
create policy package_usage_delete on public.package_usage_entries for delete to authenticated
  using ((select app.has_permission(organization_id, 'packages:assign'))
    and (select app.agency_can_access_client(client_id)));

-- ---------------------------------------------------------------------------
-- Files (visibility: internal items never reach client users)
-- ---------------------------------------------------------------------------

create policy file_folders_select on public.file_folders for select to authenticated
  using (
    (select app.agency_can_access_client(client_id))
    or (visibility = 'client' and (select app.is_client_member(client_id)))
  );
create policy file_folders_insert on public.file_folders for insert to authenticated
  with check (
    ((select app.has_permission(organization_id, 'files:upload')) and (select app.agency_can_access_client(client_id)))
    or (visibility = 'client' and (select app.has_client_permission(client_id, 'portal_files:upload')))
  );
create policy file_folders_update on public.file_folders for update to authenticated
  using ((select app.has_permission(organization_id, 'files:manage')) and (select app.agency_can_access_client(client_id)))
  with check ((select app.has_permission(organization_id, 'files:manage')) and (select app.agency_can_access_client(client_id)));
create policy file_folders_delete on public.file_folders for delete to authenticated
  using ((select app.has_permission(organization_id, 'files:manage')) and (select app.agency_can_access_client(client_id)));

create policy files_select on public.files for select to authenticated
  using (
    (select app.agency_can_access_client(client_id))
    or (
      visibility = 'client' and deleted_at is null and (select app.is_client_member(client_id))
      and (folder_id is null or exists (
        select 1 from public.file_folders ff where ff.id = files.folder_id and ff.visibility = 'client'
      ))
    )
  );
create policy files_insert on public.files for insert to authenticated
  with check (
    uploaded_by = (select auth.uid()) and (
      (uploader_side = 'agency' and (select app.has_permission(organization_id, 'files:upload'))
        and (select app.agency_can_access_client(client_id)))
      or (uploader_side = 'client' and visibility = 'client'
        and (select app.has_client_permission(client_id, 'portal_files:upload')))
    )
  );
create policy files_update on public.files for update to authenticated
  using ((select app.has_permission(organization_id, 'files:manage')) and (select app.agency_can_access_client(client_id)))
  with check ((select app.has_permission(organization_id, 'files:manage')) and (select app.agency_can_access_client(client_id)));

-- ---------------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------------

create policy threads_select on public.threads for select to authenticated
  using (
    (select app.agency_can_access_client(client_id))
    or (visibility = 'client' and (select app.is_client_member(client_id)))
  );
create policy threads_insert on public.threads for insert to authenticated
  with check (
    created_by = (select auth.uid()) and (
      ((select app.has_permission(organization_id, 'messages:send')) and (select app.agency_can_access_client(client_id)))
      or (visibility = 'client' and (select app.has_client_permission(client_id, 'portal_messages:send')))
    )
  );
create policy threads_update on public.threads for update to authenticated
  using ((select app.has_permission(organization_id, 'messages:send')) and (select app.agency_can_access_client(client_id)))
  with check ((select app.has_permission(organization_id, 'messages:send')) and (select app.agency_can_access_client(client_id)));

create policy comments_select on public.comments for select to authenticated
  using (
    (select app.agency_can_access_client(client_id))
    or (
      visibility = 'client' and (select app.is_client_member(client_id))
      and exists (select 1 from public.threads t where t.id = comments.thread_id and t.visibility = 'client')
    )
  );
create policy comments_insert on public.comments for insert to authenticated
  with check (
    author_id = (select auth.uid()) and (
      (author_side = 'agency' and (select app.has_permission(organization_id, 'messages:send'))
        and (select app.agency_can_access_client(client_id)))
      or (author_side = 'client' and visibility = 'client'
        and (select app.has_client_permission(client_id, 'portal_messages:send'))
        and exists (select 1 from public.threads t where t.id = comments.thread_id and t.visibility = 'client'))
    )
  );
create policy comments_update on public.comments for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));

create policy comment_attachments_select on public.comment_attachments for select to authenticated
  using (exists (select 1 from public.comments c where c.id = comment_id));
create policy comment_attachments_insert on public.comment_attachments for insert to authenticated
  with check (
    exists (select 1 from public.comments c where c.id = comment_id and c.author_id = (select auth.uid()))
    and exists (select 1 from public.files f where f.id = file_id and f.uploaded_by = (select auth.uid()))
  );

create policy thread_reads_select on public.thread_reads for select to authenticated
  using (exists (select 1 from public.threads t where t.id = thread_id));
create policy thread_reads_insert on public.thread_reads for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.threads t where t.id = thread_id));
create policy thread_reads_update on public.thread_reads for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.notifications, public.comments, public.thread_reads;
