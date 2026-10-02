/**
 * Phase 2 security: requests are isolated per client, drafts are private, Viewers are read-only, internal
 * history never reaches the portal, and the lifecycle, numbering and package rules hold even for crafted
 * writes — proven against Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, attempt, clientId, sql, userId } from './helpers';

const NAJD_OWNER = 'mohammed@najd.test';
const NAJD_MEMBER = 'abeer@najd.test';
const NAJD_VIEWER = 'saad@najd.test';
const AM = 'noura@ofoq.test'; // account manager of Najd (requests:triage)
const SPECIALIST = 'khalid@ofoq.test'; // on the Najd team (requests:update only)
const ADMIN = 'faisal@ofoq.test';

type Tx = Parameters<Parameters<typeof as>[1]>[0];

let najd: string;
let darb: string;
let org: string;
const types: Record<string, string> = {};

beforeAll(async () => {
  najd = await clientId('najd-heritage');
  darb = await clientId('darb-coffee');
  const rows = await sql<{ id: string; key: string; organization_id: string }[]>`select id, key, organization_id from public.request_types`;
  for (const r of rows) types[r.key] = r.id;
  org = rows[0]!.organization_id;
});

afterAll(async () => {
  await sql.end();
});

async function requestWhere(client: string, status: string) {
  const [row] = await sql<{ id: string; reference: string | null }[]>`
    select id, reference from public.requests where client_id = ${client} and status = ${status} order by created_at limit 1`;
  if (!row) throw new Error(`no ${status} request for ${client}`);
  return row;
}

/** Same as the app's actions: the reason travels in a transaction-local setting read by the triggers. */
const withReason = (tx: Tx, reason: string) => tx`select set_config('app.transition_reason', ${reason}, true)`;

/** Switch the acting user inside the same transaction (role stays `authenticated`). */
async function actAs(tx: Tx, email: string) {
  const sub = await userId(email);
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub, role: 'authenticated' })}, true)`;
}

function insertRequest(tx: Tx, client: string, type: string, extra: { status?: string; title?: string; priority?: string } = {}) {
  return tx`insert into public.requests (organization_id, client_id, request_type_id, title, status, priority)
    values (${org}, ${client}, ${types[type]!}, ${extra.title ?? 'طلب اختبار'}, ${extra.status ?? 'submitted'}, ${extra.priority ?? 'normal'})
    returning *`;
}

describe('client isolation', () => {
  it('a portal user only sees their own client’s requests, history and attachments', async () => {
    const counts = await as(NAJD_OWNER, async (tx) => ({
      own: (await tx`select count(*)::int as n from public.requests where client_id = ${najd}`)[0]!.n,
      other: (await tx`select count(*)::int as n from public.requests where client_id <> ${najd}`)[0]!.n,
      history: (await tx`select count(*)::int as n from public.request_status_history where client_id <> ${najd}`)[0]!.n,
      events: (await tx`select count(*)::int as n from public.request_events where client_id <> ${najd}`)[0]!.n,
      attachments: (await tx`select count(*)::int as n from public.request_attachments where client_id <> ${najd}`)[0]!.n,
    }));
    expect(counts.own).toBeGreaterThan(0);
    expect(counts).toMatchObject({ other: 0, history: 0, events: 0, attachments: 0 });
  });

  it('cannot create a request for another client', async () => {
    const err = await attempt(NAJD_OWNER, (tx) => insertRequest(tx, darb, 'social-post'));
    expect(err?.code).toBe('42501');
  });

  it('agency staff only see requests of clients they can access', async () => {
    // Noura (read_assigned) manages Najd, Darb and Lujain but not Future Smile.
    const smile = await clientId('future-smile');
    const n = (await as(AM, (tx) => tx`select count(*)::int as n from public.requests where client_id = ${smile}`))[0]!.n;
    expect(n).toBe(0);
    const all = (await as(ADMIN, (tx) => tx`select count(*)::int as n from public.requests where client_id = ${smile}`))[0]!.n;
    expect(all).toBeGreaterThan(0);
  });
});

describe('drafts are private to their author', () => {
  it('only the author sees a draft — not teammates, not the agency', async () => {
    const q = (tx: Tx) => tx`select count(*)::int as n from public.requests where client_id = ${najd} and status = 'draft'`;
    expect((await as(NAJD_MEMBER, q))[0]!.n).toBe(1);
    expect((await as(NAJD_OWNER, q))[0]!.n).toBe(0);
    expect((await as(AM, q))[0]!.n).toBe(0);
    expect((await as(ADMIN, q))[0]!.n).toBe(0);
  });

  it('a draft has no number, reference, due date or thread until it is submitted', async () => {
    const result = await as(NAJD_MEMBER, async (tx) => {
      const [draft] = await insertRequest(tx, najd, 'social-post', { status: 'draft', title: '' });
      const threadsBefore = await tx`select id from public.threads where subject_type = 'request' and subject_id = ${draft!.id}`;
      const [submitted] =
        await tx`update public.requests set title = 'منشور اليوم الوطني', status = 'submitted' where id = ${draft!.id} returning *`;
      const threadsAfter = await tx`select id from public.threads where subject_type = 'request' and subject_id = ${draft!.id}`;
      const history =
        await tx`select from_status, to_status, actor_side from public.request_status_history where request_id = ${draft!.id}`;
      return { draft: draft!, submitted: submitted!, threadsBefore, threadsAfter, history };
    });
    expect(result.draft).toMatchObject({ number: null, reference: null, due_date: null, submitted_at: null });
    expect(result.threadsBefore).toHaveLength(0);
    expect(result.submitted.reference).toMatch(/^NAJD-\d{4}$/);
    expect(result.submitted.due_date).not.toBeNull();
    expect(result.threadsAfter).toHaveLength(1);
    expect(result.history).toEqual([{ from_status: 'draft', to_status: 'submitted', actor_side: 'client' }]);
  });

  it('only the author can delete a draft; submitted requests are never deleted', async () => {
    const draft = await requestWhere(najd, 'draft');
    const byOwner = await as(NAJD_OWNER, (tx) => tx`delete from public.requests where id = ${draft.id} returning id`);
    expect(byOwner).toHaveLength(0);
    const byAuthor = await as(NAJD_MEMBER, (tx) => tx`delete from public.requests where id = ${draft.id} returning id`);
    expect(byAuthor).toHaveLength(1);
    const submitted = await requestWhere(najd, 'submitted');
    const admin = await as(ADMIN, (tx) => tx`delete from public.requests where id = ${submitted.id} returning id`);
    expect(admin).toHaveLength(0);
  });
});

describe('Viewer is read-only', () => {
  it('reads requests but cannot create or cancel', async () => {
    const seen = (await as(NAJD_VIEWER, (tx) => tx`select count(*)::int as n from public.requests where client_id = ${najd}`))[0]!.n;
    expect(seen).toBeGreaterThan(0);
    const insert = await attempt(NAJD_VIEWER, (tx) => insertRequest(tx, najd, 'social-post'));
    expect(insert?.code).toBe('42501');
    const target = await requestWhere(najd, 'submitted');
    const updated = await as(NAJD_VIEWER, (tx) => tx`update public.requests set status = 'cancelled' where id = ${target.id} returning id`);
    expect(updated).toHaveLength(0);
  });
});

describe('internal items never reach the portal', () => {
  it('internal notes in request conversations are hidden from client users', async () => {
    const query = (tx: Tx) =>
      tx`select count(*)::int as n from public.comments c join public.threads t on t.id = c.thread_id
         where t.subject_type = 'request' and c.visibility = 'internal' and c.client_id = ${najd}`;
    expect((await as(NAJD_OWNER, query))[0]!.n).toBe(0);
    expect((await as(AM, query))[0]!.n).toBeGreaterThan(0);
  });

  it('internal events (assignment, priority, flags) are hidden from client users', async () => {
    const query = (tx: Tx) =>
      tx`select count(*)::int as n from public.request_events where client_id = ${najd} and visibility = 'internal'`;
    expect((await as(NAJD_MEMBER, query))[0]!.n).toBe(0);
    expect((await as(AM, query))[0]!.n).toBeGreaterThan(0);
  });

  it('history and events cannot be written directly', async () => {
    const target = await requestWhere(najd, 'submitted');
    const history = await attempt(
      AM,
      (tx) =>
        tx`insert into public.request_status_history (organization_id, client_id, request_id, from_status, to_status, actor_side)
           values (${org}, ${najd}, ${target.id}, 'submitted', 'delivered', 'agency')`,
    );
    expect(history?.code).toBe('42501');
    const event = await attempt(
      AM,
      (tx) =>
        tx`insert into public.request_events (organization_id, client_id, request_id, actor_side, type, visibility)
           values (${org}, ${najd}, ${target.id}, 'agency', 'assigned', 'client')`,
    );
    expect(event?.code).toBe('42501');
  });
});

describe('client submissions', () => {
  it('lifecycle fields are server-owned: status, assignee, flags, snapshot', async () => {
    const khalid = await userId(SPECIALIST);
    const [type] = await sql<{ form_schema: { fields: unknown[] }; schema_version: number }[]>`
      select form_schema, schema_version from public.request_types where id = ${types['social-post']!}`;
    const row = await as(NAJD_MEMBER, async (tx) => {
      const [r] = await tx`insert into public.requests
          (organization_id, client_id, request_type_id, title, status, assignee_id, is_billable, due_date, reference, form_snapshot)
        values (${org}, ${najd}, ${types['social-post']!}, 'طلب', 'submitted', ${khalid}, true, '2020-01-01', 'HACK-1', '[]')
        returning *`;
      return r!;
    });
    const am = await userId(AM);
    expect(row.assignee_id).toBe(am); // defaults to the client's account manager
    expect(row.is_billable).toBe(false);
    expect(row.reference).not.toBe('HACK-1');
    expect(row.due_date.getFullYear()).toBeGreaterThanOrEqual(2026);
    expect(row.form_snapshot).toEqual(type!.form_schema.fields);
    expect(row.schema_version).toBe(type!.schema_version);
  });

  it('references are sequential per client', async () => {
    const refs = await as(NAJD_MEMBER, async (tx) => {
      const [a] = await insertRequest(tx, najd, 'story');
      const [b] = await insertRequest(tx, najd, 'story');
      return { a: a!.number as number, b: b!.number as number, ref: a!.reference as string };
    });
    const [max] = await sql<{ n: number }[]>`select max(number)::int as n from public.requests where client_id = ${najd}`;
    expect(refs.a).toBe(max!.n + 1);
    expect(refs.b).toBe(refs.a + 1);
    expect(refs.ref).toBe(`NAJD-${String(refs.a).padStart(4, '0')}`);
  });

  it('is_extra is computed from the package on submit (ad campaigns are used up for Najd)', async () => {
    const flags = await as(NAJD_MEMBER, async (tx) => {
      const [ad] = await insertRequest(tx, najd, 'ad-campaign');
      const [post] = await insertRequest(tx, najd, 'social-post');
      const [web] = await insertRequest(tx, najd, 'website-change');
      return { ad: ad!.is_extra, post: post!.is_extra, web: web!.is_extra };
    });
    expect(flags).toEqual({ ad: true, post: false, web: false });
  });

  it('clients cannot mark a request urgent or use an inactive type', async () => {
    const urgent = await attempt(NAJD_MEMBER, (tx) => insertRequest(tx, najd, 'social-post', { priority: 'urgent' }));
    expect(urgent?.message).toBe('request_field_restricted');
    const inactive = await attempt(NAJD_MEMBER, async (tx) => {
      await actAs(tx, ADMIN);
      await tx`update public.request_types set is_active = false where id = ${types.other!}`;
      await actAs(tx, NAJD_MEMBER);
      await insertRequest(tx, najd, 'other');
    });
    expect(inactive?.message).toBe('request_type_inactive');
  });

  it('the brief is editable only in draft and needs-info', async () => {
    const submitted = await requestWhere(najd, 'submitted');
    const needsInfo = await requestWhere(najd, 'needs_info');
    const locked = await attempt(NAJD_OWNER, (tx) => tx`update public.requests set title = 'تعديل' where id = ${submitted.id}`);
    expect(locked?.message).toBe('request_field_restricted');
    const events = await as(NAJD_OWNER, async (tx) => {
      await tx`update public.requests set title = 'تعديل بعد الاستفسار', brief = brief || '{"note":"x"}' where id = ${needsInfo.id}`;
      return tx`select type, visibility from public.request_events where request_id = ${needsInfo.id} and type = 'brief_updated'`;
    });
    expect(events).toEqual([{ type: 'brief_updated', visibility: 'client' }]);
    const serverField = await attempt(NAJD_OWNER, (tx) => tx`update public.requests set is_extra = true where id = ${needsInfo.id}`);
    expect(serverField?.message).toBe('request_field_restricted');
  });

  it('clients cancel early, resubmit after needs-info and close deliveries — nothing else', async () => {
    const submitted = await requestWhere(najd, 'submitted');
    const needsInfo = await requestWhere(najd, 'needs_info');
    const inProgress = await requestWhere(najd, 'in_progress');
    const delivered = await requestWhere(najd, 'delivered');
    const set = (id: string, status: string) => (tx: Tx) =>
      tx`update public.requests set status = ${status} where id = ${id} returning status, closed_at`;
    expect((await as(NAJD_MEMBER, set(submitted.id, 'cancelled')))[0]?.status).toBe('cancelled');
    expect((await as(NAJD_MEMBER, set(needsInfo.id, 'under_review')))[0]?.status).toBe('under_review');
    const closed = await as(NAJD_OWNER, set(delivered.id, 'closed'));
    expect(closed[0]?.closed_at).not.toBeNull();
    expect((await attempt(NAJD_OWNER, set(inProgress.id, 'cancelled')))?.message).toBe('invalid_transition');
    expect((await attempt(NAJD_OWNER, set(submitted.id, 'accepted')))?.message).toBe('invalid_transition');
    expect((await attempt(NAJD_OWNER, set(inProgress.id, 'delivered')))?.message).toBe('invalid_transition');
  });
});

describe('agency lifecycle', () => {
  it('account managers move requests along valid transitions only; history records each step', async () => {
    const submitted = await requestWhere(najd, 'submitted');
    const result = await as(AM, async (tx) => {
      const [r] = await tx`update public.requests set status = 'under_review' where id = ${submitted.id} returning first_response_at`;
      await tx`update public.requests set status = 'accepted' where id = ${submitted.id}`;
      const history = await tx`select from_status, to_status, actor_side from public.request_status_history
        where request_id = ${submitted.id} and actor_side = 'agency'`;
      return { firstResponse: r!.first_response_at, history };
    });
    expect(result.firstResponse).not.toBeNull();
    expect(result.history).toHaveLength(2);
    expect(result.history).toEqual(
      expect.arrayContaining([
        { from_status: 'submitted', to_status: 'under_review', actor_side: 'agency' },
        { from_status: 'under_review', to_status: 'accepted', actor_side: 'agency' },
      ]),
    );
    const skip = await attempt(AM, (tx) => tx`update public.requests set status = 'delivered' where id = ${submitted.id}`);
    expect(skip?.message).toBe('invalid_transition');
  });

  it('needs-info and reject require a reason, which lands in the history', async () => {
    const submitted = await requestWhere(najd, 'submitted');
    const missing = await attempt(AM, (tx) => tx`update public.requests set status = 'needs_info' where id = ${submitted.id}`);
    expect(missing?.message).toBe('reason_required');
    const reject = await attempt(AM, (tx) => tx`update public.requests set status = 'rejected' where id = ${submitted.id}`);
    expect(reject?.message).toBe('reason_required');
    const [row] = await as(AM, async (tx) => {
      await withReason(tx, 'أرسلوا الشعار بجودة عالية');
      await tx`update public.requests set status = 'needs_info' where id = ${submitted.id}`;
      return tx`select reason from public.request_status_history where request_id = ${submitted.id} and to_status = 'needs_info'`;
    });
    expect(row?.reason).toBe('أرسلوا الشعار بجودة عالية');
  });

  it('agency cannot see or edit client content: drafts and brief are off-limits', async () => {
    const submitted = await requestWhere(najd, 'submitted');
    const brief = await attempt(AM, (tx) => tx`update public.requests set title = 'agency edit' where id = ${submitted.id}`);
    expect(brief?.message).toBe('request_field_restricted');
  });

  it('lifecycle timestamps, numbers and snapshots cannot be forged', async () => {
    const submitted = await requestWhere(najd, 'submitted');
    const [row] = await as(
      AM,
      (tx) =>
        tx`update public.requests set submitted_at = now() - interval '30 days', number = 999, reference = 'X-1', delivered_at = now(), form_snapshot = '[]'
           where id = ${submitted.id} returning submitted_at, number, reference, delivered_at, form_snapshot`,
    );
    const [original] = await sql<{ submitted_at: Date; number: number; reference: string; form_snapshot: unknown[] }[]>`
      select submitted_at, number, reference, form_snapshot from public.requests where id = ${submitted.id}`;
    expect(row?.submitted_at.toISOString()).toBe(original!.submitted_at.toISOString());
    expect(row).toMatchObject({ number: original!.number, reference: original!.reference, delivered_at: null });
    expect(row?.form_snapshot).toEqual(original!.form_snapshot);
  });

  it('triage (assign, priority, due date, extra/billable) writes internal events; assignees must be agency members', async () => {
    const submitted = await requestWhere(najd, 'submitted');
    const khalid = await userId(SPECIALIST);
    const events = await as(AM, async (tx) => {
      await tx`update public.requests set assignee_id = ${khalid}, priority = 'high', is_billable = true, due_date = due_date + 2 where id = ${submitted.id}`;
      return tx`select type, visibility from public.request_events where request_id = ${submitted.id} order by type`;
    });
    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'assigned', visibility: 'internal' },
        { type: 'due_date_changed', visibility: 'client' },
        { type: 'flags_changed', visibility: 'internal' },
        { type: 'priority_changed', visibility: 'internal' },
      ]),
    );
    const clientUser = await userId(NAJD_OWNER);
    const err = await attempt(AM, (tx) => tx`update public.requests set assignee_id = ${clientUser} where id = ${submitted.id}`);
    expect(err?.message).toBe('invalid_assignee');
  });

  it('specialists work only on requests assigned to them, and cannot triage', async () => {
    const khalid = await userId(SPECIALIST);
    const inProgress = await requestWhere(najd, 'in_progress');
    const other = await requestWhere(najd, 'submitted');
    const result = await as(AM, async (tx) => {
      await tx`update public.requests set assignee_id = ${khalid} where id = ${inProgress.id}`;
      await actAs(tx, SPECIALIST);
      const notMine = await tx`update public.requests set status = 'under_review' where id = ${other.id} returning id`;
      const mine = await tx`update public.requests set status = 'in_review' where id = ${inProgress.id} returning status`;
      let prio: string | null = null;
      try {
        await tx.savepoint((sp) => sp`update public.requests set priority = 'low' where id = ${inProgress.id}`);
      } catch (e) {
        prio = (e as Error).message;
      }
      return { notMine: notMine.length, mine: mine[0]?.status, prio };
    });
    expect(result).toEqual({ notMine: 0, mine: 'in_review', prio: 'request_field_restricted' });
  });
});

describe('package consumption', () => {
  const usage = (tx: Tx, id: string) =>
    tx`select item_type, quantity from public.package_usage_entries where source_type = 'request' and source_id = ${id}`;

  it('accepting consumes one package item; reject or marking extra releases it', async () => {
    const submitted = await requestWhere(najd, 'submitted'); // a story
    const result = await as(AM, async (tx) => {
      const before = await usage(tx, submitted.id);
      await tx`update public.requests set status = 'accepted' where id = ${submitted.id}`;
      const accepted = await usage(tx, submitted.id);
      await tx`update public.requests set is_extra = true where id = ${submitted.id}`;
      const extra = await usage(tx, submitted.id);
      return { before, accepted, extra };
    });
    expect(result.before).toHaveLength(0);
    expect(result.accepted).toEqual([{ item_type: 'story', quantity: 1 }]);
    expect(result.extra).toHaveLength(0);
  });

  it('delivered work keeps its consumption; a rejected request never consumes', async () => {
    const delivered = await requestWhere(najd, 'delivered');
    const rejected = await requestWhere(darb, 'rejected');
    const rows = await as(ADMIN, async (tx) => ({ delivered: await usage(tx, delivered.id), rejected: await usage(tx, rejected.id) }));
    expect(rows.delivered).toHaveLength(1);
    expect(rows.rejected).toHaveLength(0);
  });

  it('quota is only visible to callers who can access the client', async () => {
    const own = await as(NAJD_MEMBER, (tx) => tx`select * from app.request_quota(${najd}, 'post')`);
    expect(own).toHaveLength(1);
    const other = await as(NAJD_MEMBER, (tx) => tx`select * from app.request_quota(${darb}, 'post')`);
    expect(other).toHaveLength(0);
  });
});

describe('request types', () => {
  it('client users see only active types; the agency sees all', async () => {
    const result = await as(ADMIN, async (tx) => {
      await tx`update public.request_types set is_active = false where id = ${types.branding!}`;
      const agency = (await tx`select count(*)::int as n from public.request_types`)[0]!.n;
      await actAs(tx, NAJD_OWNER);
      const client = await tx`select key from public.request_types`;
      return { agency, client: client.map((r) => r.key) };
    });
    expect(result.agency).toBe(Object.keys(types).length);
    expect(result.client).not.toContain('branding');
    expect(result.client).toContain('social-post');
  });

  it('only request_types:manage can create or edit types', async () => {
    const insert = (email: string) =>
      attempt(
        email,
        (tx) =>
          tx`insert into public.request_types (organization_id, key, name, category) values (${org}, 'x-test', ${tx.json({ ar: 'س', en: 'X' })}, 'other')`,
      );
    expect((await insert(NAJD_OWNER))?.code).toBe('42501');
    expect((await insert(AM))?.code).toBe('42501');
    expect(await insert(ADMIN)).toBeNull();
    const edit = await as(AM, (tx) => tx`update public.request_types set sla_days = 1 where id = ${types.story!} returning id`);
    expect(edit).toHaveLength(0);
  });

  it('every form change bumps the schema version; submitted requests keep their snapshot', async () => {
    const submitted = await requestWhere(najd, 'submitted');
    const result = await as(ADMIN, async (tx) => {
      const [before] = await tx`select schema_version from public.request_types where id = ${types.story!}`;
      const [after] =
        await tx`update public.request_types set form_schema = '{"fields":[]}' where id = ${types.story!} returning schema_version`;
      const [renamed] = await tx`update public.request_types set sla_days = 4 where id = ${types.story!} returning schema_version`;
      const [req] = await tx`select jsonb_array_length(form_snapshot) as n from public.requests where id = ${submitted.id}`;
      return { before: before!.schema_version, after: after!.schema_version, renamed: renamed!.schema_version, snapshot: req!.n };
    });
    expect(result.after).toBe(result.before + 1);
    expect(result.renamed).toBe(result.after);
    expect(result.snapshot).toBeGreaterThan(0);
  });
});

describe('SLA groundwork', () => {
  it('adds working days, skipping Friday and Saturday', async () => {
    const [row] = await sql<{ a: string; b: string }[]>`
      select app.add_working_days('2026-10-01', 1)::text as a, app.add_working_days('2026-10-04', 5)::text as b`;
    expect(row).toEqual({ a: '2026-10-04', b: '2026-10-11' });
  });
});
