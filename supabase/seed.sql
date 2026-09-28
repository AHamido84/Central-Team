-- Local development seed (static part). Users, clients, files and messages are created by
-- scripts/seed.ts through the Auth admin API so passwords and storage objects are real.
insert into public.organizations (id, slug, name, support_email, support_whatsapp, brand)
values (
  '00000000-0000-4000-8000-000000000001',
  'ofoq',
  '{"ar":"وكالة أفق للتسويق","en":"Ofoq Marketing Agency"}',
  'hello@ofoq.demo.local',
  '+966500000000',
  '{"primaryColor":"#5140E0"}'
);
select app.bootstrap_organization('00000000-0000-4000-8000-000000000001');
