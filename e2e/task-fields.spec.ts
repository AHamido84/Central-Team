import { expect, test } from '@playwright/test';
import postgres from 'postgres';

import { login } from './support';

const db = () => postgres(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1 });

/**
 * FR1.4 — per-field task permissions in the UI: a specialist can change the status of their own task but sees the other
 * fields locked (with the reason); the account manager can change them; every change shows in the task's history.
 */
test('specialist: status only on their own task; account manager: everything; history records it', async ({ browser }) => {
  const sql = db();
  const [task] = await sql<{ id: string; priority: string }[]>`
    select t.id, t.priority from public.tasks t
    join public.task_members m on m.task_id = t.id and m.role = 'assignee'
    join auth.users u on u.id = m.user_id and u.email = 'khalid@ofoq.test'
    join public.clients c on c.id = t.client_id and c.slug = 'najd-heritage'
    where t.parent_id is null and t.status_category <> 'done' and t.deleted_at is null limit 1`;
  await sql.end();

  const specialistCtx = await browser.newContext();
  const specialist = await specialistCtx.newPage();
  await login(specialist, 'khalid@ofoq.test');
  await specialist.goto(`/tasks?task=${task!.id}`);
  const drawer = specialist.getByTestId('task-drawer');
  await expect(drawer.getByTestId('drawer-properties')).toBeVisible();
  await expect(drawer.getByTestId('drawer-status')).toBeEnabled();
  await expect(drawer.getByTestId('drawer-priority')).toBeDisabled();
  await expect(drawer.getByTestId('drawer-due')).toBeDisabled();
  await expect(drawer.getByTestId('drawer-title')).toBeDisabled();
  await expect(drawer.getByTestId('field-locked').first()).toBeVisible();
  await expect(drawer.getByTestId('checklist-input')).toBeVisible();
  await specialistCtx.close();

  const amCtx = await browser.newContext();
  const am = await amCtx.newPage();
  await login(am, 'noura@ofoq.test');
  await am.goto(`/tasks?task=${task!.id}`);
  const amDrawer = am.getByTestId('task-drawer');
  await expect(amDrawer.getByTestId('drawer-priority')).toBeEnabled();
  await expect(amDrawer.getByTestId('field-locked')).toHaveCount(0);
  const next = task!.priority === 'urgent' ? 'high' : 'urgent';
  await amDrawer.getByTestId('drawer-priority').selectOption(next);
  await amDrawer.getByTestId('history-show').click();
  await expect(amDrawer.getByTestId('history-entry').first()).toContainText(/الأولوية|Priority/);
  await amCtx.close();
});
