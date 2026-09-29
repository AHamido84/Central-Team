import { expect, test, type Browser, type Page } from '@playwright/test';

import { login, unique, waitForEmail } from './support';

async function as(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await login(page, email);
  return page;
}

const iso = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** A Meta Ads Manager daily export (BOM, quoted thousands, one row per ad set per day). */
function metaExport(days: number[]): string {
  const rows = ['﻿Reporting starts,Reporting ends,Ad set name,Amount spent (SAR),Impressions,Reach,Link clicks,Results'];
  for (const d of days) {
    rows.push(`${iso(d)},${iso(d)},Riyadh 25-34,"1,200.00",60000,30000,700,14`);
    rows.push(`${iso(d)},${iso(d)},Jeddah 25-34,800.00,40000,20000,400,9`);
  }
  rows.push('Total,,,,,,,');
  return rows.join('\n');
}

/**
 * Phase 4 acceptance: AM creates a campaign with a channel and KPI targets → imports a Meta CSV → the overview shows
 * pacing → builds a report, writes the analysis and publishes it → the client sees the campaign and the report in
 * the portal and gets the email.
 */
test('campaign → CSV import → KPIs → report → publish → client portal', async ({ browser }) => {
  test.setTimeout(180_000);
  const name = `حملة اختبار ${unique('c')}`;
  const since = new Date();

  const am = await as(browser, 'noura@ofoq.test');
  await am.goto('/campaigns');
  await am.getByTestId('new-campaign').click();
  const form = am.getByTestId('campaign-form');
  await form.getByTestId('campaign-name').fill(name);
  await form.getByTestId('campaign-client').selectOption({ label: 'مطاعم نجد الأصيلة' });
  await form.getByTestId('campaign-objective').selectOption('traffic');
  await form.getByTestId('campaign-start').fill(iso(-10));
  await form.getByTestId('campaign-end').fill(iso(19));
  await form.getByTestId('campaign-budget').fill('30000');
  await form.getByTestId('campaign-status-select').selectOption('active');
  await form.getByTestId('channel-row').first().getByTestId('channel-platform').selectOption('meta');
  await form.getByTestId('channel-budget').first().fill('30000');
  // Traffic suggests clicks, CTR and CPC; give each a target.
  const targets = form.getByTestId('kpi-target');
  await expect(targets).toHaveCount(3);
  await targets.nth(0).fill('15000');
  await targets.nth(1).fill('1');
  await targets.nth(2).fill('2');
  await form.getByTestId('campaign-save').click();
  await am.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/);
  const campaignUrl = am.url();
  await expect(am.getByTestId('campaign-overview')).toBeVisible();
  await expect(am.getByTestId('kpi-tile')).toHaveCount(3);
  await expect(am.getByTestId('flight-progress')).toContainText(/لم تُسجَّل|No numbers/);

  // Import five days from a Meta export.
  await am.getByTestId('tab-metrics').click();
  await am.getByTestId('open-import').click();
  const dialog = am.getByTestId('import-dialog');
  await dialog.getByTestId('import-file').setInputFiles({
    name: 'meta-export.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(metaExport([-5, -4, -3, -2, -1])),
  });
  await expect(dialog.getByTestId('import-preset')).toHaveAttribute('data-preset', 'meta');
  await expect(dialog.getByTestId('import-summary')).toContainText(/5/);
  await dialog.getByTestId('import-confirm').click();
  await expect(dialog).toBeHidden();
  await expect(am.getByTestId('import-log')).toContainText('meta-export.csv');

  // Overview: 5,500 clicks in 10 of 30 days → 16,500 projected vs 15,000; CTR 1.1 % ≥ 1 %; CPC 1.82 SAR ≤ 2.
  await am.getByTestId('tab-overview').click();
  await expect(am.locator('[data-testid="kpi-tile"][data-metric="clicks"]')).toHaveAttribute('data-status', 'on_track');
  await expect(am.locator('[data-testid="kpi-tile"][data-metric="ctr"]')).toHaveAttribute('data-status', 'on_track');
  await expect(am.locator('[data-testid="kpi-tile"][data-metric="cpc"]')).toHaveAttribute('data-status', 'on_track');
  await expect(am.getByTestId('trend-chart')).toBeVisible();
  await expect(am.getByTestId('channel-table')).toContainText(/5,500/);

  // Build a report for the flight so far, write the analysis and publish it.
  await am.getByTestId('campaign-new-report').click();
  const create = am.getByTestId('report-create');
  await expect(create.getByTestId('report-preset')).toHaveValue('flight');
  await create.getByTestId('report-create-submit').click();
  await am.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
  const reportId = am.url().split('/').pop()!;
  await expect(am.getByTestId('report-status')).toHaveAttribute('data-status', 'draft');
  await expect(am.locator('[data-testid="report-kpi"][data-metric="clicks"]')).toContainText('5,500');
  await am
    .locator('[data-testid="section-editor"][data-kind="commentary"]')
    .getByTestId('section-body')
    .fill('أداء ممتاز في الأسبوع الأول.');
  await am.getByTestId('report-save').click();
  await expect(am.getByTestId('report-save')).toBeDisabled();
  await expect(am.locator('[data-testid="report-section"][data-kind="commentary"]')).toContainText('أداء ممتاز');
  await am.getByTestId('report-publish').click();
  await am
    .getByRole('alertdialog')
    .getByRole('button', { name: /نشر للعميل|Publish to client/ })
    .click();
  await expect(am.getByTestId('report-status')).toHaveAttribute('data-status', 'published');

  // The client sees the campaign and the published report, and was emailed.
  const client = await as(browser, 'mohammed@najd.test');
  await client.goto('/portal/campaigns');
  await expect(client.getByTestId('portal-campaign').filter({ hasText: name })).toBeVisible();
  await client.getByTestId('portal-campaign').filter({ hasText: name }).click();
  await expect(client.getByTestId('portal-campaign-detail')).toBeVisible();
  await expect(client.getByTestId('kpi-tile')).toHaveCount(3);
  await client.goto(`/portal/reports/${reportId}`);
  await expect(client.getByTestId('report-view')).toHaveAttribute('data-status', 'published');
  await expect(client.getByTestId('report-view')).toContainText('أداء ممتاز');
  const mail = await waitForEmail('mohammed@najd.test', /تقرير جديد جاهز|A new report is ready/, since);
  expect(mail.text).toContain(reportId);

  // The campaign URL keeps working for the agency after publishing.
  await am.goto(campaignUrl);
  await am.getByTestId('tab-reports').click();
  await expect(am.getByTestId('report-row')).toHaveCount(1);
});

test('portal: drafts and internal campaigns never show; the report prints on its own page', async ({ page }) => {
  await login(page, 'lujain@lujain.test');
  await page.goto('/portal/campaigns');
  await expect(page.getByTestId('portal-campaigns')).toBeVisible();
  await expect(page.getByTestId('portal-campaign').filter({ hasText: /داخلي/ })).toHaveCount(0);
  await page.getByTestId('report-row').first().click();
  await expect(page.getByTestId('report-view')).toBeVisible();
  await expect(page.getByTestId('draft-banner')).toHaveCount(0);
  await expect(page.getByTestId('report-print')).toBeVisible();
});
