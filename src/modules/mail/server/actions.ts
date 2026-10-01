'use server';

import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import { dbAdmin } from '@/lib/db/client';
import { emailOutbox, mailSettings } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { emailTranslator, renderActionEmail } from '@/lib/email/send';
import { isLocale, localized, type Locale } from '@/lib/i18n/localized';
import { presetDefaults, type MailErrorCode } from '@/modules/mail/constants';
import { mailSettingsSchema } from '@/modules/mail/schemas';
import { classifyMailError } from '@/modules/mail/server/errors';
import { enqueueEmail, processEmailQueue, scheduleEmailQueue } from '@/modules/mail/server/outbox';
import { providerFromSettings, readMailSecret } from '@/modules/mail/server/sender';

const paths = ['/admin/mail', '/admin/mail/log'];

/** Saves the organization's sender; a typed secret goes to Vault (write-only) and comes back only as a hint. */
export const saveMailSettingsAction = defineAction({
  input: mailSettingsSchema,
  side: 'agency',
  permission: 'mail:manage',
  rateLimit: { key: 'mail_settings', max: 30, windowSeconds: 600 },
  async handler({ input, tx, ctx }) {
    const d = presetDefaults[input.preset];
    const values = {
      preset: input.preset,
      host: d.api ? null : (input.host ?? d.host),
      port: d.api ? null : (input.port ?? d.port),
      security: input.security,
      username: d.api ? null : input.username,
      fromName: { ar: input.fromNameAr || undefined, en: input.fromNameEn || undefined },
      fromEmail: input.fromEmail,
      replyTo: input.replyTo,
      dailyLimit: input.dailyLimit ?? null,
      isActive: input.isActive,
      updatedBy: ctx.session.userId,
    };
    const [existing] = await tx
      .select({ id: mailSettings.id, secretHint: mailSettings.secretHint })
      .from(mailSettings)
      .where(eq(mailSettings.organizationId, ctx.organization.id));
    if (!existing && !input.secret) throw new ActionFailure('validation', { secret: ['required'] });
    let id = existing?.id;
    if (id) await tx.update(mailSettings).set(values).where(eq(mailSettings.id, id));
    else {
      // Raw insert with explicit columns: Drizzle lists every column (defaults included) and users hold insert
      // privileges only on these (no Vault reference, no bookkeeping).
      id = crypto.randomUUID();
      await tx.execute(sql`
        insert into public.mail_settings (id, organization_id, preset, host, port, security, username, from_name, from_email,
          reply_to, daily_limit, is_active, updated_by)
        values (${id}::uuid, ${ctx.organization.id}::uuid, ${values.preset}, ${values.host}, ${values.port}, ${values.security},
          ${values.username}, ${JSON.stringify(values.fromName)}::jsonb, ${values.fromEmail}, ${values.replyTo}, ${values.dailyLimit},
          ${values.isActive}, ${values.updatedBy}::uuid)`);
    }
    if (input.secret) await tx.execute(sql`select app.mail_put_secret(${id}::uuid, ${input.secret})`);
    await emitEvent(tx, {
      type: 'mail.settings_updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'mail_settings', id },
      payload: { preset: input.preset, secretChanged: Boolean(input.secret) },
    });
    return { id };
  },
  revalidate: paths,
});

/** Removes the configured sender: mail goes back to the environment sender. */
export const deleteMailSettingsAction = defineAction({
  input: z.object({}),
  side: 'agency',
  permission: 'mail:manage',
  async handler({ tx, ctx }) {
    const rows = await tx
      .delete(mailSettings)
      .where(eq(mailSettings.organizationId, ctx.organization.id))
      .returning({ id: mailSettings.id });
    if (!rows.length) throw new ActionFailure('not_found');
    return null;
  },
  revalidate: paths,
});

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), ms)),
  ]);

/**
 * "Test connection": SMTP handshake + login (or a Resend API check) without sending anything. Tests what's typed in
 * the form; a blank secret uses the stored one (decrypted on the service path after the RLS-checked lookup).
 */
export const testMailConnectionAction = defineAction({
  input: mailSettingsSchema,
  side: 'agency',
  permission: 'mail:manage',
  rateLimit: { key: 'mail_test', max: 20, windowSeconds: 600 },
  async handler({ input, tx, ctx }) {
    const [row] = await tx.select({ id: mailSettings.id }).from(mailSettings).where(eq(mailSettings.organizationId, ctx.organization.id));
    if (!input.secret && !row) throw new ActionFailure('validation', { secret: ['required'] });
    return { input, settingsId: row?.id ?? null };
  },
  async complete({ prepared }) {
    const { input, settingsId } = prepared;
    const secret = input.secret ?? (settingsId ? await readMailSecret(settingsId) : null);
    const provider = providerFromSettings(
      {
        preset: input.preset,
        host: input.host,
        port: input.port ?? null,
        security: input.security,
        username: input.username,
        fromEmail: input.fromEmail,
      },
      secret,
    );
    let code: MailErrorCode | null = null;
    let detail: string | null = null;
    try {
      await withTimeout(provider.verify?.() ?? Promise.resolve(), 20_000);
    } catch (error) {
      code = classifyMailError(error);
      detail = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    }
    // Test results are bookkeeping on the saved sender (service path after the RLS check above).
    if (settingsId && !input.secret)
      await dbAdmin
        .update(mailSettings)
        .set({ lastTestedAt: new Date(), lastTestOk: code === null, lastTestError: code })
        .where(eq(mailSettings.id, settingsId));
    return { ok: code === null, code, detail };
  },
  revalidate: paths,
});

/** "Send test email": the real branded template, through the same queue and sender as every other email. */
export const sendTestEmailAction = defineAction({
  input: z.object({ to: z.email({ message: 'invalid_email' }).trim().toLowerCase().max(254) }),
  side: 'agency',
  permission: 'mail:manage',
  rateLimit: { key: 'mail_test_send', max: 10, windowSeconds: 600 },
  async handler({ ctx }) {
    return { locale: (isLocale(ctx.profile.locale) ? ctx.profile.locale : 'ar') as Locale };
  },
  async complete({ input, prepared, ctx }) {
    const t = await emailTranslator(prepared.locale);
    const brand = localized(ctx.organization.name, prepared.locale);
    const subject = t('testSubject', { brand });
    const { html, text } = await renderActionEmail({
      locale: prepared.locale,
      brand: { name: ctx.organization.name, primaryColor: ctx.organization.brand.primaryColor },
      subject,
      content: {
        heading: t('testHeading'),
        paragraphs: [
          t('testBody', {
            sender: ctx.organization.name ? brand : 'Central',
            time: new Intl.DateTimeFormat(prepared.locale === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: 'Asia/Riyadh',
            }).format(new Date()),
          }),
        ],
        cta: { label: t('testCta'), href: `${process.env.NEXT_PUBLIC_APP_URL}/admin/mail` },
      },
    });
    const id = await enqueueEmail(
      {
        organizationId: ctx.organization.id,
        kind: 'test',
        to: input.to,
        locale: prepared.locale,
        subject,
        html,
        text,
        createdBy: ctx.session.userId,
      },
      { deliver: 'none' },
    );
    // Deliver now so the admin sees the outcome.
    await processEmailQueue({ ids: [id] });
    const [row] = await dbAdmin
      .select({ status: emailOutbox.status, errorCode: emailOutbox.errorCode, sender: emailOutbox.sender })
      .from(emailOutbox)
      .where(eq(emailOutbox.id, id));
    return { id, status: row?.status ?? 'queued', code: (row?.errorCode ?? null) as MailErrorCode | null, sender: row?.sender ?? null };
  },
  revalidate: paths,
});

/** Resends a logged email as a new message. Sign-in links aren't kept, so those can't be resent (ask for a new link). */
export const resendEmailAction = defineAction({
  input: z.object({ id: z.uuid() }),
  side: 'agency',
  permission: 'mail:manage',
  rateLimit: { key: 'mail_resend', max: 30, windowSeconds: 600 },
  async handler({ input, tx }) {
    const [row] = await tx
      .select({ id: emailOutbox.id, sensitive: emailOutbox.sensitive, status: emailOutbox.status })
      .from(emailOutbox)
      .where(eq(emailOutbox.id, input.id));
    if (!row) throw new ActionFailure('not_found');
    if (row.sensitive) throw new ActionFailure('email_not_resendable');
    return row.id;
  },
  async complete({ prepared, ctx }) {
    // Service path after the RLS-checked lookup above: the body isn't readable by users.
    const [src] = await dbAdmin.select().from(emailOutbox).where(eq(emailOutbox.id, prepared));
    if (!src?.html) throw new ActionFailure('email_not_resendable');
    const id = await enqueueEmail({
      organizationId: src.organizationId,
      kind: src.kind as Parameters<typeof enqueueEmail>[0]['kind'],
      to: src.toEmail,
      userId: src.userId,
      locale: isLocale(src.locale) ? src.locale : 'ar',
      subject: src.subject,
      html: src.html,
      text: src.text ?? '',
      replyTo: src.replyTo,
      tags: src.tags,
      createdBy: ctx.session.userId,
      resentFrom: src.id,
    });
    scheduleEmailQueue([id]);
    return { id };
  },
  revalidate: paths,
});
