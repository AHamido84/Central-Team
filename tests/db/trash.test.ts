/**
 * Feedback Round 1 — soft delete, Trash and data reset (ADR-080/081), proven against Postgres: deleted rows vanish from
 * every read (agency and portal), children go with their parent and come back with it, purge is permanent and hands
 * back the Storage paths, the rights follow `<resource>:delete` / `:purge` (authors may delete their own messages), and
 * a data reset removes exactly its scope while kept data survives.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, attempt, clientId, sql, userId } from './helpers';

type Tx = Parameters<Parameters<typeof as>[1]>[0];

const SUPER = 'sara@ofoq.test';
const ADMIN = 'faisal@ofoq.test';
const AM = 'noura@ofoq.test'; // Najd account manager
const SPECIALIST = 'khalid@ofoq.test';
const NAJD_OWNER = 'mohammed@najd.test';

let najd: string;
let org: string;

beforeAll(async () => {
  najd = await clientId('najd-heritage');
  const [row] = await sql<{ organization_id: string }[]>`select organization_id from public.clients where id = ${najd}`;
  org = row!.organization_id;
});

afterAll(async () => {
  await sql.end();
});

async function actAs(tx: Tx, email: string) {
  const sub = await userId(email);
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub, role: 'authenticated' })}, true)`;
}

async function trashDelete(tx: Tx, type: string, id: string, reassign: string | null = null) {
  const [row] = await tx<{ batch: string }[]>`select app.trash_delete(${type}, ${id}::uuid, ${reassign}::uuid) as batch`;
  return row!.batch;
}

async function count(tx: Tx, query: string, ...params: unknown[]) {
  const rows = await tx.unsafe<{ n: number }[]>(query, params as never[]);
  return Number(rows[0]!.n);
}

describe('soft delete hides rows everywhere', () => {
  it('a deleted request disappears with its tasks for the agency and the portal, and comes back on restore', async () => {
    await as(ADMIN, async (tx) => {
      const [req] = await tx<{ id: string }[]>`
        select r.id from public.requests r where r.client_id = ${najd}
          and exists (select 1 from public.tasks t where t.request_id = r.id) limit 1`;
      const requestId = req!.id;
      const tasksBefore = await count(tx, 'select count(*)::int as n from public.tasks where request_id = $1', requestId);
      expect(tasksBefore).toBeGreaterThan(0);

      const batch = await trashDelete(tx, 'request', requestId);
      expect(await count(tx, 'select count(*)::int as n from public.requests where id = $1', requestId)).toBe(0);
      expect(await count(tx, 'select count(*)::int as n from public.tasks where request_id = $1', requestId)).toBe(0);

      // The portal no longer sees it either.
      await actAs(tx, NAJD_OWNER);
      expect(await count(tx, 'select count(*)::int as n from public.requests where id = $1', requestId)).toBe(0);

      // The Trash lists it for the admin (in Trash mode only), with the tasks it took along.
      await actAs(tx, ADMIN);
      await tx`select set_config('app.trash_mode', 'on', true)`;
      const [item] = await tx<{ entity_type: string; counts: Record<string, number> }[]>`
        select entity_type, counts from public.trash_items where batch = ${batch}`;
      expect(item!.entity_type).toBe('request');
      expect(item!.counts.tasks).toBe(tasksBefore);
      await tx`select set_config('app.trash_mode', 'off', true)`;

      await tx`select app.trash_restore(${batch}::uuid)`;
      expect(await count(tx, 'select count(*)::int as n from public.requests where id = $1', requestId)).toBe(1);
      expect(await count(tx, 'select count(*)::int as n from public.tasks where request_id = $1', requestId)).toBe(tasksBefore);
      expect(await count(tx, 'select count(*)::int as n from public.trash_items where batch = $1', batch)).toBe(0);
    });
  });

  it('a deleted client hides all of its data at once and locks its portal users out', async () => {
    await as(ADMIN, async (tx) => {
      expect(await count(tx, 'select count(*)::int as n from public.tasks where client_id = $1', najd)).toBeGreaterThan(0);
      await trashDelete(tx, 'client', najd);
      for (const table of ['clients', 'requests', 'tasks', 'files', 'threads', 'deliverables', 'campaigns']) {
        const where = table === 'clients' ? 'id' : 'client_id';
        expect(await count(tx, `select count(*)::int as n from public.${table} where ${where} = $1`, najd), table).toBe(0);
      }
      await actAs(tx, AM);
      expect(await count(tx, 'select count(*)::int as n from public.tasks where client_id = $1', najd)).toBe(0);
      await actAs(tx, NAJD_OWNER);
      const [member] = await tx<{ ok: boolean }[]>`select app.is_client_member(${najd}::uuid) as ok`;
      expect(member!.ok).toBe(false);
      expect(await count(tx, 'select count(*)::int as n from public.requests where client_id = $1', najd)).toBe(0);
    });
  });

  it('deleted rows cannot be updated until restored', async () => {
    await as(ADMIN, async (tx) => {
      const [task] = await tx<{ id: string }[]>`select id from public.tasks where client_id = ${najd} and parent_id is null limit 1`;
      await trashDelete(tx, 'task', task!.id);
      const updated = await tx`update public.tasks set title = 'x' where id = ${task!.id} returning id`;
      expect(updated.length).toBe(0);
    });
  });
});

describe('purge', () => {
  it('removes the rows for good and returns the Storage paths of their files', async () => {
    await as(SUPER, async (tx) => {
      const files = await tx<{ storage_path: string }[]>`select storage_path from public.files where client_id = ${najd}`;
      expect(files.length).toBeGreaterThan(0);
      const batch = await trashDelete(tx, 'client', najd);
      const [row] = await tx<{ paths: string[] }[]>`select app.trash_purge(${batch}::uuid) as paths`;
      expect(row!.paths).toEqual(expect.arrayContaining(files.map((f) => f.storage_path)));
      await tx`select set_config('app.trash_mode', 'on', true)`;
      expect(await count(tx, 'select count(*)::int as n from public.clients where id = $1', najd)).toBe(0);
      expect(await count(tx, 'select count(*)::int as n from public.trash_items where batch = $1', batch)).toBe(0);
      // Nothing of the client is left in the database at all (checked as the table owner).
      await tx`select set_config('role', 'postgres', true)`;
      expect(await count(tx, 'select count(*)::int as n from public.tasks where client_id = $1', najd)).toBe(0);
    });
  });

  it('needs the :purge permission — an account manager can delete a request but not purge it', async () => {
    const error = await attempt(AM, async (tx) => {
      const [req] = await tx<{ id: string }[]>`select id from public.requests where client_id = ${najd} limit 1`;
      const batch = await trashDelete(tx, 'request', req!.id);
      await tx`select app.trash_purge(${batch}::uuid)`;
    });
    expect(error?.code).toBe('42501');
  });
});

describe('who may delete what', () => {
  it("a specialist can't delete other people's work", async () => {
    const error = await attempt(SPECIALIST, async (tx) => {
      const [task] = await tx<{ id: string }[]>`select id from public.tasks where client_id = ${najd} limit 1`;
      await trashDelete(tx, 'task', task!.id);
    });
    expect(error?.code).toBe('42501');
  });

  it('authors may delete their own message but not somebody else’s', async () => {
    await as(SPECIALIST, async (tx) => {
      const me = await userId(SPECIALIST);
      const [thread] = await tx<{ id: string }[]>`select id from public.threads where client_id = ${najd} limit 1`;
      const [mine] = await tx<{ id: string }[]>`
        insert into public.comments (organization_id, client_id, thread_id, author_id, author_side, body, visibility)
        values (${org}, ${najd}, ${thread!.id}, ${me}, 'agency', 'mine', 'internal') returning id`;
      await trashDelete(tx, 'comment', mine!.id);
      expect(await count(tx, 'select count(*)::int as n from public.comments where id = $1', mine!.id)).toBe(0);
    });
    const error = await attempt(SPECIALIST, async (tx) => {
      const me = await userId(SPECIALIST);
      const [other] = await tx<{ id: string }[]>`
        select id from public.comments where client_id = ${najd} and author_id is distinct from ${me} limit 1`;
      await trashDelete(tx, 'comment', other!.id);
    });
    expect(error?.code).toBe('42501');
  });

  it('the Trash shows entries only to people who may delete that kind of row', async () => {
    await as(ADMIN, async (tx) => {
      const [task] = await tx<{ id: string }[]>`select id from public.tasks where client_id = ${najd} limit 1`;
      const batch = await trashDelete(tx, 'task', task!.id);
      await actAs(tx, SPECIALIST);
      await tx`select set_config('app.trash_mode', 'on', true)`;
      expect(await count(tx, 'select count(*)::int as n from public.trash_items where batch = $1', batch)).toBe(0);
    });
  });
});

describe('blockers and cascades', () => {
  it('a request type still used by requests cannot be deleted', async () => {
    await as(ADMIN, async (tx) => {
      const [type] = await tx<{ id: string }[]>`
        select request_type_id as id from public.requests group by request_type_id order by count(*) desc limit 1`;
      const [row] = await tx<{ impact: { blockers: Record<string, number> } }[]>`
        select app.trash_impact('request_type', ${type!.id}::uuid) as impact`;
      expect(row!.impact.blockers.requests).toBeGreaterThan(0);
    });
    const error = await attempt(ADMIN, async (tx) => {
      const [type] = await tx<{ id: string }[]>`select request_type_id as id from public.requests limit 1`;
      await trashDelete(tx, 'request_type', type!.id);
    });
    expect(error?.message).toBe('in_use');
  });

  it('deleting a team member asks who takes over their open work and moves it', async () => {
    const khalid = await userId(SPECIALIST);
    const hind = await userId('hind@ofoq.test');
    const error = await attempt(ADMIN, async (tx) => {
      const [m] = await tx<
        { id: string }[]
      >`select id from public.organization_members where user_id = ${khalid} and organization_id = ${org}`;
      await trashDelete(tx, 'member', m!.id);
    });
    expect(error?.message).toBe('reassign_required');

    await as(ADMIN, async (tx) => {
      const open = await count(
        tx,
        `select count(*)::int as n from public.task_members a join public.tasks t on t.id = a.task_id
         where a.role = 'assignee' and a.user_id = $1 and t.status_category <> 'done'`,
        khalid,
      );
      expect(open).toBeGreaterThan(0);
      const [m] = await tx<
        { id: string }[]
      >`select id from public.organization_members where user_id = ${khalid} and organization_id = ${org}`;
      await trashDelete(tx, 'member', m!.id, hind);
      expect(
        await count(
          tx,
          `select count(*)::int as n from public.task_members a join public.tasks t on t.id = a.task_id
           where a.role = 'assignee' and a.user_id = $1 and t.status_category <> 'done'`,
          khalid,
        ),
      ).toBe(0);
      await tx`select set_config('role', 'postgres', true)`;
      const [status] = await tx<{ status: string }[]>`select status from public.organization_members where id = ${m!.id}`;
      expect(status!.status).toBe('deactivated');
    });
  });

  it('the last Super Admin cannot be removed', async () => {
    const sara = await userId(SUPER);
    await as(ADMIN, async (tx) => {
      const [m] = await tx<
        { id: string }[]
      >`select id from public.organization_members where user_id = ${sara} and organization_id = ${org}`;
      const [row] = await tx<
        { impact: { blockers: Record<string, number> } }[]
      >`select app.trash_impact('member', ${m!.id}::uuid) as impact`;
      expect(row!.impact.blockers.last_super_admin).toBe(1);
    });
  });
});

describe('data reset', () => {
  async function asService<T>(fn: (tx: Tx) => Promise<T>) {
    let out: T | undefined;
    try {
      await sql.begin(async (tx) => {
        out = await fn(tx as unknown as Tx);
        throw new Error('rollback');
      });
    } catch (error) {
      if ((error as Error).message !== 'rollback') throw error;
    }
    return out as T;
  }

  it('is not callable by signed-in users', async () => {
    const error = await attempt(SUPER, async (tx) => {
      await tx`select app.data_reset_run(${org}::uuid, 'demo', ${await userId(SUPER)}::uuid)`;
    });
    expect(error?.code).toBe('42501');
  });

  it('demo mode removes demo data and keeps real data', async () => {
    const sara = await userId(SUPER);
    await asService(async (tx) => {
      const [kept] = await tx<{ id: string }[]>`
        insert into public.clients (organization_id, name, slug, status)
        values (${org}, '{"ar":"عميل حقيقي","en":"Real client"}', 'real-client-kept', 'active') returning id`;
      const [preview] = await tx<{ counts: Record<string, number> }[]>`
        select app.data_reset_preview(${org}::uuid, 'demo', ${sara}::uuid) as counts`;
      expect(preview!.counts.clients).toBe(5);
      await tx`select app.data_reset_run(${org}::uuid, 'demo', ${sara}::uuid)`;
      expect(await count(tx, 'select count(*)::int as n from public.clients where organization_id = $1', org)).toBe(1);
      expect(await count(tx, 'select count(*)::int as n from public.clients where id = $1', kept!.id)).toBe(1);
      expect(await count(tx, 'select count(*)::int as n from public.organizations where id = $1', org)).toBe(1);
      expect(await count(tx, 'select count(*)::int as n from auth.users where id = $1', sara)).toBe(1);
      // Roles and permissions are configuration, never demo data.
      expect(await count(tx, 'select count(*)::int as n from public.roles where organization_id = $1', org)).toBeGreaterThan(0);
    });
  });

  it('operational mode keeps the team and configuration', async () => {
    const sara = await userId(SUPER);
    await asService(async (tx) => {
      const members = await count(
        tx,
        'select count(*)::int as n from public.organization_members where organization_id = $1 and user_type = $2',
        org,
        'agency',
      );
      const types = await count(tx, 'select count(*)::int as n from public.request_types where organization_id = $1', org);
      await tx`select app.data_reset_run(${org}::uuid, 'operational', ${sara}::uuid)`;
      for (const table of ['clients', 'requests', 'tasks', 'files', 'leads', 'deals', 'notifications']) {
        expect(await count(tx, `select count(*)::int as n from public.${table} where organization_id = $1`, org), table).toBe(0);
      }
      expect(
        await count(
          tx,
          'select count(*)::int as n from public.organization_members where organization_id = $1 and user_type = $2',
          org,
          'agency',
        ),
      ).toBe(members);
      expect(await count(tx, 'select count(*)::int as n from public.request_types where organization_id = $1', org)).toBe(types);
    });
  });

  it('factory reset keeps only the organization and its Super Admin, then re-creates the defaults', async () => {
    const sara = await userId(SUPER);
    await asService(async (tx) => {
      await tx`select app.data_reset_run(${org}::uuid, 'factory', ${sara}::uuid)`;
      expect(await count(tx, 'select count(*)::int as n from public.organization_members where organization_id = $1', org)).toBe(1);
      expect(await count(tx, 'select count(*)::int as n from public.clients where organization_id = $1', org)).toBe(0);
      expect(await count(tx, 'select count(*)::int as n from public.roles where organization_id = $1', org)).toBeGreaterThan(0);
      const [sa] = await tx<{ ok: boolean }[]>`
        select exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
          where ur.user_id = ${sara} and r.key = 'super_admin' and r.organization_id = ${org}) as ok`;
      expect(sa!.ok).toBe(true);
    });
  });

  it('refuses to run while the reset is locked', async () => {
    const sara = await userId(SUPER);
    const error = await asService(async (tx) => {
      await tx`update public.organizations set data_reset_locked_at = now() where id = ${org}`;
      try {
        await tx.savepoint((sp) => sp`select app.data_reset_run(${org}::uuid, 'demo', ${sara}::uuid)`);
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(error).toBe('reset_locked');
  });
});
