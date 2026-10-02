/**
 * Phase 3 seed: workflow templates for every request type, the converted requests' task chains with deliverables
 * at every review stage (internal review, changes, client review, approved — with annotations and revision rounds),
 * a few hundred everyday tasks for realistic boards, time entries and saved views. Runs as the table owner, so
 * triggers treat every write as a trusted system change and keep the historical timestamps given here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import * as schema from '../src/lib/db/schema';
import { generateWorkflow } from '../src/modules/workflows/generate';
import { artworkPng, simplePdf } from './seed-assets';

type Db = PostgresJsDatabase<typeof schema>;
type ClientLite = {
  slug: string;
  am: string;
  team: string[];
  colors: [string, string, string];
  users: { key: string; canApprove: boolean }[];
};

const L = (ar: string, en: string) => ({ ar, en });

type StepSeed = {
  key: string;
  name: { ar: string; en: string };
  dept: string | null;
  mode: 'account_manager' | 'role' | 'none';
  sla: number;
  after?: string[];
  review?: boolean;
  approval?: boolean;
  deliverable?: 'design' | 'video' | 'copy' | 'document' | 'other';
};

const copy: StepSeed = {
  key: 'copy',
  name: L('كتابة المحتوى', 'Copywriting'),
  dept: 'content',
  mode: 'role',
  sla: 1,
  review: true,
  deliverable: 'copy',
};
const schedule = (after: string[]): StepSeed => ({
  key: 'schedule',
  name: L('الجدولة والنشر', 'Scheduling'),
  dept: 'account_management',
  mode: 'account_manager',
  sla: 1,
  after,
});

const templates: { type: string; name: { ar: string; en: string }; steps: StepSeed[] }[] = [
  {
    type: 'social-post',
    name: L('منشور سوشيال', 'Social post'),
    steps: [
      copy,
      {
        key: 'design',
        name: L('التصميم', 'Design'),
        dept: 'design',
        mode: 'role',
        sla: 2,
        after: ['copy'],
        review: true,
        approval: true,
        deliverable: 'design',
      },
      schedule(['design']),
    ],
  },
  {
    type: 'carousel',
    name: L('كاروسيل', 'Carousel'),
    steps: [
      copy,
      {
        key: 'design',
        name: L('تصميم الشرائح', 'Slide design'),
        dept: 'design',
        mode: 'role',
        sla: 3,
        after: ['copy'],
        review: true,
        approval: true,
        deliverable: 'design',
      },
      schedule(['design']),
    ],
  },
  {
    type: 'reel-video',
    name: L('ريلز / فيديو', 'Reel / video'),
    steps: [
      { key: 'script', name: L('السيناريو', 'Script'), dept: 'content', mode: 'role', sla: 1, review: true, deliverable: 'copy' },
      { key: 'shoot', name: L('التصوير', 'Shooting'), dept: 'video', mode: 'role', sla: 2, after: ['script'] },
      {
        key: 'edit',
        name: L('المونتاج', 'Editing'),
        dept: 'video',
        mode: 'role',
        sla: 3,
        after: ['shoot'],
        review: true,
        approval: true,
        deliverable: 'video',
      },
      schedule(['edit']),
    ],
  },
  {
    type: 'story',
    name: L('ستوري', 'Story'),
    steps: [
      {
        key: 'design',
        name: L('تصميم الستوري', 'Story design'),
        dept: 'design',
        mode: 'role',
        sla: 1,
        review: true,
        approval: true,
        deliverable: 'design',
      },
      schedule(['design']),
    ],
  },
  {
    type: 'ad-campaign',
    name: L('حملة إعلانية', 'Ad campaign'),
    steps: [
      {
        key: 'plan',
        name: L('الخطة والجمهور', 'Plan & audience'),
        dept: 'media_buying',
        mode: 'role',
        sla: 2,
        approval: true,
        deliverable: 'document',
      },
      {
        key: 'creatives',
        name: L('التصاميم الإعلانية', 'Ad creatives'),
        dept: 'design',
        mode: 'role',
        sla: 3,
        after: ['plan'],
        review: true,
        approval: true,
        deliverable: 'design',
      },
      {
        key: 'launch',
        name: L('الإطلاق والمتابعة', 'Launch & monitoring'),
        dept: 'media_buying',
        mode: 'role',
        sla: 1,
        after: ['creatives'],
      },
    ],
  },
  {
    type: 'photoshoot',
    name: L('جلسة تصوير', 'Photoshoot'),
    steps: [
      { key: 'plan', name: L('التخطيط', 'Planning'), dept: 'account_management', mode: 'account_manager', sla: 1 },
      { key: 'shoot', name: L('التصوير', 'Shoot day'), dept: 'video', mode: 'role', sla: 1, after: ['plan'] },
      {
        key: 'retouch',
        name: L('المعالجة والتحرير', 'Retouching'),
        dept: 'design',
        mode: 'role',
        sla: 2,
        after: ['shoot'],
        review: true,
        approval: true,
        deliverable: 'design',
      },
    ],
  },
  {
    type: 'website-change',
    name: L('تعديل على الموقع', 'Website change'),
    steps: [
      {
        key: 'build',
        name: L('التنفيذ', 'Implementation'),
        dept: 'design',
        mode: 'role',
        sla: 2,
        review: true,
        approval: true,
        deliverable: 'other',
      },
      {
        key: 'qa',
        name: L('المراجعة والنشر', 'QA & publish'),
        dept: 'account_management',
        mode: 'account_manager',
        sla: 1,
        after: ['build'],
      },
    ],
  },
  {
    type: 'branding',
    name: L('هوية بصرية', 'Branding'),
    steps: [
      {
        key: 'discovery',
        name: L('الاكتشاف', 'Discovery'),
        dept: 'account_management',
        mode: 'account_manager',
        sla: 2,
        approval: true,
        deliverable: 'document',
      },
      {
        key: 'concepts',
        name: L('المفاهيم', 'Concepts'),
        dept: 'design',
        mode: 'role',
        sla: 5,
        after: ['discovery'],
        review: true,
        approval: true,
        deliverable: 'design',
      },
      {
        key: 'guide',
        name: L('دليل الهوية', 'Brand guidelines'),
        dept: 'design',
        mode: 'role',
        sla: 3,
        after: ['concepts'],
        review: true,
        approval: true,
        deliverable: 'document',
      },
    ],
  },
  {
    type: 'other',
    name: L('طلب آخر', 'Other'),
    steps: [
      {
        key: 'do',
        name: L('التنفيذ', 'Production'),
        dept: null,
        mode: 'account_manager',
        sla: 3,
        review: true,
        approval: true,
        deliverable: 'other',
      },
    ],
  },
];

/** Deterministic pseudo-random numbers so every reset looks the same. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const everyday: { ar: string; tags: string[]; dept: string }[] = [
  { ar: 'تحديث تقويم المحتوى الشهري', tags: ['content-calendar'], dept: 'content' },
  { ar: 'تجهيز تقرير أداء الأسبوع', tags: ['report'], dept: 'media_buying' },
  { ar: 'الرد على تعليقات إنستغرام', tags: ['community'], dept: 'content' },
  { ar: 'تصميم غلاف هايلايت', tags: ['instagram'], dept: 'design' },
  { ar: 'مراجعة ميزانية الإعلانات', tags: ['ads', 'budget'], dept: 'media_buying' },
  { ar: 'كتابة تعليقات المنشورات القادمة', tags: ['captions'], dept: 'content' },
  { ar: 'تحسين صور المنتجات للموقع', tags: ['website'], dept: 'design' },
  { ar: 'إعداد قائمة الهاشتاقات', tags: ['research'], dept: 'content' },
  { ar: 'مونتاج مقطع قصير للتيك توك', tags: ['tiktok'], dept: 'video' },
  { ar: 'اجتماع متابعة مع العميل', tags: ['meeting'], dept: 'account_management' },
  { ar: 'تحليل منافسين', tags: ['research'], dept: 'media_buying' },
  { ar: 'تجهيز ملفات الطباعة', tags: ['print'], dept: 'design' },
  { ar: 'اختبار نسخ إعلانية A/B', tags: ['ads'], dept: 'media_buying' },
  { ar: 'تصوير منتجات جديدة', tags: ['photo'], dept: 'video' },
  { ar: 'تحديث البايو والروابط', tags: ['profile'], dept: 'content' },
];

export async function seedTasksData(opts: {
  db: Db;
  ids: Record<string, string>;
  clientIds: Record<string, string>;
  orgId: string;
  clients: ClientLite[];
  upload: (path: string, body: Buffer, contentType: string) => Promise<void>;
}) {
  const { db, ids, orgId } = opts;
  const rand = rng(20260929);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
  const now = Date.now();
  const day = (offset: number) => new Date(now + offset * 86400000).toISOString().slice(0, 10);
  const at = (hoursAgo: number) => new Date(now - hoursAgo * 3600000);

  const roles = await db.select().from(schema.roles).where(eq(schema.roles.organizationId, orgId));
  const roleId = (key: string) => roles.find((r) => r.key === key)!.id;
  const depts = await db.select().from(schema.departments).where(eq(schema.departments.organizationId, orgId));
  const deptId = (key: string | null) => (key ? depts.find((d) => d.key === key)!.id : null);
  const statuses = await db
    .select()
    .from(schema.taskStatuses)
    .where(eq(schema.taskStatuses.organizationId, orgId))
    .orderBy(asc(schema.taskStatuses.sortOrder));
  const statusFor = (category: string) => statuses.find((s) => s.category === category)!.id;
  const types = await db.select().from(schema.requestTypes).where(eq(schema.requestTypes.organizationId, orgId));
  const video = readFileSync(path.resolve(__dirname, 'assets/sample-reel.webm'));

  // --- Workflow templates ------------------------------------------------------
  const templateIds: Record<string, string> = {};
  for (const tpl of templates) {
    const type = types.find((t) => t.key === tpl.type)!;
    const [row] = await db
      .insert(schema.workflowTemplates)
      .values({
        organizationId: orgId,
        requestTypeId: type.id,
        name: tpl.name,
        description: L('المسار الافتراضي لهذا النوع من الطلبات.', 'The default workflow for this request type.'),
        isActive: true,
        isDefault: true,
        createdBy: ids.reem!,
      })
      .returning({ id: schema.workflowTemplates.id });
    templateIds[tpl.type] = row!.id;
    const stepIds = Object.fromEntries(tpl.steps.map((s) => [s.key, crypto.randomUUID()]));
    await db.insert(schema.workflowTemplateSteps).values(
      tpl.steps.map((s, i) => ({
        id: stepIds[s.key]!,
        organizationId: orgId,
        templateId: row!.id,
        name: s.name,
        departmentId: deptId(s.dept),
        assigneeMode: s.mode,
        assigneeRoleId: s.mode === 'role' ? roleId('specialist') : null,
        slaDays: s.sla,
        dependsOn: (s.after ?? []).map((a) => stepIds[a]!),
        requiresInternalReview: Boolean(s.review),
        requiresClientApproval: Boolean(s.approval),
        deliverableType: s.deliverable ?? null,
        sortOrder: i,
      })),
    );
  }

  // --- Deliverable history helpers ---------------------------------------------------
  let clock = 0;
  const tick = () => at(Math.max(1, 30 * 24 - clock++ * 3));
  const versionTimes = new Map<string, { submittedAt?: Date; sentToClientAt?: Date; decidedAt?: Date }>();

  async function uploadVersion(d: typeof schema.deliverables.$inferSelect, colors: [string, string, string], number: number, by: string) {
    const [v] = await db
      .insert(schema.deliverableVersions)
      .values({
        organizationId: orgId,
        clientId: d.clientId,
        deliverableId: d.id,
        status: 'draft',
        notes: number === 1 ? 'النسخة الأولى حسب الموجز.' : 'عدّلنا حسب ملاحظاتكم.',
        uploadedBy: by,
        createdAt: tick(),
      })
      .returning();
    const fileId = crypto.randomUUID();
    const isVideo = d.type === 'video';
    const isDoc = d.type === 'document' || d.type === 'other';
    const name = isVideo ? `reel-v${number}.webm` : isDoc ? `${d.type}-v${number}.pdf` : `design-v${number}.png`;
    const storagePath = `org/${orgId}/clients/${d.clientId}/deliverables/${d.id}/${fileId}-${name}`;
    const body = isVideo
      ? video
      : isDoc
        ? simplePdf(d.title, ['Central · سنترال', `v${number}`, 'Summary and next steps.'])
        : artworkPng(1080, 1350, number === 1 ? colors[0] : colors[1], number === 1 ? colors[1] : colors[0], colors[2]);
    const mimeType = isVideo ? 'video/webm' : isDoc ? 'application/pdf' : 'image/png';
    if (d.type !== 'copy') {
      await opts.upload(storagePath, body, mimeType);
      // Videos get a poster frame, like the browser makes for real uploads.
      const thumbPath = isVideo ? `org/${orgId}/clients/${d.clientId}/deliverables/${d.id}/${fileId}-thumb.png` : null;
      if (thumbPath) await opts.upload(thumbPath, artworkPng(360, 640, colors[0], colors[1], colors[2]), 'image/png');
      await db.insert(schema.files).values({
        id: fileId,
        organizationId: orgId,
        clientId: d.clientId,
        name,
        storagePath,
        mimeType,
        sizeBytes: body.length,
        kind: isVideo ? 'video' : isDoc ? 'pdf' : 'image',
        visibility: 'internal',
        source: 'deliverable',
        uploadedBy: by,
        uploaderSide: 'agency',
        width: isVideo ? 360 : isDoc ? null : 1080,
        height: isVideo ? 640 : isDoc ? null : 1350,
        durationSeconds: isVideo ? 6 : null,
        thumbnailPath: thumbPath,
      });
      await db.insert(schema.deliverableVersionFiles).values({ versionId: v!.id, fileId, organizationId: orgId, clientId: d.clientId });
    } else {
      await db
        .update(schema.deliverableVersions)
        .set({ notes: 'يسعدنا نقدّم لكم عرض الأسبوع ☕️\nخصم ٢٠٪ على كل المشروبات المختصة حتى الخميس.\n#نجد_الأصيلة' })
        .where(eq(schema.deliverableVersions.id, v!.id));
    }
    return { version: v!, fileId: d.type === 'copy' ? null : fileId, kind: isVideo ? 'video' : isDoc ? 'pdf' : 'image' };
  }

  async function submit(d: typeof schema.deliverables.$inferSelect, versionId: string) {
    const status = d.requiresInternalReview ? 'internal_review' : d.requiresClientApproval ? 'client_review' : 'approved';
    const t = tick();
    versionTimes.set(versionId, {
      submittedAt: t,
      ...(status === 'client_review' ? { sentToClientAt: t } : {}),
      ...(status === 'approved' ? { decidedAt: t } : {}),
    });
    await db.update(schema.deliverableVersions).set({ status }).where(eq(schema.deliverableVersions.id, versionId));
  }

  async function decide(
    d: typeof schema.deliverables.$inferSelect,
    versionId: string,
    stage: 'internal' | 'client',
    decision: 'approved' | 'changes_requested',
    reviewer: string,
    comment = '',
  ) {
    const t = tick();
    await db.insert(schema.approvals).values({
      organizationId: orgId,
      clientId: d.clientId,
      deliverableId: d.id,
      versionId,
      stage,
      decision,
      reviewerId: reviewer,
      comment,
      createdAt: t,
    });
    const times = versionTimes.get(versionId) ?? {};
    if (stage === 'internal' && decision === 'approved' && d.requiresClientApproval) times.sentToClientAt = t;
    else times.decidedAt = t;
    versionTimes.set(versionId, times);
  }

  async function annotate(
    d: typeof schema.deliverables.$inferSelect,
    v: { version: { id: string }; fileId: string | null; kind: string },
    author: string,
    side: 'agency' | 'client',
    visibility: 'internal' | 'client',
    body: string,
    where: { x?: number; y?: number; t?: number },
    reply?: { by: string; side: 'agency' | 'client'; body: string },
    resolved = false,
  ) {
    const kind =
      v.fileId && v.kind === 'image' && where.x !== undefined
        ? 'point'
        : v.fileId && v.kind === 'video' && where.t !== undefined
          ? 'timestamp'
          : 'general';
    const [a] = await db
      .insert(schema.annotations)
      .values({
        organizationId: orgId,
        clientId: d.clientId,
        deliverableId: d.id,
        versionId: v.version.id,
        fileId: kind === 'general' ? null : v.fileId,
        kind,
        x: kind === 'point' ? where.x! : null,
        y: kind === 'point' ? where.y! : null,
        timeSeconds: kind === 'timestamp' ? where.t! : null,
        body,
        visibility,
        authorId: author,
        authorSide: side,
        resolvedAt: resolved ? tick() : null,
        resolvedBy: resolved ? ids.khalid! : null,
        createdAt: tick(),
      })
      .returning({ id: schema.annotations.id });
    if (reply) {
      await db.insert(schema.annotationReplies).values({
        organizationId: orgId,
        clientId: d.clientId,
        annotationId: a!.id,
        body: reply.body,
        authorId: reply.by,
        authorSide: reply.side,
        createdAt: tick(),
      });
    }
  }

  type Stage = 'working' | 'internal_review' | 'internal_changes' | 'client_review' | 'client_changes' | 'approved';

  /** Plays a deliverable's review history up to `stage` (with a client revision round on the way for `rich` ones). */
  async function playDeliverable(d: typeof schema.deliverables.$inferSelect, c: ClientLite, stage: Stage, rich: boolean) {
    if (stage === 'working') return;
    const designer = ids[c.team[0]!]!;
    const lead = ids.reem!;
    const approver = ids[c.users.find((u) => u.canApprove)!.key]!;
    let v = await uploadVersion(d, c.colors, 1, designer);
    await submit(d, v.version.id);
    if (d.requiresInternalReview) {
      if (stage === 'internal_review') return;
      await annotate(
        d,
        v,
        lead,
        'agency',
        'internal',
        'كبّروا الشعار قليلًا وابعدوه عن الحافة.',
        { x: 0.82, y: 0.12, t: 1.5 },
        { by: designer, side: 'agency', body: 'تم، شكرًا!' },
        true,
      );
      if (stage === 'internal_changes') {
        await decide(d, v.version.id, 'internal', 'changes_requested', lead, 'الألوان باهتة قليلًا — ارفعوا التباين.');
        return;
      }
      await decide(d, v.version.id, 'internal', 'approved', lead);
    }
    if (!d.requiresClientApproval) return;
    if (stage === 'client_review') {
      if (rich) await annotate(d, v, ids[c.am]!, 'agency', 'client', 'هذه النسخة الأولى — ننتظر ملاحظاتكم.', {});
      return;
    }
    if (rich || stage === 'client_changes') {
      await annotate(
        d,
        v,
        approver,
        'client',
        'client',
        'ممكن نغيّر لون الخلفية لدرجة أفتح؟',
        { x: 0.35, y: 0.55, t: 3 },
        { by: ids[c.am]!, side: 'agency', body: 'أكيد، بنعدّلها في النسخة الثانية.' },
      );
      await annotate(d, v, approver, 'client', 'client', 'النص أسفل التصميم صغير على الجوال.', { x: 0.5, y: 0.88, t: 4.5 });
      await decide(d, v.version.id, 'client', 'changes_requested', approver, 'نحتاج خلفية أفتح ونص أكبر في الأسفل.');
      if (stage === 'client_changes') return;
      v = await uploadVersion(d, c.colors, 2, designer);
      await submit(d, v.version.id);
      if (d.requiresInternalReview) await decide(d, v.version.id, 'internal', 'approved', lead);
    }
    await decide(d, v.version.id, 'client', 'approved', approver, 'ممتاز، معتمد 👍');
  }

  // --- Convert the requests the agency is working on -------------------------------------
  const converted = await db
    .select()
    .from(schema.requests)
    .where(
      and(eq(schema.requests.organizationId, orgId), inArray(schema.requests.status, ['in_progress', 'in_review', 'delivered', 'closed'])),
    )
    .orderBy(asc(schema.requests.submittedAt));
  let convertedCount = 0;
  let deliverableCount = 0;
  for (const [ri, r] of converted.entries()) {
    const c = opts.clients.find((x) => opts.clientIds[x.slug] === r.clientId)!;
    const type = types.find((t) => t.id === r.requestTypeId)!;
    const templateId = templateIds[type.key];
    if (!templateId) continue;
    const start = (r.acceptedAt ?? r.submittedAt ?? new Date()).toISOString().slice(0, 10);
    const generated = await db.transaction((tx) =>
      generateWorkflow(tx, {
        organizationId: orgId,
        locale: 'ar',
        request: { id: r.id, clientId: r.clientId, title: r.title, priority: r.priority },
        templateId,
        start,
        createdBy: ids[c.am]!,
      }),
    );
    await db
      .update(schema.requests)
      .set({ convertedAt: r.acceptedAt ?? r.submittedAt })
      .where(eq(schema.requests.id, r.id));
    convertedCount++;

    const chain = await db.select().from(schema.tasks).where(eq(schema.tasks.requestId, r.id)).orderBy(asc(schema.tasks.stepOrder));
    const finished = r.status === 'delivered' || r.status === 'closed';
    // Where the work is: delivered → every step done; in review → the client is looking at the main deliverable.
    const producing = chain.filter((t) => t.requiresClientApproval);
    const focus = finished ? chain.length : chain.indexOf(producing[producing.length - 1] ?? chain[chain.length - 1]!);
    // Najd (the demo client) always has something waiting for approval in the portal.
    const currentStage: Stage =
      r.status === 'in_review' || c.slug === 'najd-heritage'
        ? 'client_review'
        : (['working', 'internal_review', 'internal_changes', 'client_changes'] as const)[ri % 4]!;
    for (const [i, t] of chain.entries()) {
      const [d] = await db.select().from(schema.deliverables).where(eq(schema.deliverables.taskId, t.id));
      if (d) {
        deliverableCount++;
        const stage: Stage = i < focus ? 'approved' : i === focus ? currentStage : 'working';
        // Steps without client approval are fully reviewed internally once they're behind us.
        await playDeliverable(d, c, stage, i === focus || (finished && ri % 2 === 0));
        if (finished && d.requiresClientApproval) {
          await db
            .update(schema.deliverables)
            .set({ scheduledFor: day(-Math.floor(rand() * 20)) })
            .where(eq(schema.deliverables.id, d.id));
        }
      }
      const [fresh] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, t.id));
      if (i < focus && fresh!.statusCategory !== 'done') {
        await db
          .update(schema.tasks)
          .set({ statusId: statusFor('done'), completedAt: at((chain.length - i) * 20) })
          .where(eq(schema.tasks.id, t.id));
      } else if (i === focus && !d && fresh!.statusCategory === 'todo') {
        await db
          .update(schema.tasks)
          .set({ statusId: statusFor('active') })
          .where(eq(schema.tasks.id, t.id));
      } else if (i === focus && d && currentStage === 'working') {
        await db
          .update(schema.tasks)
          .set({ statusId: statusFor('active') })
          .where(eq(schema.tasks.id, t.id));
      }
    }
    // Upcoming client approvals get a planned publishing date for the content calendar.
    for (const d of await db
      .select()
      .from(schema.deliverables)
      .where(and(eq(schema.deliverables.requestId, r.id), eq(schema.deliverables.status, 'client_review')))) {
      await db
        .update(schema.deliverables)
        .set({ scheduledFor: day(3 + (ri % 7)) })
        .where(eq(schema.deliverables.id, d.id));
    }
    // Checklist on the focus task, and a watcher.
    const focusTask = chain[Math.min(focus, chain.length - 1)]!;
    await db.insert(schema.taskChecklistItems).values(
      ['مراجعة الموجز', 'تجهيز المسودة', 'التأكد من المقاسات'].map((body, k) => ({
        taskId: focusTask.id,
        organizationId: orgId,
        clientId: r.clientId,
        body,
        isDone: finished || k === 0,
        sortOrder: k + 1,
      })),
    );
    await db
      .insert(schema.taskMembers)
      .values({ taskId: focusTask.id, userId: ids.reem!, role: 'watcher', organizationId: orgId, clientId: r.clientId })
      .onConflictDoNothing();
    void generated;
  }

  // Historical timestamps for the review history played above (the triggers stamped "now").
  for (const [versionId, t] of versionTimes) {
    await db
      .update(schema.deliverableVersions)
      .set({ submittedAt: t.submittedAt ?? null, sentToClientAt: t.sentToClientAt ?? null, decidedAt: t.decidedAt ?? null })
      .where(eq(schema.deliverableVersions.id, versionId));
  }
  await db.execute(sql`
    update public.deliverables d set
      client_visible_at = (select min(v.sent_to_client_at) from public.deliverable_versions v where v.deliverable_id = d.id),
      approved_at = case when d.status = 'approved' then (select max(v.decided_at) from public.deliverable_versions v where v.deliverable_id = d.id) end
    where d.organization_id = ${orgId}`);

  // --- Everyday tasks (hundreds, for realistic boards) ------------------------------------
  const categories = ['todo', 'todo', 'active', 'active', 'review', 'changes', 'blocked', 'done', 'done', 'done'] as const;
  const priorities = ['low', 'normal', 'normal', 'normal', 'high', 'urgent'] as const;
  const staffKeys = ['noura', 'abdulrahman', 'reem', 'khalid', 'lama', 'omar', 'hind', 'turki'];
  const everydayIds: { id: string; clientId: string; category: string }[] = [];
  for (let i = 0; i < 260; i++) {
    const c = opts.clients[i % opts.clients.length]!;
    const clientId = opts.clientIds[c.slug]!;
    const base = pick(everyday);
    const category = pick(categories);
    const due = Math.round(rand() * 40 - 12);
    const id = crypto.randomUUID();
    const assignee = ids[rand() < 0.7 ? pick(c.team) : pick(staffKeys)]!;
    const created = at(24 * (20 + Math.floor(rand() * 20)));
    await db.insert(schema.tasks).values({
      id,
      organizationId: orgId,
      clientId,
      title: `${base.ar} · ${i + 1}`,
      description: rand() < 0.4 ? 'تفاصيل سريعة:\n- راجع آخر تقرير\n- نسّق مع مدير الحساب' : '',
      departmentId: deptId(base.dept),
      statusId: statusFor(category),
      priority: pick(priorities),
      startDate: rand() < 0.3 ? day(due - 3) : null,
      dueDate: rand() < 0.9 ? day(due) : null,
      estimateMinutes: rand() < 0.5 ? pick([30, 60, 90, 120, 240]) : null,
      tags: base.tags,
      reviewerId: category === 'review' ? ids[c.am]! : null,
      position: i + 1,
      completedAt: category === 'done' ? at(24 * Math.floor(rand() * 20)) : null,
      createdBy: ids[c.am]!,
      createdAt: created,
      updatedAt: created,
    });
    await db.insert(schema.taskMembers).values({ taskId: id, userId: assignee, role: 'assignee', organizationId: orgId, clientId });
    everydayIds.push({ id, clientId, category });
  }
  // A few subtasks, dependencies and running history.
  for (let i = 0; i < 30; i++) {
    const parent = everydayIds[i * 3]!;
    await db.insert(schema.tasks).values({
      organizationId: orgId,
      clientId: parent.clientId,
      parentId: parent.id,
      title: pick(['تجهيز المسودة', 'مراجعة لغوية', 'رفع الملفات النهائية']),
      statusId: statusFor(rand() < 0.5 ? 'done' : 'todo'),
      createdBy: ids.noura!,
    });
  }
  for (let i = 0; i < 20; i++) {
    const a = everydayIds[i * 5]!;
    const b = everydayIds.find((x, k) => k > i * 5 && x.clientId === a.clientId && x.category !== 'done');
    if (b) {
      await db
        .insert(schema.taskDependencies)
        .values({ taskId: b.id, dependsOnId: a.id, organizationId: orgId, clientId: a.clientId })
        .onConflictDoNothing();
    }
  }
  const timed = await db
    .select({ id: schema.tasks.id, clientId: schema.tasks.clientId, userId: schema.taskMembers.userId })
    .from(schema.tasks)
    .innerJoin(schema.taskMembers, and(eq(schema.taskMembers.taskId, schema.tasks.id), eq(schema.taskMembers.role, 'assignee')))
    .where(and(eq(schema.tasks.organizationId, orgId), isNotNull(schema.tasks.requestId)))
    .limit(40);
  for (const [i, t] of timed.entries()) {
    const started = at(24 * (i % 10) + 5);
    const minutes = 20 + ((i * 37) % 160);
    await db.insert(schema.timeEntries).values({
      organizationId: orgId,
      clientId: t.clientId,
      taskId: t.id,
      userId: t.userId,
      startedAt: started,
      endedAt: new Date(started.getTime() + minutes * 60000),
      minutes,
      source: i % 3 === 0 ? 'manual' : 'timer',
      note: i % 3 === 0 ? 'اجتماع مراجعة' : '',
    });
  }

  // --- Saved views ---------------------------------------------------------------------
  await db.insert(schema.savedViews).values([
    {
      organizationId: orgId,
      ownerId: ids.reem!,
      isShared: true,
      name: 'فريق التصميم',
      layout: 'board',
      config: { departmentIds: [deptId('design')!], swimlane: 'assignee' },
    },
    {
      organizationId: orgId,
      ownerId: ids.noura!,
      isShared: true,
      name: 'المتأخرة',
      layout: 'table',
      config: { due: 'overdue', sort: 'due', sortDir: 'asc' },
    },
    {
      organizationId: orgId,
      ownerId: ids.khalid!,
      isShared: false,
      name: 'عملي على نجد',
      layout: 'list',
      config: { mine: true, clientIds: [opts.clientIds['najd-heritage']!] },
    },
  ]);

  const [{ n }] = (await db.execute<{ n: number }>(
    sql`select count(*)::int as n from public.tasks where organization_id = ${orgId}`,
  )) as unknown as [{ n: number }];
  console.info(
    `✓ Seeded ${templates.length} workflow templates, ${convertedCount} converted requests, ${deliverableCount} deliverables and ${n} tasks.`,
  );
}
