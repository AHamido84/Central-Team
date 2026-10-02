import path from 'node:path';

import { expect, test } from '@playwright/test';
import postgres from 'postgres';

import { login, unique } from './support';

const logo = path.resolve(__dirname, 'fixtures/brand-logo.png');

/**
 * Phase 5 acceptance: an admin adds an SLA policy → a client submits a request that matches it → the account manager
 * sees the policy's targets on the request → time passes (the reply target is moved into the past directly in the
 * database, as the clock can't be sped up) → the SLA monitor, the ops dashboard and Client 360 show it, the breach the
 * daily sweep records (sweep itself: tests/db/sla-sweep.test.ts) is acknowledged with a note → the team pages render
 * → the policy is deleted again.
 */
test('SLA policy → matching request → overdue reply → monitor, ops dashboard, client 360, acknowledge, team', async ({ browser }) => {
  test.setTimeout(240_000);
  const db = postgres(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1 });
  const policyName = `سياسة ${unique('sla')}`;
  const title = `منشور مستوى الخدمة ${unique('e2e')}`;

  // Leftovers from an interrupted run would compete with this run's policy.
  await db`delete from public.sla_policies where name->>'ar' like 'سياسة sla-%'`;
  try {
    // 1. The operations manager adds a policy for Najd social posts (more specific than "Najd premium").
    const adminCtx = await browser.newContext();
    const admin = await adminCtx.newPage();
    await login(admin, 'faisal@ofoq.test');
    await admin.goto('/admin/sla');
    await admin.getByTestId('policy-new').click();
    await admin.getByTestId('policy-name-ar').fill(policyName);
    await admin.getByTestId('policy-client').selectOption({ label: 'مطاعم نجد الأصيلة' });
    await admin.getByTestId('policy-type').selectOption({ label: 'منشور سوشيال' });
    await admin.getByTestId('policy-response').fill('3');
    await admin.getByTestId('policy-resolution').fill('4');
    await admin.getByTestId('policy-save').click();
    const card = admin.getByTestId('policy-card').filter({ hasText: policyName });
    await expect(card).toBeVisible();

    // 2. A Najd member submits a social post.
    const clientCtx = await browser.newContext();
    const client = await clientCtx.newPage();
    await login(client, 'abeer@najd.test');
    await client.goto('/portal/requests');
    await client.getByTestId('new-request').click();
    await client.getByTestId('type-option').filter({ hasText: 'منشور سوشيال' }).click();
    await client.getByTestId('request-title').fill(title);
    await client.getByTestId('brief-platforms').locator('[data-value="instagram"]').click();
    await client.getByTestId('brief-goal').selectOption('offer');
    await client.getByTestId('brief-offer').fill('خصم 10٪');
    await client.getByTestId('brief-message').fill('منشور لاختبار مستوى الخدمة.');
    await client.getByTestId('brief-photos-input').setInputFiles(logo);
    await expect(client.getByTestId('brief-file').first()).toHaveAttribute('data-status', 'done');
    await client.getByTestId('wizard-next').click();
    await expect(client.getByTestId('request-wizard')).toHaveAttribute('data-step', 'attachments');
    await client.getByTestId('wizard-next').click();
    await expect(client.getByTestId('request-wizard')).toHaveAttribute('data-step', 'schedule');
    await client.getByTestId('wizard-next').click();
    await client.getByTestId('request-submit').click();
    await client.waitForURL(/\/portal\/requests\/[0-9a-f-]{36}$/);
    const requestId = client.url().split('/').pop()!;
    // Internal targets never reach the portal.
    await expect(client.getByTestId('sla-card')).toHaveCount(0);
    await clientCtx.close();

    // 3. The account manager sees the policy and both targets on the request.
    const amCtx = await browser.newContext();
    const am = await amCtx.newPage();
    await login(am, 'noura@ofoq.test');
    await am.goto(`/requests/${requestId}`);
    await expect(am.getByTestId('sla-policy')).toContainText(policyName);
    await expect(am.getByTestId('sla-response-due')).toBeVisible();
    await expect(am.getByTestId('sla-response-state')).toHaveAttribute('data-sla', /on_track|at_risk/);

    // 4. Time passes without a reply.
    await db`update public.requests set submitted_at = now() - interval '2 days', response_due_at = now() - interval '1 hour'
      where id = ${requestId}`;
    await am.reload();
    await expect(am.getByTestId('sla-response-state')).toHaveAttribute('data-sla', 'overdue');

    // 5. The SLA monitor lists it live.
    await am.goto('/sla');
    const issue = am.locator(`[data-testid="sla-issue"][data-kind="response"][href="/requests/${requestId}"]`);
    await expect(issue).toHaveAttribute('data-state', 'overdue');

    // 6. The daily sweep's record of the breach (what runSlaSweep inserts), then acknowledgement with a note.
    await db`insert into public.sla_breaches (organization_id, client_id, request_id, policy_id, kind, level, due_at)
      select organization_id, client_id, id, sla_policy_id, 'response', 'breached', response_due_at from public.requests where id = ${requestId}
      on conflict do nothing`;
    await am.goto('/sla?view=unacknowledged');
    const row = am.getByTestId('breach-row').filter({ hasText: title });
    await expect(row).toBeVisible();
    await row.getByTestId('breach-ack').click();
    await am.getByTestId('breach-note').fill('نرد على العميل خلال ساعة');
    await am.getByTestId('breach-ack-confirm').click();
    await am.goto('/sla?view=all');
    await expect(am.getByTestId('breach-row').filter({ hasText: title }).getByTestId('breach-acknowledged')).toContainText(
      'نرد على العميل خلال ساعة',
    );

    // 7. Ops dashboard, Client 360 and the clients list show the client's health.
    await am.goto('/dashboard');
    await expect(am.getByTestId('ops-tiles')).toBeVisible();
    await expect(am.getByTestId('ops-attention').locator(`[href="/requests/${requestId}"]`).first()).toBeVisible();
    await am.getByTestId('ops-scope').selectOption('mine');
    await am.waitForURL(/scope=mine/);
    await expect(am.getByTestId('ops-client-row').filter({ hasText: 'مطاعم نجد الأصيلة' })).toBeVisible();
    await am.getByTestId('ops-client-row').filter({ hasText: 'مطاعم نجد الأصيلة' }).getByRole('link').first().click();
    await expect(am.getByTestId('client-360')).toBeVisible();
    await expect(am.getByTestId('client-360').getByTestId('client-health')).toHaveAttribute('data-health', /healthy|watch|at_risk/);
    await expect(am.getByTestId('health-reasons')).toBeVisible();
    await expect(am.getByTestId('client-sla-compliance')).toBeVisible();
    await am.goto('/clients');
    await expect(am.getByTestId('client-health').filter({ visible: true }).first()).toBeVisible();

    // 8. Team: the list and one person's page.
    await am.goto('/team');
    await expect(am.getByTestId('team-row').first()).toBeVisible();
    await am.getByTestId('team-row').filter({ hasText: 'خالد المطيري' }).getByRole('link').click();
    await expect(am.getByTestId('team-member')).toBeVisible();
    await amCtx.close();

    // 9. The admin removes the policy; the request keeps its targets.
    await admin.goto('/admin/sla');
    await admin.getByTestId('policy-card').filter({ hasText: policyName }).getByRole('button').nth(1).click();
    await admin.getByRole('alertdialog').getByRole('button').last().click();
    await expect(admin.getByTestId('policy-card').filter({ hasText: policyName })).toHaveCount(0);
    const [kept] = await db<{ response_due_at: Date | null }[]>`select response_due_at from public.requests where id = ${requestId}`;
    expect(kept!.response_due_at).not.toBeNull();
    await adminCtx.close();
  } finally {
    await db`delete from public.sla_policies where name->>'ar' like 'سياسة sla-%'`;
    await db.end();
  }
});
