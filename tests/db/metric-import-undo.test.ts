/**
 * Feedback Round 6 (ADR-095): "Undo import" — people who manage a client's metrics clear the days still holding an
 * import's numbers and mark the entry undone; nobody else can, and nothing else about the entry can change.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, attempt, sql } from './helpers';

const AM_OF_NAJD = 'noura@ofoq.test';
const AM_ELSEWHERE = 'abdulrahman@ofoq.test';
const SALES_REP = 'ruba@ofoq.test';
const NAJD_OWNER = 'mohammed@najd.test';

let campaign: { id: string; client_id: string; organization_id: string; channel: string };

beforeAll(async () => {
  const [c] = await sql<{ id: string; client_id: string; organization_id: string; channel: string }[]>`
    select ca.id, ca.client_id, ca.organization_id, ch.id as channel
    from public.campaigns ca join public.clients cl on cl.id = ca.client_id
    join public.campaign_channels ch on ch.campaign_id = ca.id
    where cl.slug = 'najd-heritage' order by ca.created_at limit 1`;
  campaign = c!;
});

afterAll(async () => {
  await sql.end();
});

type Tx = Parameters<Parameters<typeof as>[1]>[0];

/** An import of two days, plus a third day a later import replaced (as the table owner, inside the test transaction). */
async function seedImport(tx: Tx) {
  await tx`select set_config('role', 'postgres', true)`;
  const [imp] = await tx<{ id: string }[]>`
    insert into public.metric_imports (organization_id, client_id, campaign_id, channel_id, file_name, preset, row_count, date_from, date_to)
    values (${campaign.organization_id}, ${campaign.client_id}, ${campaign.id}, ${campaign.channel}, 'undo-test.csv', 'meta', 3,
      '2026-09-01', '2026-09-03') returning id`;
  const [later] = await tx<{ id: string }[]>`
    insert into public.metric_imports (organization_id, client_id, campaign_id, channel_id, file_name, preset, row_count, date_from, date_to)
    values (${campaign.organization_id}, ${campaign.client_id}, ${campaign.id}, ${campaign.channel}, 'later.csv', 'meta', 1,
      '2026-09-03', '2026-09-03') returning id`;
  for (const [day, importId] of [
    ['2026-09-01', imp!.id],
    ['2026-09-02', imp!.id],
    ['2026-09-03', later!.id],
  ] as const) {
    await tx`
      insert into public.metrics_daily (organization_id, client_id, campaign_id, channel_id, date, impressions, source, import_id)
      values (${campaign.organization_id}, ${campaign.client_id}, ${campaign.id}, ${campaign.channel}, ${day}, 1000, 'import', ${importId})
      on conflict (channel_id, date) do update set impressions = 1000, source = 'import', import_id = excluded.import_id`;
  }
  await tx`select set_config('role', 'authenticated', true)`;
  return { imp: imp!.id, later: later!.id };
}

describe('undo an import', () => {
  it("the client's Account Manager clears only that import's days and marks it undone", async () => {
    const r = await as(AM_OF_NAJD, async (tx) => {
      const { imp } = await seedImport(tx);
      const removed = await tx`delete from public.metrics_daily where import_id = ${imp} returning date::text`;
      const marked = await tx`update public.metric_imports set undone_at = now() where id = ${imp} returning id`;
      const left = await tx`select date::text from public.metrics_daily
        where channel_id = ${campaign.channel} and date between '2026-09-01' and '2026-09-03' order by date`;
      return { removed: removed.map((x) => x.date).sort(), marked: marked.length, left: left.map((x) => x.date) };
    });
    expect(r.removed).toEqual(['2026-09-01', '2026-09-02']);
    expect(r.marked).toBe(1);
    // The day a later import replaced keeps its numbers.
    expect(r.left).toEqual(['2026-09-03']);
  });

  it('only the undo columns of an entry can change', async () => {
    const e = await as(AM_OF_NAJD, async (tx) => {
      const { imp } = await seedImport(tx);
      return tx
        .savepoint((sp) => sp`update public.metric_imports set row_count = 99 where id = ${imp}`)
        .then(() => null)
        .catch((err: { code?: string }) => err.code);
    });
    expect(e).toBe('42501');
  });

  it('nobody without metrics:manage on that client can clear the days or mark the entry', async () => {
    for (const email of [AM_ELSEWHERE, SALES_REP, NAJD_OWNER]) {
      const r = await as(email, async (tx) => {
        const { imp } = await seedImport(tx);
        const removed = await tx`delete from public.metrics_daily where import_id = ${imp} returning id`;
        const marked = await tx`update public.metric_imports set undone_at = now() where id = ${imp} returning id`;
        return { removed: removed.length, marked: marked.length };
      });
      expect(r, email).toEqual({ removed: 0, marked: 0 });
    }
    const err = await attempt(
      NAJD_OWNER,
      (tx) => tx`insert into public.metric_imports (organization_id, client_id, campaign_id, channel_id,
      file_name, preset, row_count, date_from, date_to) values (${campaign.organization_id}, ${campaign.client_id}, ${campaign.id},
      ${campaign.channel}, 'x.csv', 'meta', 1, '2026-09-01', '2026-09-01')`,
    );
    expect(err?.code).toBe('42501');
  });
});
