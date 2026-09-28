/**
 * Phase 1 security: client isolation, internal visibility and read-only viewers — proven directly
 * against Postgres RLS (no app code in between).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, attempt, clientId, sql, userId } from './helpers';

const NAJD_OWNER = 'mohammed@najd.test';
const NAJD_MEMBER = 'abeer@najd.test';
const NAJD_VIEWER = 'saad@najd.test';
const DARB_OWNER = 'yasser@darb.test';

let najd: string;
let darb: string;

beforeAll(async () => {
  najd = await clientId('najd-heritage');
  darb = await clientId('darb-coffee');
});

afterAll(async () => {
  await sql.end();
});

describe('client isolation (client A cannot see client B)', () => {
  it('clients: a portal user only sees their own client', async () => {
    const rows = await as(NAJD_OWNER, (tx) => tx`select id from public.clients`);
    expect(rows.map((r) => r.id)).toEqual([najd]);
  });

  it('files: nothing from another client is readable', async () => {
    const { n } = (await as(NAJD_OWNER, (tx) => tx`select count(*)::int as n from public.files where client_id = ${darb}`))[0]!;
    expect(n).toBe(0);
    const { own } = (await as(NAJD_OWNER, (tx) => tx`select count(*)::int as own from public.files where client_id = ${najd}`))[0]!;
    expect(own).toBeGreaterThan(0);
  });

  it('folders, threads and comments of another client are invisible', async () => {
    const counts = await as(DARB_OWNER, async (tx) => ({
      folders: (await tx`select count(*)::int as n from public.file_folders where client_id = ${najd}`)[0]!.n,
      threads: (await tx`select count(*)::int as n from public.threads where client_id = ${najd}`)[0]!.n,
      comments: (await tx`select count(*)::int as n from public.comments where client_id = ${najd}`)[0]!.n,
      reads: (await tx`select count(*)::int as n from public.thread_reads where client_id = ${najd}`)[0]!.n,
    }));
    expect(counts).toEqual({ folders: 0, threads: 0, comments: 0, reads: 0 });
  });

  it('client users and invitations of another client are invisible', async () => {
    const { users } = (
      await as(NAJD_OWNER, (tx) => tx`select count(*)::int as users from public.client_users where client_id = ${darb}`)
    )[0]!;
    const { invites } = (
      await as(NAJD_OWNER, (tx) => tx`select count(*)::int as invites from public.invitations where client_id is distinct from ${najd}`)
    )[0]!;
    expect(users).toBe(0);
    expect(invites).toBe(0);
  });

  it("profiles of other clients' users are invisible", async () => {
    const darbOwner = await userId(DARB_OWNER);
    const rows = await as(NAJD_OWNER, (tx) => tx`select id from public.profiles where id = ${darbOwner}`);
    expect(rows).toHaveLength(0);
  });

  it('package usage and packages of another client are invisible', async () => {
    const { n } = (await as(NAJD_OWNER, (tx) => tx`select count(*)::int as n from public.client_packages where client_id = ${darb}`))[0]!;
    expect(n).toBe(0);
  });

  it('cannot write into another client (message, file, folder)', async () => {
    const me = await userId(NAJD_OWNER);
    const [darbThread] = await sql<
      { id: string; organization_id: string }[]
    >`select id, organization_id from public.threads where client_id = ${darb} and visibility = 'client' limit 1`;
    const comment = await attempt(
      NAJD_OWNER,
      (tx) =>
        tx`insert into public.comments (organization_id, client_id, thread_id, author_id, author_side, body, visibility)
         values (${darbThread!.organization_id}, ${darb}, ${darbThread!.id}, ${me}, 'client', 'hi', 'client')`,
    );
    expect(comment?.code).toBe('42501');
    const file = await attempt(
      NAJD_OWNER,
      (tx) =>
        tx`insert into public.files (organization_id, client_id, name, storage_path, mime_type, size_bytes, kind, visibility, uploaded_by, uploader_side)
         values (${darbThread!.organization_id}, ${darb}, 'x.png', ${'x/' + crypto.randomUUID()}, 'image/png', 1, 'image', 'client', ${me}, 'client')`,
    );
    expect(file?.code).toBe('42501');
  });

  it("cannot forge a row that points at another client's organization/thread", async () => {
    const me = await userId(NAJD_OWNER);
    const [darbThread] = await sql<
      { id: string; organization_id: string }[]
    >`select id, organization_id from public.threads where client_id = ${darb} limit 1`;
    // Claims its own client_id but references another client's thread → trigger rejects.
    const forged = await attempt(
      NAJD_OWNER,
      (tx) =>
        tx`insert into public.comments (organization_id, client_id, thread_id, author_id, author_side, body, visibility)
         values (${darbThread!.organization_id}, ${najd}, ${darbThread!.id}, ${me}, 'client', 'hi', 'client')`,
    );
    expect(forged).not.toBeNull();
  });
});

describe('internal items never reach the portal', () => {
  it('internal files and folders are hidden from client users but visible to the agency', async () => {
    const { clientSees } = (
      await as(
        NAJD_OWNER,
        (tx) => tx`select count(*)::int as "clientSees" from public.files where client_id = ${najd} and visibility = 'internal'`,
      )
    )[0]!;
    const { folders } = (
      await as(
        NAJD_OWNER,
        (tx) => tx`select count(*)::int as folders from public.file_folders where client_id = ${najd} and visibility = 'internal'`,
      )
    )[0]!;
    const { agencySees } = (
      await as(
        'noura@ofoq.test',
        (tx) => tx`select count(*)::int as "agencySees" from public.files where client_id = ${najd} and visibility = 'internal'`,
      )
    )[0]!;
    expect(clientSees).toBe(0);
    expect(folders).toBe(0);
    expect(agencySees).toBeGreaterThan(0);
  });

  it('internal threads and internal notes inside client threads are hidden', async () => {
    const { threads } = (
      await as(NAJD_MEMBER, (tx) => tx`select count(*)::int as threads from public.threads where visibility = 'internal'`)
    )[0]!;
    const { notes } = (
      await as(NAJD_MEMBER, (tx) => tx`select count(*)::int as notes from public.comments where visibility = 'internal'`)
    )[0]!;
    const { agencyNotes } = (
      await as(
        'noura@ofoq.test',
        (tx) => tx`select count(*)::int as "agencyNotes" from public.comments where client_id = ${najd} and visibility = 'internal'`,
      )
    )[0]!;
    expect(threads).toBe(0);
    expect(notes).toBe(0);
    expect(agencyNotes).toBeGreaterThan(0);
  });

  it('client_notes (agency-only) are hidden from client users', async () => {
    const { n } = (await as(NAJD_OWNER, (tx) => tx`select count(*)::int as n from public.client_notes`))[0]!;
    expect(n).toBe(0);
  });

  it('a client user cannot post an internal comment or create an internal thread', async () => {
    const me = await userId(NAJD_MEMBER);
    const [thread] = await sql<
      { id: string; organization_id: string }[]
    >`select id, organization_id from public.threads where client_id = ${najd} and visibility = 'client' limit 1`;
    const internal = await attempt(
      NAJD_MEMBER,
      (tx) =>
        tx`insert into public.comments (organization_id, client_id, thread_id, author_id, author_side, body, visibility)
         values (${thread!.organization_id}, ${najd}, ${thread!.id}, ${me}, 'client', 'secret', 'internal')`,
    );
    expect(internal?.code).toBe('42501');
    const internalThread = await attempt(
      NAJD_MEMBER,
      (tx) =>
        tx`insert into public.threads (organization_id, client_id, title, visibility, created_by) values (${thread!.organization_id}, ${najd}, 't', 'internal', ${me})`,
    );
    expect(internalThread?.code).toBe('42501');
  });

  it('a client user cannot flip a file to client-visible or edit agency-managed client fields', async () => {
    const [internalFile] = await sql<
      { id: string }[]
    >`select id from public.files where client_id = ${najd} and visibility = 'internal' limit 1`;
    const updated = await as(
      NAJD_OWNER,
      (tx) => tx`update public.files set visibility = 'client' where id = ${internalFile!.id} returning id`,
    );
    expect(updated).toHaveLength(0);
    const status = await attempt(NAJD_OWNER, (tx) => tx`update public.clients set status = 'archived' where id = ${najd}`);
    expect(status?.code).toBe('42501');
    // …but the owner may edit the company profile.
    const profile = await attempt(NAJD_OWNER, (tx) => tx`update public.clients set website = 'https://najd.example' where id = ${najd}`);
    expect(profile).toBeNull();
  });
});

describe('Client Viewer is read-only', () => {
  it('can read messages and files', async () => {
    const { files } = (await as(NAJD_VIEWER, (tx) => tx`select count(*)::int as files from public.files where client_id = ${najd}`))[0]!;
    const { comments } = (
      await as(NAJD_VIEWER, (tx) => tx`select count(*)::int as comments from public.comments where client_id = ${najd}`)
    )[0]!;
    expect(files).toBeGreaterThan(0);
    expect(comments).toBeGreaterThan(0);
  });

  it('cannot send messages, start threads, upload files or manage users', async () => {
    const me = await userId(NAJD_VIEWER);
    const [thread] = await sql<
      { id: string; organization_id: string }[]
    >`select id, organization_id from public.threads where client_id = ${najd} and visibility = 'client' limit 1`;
    const org = thread!.organization_id;
    const results = await Promise.all([
      attempt(
        NAJD_VIEWER,
        (tx) =>
          tx`insert into public.comments (organization_id, client_id, thread_id, author_id, author_side, body) values (${org}, ${najd}, ${thread!.id}, ${me}, 'client', 'hi')`,
      ),
      attempt(
        NAJD_VIEWER,
        (tx) => tx`insert into public.threads (organization_id, client_id, title, created_by) values (${org}, ${najd}, 't', ${me})`,
      ),
      attempt(
        NAJD_VIEWER,
        (tx) =>
          tx`insert into public.files (organization_id, client_id, name, storage_path, mime_type, size_bytes, kind, uploaded_by, uploader_side)
           values (${org}, ${najd}, 'x.png', ${'v/' + crypto.randomUUID()}, 'image/png', 1, 'image', ${me}, 'client')`,
      ),
    ]);
    for (const r of results) expect(r?.code).toBe('42501');
    const roleChange = await as(
      NAJD_VIEWER,
      (tx) => tx`update public.client_users set can_approve = true where client_id = ${najd} returning id`,
    );
    expect(roleChange).toHaveLength(0);
  });

  it('a Client Member can send messages and upload', async () => {
    const me = await userId(NAJD_MEMBER);
    const [thread] = await sql<
      { id: string; organization_id: string }[]
    >`select id, organization_id from public.threads where client_id = ${najd} and visibility = 'client' limit 1`;
    const ok = await attempt(
      NAJD_MEMBER,
      (tx) =>
        tx`insert into public.comments (organization_id, client_id, thread_id, author_id, author_side, body) values (${thread!.organization_id}, ${najd}, ${thread!.id}, ${me}, 'client', 'hello')`,
    );
    expect(ok).toBeNull();
  });

  it('a Client Owner cannot change their own role (no self-escalation)', async () => {
    const me = await userId(NAJD_OWNER);
    const res = await attempt(NAJD_OWNER, (tx) => tx`update public.client_users set status = 'deactivated' where user_id = ${me}`);
    expect(res?.code).toBe('42501');
  });
});

describe('agency access scoping', () => {
  it('an Account Manager (read_assigned) only sees assigned clients', async () => {
    const rows = await as('abdulrahman@ofoq.test', (tx) => tx`select slug from public.clients order by slug`);
    expect(rows.map((r) => r.slug)).toEqual(['future-smile', 'gulf-vision']);
  });

  it('a per-user deny override removes access', async () => {
    const noura = await userId('noura@ofoq.test');
    const [org] = await sql<{ id: string }[]>`select id from public.organizations limit 1`;
    const visible = await as('noura@ofoq.test', async (tx) => {
      await tx`reset role`;
      await tx`insert into public.user_permission_overrides (organization_id, user_id, permission_key, effect) values (${org!.id}, ${noura}, 'clients:read_assigned', 'deny')`;
      await tx`set local role authenticated`;
      return tx`select id from public.clients`;
    });
    expect(visible).toHaveLength(0);
  });

  it('a per-user grant override extends access (seeded: Turki sees all clients)', async () => {
    const { n } = (await as('turki@ofoq.test', (tx) => tx`select count(*)::int as n from public.clients`))[0]!;
    expect(n).toBe(5);
  });
});
