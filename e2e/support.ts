import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'Passw0rd!';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

export const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
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
