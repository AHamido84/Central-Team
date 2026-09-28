-- ============================================================================
-- Reference data (permission catalog, feature flags), organization bootstrap,
-- storage buckets. Runs in every environment.
-- ============================================================================

insert into public.permissions (key, resource, action, side, module, sort_order, label) values
  -- Organization & people
  ('organization:read',       'organization',  'read',       'agency', 'organizations', 10,  '{"ar":"عرض إعدادات المنظمة","en":"View organization settings"}'),
  ('organization:update',     'organization',  'update',     'agency', 'organizations', 11,  '{"ar":"تعديل إعدادات المنظمة","en":"Edit organization settings"}'),
  ('users:read',              'users',         'read',       'agency', 'identity',      20,  '{"ar":"عرض الفريق","en":"View team members"}'),
  ('users:update',            'users',         'update',     'agency', 'identity',      21,  '{"ar":"تعديل بيانات الأعضاء","en":"Edit team members"}'),
  ('users:deactivate',        'users',         'deactivate', 'agency', 'identity',      22,  '{"ar":"تعطيل وتفعيل الأعضاء","en":"Deactivate and reactivate members"}'),
  ('invitations:read',        'invitations',   'read',       'agency', 'invitations',   30,  '{"ar":"عرض دعوات الفريق","en":"View team invitations"}'),
  ('invitations:create',      'invitations',   'create',     'agency', 'invitations',   31,  '{"ar":"دعوة أعضاء للفريق","en":"Invite team members"}'),
  ('invitations:resend',      'invitations',   'resend',     'agency', 'invitations',   32,  '{"ar":"إعادة إرسال الدعوات","en":"Resend invitations"}'),
  ('invitations:revoke',      'invitations',   'revoke',     'agency', 'invitations',   33,  '{"ar":"إلغاء الدعوات","en":"Revoke invitations"}'),
  ('roles:read',              'roles',         'read',       'agency', 'rbac',          40,  '{"ar":"عرض الأدوار والصلاحيات","en":"View roles and permissions"}'),
  ('roles:create',            'roles',         'create',     'agency', 'rbac',          41,  '{"ar":"إنشاء أدوار","en":"Create roles"}'),
  ('roles:update',            'roles',         'update',     'agency', 'rbac',          42,  '{"ar":"تعديل الأدوار وصلاحياتها","en":"Edit roles and their permissions"}'),
  ('roles:delete',            'roles',         'delete',     'agency', 'rbac',          43,  '{"ar":"حذف الأدوار","en":"Delete roles"}'),
  ('roles:assign',            'roles',         'assign',     'agency', 'rbac',          44,  '{"ar":"إسناد الأدوار للأعضاء","en":"Assign roles to members"}'),
  ('permissions:override',    'permissions',   'override',   'agency', 'rbac',          45,  '{"ar":"استثناءات صلاحيات فردية","en":"Per-user permission overrides"}'),
  ('departments:read',        'departments',   'read',       'agency', 'departments',   50,  '{"ar":"عرض الأقسام","en":"View departments"}'),
  ('departments:manage',      'departments',   'manage',     'agency', 'departments',   51,  '{"ar":"إدارة الأقسام وأعضائها","en":"Manage departments and members"}'),
  ('feature_flags:manage',    'feature_flags', 'manage',     'agency', 'feature-flags', 60,  '{"ar":"إدارة الوحدات والمزايا","en":"Manage modules and features"}'),
  ('audit_log:read',          'audit_log',     'read',       'agency', 'audit',         70,  '{"ar":"عرض سجل النشاط","en":"View audit log"}'),
  ('design_system:view',      'design_system', 'view',       'agency', 'dev',           80,  '{"ar":"عرض نظام التصميم","en":"View design system"}'),
  -- Clients (Phase 1)
  ('clients:read_all',        'clients',       'read_all',   'agency', 'clients',       100, '{"ar":"عرض جميع العملاء","en":"View all clients"}'),
  ('clients:read_assigned',   'clients',       'read_assigned','agency','clients',      101, '{"ar":"عرض العملاء المسندين فقط","en":"View assigned clients"}'),
  ('clients:create',          'clients',       'create',     'agency', 'clients',       102, '{"ar":"إضافة عملاء","en":"Create clients"}'),
  ('clients:update',          'clients',       'update',     'agency', 'clients',       103, '{"ar":"تعديل بيانات العملاء","en":"Edit clients"}'),
  ('client_users:manage',     'client_users',  'manage',     'agency', 'clients',       104, '{"ar":"إدارة مستخدمي بوابة العميل","en":"Manage client portal users"}'),
  ('packages:manage',         'packages',      'manage',     'agency', 'clients',       110, '{"ar":"إدارة الباقات","en":"Manage packages"}'),
  ('packages:assign',         'packages',      'assign',     'agency', 'clients',       111, '{"ar":"إسناد الباقات للعملاء","en":"Assign packages to clients"}'),
  ('files:upload',            'files',         'upload',     'agency', 'files',         120, '{"ar":"رفع الملفات","en":"Upload files"}'),
  ('files:manage',            'files',         'manage',     'agency', 'files',         121, '{"ar":"إدارة الملفات والمجلدات","en":"Manage files and folders"}'),
  ('messages:send',           'messages',      'send',       'agency', 'messaging',     130, '{"ar":"مراسلة العملاء","en":"Message clients"}'),
  -- Client side
  ('portal:access',           'portal',        'access',     'client', 'portal',        200, '{"ar":"الدخول إلى البوابة","en":"Access the portal"}'),
  ('portal_files:upload',     'portal_files',  'upload',     'client', 'files',         210, '{"ar":"رفع الملفات","en":"Upload files"}'),
  ('portal_messages:send',    'portal_messages','send',      'client', 'messaging',     220, '{"ar":"إرسال الرسائل","en":"Send messages"}'),
  ('portal_users:read',       'portal_users',  'read',       'client', 'clients',       230, '{"ar":"عرض فريق الشركة","en":"View company team"}'),
  ('portal_users:manage',     'portal_users',  'manage',     'client', 'clients',       231, '{"ar":"إدارة فريق الشركة","en":"Manage company team"}'),
  ('portal_company:update',   'portal_company','update',     'client', 'clients',       240, '{"ar":"تعديل ملف الشركة","en":"Edit company profile"}');

insert into public.feature_flags (key, module, default_enabled, description) values
  ('module.portal',              'portal',        true,  '{"ar":"بوابة العملاء","en":"Client portal"}'),
  ('module.clients',             'clients',       true,  '{"ar":"إدارة العملاء","en":"Client management"}'),
  ('module.files',               'files',         true,  '{"ar":"مكتبة الملفات","en":"Files library"}'),
  ('module.messages',            'messaging',     true,  '{"ar":"الرسائل","en":"Messages"}'),
  ('module.notifications_email', 'notifications', true,  '{"ar":"إشعارات البريد الإلكتروني","en":"Email notifications"}'),
  ('ui.command_palette',         'shell',         true,  '{"ar":"لوحة الأوامر","en":"Command palette"}'),
  ('dev.design_system',          'dev',           true,  '{"ar":"صفحة نظام التصميم","en":"Design system page"}'),
  ('module.requests',            'requests',      false, '{"ar":"الطلبات (المرحلة 2)","en":"Requests (Phase 2)"}'),
  ('module.approvals',           'approvals',     false, '{"ar":"الاعتمادات (المرحلة 3)","en":"Approvals (Phase 3)"}'),
  ('module.calendar',            'calendar',      false, '{"ar":"التقويم (المرحلة 3)","en":"Calendar (Phase 3)"}');

-- ---------------------------------------------------------------------------
-- bootstrap_organization: system roles + default grants + departments.
-- Idempotent; used by seed and by future organization provisioning.
-- ---------------------------------------------------------------------------

create or replace function app.bootstrap_organization(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_role uuid;
begin
  for r in select * from (values
    ('super_admin',     'agency', true,  1, '{"ar":"مدير النظام","en":"Super Admin"}'::jsonb,              '{"ar":"كل الصلاحيات، ولا يمكن تقييده","en":"All permissions; cannot be restricted"}'::jsonb),
    ('admin',           'agency', false, 2, '{"ar":"مدير العمليات","en":"Admin / Operations Manager"}'::jsonb, '{"ar":"إدارة الفريق والعملاء والإعدادات","en":"Runs the team, clients and settings"}'::jsonb),
    ('account_manager', 'agency', false, 3, '{"ar":"مدير حساب","en":"Account Manager"}'::jsonb,             '{"ar":"يدير علاقة العملاء المسندين إليه","en":"Owns relationships with assigned clients"}'::jsonb),
    ('team_lead',       'agency', false, 4, '{"ar":"قائد فريق","en":"Team Lead"}'::jsonb,                    '{"ar":"يقود قسمًا ويطّلع على جميع العملاء","en":"Leads a department with visibility of all clients"}'::jsonb),
    ('specialist',      'agency', false, 5, '{"ar":"أخصائي","en":"Specialist"}'::jsonb,                      '{"ar":"ينفّذ الأعمال للعملاء المسندين","en":"Delivers work for assigned clients"}'::jsonb),
    ('client_owner',    'client', false, 6, '{"ar":"مالك حساب العميل","en":"Client Owner"}'::jsonb,           '{"ar":"يدير فريق الشركة وملفها","en":"Manages the company team and profile"}'::jsonb),
    ('client_member',   'client', false, 7, '{"ar":"عضو","en":"Client Member"}'::jsonb,                       '{"ar":"يرفع الملفات ويراسل الوكالة","en":"Uploads files and messages the agency"}'::jsonb),
    ('client_viewer',   'client', false, 8, '{"ar":"مشاهد","en":"Client Viewer"}'::jsonb,                     '{"ar":"اطلاع فقط","en":"Read-only access"}'::jsonb)
  ) as t(key, side, locked, sort, name, description)
  loop
    insert into public.roles (organization_id, key, name, description, side, is_system, is_locked, sort_order)
    values (p_org, r.key, r.name, r.description, r.side, true, r.locked, r.sort)
    on conflict (organization_id, key) do nothing;
  end loop;

  for r in select * from (values
    ('super_admin', array(select key from public.permissions where side = 'agency')),
    ('admin', array(select key from public.permissions where side = 'agency' and key <> 'feature_flags:manage')),
    ('account_manager', array[
      'organization:read', 'users:read', 'departments:read', 'design_system:view',
      'clients:read_assigned', 'clients:update', 'client_users:manage', 'packages:assign',
      'files:upload', 'files:manage', 'messages:send']),
    ('team_lead', array[
      'organization:read', 'users:read', 'departments:read', 'design_system:view',
      'clients:read_all', 'files:upload', 'files:manage', 'messages:send']),
    ('specialist', array[
      'organization:read', 'users:read', 'departments:read',
      'clients:read_assigned', 'files:upload', 'messages:send']),
    ('client_owner', array(select key from public.permissions where side = 'client')),
    ('client_member', array['portal:access', 'portal_files:upload', 'portal_messages:send', 'portal_users:read']),
    ('client_viewer', array['portal:access', 'portal_users:read'])
  ) as t(key, perms)
  loop
    select id into v_role from public.roles where organization_id = p_org and key = r.key;
    insert into public.role_permissions (role_id, permission_key, organization_id)
    select v_role, k, p_org from unnest(r.perms) k
    on conflict do nothing;
  end loop;

  insert into public.departments (organization_id, key, name, color, icon, sort_order) values
    (p_org, 'account_management', '{"ar":"إدارة الحسابات","en":"Account Management"}', 'primary', 'briefcase', 1),
    (p_org, 'design',             '{"ar":"التصميم","en":"Design"}',                        'violet',  'palette',   2),
    (p_org, 'video',              '{"ar":"الفيديو","en":"Video"}',                          'rose',    'clapperboard', 3),
    (p_org, 'content',            '{"ar":"المحتوى","en":"Content"}',                        'amber',   'pen-line',  4),
    (p_org, 'media_buying',       '{"ar":"شراء الوسائط","en":"Media Buying"}',              'emerald', 'megaphone', 5)
  on conflict (organization_id, key) do nothing;
end $$;

revoke all on function app.bootstrap_organization(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage buckets. Access goes through server-issued signed URLs only (ADR-020).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('client-files', 'client-files', false, 209715200, null),
  ('public-assets', 'public-assets', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
