import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

import { login, unique } from './support';

/** Feedback Round 6 (ADR-095): CSV imports land where the grid shows them; period totals are refused; undo works. */

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const NAME = `E2E Import ${unique('c')}`;
let campaignId: string;

async function db<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(DB_URL, { max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  campaignId = await db(async (sql) => {
    const [client] = await sql<{ id: string; organization_id: string }[]>`
      select id, organization_id from public.clients where slug = 'najd-heritage'`;
    const [c] = await sql<{ id: string }[]>`
      insert into public.campaigns (organization_id, client_id, name, start_date, end_date, status)
      values (${client!.organization_id}, ${client!.id}, ${NAME}, '2026-09-06', '2026-09-30', 'active') returning id`;
    await sql`insert into public.campaign_channels (organization_id, client_id, campaign_id, platform)
      values (${client!.organization_id}, ${client!.id}, ${c!.id}, 'instagram')`;
    return c!.id;
  });
});

test.afterAll(async () => {
  await db((sql) => sql`delete from public.campaigns where id = ${campaignId}`);
});

const metaDaily = (days: string[]) =>
  [
    'Reporting starts,Reporting ends,Campaign name,Amount spent (SAR),Impressions,Link clicks',
    ...days.map((d, i) => `${d},${d},Test,${100 * (i + 1)},${1000 * (i + 1)},${10 * (i + 1)}`),
  ].join('\n');

async function openImport(page: Page, name: string, csv: string) {
  await page.goto(`/campaigns/${campaignId}?tab=metrics`);
  await page.getByTestId('open-import').click();
  const dialog = page.getByTestId('import-dialog');
  await dialog.getByTestId('import-file').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(csv) });
  return dialog;
}

test('a Meta period-total export is explained and not imported', async ({ page }) => {
  await login(page, 'faisal@ofoq.test');
  const dialog = await openImport(
    page,
    'Campaigns-Sep-5-2026-Oct-4-2026.csv',
    [
      'Campaign name,Reporting starts,Reporting ends,Results,Reach,Impressions,Amount spent (SAR),Link clicks',
      'A,2026-09-05,2026-10-04,1200,90000,250000,"4,500.75",3100',
      'B,2026-09-05,2026-10-04,85,30000,70000,"1,250.25",900',
    ].join('\n'),
  );
  await expect(dialog.getByTestId('import-period')).toBeVisible();
  await expect(dialog.getByTestId('import-period-how')).toContainText(/Breakdown|التقسيم/);
  await expect(dialog.getByTestId('import-confirm')).toBeDisabled();
});

test('daily import → numbers in the grid on that week → undo clears them', async ({ page }) => {
  await login(page, 'faisal@ofoq.test');
  const dialog = await openImport(page, 'daily.csv', metaDaily(['2026-09-14', '2026-09-15']));
  await expect(dialog.getByTestId('import-summary')).toContainText(/2/);
  await dialog.getByTestId('import-confirm').click();
  await expect(dialog).toBeHidden();
  // The grid jumped to the imported week (the campaign's last week would otherwise show).
  await expect(page.getByTestId('cell-2026-09-15-impressions')).toHaveValue(/2[,٬]?000/);
  await expect(page.getByTestId('cell-2026-09-14-impressions')).toHaveValue(/1[,٬]?000/);

  await page.getByTestId('import-log').getByTestId('import-undo').first().click();
  await page
    .getByRole('button', { name: /تراجع عن الاستيراد|Undo import/ })
    .last()
    .click();
  await expect(page.getByTestId('import-undone')).toBeVisible();
  await expect(page.getByTestId('cell-2026-09-15-impressions')).toHaveValue('');
});

test('days after the campaign end: extend the dates (default) and the days are kept', async ({ page }) => {
  await login(page, 'faisal@ofoq.test');
  const dialog = await openImport(page, 'late.csv', metaDaily(['2026-09-30', '2026-10-01', '2026-10-02']));
  await expect(dialog.getByTestId('import-outside')).toBeVisible();
  await expect(dialog.getByTestId('import-outside-extend')).toBeChecked();
  await dialog.getByTestId('import-confirm').click();
  await expect(dialog).toBeHidden();
  const end = await db(
    async (sql) => (await sql<{ d: string }[]>`select end_date::text as d from public.campaigns where id = ${campaignId}`)[0]!.d,
  );
  expect(end).toBe('2026-10-02');
  await expect(page.getByTestId('cell-2026-10-02-impressions')).toHaveValue(/3[,٬]?000/);
});

test('…or leave them out', async ({ page }) => {
  await login(page, 'faisal@ofoq.test');
  const dialog = await openImport(page, 'early.csv', metaDaily(['2026-09-04', '2026-09-06']));
  await dialog.getByTestId('import-outside-skip').check();
  await expect(dialog.getByTestId('import-confirm')).toContainText(/يوم واحد|1 day/);
  await dialog.getByTestId('import-confirm').click();
  await expect(dialog).toBeHidden();
  const start = await db(
    async (sql) => (await sql<{ d: string }[]>`select start_date::text as d from public.campaigns where id = ${campaignId}`)[0]!.d,
  );
  expect(start).toBe('2026-09-06');
  const stored = await db(
    async (sql) =>
      (
        await sql<
          { n: number }[]
        >`select count(*)::int as n from public.metrics_daily where campaign_id = ${campaignId} and date = '2026-09-04'`
      )[0]!.n,
  );
  expect(stored).toBe(0);
});
