import { expect, test, type Browser } from '@playwright/test';
import postgres from 'postgres';

import { login } from './support';

/**
 * Phase 8 acceptance (mock provider — no keys needed):
 * 1. An account manager opens an insight, gets an AI explanation and turns a suggestion into a task.
 * 2. "Draft with AI" writes a report's commentary in the report's language; saving keeps it.
 * 3. The assistant answers with citations that open the source, and never cites what the asker can't open.
 */
const db = () => postgres(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1 });

async function englishPage(browser: Browser, email: string) {
  const page = await (await browser.newContext({ locale: 'en-US' })).newPage();
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3000' }]);
  await login(page, email);
  return page;
}

test('insight → AI explanation → suggestion becomes a task', async ({ browser }) => {
  test.setTimeout(120_000);
  const sql = db();
  let taskId: string | null = null;
  try {
    // The seeded "spending too slowly" insight on Lujain's sale campaign, reset so the test is re-runnable.
    const [insight] = await sql<{ id: string }[]>`
      select i.id from public.ai_insights i join public.clients c on c.id = i.client_id
      where c.slug = 'lujain-fashion' and i.kind = 'budget_underpace'`;
    expect(insight, 'seeded insight — run pnpm db:reset').toBeTruthy();
    await sql`update public.ai_insights set status = 'open', explanation = null, explained_at = null where id = ${insight!.id}`;
    await sql`update public.ai_recommendations set status = 'proposed', task_id = null, decided_by = null, decided_at = null where insight_id = ${insight!.id}`;
    await sql`update public.ai_settings set enabled = true`;

    // Noura's profile language is Arabic (it wins over the browser): this test also covers the RTL screens.
    const page = await (await browser.newContext()).newPage();
    await login(page, 'noura@ofoq.test');
    await page.goto('/insights');
    const row = page.getByTestId('insight-row').filter({ has: page.locator(`a[href="/insights/${insight!.id}"]`) });
    await expect(row).toBeVisible();
    await row.click();
    await page.waitForURL(`**/insights/${insight!.id}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الإنفاق أبطأ من الخطة');
    await expect(page.getByTestId('insight-body')).toContainText('بوتيرة متساوية');

    await page.getByTestId('insight-explain').click();
    await expect(page.getByTestId('insight-explanation')).toContainText('ماذا تقول الأرقام:');

    const rec = page.locator('[data-testid="recommendation"][data-kind="increase_budget"]');
    await rec.getByTestId('rec-accept').click();
    await page.getByTestId('rec-accept-confirm').click();
    await expect(rec).toHaveAttribute('data-status', 'accepted');
    await expect(page.getByTestId('insight-status')).toHaveAttribute('data-status', 'acknowledged');

    const [decided] = await sql<{ task_id: string }[]>`
      select task_id from public.ai_recommendations where insight_id = ${insight!.id} and kind = 'increase_budget'`;
    taskId = decided!.task_id;
    const [task] = await sql<{ title: string; description: string }[]>`select title, description from public.tasks where id = ${taskId}`;
    expect(task!.title).toBe('ارفع الميزانية اليومية');
    expect(task!.description).toContain(`/insights/${insight!.id}`);

    await rec.getByTestId('rec-open-task').click();
    await expect(page.getByTestId('task-drawer')).toBeVisible();
  } finally {
    if (taskId) await sql`delete from public.tasks where id = ${taskId}`;
    await sql.end();
  }
});

test('draft report commentary with AI, in the report language', async ({ browser }) => {
  test.setTimeout(120_000);
  const sql = db();
  let reportId: string | null = null;
  try {
    const [ctx] = await sql<{ org: string; client: string; campaign: string }[]>`
      select c.organization_id as org, c.id as client, k.id as campaign
      from public.clients c join public.campaigns k on k.client_id = c.id
      where c.slug = 'lujain-fashion' and k.name = 'تخفيضات نهاية الموسم'`;
    const [report] = await sql<{ id: string }[]>`
      insert into public.reports (organization_id, client_id, campaign_id, title, period_start, period_end, locale)
      values (${ctx!.org}, ${ctx!.client}, ${ctx!.campaign}, ${`AI draft ${Date.now().toString(36)}`}, current_date - 14, current_date - 1, 'en')
      returning id`;
    reportId = report!.id;
    await sql`
      insert into public.report_sections (organization_id, client_id, report_id, kind, sort_order) values
        (${ctx!.org}, ${ctx!.client}, ${reportId}, 'kpi_summary', 0),
        (${ctx!.org}, ${ctx!.client}, ${reportId}, 'commentary', 1),
        (${ctx!.org}, ${ctx!.client}, ${reportId}, 'next_steps', 2)`;

    // The Arabic UI still drafts in the report's language (English).
    const page = await (await browser.newContext()).newPage();
    await login(page, 'noura@ofoq.test');
    await page.goto(`/reports/${reportId}`);
    const commentary = page.locator('[data-testid="section-editor"][data-kind="commentary"]');
    await commentary.getByTestId('ai-draft').click();
    await expect(commentary.getByTestId('section-body')).toHaveValue(/^Summary of the period:\n/);
    await expect(commentary.getByTestId('section-body')).toHaveValue(/Spend: SAR/);
    const steps = page.locator('[data-testid="section-editor"][data-kind="next_steps"]');
    await steps.getByTestId('ai-draft').click();
    await expect(steps.getByTestId('section-body')).toHaveValue(/^Suggested next steps:\n- /);
    await page.getByTestId('report-save').click();
    const body = async (kind: string) =>
      (await sql<{ body: string }[]>`select body from public.report_sections where report_id = ${reportId} and kind = ${kind}`)[0]?.body ??
      '';
    await expect.poll(() => body('commentary')).toMatch(/^Summary of the period:/);
    await expect.poll(() => body('next_steps')).toMatch(/^Suggested next steps:/);
  } finally {
    if (reportId) await sql`delete from public.reports where id = ${reportId}`;
    await sql.end();
  }
});

test('assistant answers with citations, only from records the asker can open', async ({ browser }) => {
  test.setTimeout(150_000);
  const sql = db();
  const started = new Date();
  try {
    await sql`update public.ai_settings set enabled = true`;
    const page = await englishPage(browser, 'sara@ofoq.test');
    await page.goto('/assistant');
    await page.getByTestId('assistant-input').fill('لخّص وضع حملة عروض تقويم الأسنان');
    await page.getByTestId('assistant-send').click();
    await page.waitForURL(/\/assistant\/[0-9a-f-]{36}$/);
    const answer = page.getByTestId('message-assistant').last();
    await expect(answer).toHaveAttribute('data-status', 'ok');
    await expect(answer.getByTestId('citation').first()).toBeVisible();
    await expect(answer.getByTestId('citation-marker').first()).toBeVisible();
    const first = answer.getByTestId('citation').first();
    const href = await first.getAttribute('href');
    expect(href).toMatch(/^\/(campaigns|insights|requests|clients|reports|tasks|crm)/);
    await first.click();
    await page.waitForURL((url) => url.pathname === href!.split('?')[0]);

    // A Specialist asking about a lead by name gets nothing from the CRM (no leads:read).
    const [lead] = await sql<{ full_name: string }[]>`
      select l.full_name from public.leads l join public.ai_chunks c on c.source_id = l.id where l.merged_into_id is null limit 1`;
    const khalid = await englishPage(browser, 'khalid@ofoq.test');
    await khalid.goto('/assistant');
    await khalid.getByTestId('assistant-input').fill(`عميل محتمل ${lead!.full_name}`);
    await khalid.getByTestId('assistant-send').click();
    await khalid.waitForURL(/\/assistant\/[0-9a-f-]{36}$/);
    const reply = khalid.getByTestId('message-assistant').last();
    await expect(reply).toBeVisible();
    await expect(reply.locator('[data-testid="citation"][data-source-type="lead"]')).toHaveCount(0);
    await expect(reply.locator('[data-testid="citation"][data-source-type="deal"]')).toHaveCount(0);
  } finally {
    await sql`delete from public.ai_conversations where created_at >= ${started}`;
    await sql.end();
  }
});
