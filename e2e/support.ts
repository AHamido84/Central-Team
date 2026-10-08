import { expect, type Page } from '@playwright/test';
import postgres from 'postgres';

export const PASSWORD = 'Passw0rd!';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

export const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Signs in. The suite signs the same personas in many times, and the app allows 10 sign-ins per email per 15 minutes
 * (gotcha 20): clear that one counter first so the run's speed doesn't decide whether a test can log in. The limit
 * itself is covered by `tests/unit` and stays on for everything else.
 */
export async function login(page: Page, email: string, password = PASSWORD) {
  const db = postgres(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1 });
  try {
    await db`delete from public.rate_limits where key = ${`login:email:${email.toLowerCase()}`}`;
  } finally {
    await db.end();
  }
  // In dev a cold route can hydrate after the fields were filled and clear them: try again from a fresh page.
  for (let attempt = 1; ; attempt++) {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill(password);
    await page.getByTestId('login-submit').click();
    try {
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: attempt < 3 ? 25_000 : 60_000 });
      return;
    } catch (error) {
      if (attempt >= 3) throw error;
    }
  }
}

type MailpitMessage = { ID: string; Subject: string; To: { Address: string }[]; Created: string };

/** Polls Mailpit for the newest message to `to` whose subject matches, then returns its HTML. */
export async function waitForEmail(
  to: string,
  subject?: RegExp,
  since = new Date(Date.now() - 60_000),
): Promise<{ subject: string; html: string; text: string }> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=20`);
    if (res.ok) {
      const data = (await res.json()) as { messages: MailpitMessage[] };
      const match = data.messages.find((m) => new Date(m.Created) >= since && (!subject || subject.test(m.Subject)));
      if (match) {
        const full = (await (await fetch(`${MAILPIT}/api/v1/message/${match.ID}`)).json()) as {
          HTML: string;
          Text: string;
          Subject: string;
        };
        return { subject: full.Subject, html: full.HTML, text: full.Text };
      }
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`No email to ${to} matching ${subject} within 30s`);
}

export function linkFrom(html: string, pattern: RegExp): string {
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
  const link = hrefs.find((h) => pattern.test(h));
  if (!link) throw new Error(`No link matching ${pattern} in email`);
  return link;
}

export async function completeOnboarding(page: Page, name: string) {
  await page.waitForURL('**/onboarding');
  await page.getByTestId('onboarding-name').fill(name);
  await page.getByTestId('onboarding-phone').fill('0551234567');
  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('onboarding-next').click(); // skip photo
  await page.getByTestId('onboarding-next').click(); // finish with default language/theme
}

export async function expectDir(page: Page, dir: 'rtl' | 'ltr', lang: 'ar' | 'en') {
  await expect(page.locator('html')).toHaveAttribute('dir', dir);
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
}
