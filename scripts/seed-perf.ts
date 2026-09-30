/**
 * Performance seed (Feedback Round 1, FR1.2): tops the demo organization up to N tasks (default 1,000) spread over the
 * demo clients, statuses, priorities, departments and people, with subtasks, dependencies, checklist items and
 * comments on some of them — enough to profile the Tasks screens. Local databases only; safe to run again (it only
 * adds what is missing to reach N).
 *
 *   pnpm db:seed:perf          # 1,000 tasks in total
 *   pnpm db:seed:perf 3000     # or any other total
 */
import { config } from 'dotenv';
import postgres from 'postgres';

import { databaseUrl } from '../src/lib/db/url';

config({ path: '.env.local' });

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const target = Number(process.argv[2] ?? 1000);
const url = databaseUrl(process.env, 'direct') ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
if (!/127\.0\.0\.1|localhost/.test(url) && process.env.SEED_ALLOW_REMOTE !== '1') {
  console.error('Refusing to seed a non-local database (set SEED_ALLOW_REMOTE=1 to override).');
  process.exit(1);
}

async function main() {
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from public.tasks where organization_id = ${ORG_ID}`;
  const n = row?.n ?? 0;
  const missing = Math.max(0, target - n);
  if (!missing) {
    console.info(`Already ${n} tasks (target ${target}).`);
    await sql.end();
    return;
  }
  const started = Date.now();
  await sql.begin(async (tx) => {
    // Audit rows for thousands of synthetic tasks would only slow the seed down.
    await tx`select set_config('app.audit_skip', 'on', true)`;
    const parents = Math.round(missing * 0.85);
    await tx`
      with clients as (
        select id, row_number() over (order by slug) - 1 as i, count(*) over () as n
        from public.clients where organization_id = ${ORG_ID} and deleted_at is null
      ),
      statuses as (
        select id, category, row_number() over (order by sort_order) - 1 as i, count(*) over () as n
        from public.task_statuses where organization_id = ${ORG_ID}
      ),
      depts as (
        select id, row_number() over (order by key) - 1 as i, count(*) over () as n
        from public.departments where organization_id = ${ORG_ID}
      ),
      gen as (select g from generate_series(1, ${parents}::int) g)
      insert into public.tasks (organization_id, client_id, title, description, department_id, status_id, status_category,
        priority, start_date, due_date, estimate_minutes, tags, position, created_at, updated_at, completed_at)
      select ${ORG_ID}::uuid, c.id,
        (array['تصميم منشور', 'كتابة محتوى', 'مونتاج فيديو', 'تقرير أداء', 'إعداد حملة', 'مراجعة هوية'])[1 + g % 6] || ' · ' || g,
        case when g % 3 = 0 then 'مهمة تجريبية لقياس الأداء' else '' end,
        d.id, s.id, s.category,
        (array['low', 'normal', 'normal', 'high', 'urgent'])[1 + g % 5],
        case when g % 4 = 0 and g % 10 <> 0 then current_date + (g % 45 - 15) - (g % 5) end,
        case when g % 10 <> 0 then current_date + (g % 45 - 15) end,
        case when g % 2 = 0 then (array[30, 60, 90, 120, 240])[1 + g % 5] end,
        array['perf'],
        100000 + g,
        now() - (g % 60) * interval '1 day', now() - (g % 60) * interval '1 day',
        case when s.category = 'done' then now() - (g % 20) * interval '1 day' end
      from gen
      join clients c on c.i = g % c.n
      join statuses s on s.i = (g * 7) % s.n
      join depts d on d.i = g % d.n`;
    // Assignees (1–2 per task) from the agency team.
    await tx`
      with people as (
        select m.user_id, row_number() over (order by m.user_id) - 1 as i, count(*) over () as n
        from public.organization_members m
        where m.organization_id = ${ORG_ID} and m.user_type = 'agency' and m.status = 'active' and m.deleted_at is null
      ),
      t as (select id, client_id, row_number() over (order by id) as g from public.tasks
            where organization_id = ${ORG_ID} and 'perf' = any(tags) and parent_id is null
              and not exists (select 1 from public.task_members tm where tm.task_id = tasks.id))
      insert into public.task_members (task_id, user_id, role, organization_id, client_id)
      select t.id, p.user_id, 'assignee', ${ORG_ID}::uuid, t.client_id from t join people p on p.i = t.g % p.n
      union
      select t.id, p.user_id, 'assignee', ${ORG_ID}::uuid, t.client_id from t join people p on p.i = (t.g * 3 + 1) % p.n where t.g % 4 = 0
      on conflict do nothing`;
    // Subtasks under the first parents.
    await tx`
      with p as (select id, client_id, status_id, status_category, row_number() over (order by position) as g from public.tasks
                 where organization_id = ${ORG_ID} and 'perf' = any(tags) and parent_id is null)
      insert into public.tasks (organization_id, client_id, parent_id, title, status_id, status_category, priority, tags, position)
      select ${ORG_ID}::uuid, p.client_id, p.id, 'مهمة فرعية · ' || p.g, p.status_id, p.status_category, 'normal', array['perf'], 200000 + p.g
      from p where p.g <= ${missing - parents}`;
    // Checklists, dependencies and a few comments on task threads.
    await tx`
      insert into public.task_checklist_items (task_id, organization_id, client_id, body, is_done, sort_order)
      select t.id, t.organization_id, t.client_id, 'بند ' || k, k % 2 = 0, k
      from public.tasks t cross join generate_series(1, 3) k
      where t.organization_id = ${ORG_ID} and 'perf' = any(t.tags) and t.parent_id is null and t.position % 3 = 0`;
    await tx`
      with t as (select id, client_id, row_number() over (partition by client_id order by position) as g from public.tasks
                 where organization_id = ${ORG_ID} and 'perf' = any(tags) and parent_id is null and status_category <> 'done')
      insert into public.task_dependencies (task_id, depends_on_id, organization_id, client_id)
      select b.id, a.id, ${ORG_ID}::uuid, a.client_id from t a join t b on b.client_id = a.client_id and b.g = a.g + 1
      where a.g % 10 = 0
      on conflict do nothing`;
  });
  const [after] = await sql<{ total: number }[]>`select count(*)::int as total from public.tasks where organization_id = ${ORG_ID}`;
  console.info(`✓ ${after?.total ?? 0} tasks (${missing} added in ${Date.now() - started} ms).`);
  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
