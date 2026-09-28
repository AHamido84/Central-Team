/**
 * Phase 2 security: requests are isolated per client, Viewers are read-only, internal notes and internal
 * history never reach the portal, and lifecycle rules hold even for crafted writes — proven against Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, attempt, clientId, sql, userId } from './helpers';

const NAJD_OWNER = 'mohammed@najd.test';
const NAJD_MEMBER = 'abeer@najd.test';
const NAJD_VIEWER = 'saad@najd.test';
const AM = 'noura@ofoq.test'; // account manager of Najd (requests:triage)
const SPECIALIST = 'khalid@ofoq.test'; // on the Najd team (requests:update only)
const ADMIN = 'faisal@ofoq.test';

let najd: string;
let darb: string;
let org: string;
let form: { id: string; version: string };

beforeAll(async () => {
  najd = await clientId('najd-heritage');
  darb = await clientId('darb-coffee');
  const [row] = await sql<{ id: string; current_version_id: string; organization_id: string }[]>`
    select id, current_version_id, organization_id from public.request_forms where key = 'general'`;
  form = { id: row!.id, version: row!.current_version_id };
  org = row!.organization_id;
});

afterAll(async () => {
  await sql.end();
});

async function requestWhere(client: string, status: string, extra = sql``) {
  const [row] = await sql<{ id: string; assignee_id: string | null }[]>`
    select id, assignee_id from public.requests where client_id = ${client} and status = ${status} ${extra} order by number limit 1`;
  if (!row) throw new Error(`no ${status} request for ${client}`);
  return row;
}

describe('client isolation', () => {
  it('a portal user only sees their own client’s requests, history and attachments', async () => {
    const counts = await as(NAJD_OWNER, async (tx) => ({
      own: (await tx`select count(*)::int as n from public.requests where client_id = ${najd}`)[0]!.n,
      other: (await tx`select count(*)::int as n from public.requests where client_id <> ${najd}`)[0]!.n,
      events: (await tx`select count(*)::int as n from public.request_events where client_id <> ${najd}`)[0]!.n,
      attachments: (await tx`select count(*)::int as n from public.request_attachments where client_id <> ${najd}`)[0]!.n,
    }));
    expect(counts.own).toBeGreaterThan(0);
    expect(counts).toMatchObject({ other: 0, events: 0, attachments: 0 });
  });

  it('cannot submit a request for another client', async () => {
    const me = await userId(NAJD_OWNER);
    const direct = await attempt(
      NAJD_OWNER,
      (tx) =>
        tx`insert into public.requests (organization_id, client_id, form_id, form_version_id, title, submitted_by)
         values (${org}, ${darb}, ${form.id}, ${form.version}, 'x', ${me})`,
    );
    expect(direct?.code).toBe('42501');
  });

  it('agency staff only see requests of clients they can access', async () => {
    // Noura (read_assigned) manages Najd, Darb and Lujain but not Future Smile / Gulf Vision.
    const smile = await clientId('future-smile');
    const n = (await as(AM, (tx) => tx`select count(*)::int as n from public.requests where client_id = ${smile}`))[0]!.n;
    expect(n).toBe(0);
    const all = (await as(ADMIN, (tx) => tx`select count(*)::int as n from public.requests where client_id = ${smile}`))[0]!.n;
    expect(all).toBeGreaterThan(0);
  });
});

describe('Viewer is read-only', () => {
  it('reads requests but cannot submit or cancel', async () => {
    const me = await userId(NAJD_VIEWER);
    const seen = (await as(NAJD_VIEWER, (tx) => tx`select count(*)::int as n from public.requests where client_id = ${najd}`))[0]!.n;
    expect(seen).toBeGreaterThan(0);
    const insert = await attempt(
      NAJD_VIEWER,
      (tx) =>
        tx`insert into public.requests (organization_id, client_id, form_id, form_version_id, title, submitted_by)
           values (${org}, ${najd}, ${form.id}, ${form.version}, 'x', ${me})`,
    );
    expect(insert?.code).toBe('42501');
    const target = await requestWhere(najd, 'submitted');
    const updated = await as(NAJD_VIEWER, (tx) => tx`update public.requests set status = 'cancelled' where id = ${target.id} returning id`);
    expect(updated).toHaveLength(0);
  });
});

describe('internal items never reach the portal', () => {
  it('internal notes in request conversations are hidden from client users', async () => {
    const query = (tx: Parameters<Parameters<typeof as>[1]>[0]) =>
      tx`select count(*)::int as n from public.comments c join public.threads t on t.id = c.thread_id
         where t.subject_type = 'request' and c.visibility = 'internal' and c.client_id = ${najd}`;
    expect((await as(NAJD_OWNER, query))[0]!.n).toBe(0);
    expect((await as(AM, query))[0]!.n).toBeGreaterThan(0);
  });

  it('internal lifecycle history (assignment, priority) is hidden from client users', async () => {
    const query = (tx: Parameters<Parameters<typeof as>[1]>[0]) =>
      tx`select count(*)::int as n from public.request_events where client_id = ${najd} and visibility = 'internal'`;
    expect((await as(NAJD_MEMBER, query))[0]!.n).toBe(0);
    expect((await as(AM, query))[0]!.n).toBeGreaterThan(0);
  });

  it('request history rows cannot be written directly', async () => {
    const target = await requestWhere(najd, 'submitted');
    const err = await attempt(
      AM,
      (tx) =>
        tx`insert into public.request_events (organization_id, client_id, request_id, actor_side, type, visibility)
           values (${org}, ${najd}, ${target.id}, 'agency', 'status_changed', 'client')`,
    );
    expect(err?.code).toBe('42501');
  });
});

describe('client submissions', () => {
  it('lifecycle fields are server-owned: status, assignee, number, SLA, thread', async () => {
    const me = await userId(NAJD_MEMBER);
    const khalid = await userId(SPECIALIST);
    const result = await as(NAJD_MEMBER, async (tx) => {
      const [row] =
        await tx`insert into public.requests (organization_id, client_id, form_id, form_version_id, title, answers, status, assignee_id, submitted_by)
        values (${org}, ${najd}, ${form.id}, ${form.version}, 'طلب', ${tx.json({ details: 'x' })}, 'completed', ${khalid}, ${me}) returning *`;
      const threads = await tx`select id from public.threads where subject_type = 'request' and subject_id = ${row!.id}`;
      const events = await tx`select type, visibility from public.request_events where request_id = ${row!.id}`;
      return { row: row!, threads, events };
    });
    expect(result.row.status).toBe('submitted');
    expect(result.row.assignee_id).toBeNull();
    expect(result.row.submitted_side).toBe('client');
    expect(result.row.number).toBeGreaterThan(0);
    expect(result.row.response_due_at).not.toBeNull();
    expect(result.threads).toHaveLength(1);
    expect(result.events).toEqual([{ type: 'submitted', visibility: 'client' }]);
  });

  it('clients cannot mark their own request urgent', async () => {
    const me = await userId(NAJD_MEMBER);
    const err = await attempt(
      NAJD_MEMBER,
      (tx) =>
        tx`insert into public.requests (organization_id, client_id, form_id, form_version_id, title, priority, submitted_by)
           values (${org}, ${najd}, ${form.id}, ${form.version}, 'x', 'urgent', ${me})`,
    );
    expect(err?.message).toBe('request_field_restricted');
  });

  it('cannot submit against an unpublished (draft) form', async () => {
    const me = await userId(NAJD_MEMBER);
    const [draft] = await sql<{ id: string; version_id: string }[]>`
      select f.id, v.id as version_id from public.request_forms f join public.request_form_versions v on v.form_id = f.id
      where f.status = 'draft' limit 1`;
    const err = await attempt(
      NAJD_MEMBER,
      (tx) =>
        tx`insert into public.requests (organization_id, client_id, form_id, form_version_id, title, submitted_by)
           values (${org}, ${najd}, ${draft!.id}, ${draft!.version_id}, 'x', ${me})`,
    );
    expect(err).not.toBeNull();
  });

  it('clients can cancel before work starts, but nothing else', async () => {
    const submitted = await requestWhere(najd, 'submitted');
    const inProgress = await requestWhere(najd, 'in_progress');
    const cancel = await as(
      NAJD_MEMBER,
      (tx) => tx`update public.requests set status = 'cancelled' where id = ${submitted.id} returning status, cancelled_at`,
    );
    expect(cancel[0]?.status).toBe('cancelled');
    expect(cancel[0]?.cancelled_at).not.toBeNull();
    const priority = await attempt(NAJD_OWNER, (tx) => tx`update public.requests set priority = 'urgent' where id = ${submitted.id}`);
    expect(priority?.message).toBe('request_field_restricted');
    const late = await attempt(NAJD_OWNER, (tx) => tx`update public.requests set status = 'cancelled' where id = ${inProgress.id}`);
    expect(late?.message).toBe('invalid_transition');
    const complete = await attempt(NAJD_OWNER, (tx) => tx`update public.requests set status = 'completed' where id = ${submitted.id}`);
    expect(complete?.message).toBe('invalid_transition');
  });

  it('a client reply to "waiting on you" puts the request back in progress', async () => {
    const me = await userId(NAJD_OWNER);
    const waiting = await requestWhere(najd, 'waiting_client');
    const after = await as(NAJD_OWNER, async (tx) => {
      const [thread] = await tx`select id from public.threads where subject_type = 'request' and subject_id = ${waiting.id}`;
      await tx`insert into public.comments (organization_id, client_id, thread_id, author_id, author_side, body, visibility)
               values (${org}, ${najd}, ${thread!.id}, ${me}, 'client', 'أرسلنا الصور', 'client')`;
      const [r] = await tx`select status from public.requests where id = ${waiting.id}`;
      const [e] =
        await tx`select actor_side, to_value from public.request_events where request_id = ${waiting.id} order by created_at desc limit 1`;
      return { status: r!.status, event: e };
    });
    expect(after.status).toBe('in_progress');
    expect(after.event).toEqual({ actor_side: 'system', to_value: 'in_progress' });
  });
});

describe('agency triage', () => {
  it('account managers move requests along valid transitions only', async () => {
    const submitted = await requestWhere(najd, 'submitted');
    const ok = await as(
      AM,
      (tx) => tx`update public.requests set status = 'in_review' where id = ${submitted.id} returning first_response_at`,
    );
    expect(ok[0]?.first_response_at).not.toBeNull();
    const skip = await attempt(AM, (tx) => tx`update public.requests set status = 'completed' where id = ${submitted.id}`);
    expect(skip?.message).toBe('invalid_transition');
  });

  it('SLA due dates and lifecycle timestamps cannot be forged', async () => {
    const submitted = await requestWhere(najd, 'submitted');
    const [row] = await as(
      AM,
      (tx) =>
        tx`update public.requests set response_due_at = now() + interval '30 days', resolved_at = now() where id = ${submitted.id}
           returning response_due_at, resolved_at`,
    );
    const [original] = await sql<{ response_due_at: Date }[]>`select response_due_at from public.requests where id = ${submitted.id}`;
    expect(row?.response_due_at?.toISOString()).toBe(original!.response_due_at.toISOString());
    expect(row?.resolved_at).toBeNull();
  });

  it('assignees must be active agency members', async () => {
    const submitted = await requestWhere(najd, 'submitted');
    const clientUser = await userId(NAJD_OWNER);
    const err = await attempt(AM, (tx) => tx`update public.requests set assignee_id = ${clientUser} where id = ${submitted.id}`);
    expect(err?.message).toBe('invalid_assignee');
  });

  it('specialists update only requests assigned to them, and cannot re-prioritize', async () => {
    const khalid = await userId(SPECIALIST);
    const mine = await requestWhere(najd, 'in_progress', sql`and assignee_id = ${khalid}`);
    const notMine = await requestWhere(najd, 'submitted');
    const other = await as(SPECIALIST, (tx) => tx`update public.requests set status = 'in_review' where id = ${notMine.id} returning id`);
    expect(other).toHaveLength(0);
    const own = await as(
      SPECIALIST,
      (tx) => tx`update public.requests set status = 'waiting_client' where id = ${mine.id} returning status`,
    );
    expect(own[0]?.status).toBe('waiting_client');
    const prio = await attempt(SPECIALIST, (tx) => tx`update public.requests set priority = 'low' where id = ${mine.id}`);
    expect(prio?.message).toBe('request_field_restricted');
  });

  it('nobody deletes requests', async () => {
    const submitted = await requestWhere(najd, 'submitted');
    const err = await attempt(ADMIN, (tx) => tx`delete from public.requests where id = ${submitted.id}`);
    expect(err?.code).toBe('42501');
  });
});

describe('request forms', () => {
  it('client users see only published forms and published versions', async () => {
    const seen = await as(NAJD_OWNER, async (tx) => ({
      forms: (await tx`select distinct status from public.request_forms`).map((r) => r.status),
      drafts: (await tx`select count(*)::int as n from public.request_form_versions where published_at is null`)[0]!.n,
    }));
    expect(seen.forms).toEqual(['published']);
    expect(seen.drafts).toBe(0);
    const agency = (await as(AM, (tx) => tx`select count(*)::int as n from public.request_forms where status = 'draft'`))[0]!.n;
    expect(agency).toBeGreaterThan(0);
  });

  it('only request_forms:manage can create forms', async () => {
    const insert = (email: string) =>
      attempt(
        email,
        (tx) => tx`insert into public.request_forms (organization_id, key, name) values (${org}, 'x-test', ${tx.json({ ar: 'س' })})`,
      );
    expect((await insert(NAJD_OWNER))?.code).toBe('42501');
    expect((await insert(AM))?.code).toBe('42501');
    expect(await insert(ADMIN)).toBeNull();
  });

  it('published versions are frozen, even for form managers', async () => {
    const edit = await attempt(ADMIN, (tx) => tx`update public.request_form_versions set fields = '[]' where id = ${form.version}`);
    expect(edit?.message).toBe('form_version_published');
    const del = await attempt(ADMIN, (tx) => tx`delete from public.request_form_versions where id = ${form.version}`);
    expect(del?.message).toBe('form_version_published');
  });
});

describe('SLA groundwork', () => {
  it('counts working hours only (Friday and Saturday skipped, Riyadh time)', async () => {
    // Thursday 20:00 + 8 working hours = 4h Thursday + 4h Sunday → Sunday 04:00.
    const [row] = await sql<{ due: Date }[]>`select app.sla_due('2026-10-01 20:00+03', 8, 'Asia/Riyadh') as due`;
    expect(row!.due.toISOString()).toBe(new Date('2026-10-04T04:00:00+03:00').toISOString());
    const [none] = await sql<{ due: Date | null }[]>`select app.sla_due(now(), null, 'Asia/Riyadh') as due`;
    expect(none!.due).toBeNull();
  });
});
