import path from 'node:path';

import { expect, test } from '@playwright/test';

import { login, unique, waitForEmail } from './support';

const logo = path.resolve(__dirname, 'fixtures/brand-logo.png');

/**
 * Phase 2 acceptance: a client submits a request with files through the wizard → the account manager asks
 * for more information → the client updates the brief and resubmits → the account manager accepts it and
 * the package item is consumed. Notifications (bell + email) reach the other side at every step.
 */
test('client submits with files → AM requests info → client updates → AM accepts', async ({ browser }) => {
  const title = `منشور اختبار ${unique('e2e')}`;
  const since = new Date();

  // 1. Client (Najd, member) walks the wizard: type → brief → attachments → schedule → review → submit.
  const clientCtx = await browser.newContext();
  const client = await clientCtx.newPage();
  await login(client, 'abeer@najd.test');
  await client.goto('/portal');
  const postBar = client.locator('[data-testid="package-bar"][data-item="post"]');
  const usedBefore = Number(await postBar.getAttribute('data-used'));

  await client.goto('/portal/requests');
  await client.getByTestId('new-request').click();
  await client.getByTestId('type-option').filter({ hasText: 'منشور سوشيال' }).click();
  await expect(client.getByTestId('request-wizard')).toHaveAttribute('data-step', 'brief');
  await client.getByTestId('request-title').fill(title);
  // Required fields block the next step (same validator as the server).
  await client.getByTestId('wizard-next').click();
  await expect(client.getByTestId('request-wizard')).toHaveAttribute('data-step', 'brief');
  await expect(client.getByRole('alert').first()).toBeVisible();
  await client.getByTestId('brief-platforms').locator('[data-value="instagram"]').click();
  await client.getByTestId('brief-goal').selectOption('offer');
  // The conditional "offer details" question appears only for the offer goal.
  await expect(client.getByTestId('brief-offer')).toBeVisible();
  await client.getByTestId('brief-offer').fill('خصم 15٪ على القهوة المختصة');
  await client.getByTestId('brief-message').fill('منشور يبرز عرض الأسبوع بألوان الهوية.');
  await client.getByTestId('brief-photos-input').setInputFiles(logo);
  await expect(client.getByTestId('brief-file').first()).toHaveAttribute('data-status', 'done');
  await client.getByTestId('wizard-next').click();

  await expect(client.getByTestId('request-wizard')).toHaveAttribute('data-step', 'attachments');
  await client.getByTestId('request-attachment-input').setInputFiles(logo);
  await expect(client.getByTestId('request-attachment').first()).toHaveAttribute('data-status', 'done');
  await client.getByTestId('wizard-next').click();

  await expect(client.getByTestId('request-wizard')).toHaveAttribute('data-step', 'schedule');
  await client.getByTestId('priority-high').click();
  await client.getByTestId('wizard-next').click();

  await expect(client.getByTestId('wizard-review')).toBeVisible();
  await expect(client.getByTestId('quota-ok')).toBeVisible();
  await client.getByTestId('request-submit').click();
  await client.waitForURL(/\/portal\/requests\/[0-9a-f-]{36}$/);
  await expect(client.getByTestId('request-heading')).toHaveText(title);
  await expect(client.getByTestId('request-reference')).toHaveText(/^NAJD-\d{4}$/);
  const reference = (await client.getByTestId('request-reference').textContent())!.trim();
  await expect(client.getByTestId('request-status').first()).toHaveAttribute('data-status', 'submitted');
  await expect(client.getByTestId('brief-file-view')).toHaveCount(1);
  await expect(client.getByTestId('request-attachment-item')).toHaveCount(1);

  // 2. The account manager is notified and finds it in the triage inbox (new view), previews it in the drawer.
  const submittedMail = await waitForEmail('noura@ofoq.test', /طلب جديد|New request/, since);
  expect(submittedMail.text).toContain(reference);
  const agencyCtx = await browser.newContext();
  const agency = await agencyCtx.newPage();
  await login(agency, 'noura@ofoq.test');
  await agency.goto('/requests');
  await agency.getByTestId('inbox-view-new').click();
  await agency.getByTestId('requests-table-search').fill(reference);
  await agency.getByTestId('requests-table').locator('table tbody tr').first().click();
  await expect(agency.getByTestId('request-preview')).toContainText(title);
  await agency.getByTestId('open-request').click();
  await expect(agency.getByTestId('request-heading')).toHaveText(title);

  // 3. Needs info requires a reason; the reason reaches the client.
  const question = 'هل العرض يشمل الطلب عبر التطبيق؟ وأرسلوا صورة المنتج بخلفية بيضاء.';
  await agency.getByTestId('status-action-needs_info').click();
  await agency.getByTestId('status-confirm').click();
  await expect(agency.getByRole('dialog').getByRole('alert').first()).toBeVisible();
  await agency.getByTestId('status-reason').fill(question);
  await agency.getByTestId('status-confirm').click();
  await expect(agency.getByTestId('request-status').first()).toHaveAttribute('data-status', 'needs_info');
  await expect(agency.getByTestId('timeline-reason').first()).toContainText('هل العرض يشمل');

  // 4. The client sees it live, gets an email, updates the brief and resubmits.
  await expect(client.getByTestId('needs-info-banner')).toBeVisible();
  await expect(client.getByTestId('needs-info-reason')).toContainText('هل العرض يشمل');
  const infoMail = await waitForEmail('abeer@najd.test', /نحتاج معلومات|more information/i, since);
  expect(infoMail.text).toContain(reference);
  await client.getByTestId('edit-brief').click();
  await client.waitForURL(/\/edit$/);
  await expect(client.getByTestId('needs-info-question')).toContainText('هل العرض يشمل');
  await client.getByTestId('brief-offer').fill('خصم 15٪ يشمل الطلب عبر التطبيق');
  await client.getByTestId('wizard-next').click();
  await client.getByTestId('request-attachment-input').setInputFiles(logo);
  await expect(client.getByTestId('request-attachment')).toHaveCount(2);
  await expect(client.getByTestId('request-attachment').last()).toHaveAttribute('data-status', 'done');
  await client.getByTestId('wizard-next').click();
  await client.getByTestId('wizard-next').click();
  await client.getByTestId('resubmit-note').fill('أضفنا صورة بخلفية بيضاء، والعرض يشمل التطبيق.');
  await client.getByTestId('request-submit').click();
  await client.waitForURL(/\/portal\/requests\/[0-9a-f-]{36}$/);
  await expect(client.getByTestId('request-status').first()).toHaveAttribute('data-status', 'under_review');
  await expect(client.getByTestId('request-brief')).toContainText('يشمل الطلب عبر التطبيق');

  // 5. The agency sees the update live and accepts; the package item is consumed.
  await expect(agency.getByTestId('request-status').first()).toHaveAttribute('data-status', 'under_review');
  await expect(agency.getByTestId('request-brief')).toContainText('يشمل الطلب عبر التطبيق');
  await agency.getByTestId('status-action-accepted').click();
  await agency.getByTestId('status-confirm').click();
  await expect(agency.getByTestId('request-status').first()).toHaveAttribute('data-status', 'accepted');

  await expect(client.getByTestId('request-status').first()).toHaveAttribute('data-status', 'accepted');
  const acceptedMail = await waitForEmail('abeer@najd.test', /تحديث على الطلب|Update on/, since);
  expect(acceptedMail.text).toContain(reference);
  await client.goto('/portal');
  await expect(postBar).toHaveAttribute('data-used', String(usedBefore + 1));

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
  await expect(page.locator('[data-testid^="status-action-"]')).toHaveCount(0);
  await page.goto('/portal/requests/new');
  await expect(page.getByText('لا تملك صلاحية الوصول')).toBeVisible();
});

test('type builder: add a conditional question and save a new schema version', async ({ page }) => {
  await login(page, 'faisal@ofoq.test');
  await page.goto('/admin/request-types');
  await page.getByTestId('type-card').filter({ hasText: 'تعديل على الموقع' }).click();
  await expect(page.getByTestId('builder-field').first()).toBeVisible();
  const before = await page.getByTestId('builder-field').count();
  await page.getByTestId('add-field').click();
  await page.getByTestId('add-field-checkbox').click();
  const toggle = `يحتاج نسخة إنجليزية ${unique('c')}`;
  await page.getByTestId('builder-label-ar').last().fill(toggle);
  await page.getByTestId('builder-label-en').last().fill('Needs an English version');
  await page.getByTestId('add-field').click();
  await page.getByTestId('add-field-long_text').click();
  const label = `النص الإنجليزي ${unique('q')}`;
  await page.getByTestId('builder-label-ar').last().fill(label);
  await page.getByTestId('builder-label-en').last().fill('English copy');
  await page.getByTestId('builder-condition-field').last().selectOption({ label: toggle });
  await page.getByTestId('builder-condition-value').last().selectOption('true');
  // Live preview: the conditional question appears only once the checkbox is ticked.
  const preview = page.getByTestId('builder-preview');
  await expect(preview).not.toContainText(label);
  await preview.getByText(toggle).click();
  await expect(preview).toContainText(label);
  await page.getByTestId('save-form').click();
  await expect(page.getByText('حُفظ النموذج').first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('builder-field')).toHaveCount(before + 2);
});
