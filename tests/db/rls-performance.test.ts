/**
 * FR1.2 / ADR-082 — policies compute access once per statement (arrays in an InitPlan) instead of once per row. These
 * tests prove the array functions grant exactly what the per-row functions grant for every seeded user, that no policy
 * went back to the per-row form, and that the Tasks list query stays fast with the seeded data.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { as, sql } from './helpers';

afterAll(async () => {
  await sql.end();
});

const perRow =
  /\( SELECT app\.(agency_can_access_client|agency_can_read_tasks|agency_can_read_requests|is_client_member|can_access_client|is_agency_member|is_org_member|can_see_profile)\(/;

describe('RLS access is computed once per statement', () => {
  it('no policy calls a per-row access function on a column', async () => {
    const policies = await sql<{ tablename: string; policyname: string; expr: string }[]>`
      select tablename, policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
      from pg_policies where schemaname in ('public', 'storage')`;
    const offenders = policies.filter((p) => perRow.test(p.expr)).map((p) => `${p.tablename}.${p.policyname}`);
    expect(offenders).toEqual([]);
  });

  it('the array functions grant exactly what the per-row functions grant, for every seeded user', async () => {
    const users = await sql<{ email: string }[]>`select email from auth.users where email like '%.test' order by email`;
    expect(users.length).toBeGreaterThan(10);
    for (const { email } of users) {
      const diff = await as(email, async (tx) => {
        const [row] = await tx<
          { clients: boolean; tasks: boolean; requests: boolean; members: boolean; orgs: boolean; profiles: boolean }[]
        >`
          select
            (select coalesce(array_agg(id order by id), '{}') from public.clients where app.agency_can_access_client(id))
              = (select coalesce(array_agg(x order by x), '{}') from unnest(app.agency_client_ids()) x) as clients,
            (select coalesce(array_agg(id order by id), '{}') from public.clients where app.agency_can_read_tasks(id))
              = (select coalesce(array_agg(x order by x), '{}') from unnest(app.agency_task_client_ids()) x) as tasks,
            (select coalesce(array_agg(id order by id), '{}') from public.clients where app.agency_can_read_requests(id))
              = (select coalesce(array_agg(x order by x), '{}') from unnest(app.agency_request_client_ids()) x) as requests,
            (select coalesce(array_agg(id order by id), '{}') from public.clients where app.is_client_member(id))
              = (select coalesce(array_agg(x order by x), '{}') from unnest(app.member_client_ids()) x) as members,
            (select coalesce(array_agg(id order by id), '{}') from public.organizations where app.is_agency_member(id))
              = (select coalesce(array_agg(x order by x), '{}') from unnest(app.agency_org_ids()) x) as orgs,
            (select coalesce(array_agg(id order by id), '{}') from public.profiles where app.can_see_profile(id))
              = (select coalesce(array_agg(x order by x), '{}') from unnest(app.visible_profile_ids()) x) as profiles`;
        return Object.entries(row!)
          .filter(([, same]) => !same)
          .map(([k]) => k);
      });
      expect(diff, email).toEqual([]);
    }
  });

  it('the Tasks list query runs in well under a second as an admin', async () => {
    const ms = await as('faisal@ofoq.test', async (tx) => {
      const rows = await tx<{ plan: string }[]>`
        explain (analyze, format text)
        select t.id, (select count(*) from public.task_checklist_items i where i.task_id = t.id),
          (select json_agg(p.full_name) from public.task_members m join public.profiles p on p.id = m.user_id where m.task_id = t.id)
        from public.tasks t join public.clients c on c.id = t.client_id`;
      const line = rows.map((r) => Object.values(r)[0] as string).find((l) => l.startsWith('Execution Time'));
      return Number(line?.match(/([\d.]+) ms/)?.[1] ?? Infinity);
    });
    // Was ~8 s with 1,000 tasks before ADR-082; the seeded ~320 tasks took ~2.5 s.
    expect(ms).toBeLessThan(1000);
  });
});
