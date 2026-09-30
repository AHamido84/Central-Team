import { expect, test } from '@playwright/test';
import postgres from 'postgres';

import { login, unique } from './support';

const db = () => postgres(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1 });

/**
 * FR1.3 — converting a request goes through a review step: rename, reassign, reorder, remove a step and add a task
 * outside the workflow before anything is created; afterwards the request page lists the tasks with "Add task" and
 * delete, and progress follows. The request is put back as it was so the test can run again.
 */
test('review the plan, then create exactly what was reviewed; add and delete tasks afterwards', async ({ page }) => {
  const sql = db();
  const [request] = await sql<{ id: string; status: string }[]>`
    select id, status from public.requests where title = 'ريلز مجموعة العيد' and converted_at is null`;
  test.skip(!request, 'seed request already converted — run pnpm db:reset');
  const renamed = `مهمة معدّلة ${unique('r')}`;
  const adhoc = `مهمة إضافية ${unique('a')}`;
  const later = `مهمة لاحقة ${unique('l')}`;
  try {
    await login(page, 'faisal@ofoq.test');
    await page.goto(`/requests/${request!.id}`);
    await page.getByTestId('convert-to-tasks').click();
    await page.getByTestId('convert-review-button').click();
    const items = page.getByTestId('plan-item');
    await expect(items).toHaveCount(4);

    // Rename the first step and give it to someone else.
    await items.nth(0).getByTestId('plan-title').fill(renamed);
    await items.nth(0).getByTestId('plan-assignee').selectOption({ label: 'هند السبيعي' });
    // Remove the last step.
    await items.nth(3).getByTestId('plan-remove').click();
    await expect(items).toHaveCount(3);
    // Add a task outside the workflow and move it up one place.
    await page.getByTestId('plan-add').click();
    await expect(items).toHaveCount(4);
    await items.nth(3).getByTestId('plan-title').fill(adhoc);
    await expect(items.nth(3)).toHaveAttribute('data-step', 'adhoc');
    await items.nth(2).getByTestId('plan-move-down').click();
    await expect(items.nth(2).getByTestId('plan-title')).toHaveValue(adhoc);
    // Durations drive the dates.
    const dueBefore = await items.nth(0).getByTestId('plan-due').inputValue();
    await items.nth(0).getByTestId('plan-duration').fill('5');
    await expect(items.nth(0).getByTestId('plan-due')).not.toHaveValue(dueBefore);

    await page.getByTestId('convert-confirm').click();
    const tasks = page.getByTestId('request-task');
    await expect(tasks).toHaveCount(4);
    await expect(tasks.nth(0)).toContainText(renamed);
    await expect(tasks.filter({ hasText: adhoc }).getByTestId('outside-workflow')).toBeVisible();
    const [assigned] = await sql<{ name: string }[]>`
      select p.full_name as name from public.tasks t join public.task_members m on m.task_id = t.id and m.role = 'assignee'
      join public.profiles p on p.id = m.user_id where t.request_id = ${request!.id} and t.title = ${renamed}`;
    expect(assigned?.name).toBe('هند السبيعي');

    // After conversion: add a task, then delete it.
    const steps = page.getByTestId('progress-step');
    await expect(steps).toHaveCount(4);
    await page.getByTestId('request-add-task').click();
    await page.getByTestId('add-task-title').fill(later);
    await page.getByTestId('add-task-submit').click();
    await expect(tasks).toHaveCount(5);
    await expect(steps).toHaveCount(5);
    await tasks.filter({ hasText: later }).getByTestId('request-task-actions').click();
    await page.getByTestId('action-delete').click();
    // The task's conversation goes with it, so the dialog asks for the name.
    await page.getByTestId('delete-type-name').fill(later);
    await page.getByTestId('delete-confirm').click();
    await expect(tasks).toHaveCount(4);
    await expect(steps).toHaveCount(4);
  } finally {
    await sql`delete from public.deliverables where request_id = ${request!.id}`;
    await sql`delete from public.tasks where request_id = ${request!.id}`;
    await sql`delete from public.trash_items where entity_type = 'task' and title = ${later}`;
    await sql`update public.requests set converted_at = null, status = ${request!.status} where id = ${request!.id}`;
    await sql.end();
  }
});
