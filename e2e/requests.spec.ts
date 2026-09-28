import path from 'node:path';

import { expect, test } from '@playwright/test';

import { login, unique, waitForEmail } from './support';

/**
 * Phase 2 acceptance: a client submits a request from the portal → the agency triages it (status, assignee)
 * and replies in the request conversation → the client is notified (live page, bell, email) and the
 * assignee hears about the assignment.
 */
test('client submits a request → agency triages and replies → client notified', async ({ browser }) => {
  const title = `طلب اختبار ${unique('e2e')}`;
  const since = new Date();

  // 1. Client (Najd, member) submits a general request with an attachment.
  const clientCtx = await browser.newContext();
  const client = await clientCtx.newPage();
  await login(client, 'abeer@najd.test');
  await expect(client.getByTestId('slot-requests')).toBeVisible();
  await client.goto('/portal/requests');
  await client.getByTestId('new-request').click();
  await client.getByTestId('form-option').filter({ hasText: 'طلب عام' }).click();
  await client.getByTestId('request-title').fill(title);
  // Server-side validation mirrors the form: submitting without the required details is blocked.
  await client.getByTestId('request-submit').click();
  await expect(client.getByRole('alert').first()).toBeVisible();
  await client.getByTestId('answer-details').fill('نحتاج تصميم إعلان لعرض الأسبوع القادم بمقاسات ستوري ومنشور.');
  await client.getByTestId('request-attachment-input').setInputFiles(path.resolve(__dirname, 'fixtures/brand-logo.png'));
  await expect(client.getByTestId('request-attachment').first()).toHaveAttribute('data-status', 'done');
  await client.getByTestId('request-submit').click();
  await client.waitForURL(/\/portal\/requests\/[0-9a-f-]{36}$/);
  await expect(client.getByTestId('request-heading')).toHaveText(title);
  await expect(client.getByTestId('request-status').first()).toHaveAttribute('data-status', 'submitted');
  await expect(client.getByTestId('request-attachment-item')).toHaveCount(1);

  // 2. The account manager is notified and finds it in the triage inbox.
  const submittedMail = await waitForEmail('noura@ofoq.test', /طلب جديد|New request/, since);
  expect(submittedMail.text).toContain(title);
  const agencyCtx = await browser.newContext();
  const agency = await agencyCtx.newPage();
  await login(agency, 'noura@ofoq.test');
  await agency.goto('/requests');
  await agency.getByTestId('inbox-view-unassigned').click();
  await agency.getByTestId('requests-table-search').fill(title.slice(-12));
  await agency.getByTestId('requests-table').locator('table').getByTestId('request-link').filter({ hasText: title }).click();
  await expect(agency.getByTestId('request-heading')).toHaveText(title);

  // 3. Triage: assign a specialist, raise priority, start work with a message to the client.
  const assignedSince = new Date();
  await agency.getByTestId('request-assignee-select').selectOption({ label: 'خالد المطيري' });
  await expect(agency.getByTestId('request-timeline')).toContainText('خالد المطيري');
  await agency.getByTestId('request-priority-select').selectOption('high');
  await expect(agency.getByTestId('request-priority').first()).toHaveAttribute('data-priority', 'high');
  await agency.getByTestId('status-action-in_progress').click();
  await agency.getByTestId('status-message').fill('بدأنا العمل على التصاميم وسنشاركها غدًا.');
  await agency.getByTestId('status-confirm').click();
  await expect(agency.getByTestId('request-status').first()).toHaveAttribute('data-status', 'in_progress');

  // Internal note stays on the agency side.
  await agency.getByTestId('composer-internal').click();
  await agency.getByTestId('composer-input').fill('ملاحظة داخلية: استخدموا القالب الجديد.');
  await agency.getByTestId('composer-send').click();
  await expect(agency.getByTestId('message').filter({ hasText: 'ملاحظة داخلية' })).toHaveAttribute('data-internal', 'true');

  // 4. The client sees the change live, the reply, the bell badge — but not the internal note — and gets an email.
  await expect(client.getByTestId('request-status').first()).toHaveAttribute('data-status', 'in_progress');
  await expect(client.getByTestId('message').filter({ hasText: 'بدأنا العمل' })).toBeVisible();
  await expect(client.getByTestId('notification-count')).toBeVisible();
  await expect(client.getByText('ملاحظة داخلية')).toHaveCount(0);
  const statusMail = await waitForEmail('abeer@najd.test', /تحديث على الطلب|Update on/, since);
  expect(statusMail.text).toContain(title);

  // 5. The assignee is told about the assignment.
  const assignedMail = await waitForEmail('khalid@ofoq.test', /أُسند إليك|assigned to you/, assignedSince);
  expect(assignedMail.text).toContain(title);

  // 6. The client replies; the agency conversation updates in realtime.
  await client.getByTestId('composer-input').fill('شكرًا! ننتظر التصاميم.');
  await client.getByTestId('composer-send').click();
  await expect(agency.getByTestId('message').filter({ hasText: 'ننتظر التصاميم' })).toBeVisible();

  await clientCtx.close();
  await agencyCtx.close();
});

test('a Client Viewer can follow requests but not submit or cancel', async ({ page }) => {
  await login(page, 'saad@najd.test');
  await page.goto('/portal/requests');
  await expect(page.getByTestId('portal-request-row').first()).toBeVisible();
  await expect(page.getByTestId('new-request')).toHaveCount(0);
  await page.getByTestId('portal-request-row').first().click();
  await expect(page.getByTestId('status-tracker')).toBeVisible();
  await expect(page.getByTestId('cancel-request')).toHaveCount(0);
  await page.goto('/portal/requests/new');
  await expect(page.getByText('لا تملك صلاحية الوصول')).toBeVisible();
});

test('form builder: add a question and publish a new version', async ({ page }) => {
  await login(page, 'faisal@ofoq.test');
  await page.goto('/admin/request-forms');
  await page.getByTestId('form-card').filter({ hasText: 'كتابة محتوى' }).click();
  await expect(page.getByTestId('builder-field').first()).toBeVisible();
  const before = await page.getByTestId('builder-field').count();
  await page.getByTestId('add-field').click();
  await page.getByTestId('add-field-short_text').click();
  await page
    .getByTestId('builder-label-ar')
    .last()
    .fill(`الجمهور ${unique('q')}`);
  await page.getByTestId('builder-label-en').last().fill('Audience');
  await expect(page.getByTestId('builder-preview')).toContainText('الجمهور');
  await page.getByTestId('publish-form').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'نشر' }).click();
  await expect(page.getByTestId('form-versions')).toContainText('v2');
  await expect(page.getByTestId('builder-field')).toHaveCount(before + 1);
});
