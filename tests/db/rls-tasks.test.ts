/**
 * Phase 3 security & lifecycle: tasks, time and workflows are agency-only; clients see a deliverable only once a
 * version was sent to them, and only those versions, their files and client-visible comments; the approval state
 * machine moves version → deliverable → task → request and counts client revision rounds — proven against Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, attempt, clientId, sql, userId } from './helpers';

type Tx = Parameters<Parameters<typeof as>[1]>[0];

const NAJD_OWNER = 'mohammed@najd.test'; // can approve
const NAJD_VIEWER = 'saad@najd.test'; // read-only, no approval right
const DARB_MEMBER = 'dana@darb.test';
const AM = 'noura@ofoq.test'; // Najd account manager (deliverables:review)
const SPECIALIST = 'khalid@ofoq.test'; // Najd + Future Smile team, no review right
const ADMIN = 'faisal@ofoq.test';

let najd: string;
let darb: string;
let smile: string;
let org: string;

beforeAll(async () => {
  najd = await clientId('najd-heritage');
  darb = await clientId('darb-coffee');
  smile = await clientId('future-smile');
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

const count = async (tx: Tx, table: string, where = sql`true`) =>
  ((await tx`select count(*)::int as n from ${tx(table)} where ${where}`)[0] as { n: number }).n;

/** A fresh task + deliverable (+ draft version with one file) for Najd, created as the account manager. */
async function freshDeliverable(tx: Tx, flags = { review: true, approval: true }) {
  await actAs(tx, AM);
  const me = await userId(AM);
  const [status] = await tx`select id from public.task_statuses where is_default`;
  const [task] =
    await tx`insert into public.tasks (organization_id, client_id, title, status_id) values (${org}, ${najd}, 'اختبار', ${status!.id}) returning id`;
  const [d] =
    await tx`insert into public.deliverables (organization_id, client_id, task_id, type, title, requires_internal_review, requires_client_approval)
    values (${org}, ${najd}, ${task!.id}, 'design', 'تصميم اختبار', ${flags.review}, ${flags.approval}) returning id`;
  const [v] =
    await tx`insert into public.deliverable_versions (organization_id, client_id, deliverable_id) values (${org}, ${najd}, ${d!.id}) returning id, number, status`;
  const fileId = crypto.randomUUID();
  await tx`insert into public.files (id, organization_id, client_id, name, storage_path, mime_type, size_bytes, kind, visibility, source, uploaded_by, uploader_side)
    values (${fileId}, ${org}, ${najd}, 'v1.png', ${`test/${fileId}.png`}, 'image/png', 100, 'image', 'internal', 'deliverable', ${me}, 'agency')`;
  await tx`insert into public.deliverable_version_files (version_id, file_id, organization_id, client_id) values (${v!.id}, ${fileId}, ${org}, ${najd})`;
  return { taskId: task!.id as string, deliverableId: d!.id as string, versionId: v!.id as string, fileId, version: v! };
}

const decide = (
  tx: Tx,
  versionId: string,
  stage: 'internal' | 'client',
  decision: 'approved' | 'changes_requested',
  reviewer: string,
  comment = 'ملاحظات',
) =>
  tx`insert into public.approvals (organization_id, client_id, deliverable_id, version_id, stage, decision, comment, reviewer_id)
     values (${org}, ${najd}, ${crypto.randomUUID()}, ${versionId}, ${stage}, ${decision}, ${comment}, ${reviewer})`;

describe('agency-only data never reaches the portal', () => {
  it('client users see no tasks, members, checklists, time, statuses, workflows or saved views', async () => {
    const counts = await as(NAJD_OWNER, async (tx) => ({
      tasks: await count(tx, 'tasks'),
      members: await count(tx, 'task_members'),
      deps: await count(tx, 'task_dependencies'),
      checklist: await count(tx, 'task_checklist_items'),
      time: await count(tx, 'time_entries'),
      statuses: await count(tx, 'task_statuses'),
      templates: await count(tx, 'workflow_templates'),
      steps: await count(tx, 'workflow_template_steps'),
      views: await count(tx, 'saved_views'),
      taskThreads: await count(tx, 'threads', sql`subject_type = 'task'`),
    }));
    expect(counts).toEqual({
      tasks: 0,
      members: 0,
      deps: 0,
      checklist: 0,
      time: 0,
      statuses: 0,
      templates: 0,
      steps: 0,
      views: 0,
      taskThreads: 0,
    });
    const agency = await as(AM, async (tx) => ({ tasks: await count(tx, 'tasks'), statuses: await count(tx, 'task_statuses') }));
    expect(agency.tasks).toBeGreaterThan(0);
    expect(agency.statuses).toBe(6);
  });

  it('client users cannot create tasks or time entries even with crafted writes', async () => {
    const [status] = await sql`select id from public.task_statuses limit 1`;
    const task = await attempt(
      NAJD_OWNER,
      (tx) => tx`insert into public.tasks (organization_id, client_id, title, status_id) values (${org}, ${najd}, 'x', ${status!.id})`,
    );
    expect(task?.code).toBe('42501');
    const [t] = await sql`select id from public.tasks where client_id = ${najd} limit 1`;
    const time = await attempt(
      NAJD_OWNER,
      (tx) =>
        tx`insert into public.time_entries (organization_id, client_id, task_id, user_id) values (${org}, ${najd}, ${t!.id}, ${crypto.randomUUID()})`,
    );
    expect(time?.code).toBe('42501');
  });

  it('clients see only deliverables sent to them, only sent versions, only client-stage approvals and client-visible comments', async () => {
    const seen = await as(NAJD_OWNER, async (tx) => ({
      unsent: await count(tx, 'deliverables', sql`client_visible_at is null`),
      draftVersions: await count(tx, 'deliverable_versions', sql`sent_to_client_at is null`),
      internalApprovals: await count(tx, 'approvals', sql`stage = 'internal'`),
      internalNotes: await count(tx, 'annotations', sql`visibility = 'internal'`),
      otherClient: await count(tx, 'deliverables', sql`client_id <> ${najd}`),
      visible: await count(tx, 'deliverables'),
    }));
    expect(seen).toMatchObject({ unsent: 0, draftVersions: 0, internalApprovals: 0, internalNotes: 0, otherClient: 0 });
    expect(seen.visible).toBeGreaterThan(0);
    const agency = await as(AM, async (tx) => ({
      unsent: await count(tx, 'deliverables', sql`client_visible_at is null and client_id = ${najd}`),
      internalNotes: await count(tx, 'annotations', sql`visibility = 'internal' and client_id = ${najd}`),
    }));
    expect(agency.unsent).toBeGreaterThan(0);
    expect(agency.internalNotes).toBeGreaterThan(0);
  });

  it('deliverable files are hidden from the client until their version is sent', async () => {
    const result = await as(ADMIN, async (tx) => {
      const f = await freshDeliverable(tx);
      await actAs(tx, NAJD_OWNER);
      const before = await count(tx, 'files', sql`id = ${f.fileId}`);
      await actAs(tx, AM);
      await tx`update public.deliverable_versions set status = 'internal_review' where id = ${f.versionId}`;
      await decide(tx, f.versionId, 'internal', 'approved', await userId(AM));
      await actAs(tx, NAJD_OWNER);
      const after = await count(tx, 'files', sql`id = ${f.fileId}`);
      // …and never through the files library.
      const library = await count(tx, 'files', sql`id = ${f.fileId} and source = 'library'`);
      return { before, after, library };
    });
    expect(result).toEqual({ before: 0, after: 1, library: 0 });
  });

  it('agency staff only see tasks of clients they can access; specialists cannot review or manage workflows', async () => {
    const khalid = await as(SPECIALIST, async (tx) => ({
      najd: await count(tx, 'tasks', sql`client_id = ${najd}`),
      darb: await count(tx, 'tasks', sql`client_id = ${darb}`),
    }));
    expect(khalid.najd).toBeGreaterThan(0);
    expect(khalid.darb).toBe(0);
    const tpl = await attempt(
      SPECIALIST,
      (tx) => tx`insert into public.workflow_templates (organization_id, name) values (${org}, ${tx.json({ ar: 'x', en: 'x' })})`,
    );
    expect(tpl?.code).toBe('42501');
    const review = await as(ADMIN, async (tx) => {
      const f = await freshDeliverable(tx);
      await tx`update public.deliverable_versions set status = 'internal_review' where id = ${f.versionId}`;
      await actAs(tx, SPECIALIST);
      const khalidId = await userId(SPECIALIST);
      try {
        await tx.savepoint((sp) => decide(sp as unknown as Tx, f.versionId, 'internal', 'approved', khalidId));
        return null;
      } catch (e) {
        return (e as { code?: string }).code;
      }
    });
    expect(review).toBe('42501');
  });
});

describe('approval state machine', () => {
  it('submit → internal review → changes → new version → internal approval → client', async () => {
    const r = await as(ADMIN, async (tx) => {
      const f = await freshDeliverable(tx);
      const status = async () => {
        const [d] =
          await tx`select d.status, t.status_category from public.deliverables d join public.tasks t on t.id = d.task_id where d.id = ${f.deliverableId}`;
        return `${d!.status}/${d!.status_category}`;
      };
      const steps: string[] = [await status()];
      await tx`update public.deliverable_versions set status = 'internal_review' where id = ${f.versionId}`;
      steps.push(await status());
      await decide(tx, f.versionId, 'internal', 'changes_requested', await userId(AM), 'الألوان باهتة');
      steps.push(await status());
      const [v2] =
        await tx`insert into public.deliverable_versions (organization_id, client_id, deliverable_id) values (${org}, ${najd}, ${f.deliverableId}) returning id, number`;
      const [v1] = await tx`select status from public.deliverable_versions where id = ${f.versionId}`;
      steps.push(await status());
      return {
        steps,
        v2: v2!,
        v1: v1!.status as string,
        fileless: await attemptIn(tx, (q) => q`update public.deliverable_versions set status = 'internal_review' where id = ${v2!.id}`),
      };
    });
    expect(r.steps).toEqual(['in_progress/active', 'internal_review/review', 'internal_changes/changes', 'in_progress/active']);
    expect(r.v2.number).toBe(2);
    // The version with changes requested stays as history; the new one must carry files before it can be sent.
    expect(r.v1).toBe('internal_changes');
    expect(r.fileless).toBe('version_empty');
  });

  it('client changes use a revision round from the package; approval delivers the task and the request', async () => {
    const r = await as(ADMIN, async (tx) => {
      const [req] = await tx`select id from public.requests where client_id = ${najd} and status = 'in_progress' limit 1`;
      const f = await freshDeliverable(tx);
      await tx`update public.deliverables set request_id = ${req!.id} where id = ${f.deliverableId}`;
      await tx`update public.tasks set request_id = ${req!.id} where id = ${f.taskId}`;
      // Make this the request's only deliverable, so approving it completes the request.
      await tx`update public.deliverables set request_id = null where request_id = ${req!.id} and id <> ${f.deliverableId}`;
      const usage = async () => count(tx, 'package_usage_entries', sql`client_id = ${najd} and item_type = 'revision_round'`);
      const before = await usage();
      await tx`update public.deliverable_versions set status = 'internal_review' where id = ${f.versionId}`;
      await decide(tx, f.versionId, 'internal', 'approved', await userId(AM));
      const [sent] = await tx`select status, sent_to_client_at from public.deliverable_versions where id = ${f.versionId}`;
      await actAs(tx, NAJD_OWNER);
      const owner = await userId(NAJD_OWNER);
      await decide(tx, f.versionId, 'client', 'changes_requested', owner, 'خلفية أفتح لو سمحتم');
      await actAs(tx, ADMIN);
      const afterChanges = await usage();
      const [rounds] = await tx`select revision_rounds, status from public.deliverables where id = ${f.deliverableId}`;
      // v2 with a file, straight through internal review and client approval.
      await actAs(tx, AM);
      const [v2] =
        await tx`insert into public.deliverable_versions (organization_id, client_id, deliverable_id) values (${org}, ${najd}, ${f.deliverableId}) returning id`;
      const fileId = crypto.randomUUID();
      await tx`insert into public.files (id, organization_id, client_id, name, storage_path, mime_type, size_bytes, kind, visibility, source, uploaded_by, uploader_side)
        values (${fileId}, ${org}, ${najd}, 'v2.png', ${`test/${fileId}.png`}, 'image/png', 100, 'image', 'internal', 'deliverable', ${await userId(AM)}, 'agency')`;
      await tx`insert into public.deliverable_version_files (version_id, file_id, organization_id, client_id) values (${v2!.id}, ${fileId}, ${org}, ${najd})`;
      await tx`update public.deliverable_versions set status = 'internal_review' where id = ${v2!.id}`;
      await decide(tx, v2!.id, 'internal', 'approved', await userId(AM));
      await actAs(tx, NAJD_OWNER);
      await decide(tx, v2!.id, 'client', 'approved', owner, '');
      await actAs(tx, ADMIN);
      const [final] = await tx`select d.status, d.approved_at, t.status_category, r.status as request from public.deliverables d
        join public.tasks t on t.id = d.task_id join public.requests r on r.id = d.request_id where d.id = ${f.deliverableId}`;
      const [history] =
        await tx`select actor_side from public.request_status_history where request_id = ${req!.id} and to_status = 'delivered' order by created_at desc limit 1`;
      return { sent: sent!, before, afterChanges, rounds: rounds!, final: final!, history: history! };
    });
    expect(r.sent.status).toBe('client_review');
    expect(r.sent.sent_to_client_at).not.toBeNull();
    expect(r.afterChanges).toBe(r.before + 1);
    expect(r.rounds).toMatchObject({ revision_rounds: 1, status: 'client_changes' });
    expect(r.final).toMatchObject({ status: 'approved', status_category: 'done', request: 'delivered' });
    expect(r.final.approved_at).not.toBeNull();
    expect(r.history.actor_side).toBe('system');
  });

  it('decisions are validated: stage must match, feedback is required, one decision per stage per version', async () => {
    const r = await as(ADMIN, async (tx) => {
      const f = await freshDeliverable(tx);
      const am = await userId(AM);
      const early = await attemptIn(tx, (q) => decide(q, f.versionId, 'internal', 'approved', am));
      await tx`update public.deliverable_versions set status = 'internal_review' where id = ${f.versionId}`;
      const clientTooEarly = await attemptIn(tx, (q) => decide(q, f.versionId, 'client', 'approved', am));
      const noFeedback = await attemptIn(tx, (q) => decide(q, f.versionId, 'internal', 'changes_requested', am, '  '));
      await decide(tx, f.versionId, 'internal', 'approved', am);
      const twice = await attemptIn(tx, (q) => decide(q, f.versionId, 'internal', 'approved', am));
      const locked = await attemptIn(tx, (q) => q`update public.deliverable_versions set notes = 'late edit' where id = ${f.versionId}`);
      return { early, clientTooEarly, noFeedback, twice, locked };
    });
    expect(r).toEqual({
      early: 'invalid_transition',
      clientTooEarly: 'invalid_transition',
      noFeedback: 'comment_required',
      twice: 'invalid_transition',
      locked: 'version_locked',
    });
  });

  it('only client users with approval rights decide, and only for their company', async () => {
    const r = await as(ADMIN, async (tx) => {
      const f = await freshDeliverable(tx, { review: false, approval: true });
      await tx`update public.deliverable_versions set status = 'internal_review' where id = ${f.versionId}`;
      const [v] = await tx`select status from public.deliverable_versions where id = ${f.versionId}`;
      const tryAs = async (email: string) => {
        await actAs(tx, email);
        const id = await userId(email);
        return attemptIn(tx, (q) => decide(q, f.versionId, 'client', 'approved', id));
      };
      return { status: v!.status, viewer: await tryAs(NAJD_VIEWER), otherClient: await tryAs(DARB_MEMBER), owner: await tryAs(NAJD_OWNER) };
    });
    expect(r.status).toBe('client_review');
    expect(r.viewer).toBe('42501');
    expect(r.otherClient).not.toBeNull();
    expect(r.owner).toBeNull();
  });

  it('client comments are always client-visible and allowed only while the version awaits them; agency notes stay internal until sent', async () => {
    const r = await as(ADMIN, async (tx) => {
      const f = await freshDeliverable(tx);
      await actAs(tx, AM);
      const [early] =
        await tx`insert into public.annotations (organization_id, client_id, deliverable_id, version_id, kind, body, visibility, author_side)
        values (${org}, ${najd}, ${f.deliverableId}, ${f.versionId}, 'general', 'ملاحظة للفريق', 'client', 'agency') returning visibility`;
      await tx`update public.deliverable_versions set status = 'internal_review' where id = ${f.versionId}`;
      await decide(tx, f.versionId, 'internal', 'approved', await userId(AM));
      await actAs(tx, NAJD_VIEWER);
      const [pin] =
        await tx`insert into public.annotations (organization_id, client_id, deliverable_id, version_id, file_id, kind, x, y, body, visibility, author_side)
        values (${org}, ${najd}, ${f.deliverableId}, ${f.versionId}, ${f.fileId}, 'point', 0.4, 0.6, 'أكبر قليلًا', 'internal', 'agency') returning visibility, author_side`;
      const seen = await count(tx, 'annotations', sql`version_id = ${f.versionId}`);
      return { early: early!.visibility, pin: pin!, seen };
    });
    expect(r.early).toBe('internal');
    expect(r.pin).toEqual({ visibility: 'client', author_side: 'client' });
    expect(r.seen).toBe(1);
  });
});

describe('task integrity', () => {
  it('dependencies must stay within the client and cannot form cycles', async () => {
    const r = await as(AM, async (tx) => {
      const [a, b] = await tx`select id from public.tasks where client_id = ${najd} and parent_id is null order by number limit 2`;
      await tx`insert into public.task_dependencies (organization_id, client_id, task_id, depends_on_id) values (${org}, ${najd}, ${b!.id}, ${a!.id}) on conflict do nothing`;
      const cycle = await attemptIn(
        tx,
        (q) =>
          q`insert into public.task_dependencies (organization_id, client_id, task_id, depends_on_id) values (${org}, ${najd}, ${a!.id}, ${b!.id})`,
      );
      const [other] = await sql`select id from public.tasks where client_id = ${smile} limit 1`;
      const cross = await attemptIn(
        tx,
        (q) =>
          q`insert into public.task_dependencies (organization_id, client_id, task_id, depends_on_id) values (${org}, ${najd}, ${a!.id}, ${other!.id})`,
      );
      return { cycle, cross };
    });
    expect(r.cycle).toBe('dependency_cycle');
    expect(r.cross).not.toBeNull();
  });

  it('numbers tasks per organization, keeps the status category in sync and stamps completion', async () => {
    const r = await as(AM, async (tx) => {
      const [done] = await tx`select id from public.task_statuses where category = 'done'`;
      const [todo] = await tx`select id from public.task_statuses where is_default`;
      // Numbers are per organization, including tasks this person can't see.
      const [max] = await sql`select max(number)::int as n from public.tasks where organization_id = ${org}`;
      const [t] = await tx`insert into public.tasks (organization_id, client_id, title, status_id, status_category, number)
        values (${org}, ${najd}, 'جديدة', ${todo!.id}, 'done', 1) returning id, number, status_category, completed_at`;
      const [finished] =
        await tx`update public.tasks set status_id = ${done!.id} where id = ${t!.id} returning status_category, completed_at`;
      const [thread] = await tx`select visibility from public.threads where subject_type = 'task' and subject_id = ${t!.id}`;
      return { max: max!.n as number, t: t!, finished: finished!, thread: thread! };
    });
    expect(r.t.number).toBe(r.max + 1);
    expect(r.t.status_category).toBe('todo');
    expect(r.t.completed_at).toBeNull();
    expect(r.finished.status_category).toBe('done');
    expect(r.finished.completed_at).not.toBeNull();
    expect(r.thread.visibility).toBe('internal');
  });

  it('time entries: one running timer per person, only your own, minutes from the clock', async () => {
    const r = await as(SPECIALIST, async (tx) => {
      const [t] = await tx`select id from public.tasks where client_id = ${najd} limit 1`;
      const [entry] = await tx`insert into public.time_entries (organization_id, client_id, task_id, user_id, started_at, source, minutes)
        values (${org}, ${najd}, ${t!.id}, ${crypto.randomUUID()}, now() - interval '90 minutes', 'timer', 500) returning id, user_id, minutes, ended_at`;
      const second = await attemptIn(
        tx,
        (q) =>
          q`insert into public.time_entries (organization_id, client_id, task_id, user_id, source) values (${org}, ${najd}, ${t!.id}, ${crypto.randomUUID()}, 'timer')`,
      );
      const [stopped] = await tx`update public.time_entries set ended_at = now() where id = ${entry!.id} returning minutes`;
      await actAs(tx, AM);
      const othersVisible = await count(tx, 'time_entries', sql`id = ${entry!.id}`);
      const edit = await tx`update public.time_entries set note = 'x' where id = ${entry!.id} returning id`;
      return { entry: entry!, second, stopped: stopped!.minutes as number, othersVisible, edited: edit.length };
    });
    expect(r.entry.user_id).toBe(await userId(SPECIALIST));
    expect(r.entry.minutes).toBe(0);
    expect(r.entry.ended_at).toBeNull();
    expect(r.second).not.toBeNull();
    expect(r.stopped).toBe(90);
    // The account manager has time:read_all but can never edit someone else's entry.
    expect(r.othersVisible).toBe(1);
    expect(r.edited).toBe(0);
  });

  it('workflow step dependencies are checked at commit (unknown steps, cycles)', async () => {
    const r = await as(ADMIN, async (tx) => {
      const [tpl] = await tx`select id from public.workflow_templates limit 1`;
      const [a, b] = await tx`select id from public.workflow_template_steps where template_id = ${tpl!.id} order by sort_order limit 2`;
      const cycle = await attemptIn(tx, async (q) => {
        await q`update public.workflow_template_steps set depends_on = array[${b!.id}]::uuid[] where id = ${a!.id}`;
        await q`set constraints all immediate`;
      });
      return { cycle };
    });
    expect(r.cycle).toBe('dependency_cycle');
  });
});

describe('portal progress', () => {
  it('returns step names and states for the client — and nothing for other clients', async () => {
    const [req] =
      await sql`select id from public.requests where client_id = ${najd} and converted_at is not null and status = 'in_progress' limit 1`;
    const own = await as(NAJD_VIEWER, (tx) => tx`select * from app.request_progress(${req!.id})`);
    expect(own.length).toBeGreaterThan(1);
    expect(Object.keys(own[0]!).sort()).toEqual(['due_date', 'name', 'state', 'step_order']);
    expect(own.map((s) => s.state)).toContain('done');
    const other = await as(DARB_MEMBER, (tx) => tx`select * from app.request_progress(${req!.id})`);
    expect(other).toHaveLength(0);
  });
});

/** Runs a statement inside a savepoint and returns the raised message / code (null on success). */
async function attemptIn(tx: Tx, fn: (q: Tx) => Promise<unknown>): Promise<string | null> {
  try {
    await tx.savepoint(async (sp) => {
      await fn(sp as unknown as Tx);
    });
    return null;
  } catch (error) {
    const e = error as { message?: string; code?: string };
    return e.code === '42501' ? '42501' : (e.message ?? 'error');
  }
}
