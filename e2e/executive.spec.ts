import { expect, test } from '@playwright/test';
import postgres from 'postgres';

import { login, unique } from './support';

/**
 * Feedback Round 7 (ADR-096/097): the chairman signs in and lands on the Executive Center, changes the period, drills
 * down, downloads the board report as PDF and PowerPoint, schedules it and finds the email with the PDF attached in
 * Mailpit. Viewers can't export; portal users and operational roles can't open the Center.
 */

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:54324';
const CHAIRMAN = 'chairman@ofoq.test';

test.describe.configure({ mode: 'serial' });

const recipient = `${unique('board')}@e2e.test`;

test.afterAll(async () => {
  const db = postgres(DB_URL, { max: 1 });
  try {
    await db`delete from public.executive_schedules where ${recipient} = any(recipients)`;
  } finally {
    await db.end();
  }
});

test('the chairman lands on the Executive Center, changes the period and drills down', async ({ page }) => {
  await login(page, CHAIRMAN);
  await page.waitForURL('**/executive');
  await expect(page.getByTestId('executive-center')).toBeVisible();
  await expect(page.getByTestId('kpi-revenue')).toBeVisible();
  await expect(page.getByTestId('attention-panel')).toBeVisible();
  await expect(page.getByTestId('executive-brief')).toBeVisible();

  // Year to date compared with last year: the URL carries the view.
  await expect(async () => {
    await page.getByTestId('executive-period').selectOption('ytd');
    await page.waitForURL(/period=ytd/, { timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await page.getByTestId('executive-compare').selectOption('last_year');
  await page.waitForURL(/compare=last_year/);
  await expect(page.getByTestId('executive-period-range')).toContainText(String(new Date().getFullYear()));

  // Each tab renders; the definition of a KPI is one click away.
  for (const tab of ['clients', 'operations', 'team', 'marketing', 'sales', 'risks', 'overview']) {
    await page.getByTestId(`executive-tab-${tab}`).click();
    await expect(page.getByTestId(`tab-${tab}`)).toBeVisible();
  }
  await page.getByTestId('kpi-info-on_time_rate').click();
  await expect(page.getByRole('dialog')).toContainText(/المعادلة|Formula/);
  await page.keyboard.press('Escape');

  // Drill down from a tile to the screen it comes from.
  await page.getByTestId('kpi-drill-pipeline_value').click();
  await page.waitForURL('**/crm/pipeline');
});

test('the board report downloads as PDF and PowerPoint', async ({ page }) => {
  await login(page, CHAIRMAN);
  await page.waitForURL('**/executive');
  for (const [format, type, magic] of [
    ['pdf', 'application/pdf', '%PDF'],
    ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'PK'],
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'PK'],
  ] as const) {
    const res = await page.request.get(`/api/executive/export?format=${format}&period=last_month`, { timeout: 120_000 });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe(type);
    expect(res.headers()['content-disposition']).toContain(`.${format}`);
    const body = await res.body();
    expect(body.subarray(0, magic.length).toString('latin1')).toBe(magic);
    expect(body.length).toBeGreaterThan(5_000);
  }
  // The menu offers the same files as links.
  await page.getByTestId('executive-export').click();
  await expect(page.getByTestId('export-pdf')).toHaveAttribute('href', /format=pdf/);
});

test('a scheduled board report arrives in Mailpit with the PDF attached', async ({ page }) => {
  await login(page, CHAIRMAN);
  await page.goto('/executive/reports');
  await expect(async () => {
    await page.getByTestId('schedule-new').click();
    await expect(page.getByTestId('schedule-recipients')).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
  await page.getByTestId('schedule-cadence').selectOption('weekly');
  await page.getByTestId('schedule-recipients').fill(recipient);
  await page.getByTestId('schedule-save').click();
  const row = page.getByTestId('schedule-row').filter({ hasText: recipient });
  await expect(row).toBeVisible();
  const since = new Date(Date.now() - 5_000);
  await row.getByTestId('schedule-send-now').click();

  const deadline = Date.now() + 120_000;
  let message: { ID: string; Attachments: number; Subject: string } | undefined;
  while (!message && Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${recipient}"`)}&limit=5`);
    const data = (await res.json()) as { messages: { ID: string; Attachments: number; Subject: string; Created: string }[] };
    message = data.messages.find((m) => new Date(m.Created) >= since);
    if (!message) await new Promise((r) => setTimeout(r, 1_000));
  }
  expect(message, 'board report email').toBeTruthy();
  expect(message!.Attachments).toBe(1);
  const full = (await (await fetch(`${MAILPIT}/api/v1/message/${message!.ID}`)).json()) as {
    Attachments: { FileName: string; ContentType: string; Size: number }[];
    HTML: string;
  };
  expect(full.Attachments[0]!.FileName).toMatch(/^board-report-.*\.pdf$/);
  expect(full.Attachments[0]!.ContentType).toBe('application/pdf');
  expect(full.Attachments[0]!.Size).toBeGreaterThan(5_000);
  // …and a link back to the Executive Center.
  expect(full.HTML).toMatch(/\/executive/);
});

test('the viewer reads but cannot export; operational roles and portal users cannot open the Center', async ({ page }) => {
  await login(page, 'board@ofoq.test');
  await page.waitForURL('**/executive');
  await expect(page.getByTestId('kpi-revenue')).toBeVisible();
  await expect(page.getByTestId('executive-export')).toHaveCount(0);
  const denied = await page.request.get('/api/executive/export?format=pdf');
  expect(denied.status()).toBe(403);

  await page.context().clearCookies();
  await login(page, 'khalid@ofoq.test');
  // The page streams its skeleton first, so the refusal is the forbidden screen rather than the status code.
  await page.goto('/executive');
  await expect(page.getByText('لا تملك صلاحية الوصول')).toBeVisible();
  await expect(page.getByTestId('executive-center')).toHaveCount(0);

  await page.context().clearCookies();
  const db = postgres(DB_URL, { max: 1 });
  let portalEmail: string;
  try {
    const [p] = await db<{ email: string }[]>`
      select u.email from public.client_users cu join auth.users u on u.id = cu.user_id
      join public.client_users other on other.user_id = cu.user_id
      where cu.status = 'active' group by u.email having count(*) = 1 order by u.email limit 1`;
    portalEmail = p!.email;
  } finally {
    await db.end();
  }
  await login(page, portalEmail);
  await page.goto('/executive');
  await expect(page).toHaveURL(/\/portal/);
  await expect(page.getByTestId('executive-center')).toHaveCount(0);
});
