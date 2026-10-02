/**
 * FR1.4 / ADR-084 — per-field task permissions, enforced by the database: specialists change only the status and
 * checklist of tasks assigned to them; account managers and team leads change everything on their clients' tasks or
 * in the department they lead; admins change everything. The UI mirror (`taskAccess`) agrees with the database for
 * every seeded agency user, and a task's history is readable by the people who can read the task.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { taskAccess, type TaskEditContext } from '@/modules/tasks/access';

import { as, attempt, clientId, sql, userId } from './helpers';

type Tx = Parameters<Parameters<typeof as>[1]>[0];

const SPECIALIST = 'khalid@ofoq.test';
const AM = 'noura@ofoq.test'; // Najd
const ADMIN = 'faisal@ofoq.test';
const LEAD = 'reem@ofoq.test'; // leads Design
const NAJD_OWNER = 'mohammed@najd.test';

let najd: string;
let org: string;
let own: string; // a Najd task assigned to the specialist
let other: string; // a Najd task not assigned to the specialist

beforeAll(async () => {
  najd = await clientId('najd-heritage');
  const khalid = await userId(SPECIALIST);
  const [o] = await sql<{ id: string; organization_id: string }[]>`
    select t.id, t.organization_id from public.tasks t join public.task_members m on m.task_id = t.id and m.role = 'assignee'
    where t.client_id = ${najd} and m.user_id = ${khalid} and t.parent_id is null limit 1`;
  own = o!.id;
  org = o!.organization_id;
  const [x] = await sql<{ id: string }[]>`
    select t.id from public.tasks t where t.client_id = ${najd} and t.parent_id is null
      and not exists (select 1 from public.task_members m where m.task_id = t.id and m.user_id = ${khalid}) limit 1`;
  other = x!.id;
});

afterAll(async () => {
  await sql.end();
});

const statusOf = async (tx: Tx, category: string) =>
  (await tx<{ id: string }[]>`select id from public.task_statuses where organization_id = ${org} and category = ${category} limit 1`)[0]!
    .id;

describe('specialist on their own task', () => {
  it('may change the status and the checklist', async () => {
    await as(SPECIALIST, async (tx) => {
      const rows = await tx`update public.tasks set status_id = ${await statusOf(tx, 'active')} where id = ${own} returning id`;
      expect(rows.length).toBe(1);
      await tx`insert into public.task_checklist_items (task_id, organization_id, client_id, body) values (${own}, ${org}, ${najd}, 'x')`;
    });
  });

  it('may not change other fields, people or dependencies', async () => {
    expect((await attempt(SPECIALIST, (tx) => tx`update public.tasks set title = 'x' where id = ${own}`))?.message).toBe('field_forbidden');
    expect((await attempt(SPECIALIST, (tx) => tx`update public.tasks set due_date = current_date where id = ${own}`))?.message).toBe(
      'field_forbidden',
    );
    const hind = await userId('hind@ofoq.test');
    expect(
      (
        await attempt(
          SPECIALIST,
          (tx) =>
            tx`insert into public.task_members (task_id, user_id, role, organization_id, client_id) values (${own}, ${hind}, 'watcher', ${org}, ${najd})`,
        )
      )?.message,
    ).toBe('field_forbidden');
  });

  it('may not even change the status of a task that is not theirs', async () => {
    const error = await attempt(
      SPECIALIST,
      async (tx) => tx`update public.tasks set status_id = ${await statusOf(tx, 'active')} where id = ${other}`,
    );
    expect(error?.message).toBe('field_forbidden');
  });

  it('may create a task and assign it in the same go', async () => {
    await as(SPECIALIST, async (tx) => {
      const me = await userId(SPECIALIST);
      const [t] = await tx<{ id: string }[]>`
        insert into public.tasks (organization_id, client_id, title, status_id, status_category)
        values (${org}, ${najd}, 'new', ${await statusOf(tx, 'todo')}, 'todo') returning id`;
      await tx`insert into public.task_members (task_id, user_id, role, organization_id, client_id) values (${t!.id}, ${me}, 'assignee', ${org}, ${najd})`;
    });
  });
});

describe('managers and admins', () => {
  it('the account manager edits every field on their client’s tasks', async () => {
    await as(AM, async (tx) => {
      const rows = await tx`update public.tasks set title = 'renamed', priority = 'high' where id = ${other} returning id`;
      expect(rows.length).toBe(1);
    });
  });

  it('a team lead edits every field of tasks in the department they lead, only the rest is limited', async () => {
    await as(LEAD, async (tx) => {
      const [design] = await tx<{ id: string }[]>`select id from public.departments where key = 'design' and organization_id = ${org}`;
      const [t] = await tx<{ id: string }[]>`
        select t.id from public.tasks t where t.department_id = ${design!.id} and t.client_id not in (
          select client_id from public.client_assignments where user_id = ${await userId(LEAD)}) limit 1`;
      if (!t) return;
      const [scope] = await tx<{ s: string }[]>`select app.task_edit_scope(${t.id}::uuid) as s`;
      expect(scope!.s).toBe('full');
    });
  });

  it('an admin edits everything', async () => {
    await as(ADMIN, async (tx) => {
      const [scope] = await tx<{ s: string }[]>`select app.task_edit_scope(${own}::uuid) as s`;
      expect(scope!.s).toBe('full');
    });
  });
});

describe('the UI mirror agrees with the database', () => {
  it('taskAccess() equals app.task_edit_scope() for every agency user and every task they can see', async () => {
    const users = await sql<{ email: string }[]>`select email from auth.users where email like '%@ofoq.test' order by email`;
    for (const { email } of users) {
      const mismatches = await as(email, async (tx) => {
        const me = await userId(email);
        const [c] = await tx<{ c: Omit<TaskEditContext, 'me'> }[]>`select app.task_edit_context(${org}::uuid) as c`;
        const ctx: TaskEditContext = { me, ...c!.c };
        const tasks = await tx<{ id: string; client_id: string; department_id: string | null; assignees: string[]; scope: string }[]>`
          select t.id, t.client_id, t.department_id, app.task_edit_scope(t.id) as scope,
            coalesce((select array_agg(m.user_id) from public.task_members m where m.task_id = t.id and m.role = 'assignee'), '{}') as assignees
          from public.tasks t limit 400`;
        return tasks
          .filter(
            (t) =>
              taskAccess({ clientId: t.client_id, departmentId: t.department_id, assignees: t.assignees.map((id) => ({ id })) }, ctx) !==
              t.scope,
          )
          .map((t) => t.id);
      });
      expect(mismatches, email).toEqual([]);
    }
  });
});

describe('history', () => {
  it('is readable by people who can read the task, and records field changes', async () => {
    await as(AM, async (tx) => {
      await tx`update public.tasks set priority = 'urgent' where id = ${other}`;
      const rows = await tx<{ changed_fields: string[] }[]>`select changed_fields from app.task_history(${other}::uuid)`;
      expect(rows.some((r) => r.changed_fields?.includes('priority'))).toBe(true);
    });
    await as(SPECIALIST, async (tx) => {
      const rows = await tx`select 1 from app.task_history(${other}::uuid)`;
      expect(rows.length).toBeGreaterThan(0);
    });
    await as(NAJD_OWNER, async (tx) => {
      const rows = await tx`select 1 from app.task_history(${other}::uuid)`;
      expect(rows.length).toBe(0);
    });
  });
});
