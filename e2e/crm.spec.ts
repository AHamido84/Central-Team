import { expect, test } from '@playwright/test';
import postgres from 'postgres';

import { login, waitForEmail } from './support';

/**
 * Phase 6 acceptance: a visitor fills the public website form → the lead lands assigned by the rules (Jeddah → Ruba) →
 * Ruba opens it, creates a deal with a package, moves it through the stages to Won → the sales manager turns it into a
 * client in one step → the client exists (onboarding) with the package for the current period, the contact has a
 * portal invitation email, and the onboarding request was converted to tasks through the workflow template.
 */
test('public form → assigned lead → deal → stages → won → client with package, invitation and onboarding tasks', async ({ browser }) => {
  test.setTimeout(240_000);
  const db = postgres(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1 });
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const email = `lead-${tag}@e2e.test`;
  const phone = `055${String(Date.now()).slice(-7)}`;
  const company = `Sadeem ${tag}`;
  const since = new Date();
  let clientId: string | null = null;

  try {
    // 1. A visitor submits the embeddable form (anonymous, after the spam-protection minimum time).
    const visitorCtx = await browser.newContext();
    await visitorCtx.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3000' }]);
    const visitor = await visitorCtx.newPage();
    await visitor.goto('/f/ofoq-website-contact');
    await visitor.getByTestId('pf-name').fill('Sadeem Owner');
    await visitor.getByTestId('pf-company').fill(company);
    await visitor.getByTestId('pf-phone').fill(phone);
    await visitor.getByTestId('pf-email').fill(email);
    await visitor.getByTestId('pf-city').selectOption('jeddah');
    await visitor.getByTestId('pf-message').fill('We need social media management for our new store.');
    await visitor.waitForTimeout(3_500);
    await visitor.getByTestId('pf-submit').click();
    await expect(visitor.getByTestId('public-form-done')).toBeVisible();
    await visitorCtx.close();

    const [lead] = await db<{ id: string; owner: string | null; phone: string }[]>`
      select l.id, u.email as owner, l.phone from public.leads l left join auth.users u on u.id = l.owner_id where l.email = ${email}`;
    expect(lead?.owner).toBe('ruba@ofoq.test');
    expect(lead?.phone).toBe(`+966${phone.slice(1)}`);

    // 2. Ruba (sales rep, English) creates a deal from the lead and works it to Won.
    const repCtx = await browser.newContext();
    const rep = await repCtx.newPage();
    await login(rep, 'ruba@ofoq.test');
    await rep.goto('/crm/leads');
    await expect(rep.getByText(company).first()).toBeVisible();
    await rep.goto(`/crm/leads/${lead!.id}`);
    await rep.getByTestId('lead-convert').click();
    await rep.getByTestId('deal-title').fill(`${company} — social retainer`);
    await rep.getByTestId('deal-value').fill('36000');
    await rep.getByTestId('deal-package').selectOption({ index: 1 });
    await rep.getByTestId('lead-convert-save').click();
    await rep.waitForURL('**/crm/deals/**');
    const dealId = rep.url().split('/').pop()!;
    await expect(rep.getByTestId('deal-contact')).toContainText('Sadeem Owner');

    const steps = rep.getByTestId('stage-step');
    for (const i of [2, 3, 4]) {
      await steps.nth(i).click();
      await expect(steps.nth(i)).toHaveAttribute('data-current', 'true');
    }
    await rep.getByTestId('deal-stage-bar').locator('[data-kind="won"]').click();
    await expect(rep.getByTestId('deal-stage-bar').locator('[data-kind="won"]')).toHaveAttribute('data-current', 'true');
    await expect(rep.getByTestId('deal-summary')).toContainText('Won');
    // Reps can't create clients; the conversion is the manager's.
    await expect(rep.getByTestId('deal-convert')).toHaveCount(0);
    await repCtx.close();

    const history = await db<{ n: number }[]>`select count(*)::int as n from public.deal_stage_history where deal_id = ${dealId}`;
    expect(history[0]!.n).toBe(5);

    // 3. The sales manager turns the won deal into a client in one step.
    const managerCtx = await browser.newContext();
    const manager = await managerCtx.newPage();
    await login(manager, 'majed@ofoq.test');
    await manager.goto(`/crm/deals/${dealId}`);
    await manager.getByTestId('deal-convert').click();
    await manager.getByTestId('convert-name-ar').fill(`سديم ${tag}`);
    await expect(manager.getByTestId('convert-invite')).not.toHaveValue('');
    await expect(manager.getByTestId('convert-onboarding')).toHaveAttribute('data-state', 'checked');
    await manager.getByTestId('convert-run').click();
    await manager.waitForURL((u) => /\/clients\/[0-9a-f-]{36}$/.test(u.pathname));
    clientId = manager.url().split('/').pop()!;
    await managerCtx.close();

    // 4. Everything the conversion promised exists.
    const [client] = await db<{ status: string; name: { ar?: string } }[]>`select status, name from public.clients where id = ${clientId}`;
    expect(client).toMatchObject({ status: 'onboarding' });
    // The package starts on the agency's day (Asia/Riyadh), which runs ahead of UTC's `current_date` late in the evening.
    const pkgs =
      await db`select id from public.client_packages where client_id = ${clientId} and (now() at time zone 'Asia/Riyadh')::date between period_start and period_end`;
    expect(pkgs).toHaveLength(1);
    const invites =
      await db`select id from public.invitations where lower(email) = ${email} and status = 'pending' and client_id = ${clientId}`;
    expect(invites).toHaveLength(1);
    const [req] = await db<{ id: string; key: string }[]>`
      select r.id, t.key from public.requests r join public.request_types t on t.id = r.request_type_id where r.client_id = ${clientId}`;
    expect(req?.key).toBe('onboarding');
    const tasks = await db<{ n: number }[]>`select count(*)::int as n from public.tasks where client_id = ${clientId}`;
    expect(tasks[0]!.n).toBeGreaterThanOrEqual(5);
    const [deal] = await db<
      { client_id: string; converted_at: Date | null }[]
    >`select client_id, converted_at from public.deals where id = ${dealId}`;
    expect(deal?.client_id).toBe(clientId);
    expect(deal?.converted_at).not.toBeNull();
    const mail = await waitForEmail(email, undefined, since);
    expect(mail.html).toContain('/invite/');
  } finally {
    if (clientId) {
      await db`delete from public.invitations where client_id = ${clientId}`;
      await db`delete from public.deals where client_id = ${clientId}`;
      await db`delete from public.clients where id = ${clientId}`;
    }
    await db`delete from public.deals where lead_id in (select id from public.leads where email = ${email})`;
    await db`delete from public.leads where email = ${email}`;
    await db.end();
  }
});
