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

/**
 * The people pickers open inside the drawer (a sheet) and must be clickable: assignee, reviewer and watchers change and
 * are saved. Regression: the picker rendered behind the drawer, so no one could be picked.
 */
test('the drawer changes assignees, reviewer and watchers', async ({ page }) => {
  const sql = db();
  const [task] = await sql<{ id: string; reviewer_id: string | null }[]>`
    select t.id, t.reviewer_id from public.tasks t join public.clients c on c.id = t.client_id and c.slug = 'najd-heritage'
    where t.parent_id is null and t.status_category <> 'done' and t.deleted_at is null order by t.created_at limit 1`;
  const members = await sql<{ user_id: string; role: string }[]>`select user_id, role from public.task_members where task_id = ${task!.id}`;
  const person = async (email: string) =>
    (await sql<{ id: string; full_name: string }[]>`select id, full_name from public.profiles where email = ${email}`)[0]!;
  const omar = await person('omar@ofoq.test');
  const reem = await person('reem@ofoq.test');
  const turki = await person('turki@ofoq.test');
  try {
    await login(page, 'sara@ofoq.test');
    await page.goto(`/tasks?task=${task!.id}`);
    const drawer = page.getByTestId('task-drawer');
    await expect(drawer.getByTestId('drawer-properties')).toBeVisible();
    const pick = async (field: string, name: string) => {
      await drawer.getByTestId(field).click();
      await page.getByTestId('person-option').filter({ hasText: name }).click();
      // The reviewer picker closes itself; the multi-selects stay open until Escape.
      if (await page.getByTestId('person-option').first().isVisible()) await page.keyboard.press('Escape');
      await expect(drawer.getByTestId(field)).toContainText(name);
    };
    await pick('drawer-assignees', omar.full_name);
    await pick('drawer-reviewer', reem.full_name);
    await pick('drawer-watchers', turki.full_name);
    await expect(drawer).toBeVisible();

    await expect
      .poll(async () => {
        const [row] = await sql<{ reviewer_id: string | null; a: boolean; w: boolean }[]>`
          select t.reviewer_id,
            exists (select 1 from public.task_members m where m.task_id = t.id and m.user_id = ${omar.id} and m.role = 'assignee') as a,
            exists (select 1 from public.task_members m where m.task_id = t.id and m.user_id = ${turki.id} and m.role = 'watcher') as w
          from public.tasks t where t.id = ${task!.id}`;
        return row;
      })
      .toEqual({ reviewer_id: reem.id, a: true, w: true });
  } finally {
    await sql`delete from public.task_members where task_id = ${task!.id}`;
    for (const m of members)
      await sql`insert into public.task_members (task_id, user_id, role) values (${task!.id}, ${m.user_id}, ${m.role}) on conflict do nothing`;
    await sql`update public.tasks set reviewer_id = ${task!.reviewer_id} where id = ${task!.id}`;
    await sql.end();
  }
});
