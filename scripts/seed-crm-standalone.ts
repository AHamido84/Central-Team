/**
 * Loads only the Phase 6 demo sales & capacity data (two sales users, the onboarding workflow, CRM settings, a website
 * form, rules, targets, leads, deals, activities, quotes, team hours, time off and service effort) into a database
 * that already has the earlier demo seed (used by `scripts/deploy-db.ts` when a deployment predates Phase 6). Refuses
 * to run unless the demo organization exists and has no leads yet, so it never duplicates data or touches a real
 * agency.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { databaseUrl } from '../src/lib/db/url';
import * as schema from '../src/lib/db/schema';
import { seedCrmData } from './seed-crm';

config({ path: '.env.local' });

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const PASSWORD = 'Passw0rd!';
const existing = ['sara', 'faisal', 'reem', 'khalid', 'lama', 'omar', 'hind'];
const sales = [
  {
    key: 'majed',
    email: 'majed@ofoq.test',
    name: 'ماجد الشهري',
    phone: '+966501110011',
    locale: 'ar',
    role: 'sales_manager',
    lead: true,
    title: 'مدير المبيعات',
  },
  {
    key: 'ruba',
    email: 'ruba@ofoq.test',
    name: 'Ruba Haddad',
    phone: '+966501110012',
    locale: 'en',
    role: 'sales_rep',
    lead: false,
    title: 'Account Executive',
  },
] as const;

async function main() {
  const url = databaseUrl(process.env, 'direct') ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  if (!/127\.0\.0\.1|localhost/.test(url) && process.env.SEED_ALLOW_REMOTE !== '1') {
    throw new Error('Refusing to seed a non-local database. Set SEED_ALLOW_REMOTE=1 to override.');
  }
  const client = postgres(url, { max: 2 });
  try {
    const [org] = await client<{ n: number }[]>`select count(*)::int as n from public.organizations where id = ${ORG_ID} and slug = 'ofoq'`;
    const [leadCount] = await client<{ n: number }[]>`select count(*)::int as n from public.leads where organization_id = ${ORG_ID}`;
    if (!org?.n || (leadCount?.n ?? 0) > 0) {
      process.stdout.write('[seed-crm] demo organization missing or leads already present — nothing to do\n');
      return;
    }
    const db = drizzle(client, { schema });
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const roles = await db.select().from(schema.roles).where(eq(schema.roles.organizationId, ORG_ID));
    const [salesDept] = await client<
      { id: string }[]
    >`select id from public.departments where organization_id = ${ORG_ID} and key = 'sales'`;

    const people = await client<{ email: string; id: string }[]>`
      select email, id from public.profiles where email = any(${[...existing, ...sales.map((s) => s.key)].map((k) => `${k}@ofoq.test`)})`;
    const ids: Record<string, string> = Object.fromEntries(people.map((p) => [p.email.split('@')[0]!, p.id]));

    for (const s of sales) {
      if (ids[s.key]) continue;
      const { data, error } = await supabase.auth.admin.createUser({
        email: s.email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: s.name, locale: s.locale },
      });
      if (error || !data.user) throw new Error(`createUser ${s.email}: ${error?.message}`);
      const id = data.user.id;
      ids[s.key] = id;
      await db
        .update(schema.profiles)
        .set({ fullName: s.name, phone: s.phone, whatsapp: s.phone, locale: s.locale, onboardedAt: new Date() })
        .where(eq(schema.profiles.id, id));
      await db.insert(schema.organizationMembers).values({ organizationId: ORG_ID, userId: id, userType: 'agency', jobTitle: s.title });
      await db.insert(schema.userRoles).values({ organizationId: ORG_ID, userId: id, roleId: roles.find((r) => r.key === s.role)!.id });
      if (salesDept)
        await db
          .insert(schema.departmentMembers)
          .values({ departmentId: salesDept.id, userId: id, organizationId: ORG_ID, isLead: s.lead });
    }

    const clients = await client<{ slug: string; id: string }[]>`select slug, id from public.clients where organization_id = ${ORG_ID}`;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(),
    );
    await seedCrmData({ db, ids, clientIds: Object.fromEntries(clients.map((c) => [c.slug, c.id])), orgId: ORG_ID, today });
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[seed-crm] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
