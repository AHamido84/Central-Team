import { expect, test } from '@playwright/test';
import postgres from 'postgres';

import { login } from './support';

/**
 * Phase 7 acceptance: an admin writes an automation on "campaign numbers synced" → connects the Snapchat sandbox
 * through the real OAuth round-trip (signed state, consent, callback, Vault) → maps the ad account to Najd and a
 * platform campaign to a campaign channel → syncs → the daily numbers land in metrics_daily (source api) and show on the
 * campaign → the rule runs and its notification reaches the campaign owner.
 */
test('sandbox connect → map → sync → metrics on the campaign → automation fires', async ({ browser }) => {
  test.setTimeout(240_000);
  const db = postgres(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1 });
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const campaignName = `Snap sync ${tag}`;
  const ruleName = `Synced alert ${tag}`;
  let campaignId: string | null = null;
  let automationId: string | null = null;

  try {
    // Start clean: no Snapchat sandbox connection from an earlier run (its Vault secret goes with it).
    await db`delete from public.integration_connections where provider = 'snapchat' and mode = 'sandbox'`;
    const [ctx] = await db<{ org: string; client: string; sara: string }[]>`
      select c.organization_id as org, c.id as client, (select id from auth.users where email = 'sara@ofoq.test') as sara
      from public.clients c where c.slug = 'najd-heritage'`;
    // A live campaign for Najd with a Snapchat channel, owned by Sara (the rule notifies the owner).
    [{ id: campaignId }] = await db<{ id: string }[]>`
      insert into public.campaigns (organization_id, client_id, name, status, start_date, end_date, budget_minor, owner_id)
      values (${ctx!.org}, ${ctx!.client}, ${campaignName}, 'active', current_date - 20, current_date + 20, 5000000, ${ctx!.sara})
      returning id`;
    const [{ id: channelId }] = await db<
      { id: string }[]
    >`insert into public.campaign_channels (organization_id, client_id, campaign_id, platform, name)
      values (${ctx!.org}, ${ctx!.client}, ${campaignId}, 'snapchat', 'Snap') returning id`;

    const page = await (await browser.newContext({ locale: 'en-US' })).newPage();
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3000' }]);
    await login(page, 'sara@ofoq.test');

    // 1. The automation: when campaign numbers are synced (rows > 0) → notify the campaign owner.
    await page.goto('/admin/automations/new');
    await page.getByTestId('automation-name').fill(ruleName);
    await page.getByTestId('automation-trigger').selectOption('metrics.synced');
    await page.getByTestId('add-condition').click();
    await page.getByTestId('condition-field').selectOption('event.rows');
    await page.getByTestId('condition-op').selectOption('gt');
    await page.getByTestId('condition-value').fill('0');
    await page.getByTestId('notify-title').fill(`Fresh numbers: {{campaign.name}}`);
    await page.getByTestId('automation-save').click();
    await page.waitForURL('**/admin/automations/*-*');
    automationId = page.url().split('/').pop()!.split('?')[0]!;

    // 2. Connect the Snapchat sandbox: our consent screen stands in for the platform's.
    await page.goto('/admin/integrations');
    await page.getByTestId('connect-sandbox-snapchat').click();
    await page.waitForURL('**/integrations/sandbox/authorize**');
    await page.getByTestId('sandbox-allow').click();
    await page.waitForURL('**/admin/integrations/*?connected=1');
    await expect(page.getByTestId('connection-health')).toHaveText(/Connected|متصل/);
    const connectionId = new URL(page.url()).pathname.split('/').pop()!;
    const [secret] = await db<
      { n: number }[]
    >`select count(*)::int as n from public.integration_secrets where connection_id = ${connectionId}`;
    expect(secret?.n).toBe(1);

    // 3. Map the ad account to Najd, then the first platform campaign to the campaign's Snapchat channel.
    const account = page.getByTestId('account-row').first();
    await account.getByTestId('account-client').selectOption(ctx!.client);
    await expect(account.getByTestId('account-sync')).toBeChecked();
    await page.getByTestId('tab-campaigns').click();
    const link = page.getByTestId('campaign-link').first();
    await link.getByTestId('campaign-channel').selectOption(channelId!);
    await expect(link.getByTestId('campaign-channel')).toHaveValue(channelId!);

    // 4. Sync now → the run succeeds and writes three days (today and the two before) for the channel.
    await page.getByTestId('tab-sync').click();
    await page.getByTestId('sync-now').click();
    await expect
      .poll(
        async () =>
          (
            await db<
              { status: string }[]
            >`select status from public.integration_sync_runs where connection_id = ${connectionId} order by created_at desc limit 1`
          )[0]?.status,
        { timeout: 60_000 },
      )
      .toBe('succeeded');
    const rows = await db<{ n: number; api: number; spend: number }[]>`
      select count(*)::int as n, count(*) filter (where source = 'api')::int as api, coalesce(sum(spend_minor), 0)::int as spend
      from public.metrics_daily where campaign_id = ${campaignId}`;
    expect(rows[0]!.n).toBe(3);
    expect(rows[0]!.api).toBe(3);
    expect(rows[0]!.spend).toBeGreaterThan(0);
    await page.reload();
    await page.getByTestId('tab-sync').click();
    await expect(page.getByTestId('sync-run').first()).toContainText(/Succeeded|تمت/);

    // Syncing the same range again changes nothing (idempotent upsert per channel and day).
    await page.getByTestId('sync-now').click();
    await expect
      .poll(
        async () =>
          (
            await db<
              { n: number }[]
            >`select count(*)::int as n from public.integration_sync_runs where connection_id = ${connectionId} and status = 'succeeded'`
          )[0]?.n,
        { timeout: 60_000 },
      )
      .toBe(2);
    const again = await db<{ n: number; spend: number }[]>`
      select count(*)::int as n, coalesce(sum(spend_minor), 0)::int as spend from public.metrics_daily where campaign_id = ${campaignId}`;
    expect(again[0]).toEqual({ n: 3, spend: rows[0]!.spend });

    // 5. The numbers show on the campaign.
    await page.goto(`/campaigns/${campaignId}?tab=metrics`);
    await expect(page.getByText('Snap').first()).toBeVisible();

    // 6. The rule ran on metrics.synced and Sara got its notification.
    await expect
      .poll(
        async () =>
          (
            await db<
              { n: number }[]
            >`select count(*)::int as n from public.automation_runs where automation_id = ${automationId} and status = 'succeeded' and not dry_run`
          )[0]?.n,
        { timeout: 60_000 },
      )
      .toBeGreaterThan(0);
    await page.goto('/notifications');
    await expect(page.getByText(`Fresh numbers: ${campaignName}`).first()).toBeVisible();

    // 7. The run log shows it.
    await page.goto(`/admin/automations/${automationId}?tab=runs`);
    await expect(page.getByTestId('run-row').first()).toContainText(/Succeeded|نجح/);
  } finally {
    if (automationId) await db`delete from public.automations where id = ${automationId}`;
    if (campaignId) await db`delete from public.campaigns where id = ${campaignId}`;
    await db`delete from public.integration_connections where provider = 'snapchat' and mode = 'sandbox'`;
    await db.end();
  }
});
