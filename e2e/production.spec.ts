import path from 'node:path';

import { expect, test, type Browser, type Page } from '@playwright/test';

import { login, unique, waitForEmail } from './support';

const art = path.resolve(__dirname, 'fixtures/brand-logo.png');

async function as(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await login(page, email);
  return page;
}

async function uploadVersion(designer: Page, deliverableId: string) {
  await designer.goto(`/deliverables/${deliverableId}`);
  const newVersion = designer.getByTestId('new-version');
  const panel = designer.getByTestId('upload-panel');
  await expect(panel.or(newVersion)).toBeVisible();
  if (await newVersion.isVisible()) await newVersion.click();
  await expect(panel).toBeVisible();
  await designer.getByTestId('version-file-input').setInputFiles(art);
  await expect(designer.getByTestId('upload-item').last()).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
  await expect(designer.getByTestId('draft-file')).toHaveCount(1);
  await designer.getByTestId('submit-version').click();
  await expect(designer.getByTestId('deliverable-review')).toHaveAttribute('data-status', 'internal_review');
}

async function approveInternally(lead: Page, deliverableId: string) {
  await lead.goto(`/deliverables/${deliverableId}`);
  await lead.getByTestId('approve').click();
  await lead.getByTestId('decision-confirm').click();
  await expect(lead.getByTestId('deliverable-review')).toHaveAttribute('data-status', 'client_review');
}

/**
 * Phase 3 acceptance: client request → AM converts it into tasks → designer uploads v1 (resumable upload) → team lead
 * approves internally → client pins a comment on the image and requests changes → v2 → client approves → request Delivered.
 */
test('request → tasks → deliverable → internal review → client changes → v2 → approval → delivered', async ({ browser }) => {
  test.setTimeout(240_000);
  const title = `ستوري اختبار ${unique('p3')}`;
  const since = new Date();

  // 1. The client submits a Story request.
  const client = await as(browser, 'abeer@najd.test');
  await client.goto('/portal/requests/new');
  await client.getByTestId('type-option').filter({ hasText: 'ستوري' }).click();
  await client.getByTestId('request-title').fill(title);
  await client.getByTestId('brief-platforms').locator('[data-value="snapchat"]').click();
  await client.getByTestId('brief-count').fill('2');
  await client.getByTestId('brief-message').fill('ستوري تعلن عن طبق اليوم.');
  for (let i = 0; i < 3; i++) await client.getByTestId('wizard-next').click();
  await client.getByTestId('request-submit').click();
  await client.waitForURL(/\/portal\/requests\/[0-9a-f-]{36}$/);
  const requestId = client.url().split('/').pop()!;

  // 2. The account manager converts it into tasks from the workflow template.
  const am = await as(browser, 'noura@ofoq.test');
  await am.goto(`/requests/${requestId}`);
  await am.getByTestId('convert-to-tasks').click();
  await expect(am.getByTestId('convert-preview').locator('li')).toHaveCount(2);
  await am.getByTestId('convert-confirm').click();
  await expect(am.getByTestId('request-status').first()).toHaveAttribute('data-status', 'in_progress');
  await expect(am.getByTestId('request-tasks').locator('li')).toHaveCount(2);
  const card = am.getByTestId('request-work').getByTestId('deliverable-card');
  await expect(card).toHaveCount(1);
  const deliverableId = (await card.getAttribute('href'))!.split('/').pop()!;

  // The designer is assigned (Design department, on the Najd team) and hears about it.
  const assigned = await waitForEmail('khalid@ofoq.test', /أُسندت إليك مهمة|assigned to you/, since);
  expect(assigned.text).toContain(title);

  // The client sees the workflow progress, but no tasks.
  await client.goto(`/portal/requests/${requestId}`);
  await expect(client.getByTestId('request-progress').getByTestId('progress-step')).toHaveCount(2);
  await expect(client.getByTestId('request-deliverables')).toHaveCount(0);

  // 3. The designer uploads v1 and sends it for internal review.
  const designer = await as(browser, 'khalid@ofoq.test');
  await uploadVersion(designer, deliverableId);

  // 4. The team lead approves internally → it goes to the client.
  const lead = await as(browser, 'reem@ofoq.test');
  await approveInternally(lead, deliverableId);
  const ready = await waitForEmail('abeer@najd.test', /بانتظار اعتمادك|Waiting for your approval/, since);
  expect(ready.text).toContain(title);

  // 5. The client pins a comment on the image and requests changes (feedback required).
  await client.goto('/portal');
  await expect(client.getByTestId('approvals-cta')).toBeVisible();
  await client.goto(`/portal/approvals/${deliverableId}`);
  await expect(client.getByTestId('client-deliverable-status')).toHaveAttribute('data-state', 'awaiting');
  const image = client.getByTestId('viewer-image');
  await expect(image).toBeVisible();
  const box = (await image.boundingBox())!;
  await client.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await expect(client.getByTestId('pin-pending')).toBeVisible();
  await client.getByTestId('annotation-input').fill('ممكن الشعار أكبر هنا؟');
  await client.getByTestId('annotation-submit').click();
  await expect(client.getByTestId('annotation-pin')).toHaveCount(1);
  await client.getByTestId('request-changes').click();
  await client.getByTestId('decision-confirm').click();
  await expect(client.getByTestId('decision-dialog').getByText(/اكتب ملاحظاتك|Add your feedback/)).toBeVisible();
  await expect(client.getByTestId('revision-quota')).toBeVisible();
  await client.getByTestId('decision-comment').fill('الشعار أكبر وخلفية أفتح.');
  await client.getByTestId('decision-confirm').click();
  await expect(client.getByTestId('client-deliverable-status')).toHaveAttribute('data-state', 'revising');

  // The designer sees the pinned feedback and the task back in "changes".
  await designer.goto(`/deliverables/${deliverableId}`);
  await expect(designer.getByTestId('deliverable-review')).toHaveAttribute('data-status', 'client_changes');
  await expect(designer.getByTestId('annotation').filter({ hasText: 'الشعار أكبر' })).toBeVisible();

  // 6. v2 → internal approval → client approves → the request is delivered.
  await uploadVersion(designer, deliverableId);
  await approveInternally(lead, deliverableId);
  await client.goto(`/portal/approvals/${deliverableId}`);
  await expect(client.getByTestId('version-select')).toContainText('2');
  await client.getByTestId('approve').click();
  await client.getByTestId('decision-confirm').click();
  await expect(client.getByTestId('client-deliverable-status')).toHaveAttribute('data-state', 'approved');
  await client.goto(`/portal/requests/${requestId}`);
  await expect(client.getByTestId('request-status').first()).toHaveAttribute('data-status', 'delivered');
  await expect(client.getByTestId('delivered-banner')).toBeVisible();
  await expect(client.getByTestId('request-deliverables').getByTestId('deliverable-card')).toHaveCount(1);

  const approvedMail = await waitForEmail('khalid@ofoq.test', /اعتُمد|was approved/, since);
  expect(approvedMail.text.toLowerCase()).toContain(title.toLowerCase());
});

test('task board: drag a card to another status, open the drawer, tick the checklist, log time', async ({ page }) => {
  await login(page, 'noura@ofoq.test');
  await page.goto('/tasks?layout=board');
  const todo = page.locator('[data-testid="board-column"][data-category="todo"]');
  const active = page.locator('[data-testid="board-column"][data-category="active"]');
  const card = todo.getByTestId('task-card').first();
  const taskId = (await card.getAttribute('data-task-id'))!;
  // Pointer drag from "To do" into the "In progress" column (a few moves so the sensor activates).
  const from = (await card.boundingBox())!;
  const to = (await active.locator('header').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(from.x + ((to.x + to.width / 2 - from.x) * i) / 8, from.y + ((to.y + 60 - from.y) * i) / 8);
  }
  await page.mouse.up();
  await expect(active.locator(`[data-task-id="${taskId}"]`)).toBeVisible();
  // The move is saved (survives a reload).
  await page.reload();
  await expect(active.locator(`[data-task-id="${taskId}"]`)).toBeVisible();

  // Keyboard drag: space picks the card up, an arrow moves it to the next column (left in Arabic), space drops it.
  const next = todo.getByTestId('task-card').first();
  const nextId = (await next.getAttribute('data-task-id'))!;
  await next.locator('..').focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Space');
  await expect(active.locator(`[data-task-id="${nextId}"]`)).toBeVisible();

  await active.locator(`[data-task-id="${taskId}"]`).click();
  const drawer = page.getByTestId('task-drawer');
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`task=${taskId}`));
  await drawer.getByTestId('checklist-input').fill('راجع المقاسات');
  await drawer.getByTestId('checklist-input').press('Enter');
  await drawer.getByTestId('checklist-item').last().click();
  await expect(drawer.getByTestId('checklist-item').last()).toHaveAttribute('data-state', 'checked');
  await drawer.getByTestId('time-add').click();
  await drawer.getByTestId('time-minutes').fill('45');
  await drawer.getByTestId('time-save').click();
  await expect(drawer.getByTestId('time-entries')).toContainText(/45/);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
});

test('workflow builder: add a reviewed step after the last one and save', async ({ page }) => {
  await login(page, 'faisal@ofoq.test');
  await page.goto('/admin/workflows');
  await page.getByTestId('workflow-card').filter({ hasText: 'تعديل على الموقع' }).click();
  const steps = page.getByTestId('workflow-step');
  await expect(steps.first()).toBeVisible();
  const before = await steps.count();
  await page.getByTestId('add-step').click();
  await expect(steps).toHaveCount(before + 1);
  const added = steps.last();
  const name = `نشر ${unique('s')}`;
  await added.getByTestId('step-name-ar').fill(name);
  await added.getByTestId('step-name-en').fill('Publish');
  await added.getByTestId('step-deliverable').selectOption('document');
  await added.getByTestId('step-client-approval').click();
  // New steps start after the previous last step; the preview shows it.
  await expect(page.getByTestId('workflow-preview')).toContainText(name);
  await page.getByTestId('save-workflow').click();
  await expect(page.getByText(/حُفظ مسار العمل|Workflow saved/).first()).toBeVisible();
  await page.reload();
  await expect(steps).toHaveCount(before + 1);
  await expect(steps.last()).toContainText(name);
});
