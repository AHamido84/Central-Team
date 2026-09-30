import path from 'node:path';

import { expect, test as base, type Page } from '@playwright/test';

import { login } from './support';

// One sign-in per worker (the login is rate limited per e-mail); every test reuses the session.
const test = base.extend<object, { authFile: string }>({
  authFile: [
    async ({ browser }, provide, workerInfo) => {
      const file = path.join(workerInfo.project.outputDir, `.auth-tasks-drawer-${workerInfo.workerIndex}.json`);
      const context = await browser.newContext({ baseURL: workerInfo.project.use.baseURL });
      await login(await context.newPage(), 'noura@ofoq.test');
      await context.storageState({ path: file });
      await context.close();
      await provide(file);
    },
    { scope: 'worker' },
  ],
  storageState: ({ authFile }, provide) => provide(authFile),
});

/**
 * FR1.2 — the task drawer closes every way people expect (X, Esc, click outside, browser Back, swipe on mobile), keeps
 * `?task=` shareable, asks before throwing away unsaved edits, replaces its content instead of stacking, and hands
 * focus back to the card that opened it.
 */

async function openFirstCard(page: Page) {
  await page.goto('/tasks?layout=board');
  const card = page.getByTestId('task-card').first();
  await expect(card).toBeVisible();
  const id = (await card.getAttribute('data-task-id'))!;
  await card.click();
  await expect(page.getByTestId('task-drawer').getByTestId('drawer-properties')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`task=${id}`));
  return id;
}

async function expectClosed(page: Page, id: string) {
  await expect(page.getByTestId('task-drawer')).toHaveCount(0);
  await expect(page).not.toHaveURL(/task=/);
  // Focus is back on the card that opened the task.
  await expect(page.locator(`[data-task-focus="${id}"]`).first()).toBeFocused();
}

test.describe('task drawer', () => {
  test('closes with the X button', async ({ page }) => {
    const id = await openFirstCard(page);
    await page.getByTestId('task-drawer').getByTestId('sheet-close').click();
    await expectClosed(page, id);
  });

  test('closes with Escape', async ({ page }) => {
    const id = await openFirstCard(page);
    await page.keyboard.press('Escape');
    await expectClosed(page, id);
  });

  test('closes when clicking outside', async ({ page }) => {
    const id = await openFirstCard(page);
    const box = (await page.getByTestId('task-drawer').boundingBox())!;
    const viewport = page.viewportSize()!;
    // The drawer sits at the end edge (left in Arabic); click on the other side of the overlay.
    const x = box.x < viewport.width / 2 ? viewport.width - 40 : 40;
    await page.mouse.click(x, viewport.height / 2);
    await expectClosed(page, id);
  });

  test('closes with the browser Back button and the URL is shareable', async ({ page }) => {
    const id = await openFirstCard(page);
    await page.goBack();
    await expect(page.getByTestId('task-drawer')).toHaveCount(0);
    await expect(page).toHaveURL(/\/tasks/);
    await expect(page).not.toHaveURL(/task=/);

    // Opening the shared link shows the task; closing it keeps you on the Tasks page.
    await page.goto(`/tasks?layout=board&task=${id}`);
    await expect(page.getByTestId('task-drawer').getByTestId('drawer-properties')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('task-drawer')).toHaveCount(0);
    await expect(page).toHaveURL(/\/tasks\?layout=board$/);
  });

  test('opening another task replaces the content (no stacking)', async ({ page }) => {
    const id = await openFirstCard(page);
    const title = await page.getByTestId('drawer-title').innerText();
    await page.keyboard.press('j');
    await expect(page.getByTestId('drawer-title')).not.toHaveText(title);
    await expect(page).not.toHaveURL(new RegExp(`task=${id}`));
    await expect(page.getByTestId('task-drawer')).toHaveCount(1);
    // One Back closes the drawer: switching replaced the history entry.
    await page.goBack();
    await expect(page.getByTestId('task-drawer')).toHaveCount(0);
  });

  test('asks before discarding unsaved edits', async ({ page }) => {
    await openFirstCard(page);
    const drawer = page.getByTestId('task-drawer');
    await drawer.getByTestId('checklist-input').fill('بند لم يُحفظ');
    await drawer.getByTestId('sheet-close').click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'متابعة التعديل' }).click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId('checklist-input')).toHaveValue('بند لم يُحفظ');

    await drawer.getByTestId('sheet-close').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'تجاهل' }).click();
    await expect(page.getByTestId('task-drawer')).toHaveCount(0);
  });
});

test.describe('task drawer on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('closes with a swipe towards its edge', async ({ page }) => {
    await page.goto('/tasks?layout=list');
    const row = page.locator('[data-task-focus]').first();
    await row.click();
    const drawer = page.getByTestId('task-drawer');
    await expect(drawer.getByTestId('drawer-properties')).toBeVisible();
    const box = (await drawer.boundingBox())!;
    const rtl = (await page.evaluate(() => document.documentElement.dir)) === 'rtl';
    const y = box.y + box.height / 2;
    const startX = box.x + box.width / 2;
    const endX = startX + (rtl ? -160 : 160);
    await drawer.evaluate(
      (el, { startX, endX, y }) => {
        const touch = (x: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
        el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(startX)], changedTouches: [touch(startX)] }));
        el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [touch(endX)] }));
      },
      { startX, endX, y },
    );
    await expect(page.getByTestId('task-drawer')).toHaveCount(0);
    await expect(page).not.toHaveURL(/task=/);
  });
});
