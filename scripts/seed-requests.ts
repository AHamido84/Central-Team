/**
 * Phase 2 seed: the nine request types (with rich brief forms) and requests for every seeded client in every
 * status — drafts, needs-info questions, extras, conversations with internal notes, attachments, history and
 * package consumption. Runs as the table owner (no auth.uid()), so the request triggers trust the historical
 * timestamps given here and still number, date and count each request.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import * as schema from '../src/lib/db/schema';
import type { Brief, RequestFormField } from '../src/modules/requests/form-schema';
import { artworkPng, simplePdf } from './seed-assets';

type Db = PostgresJsDatabase<typeof schema>;
type ClientLite = {
  slug: string;
  am: string;
  team: string[];
  colors: [string, string, string];
  users: { key: string; role: 'client_owner' | 'client_member' | 'client_viewer' }[];
};

const L = (ar: string, en: string) => ({ ar, en });
const opt = (value: string, ar: string, en: string) => ({ value, label: L(ar, en) });
const field = (f: RequestFormField) => f;

type TypeSeed = {
  key: string;
  name: { ar: string; en: string };
  description: { ar: string; en: string };
  icon: string;
  category: string;
  defaultPriority: string;
  slaDays: number | null;
  item: string | null;
  fields: RequestFormField[];
};

const platformsField = (required = true) => field({ id: 'platforms', type: 'platforms', label: L('المنصات', 'Platforms'), required });
const refs = field({ id: 'references', type: 'links', label: L('روابط مرجعية', 'Reference links'), required: false, maxItems: 5 });
const photos = (ar: string, en: string, required = false) =>
  field({ id: 'photos', type: 'file', label: L(ar, en), required, maxItems: 10 });

export const typeSeeds: TypeSeed[] = [
  {
    key: 'social-post',
    name: L('منشور سوشيال', 'Social post'),
    description: L('تصميم منشور لمنصة أو أكثر.', 'A designed post for one or more platforms.'),
    icon: 'image',
    category: 'design',
    defaultPriority: 'normal',
    slaDays: 3,
    item: 'post',
    fields: [
      platformsField(),
      field({
        id: 'goal',
        type: 'single_select',
        label: L('هدف المنشور', 'Post goal'),
        required: true,
        options: [
          opt('awareness', 'التعريف بالعلامة', 'Awareness'),
          opt('offer', 'عرض أو تخفيض', 'Offer'),
          opt('engagement', 'تفاعل', 'Engagement'),
        ],
      }),
      field({
        id: 'message',
        type: 'long_text',
        label: L('الرسالة الأساسية', 'Key message'),
        help: L('ما الذي يجب أن يتذكره المتابع؟', 'What should the follower remember?'),
        required: true,
      }),
      field({
        id: 'offer',
        type: 'short_text',
        label: L('تفاصيل العرض', 'Offer details'),
        required: true,
        showIf: { field: 'goal', equals: 'offer' },
      }),
      field({ id: 'show_price', type: 'checkbox', label: L('إظهار السعر', 'Show the price'), required: false }),
      field({
        id: 'price',
        type: 'number',
        label: L('السعر (ر.س)', 'Price (SAR)'),
        required: true,
        min: 1,
        max: 100000,
        showIf: { field: 'show_price', equals: true },
      }),
      field({ id: 'size', type: 'dimensions', label: L('المقاس', 'Size'), required: false }),
      field({ id: 'colors', type: 'color', label: L('ألوان مفضلة', 'Preferred colors'), required: false, maxItems: 4 }),
      photos('صور المنتج', 'Product photos'),
      refs,
    ],
  },
  {
    key: 'carousel',
    name: L('كاروسيل', 'Carousel'),
    description: L('منشور متعدد الشرائح يحكي قصة.', 'A multi-slide post that tells a story.'),
    icon: 'gallery-horizontal',
    category: 'design',
    defaultPriority: 'normal',
    slaDays: 4,
    item: 'post',
    fields: [
      platformsField(),
      field({ id: 'slides', type: 'number', label: L('عدد الشرائح', 'Number of slides'), required: true, min: 2, max: 10 }),
      field({
        id: 'story',
        type: 'long_text',
        label: L('فكرة القصة', 'Story outline'),
        help: L('- الشريحة 1: …', '- Slide 1: …'),
        required: true,
      }),
      field({ id: 'size', type: 'dimensions', label: L('المقاس', 'Size'), required: false }),
      photos('الصور', 'Images'),
      refs,
    ],
  },
  {
    key: 'reel-video',
    name: L('ريلز / فيديو', 'Reel / Video'),
    description: L('فيديو قصير من الفكرة حتى المونتاج.', 'A short video from concept to edit.'),
    icon: 'clapperboard',
    category: 'video',
    defaultPriority: 'normal',
    slaDays: 5,
    item: 'reel',
    fields: [
      field({
        id: 'duration',
        type: 'single_select',
        label: L('المدة', 'Duration'),
        required: true,
        options: [
          opt('s15', '15 ثانية', '15 seconds'),
          opt('s30', '30 ثانية', '30 seconds'),
          opt('s60', '60 ثانية', '60 seconds'),
          opt('s90', '90 ثانية', '90 seconds'),
        ],
      }),
      platformsField(),
      field({ id: 'concept', type: 'long_text', label: L('الفكرة', 'Concept'), required: true }),
      field({ id: 'has_script', type: 'checkbox', label: L('لدينا نص جاهز', 'We have a script'), required: false }),
      field({ id: 'script', type: 'long_text', label: L('النص', 'Script'), required: true, showIf: { field: 'has_script', equals: true } }),
      field({
        id: 'music',
        type: 'single_select',
        label: L('الموسيقى', 'Music'),
        required: false,
        options: [opt('trending', 'ترند', 'Trending'), opt('brand', 'موسيقى العلامة', 'Brand music'), opt('none', 'بدون', 'None')],
      }),
      refs,
      photos('لقطات أو ملفات', 'Footage or files'),
    ],
  },
  {
    key: 'story',
    name: L('ستوري', 'Story'),
    description: L('ستوري سريعة لسناب وإنستغرام.', 'Quick stories for Snapchat and Instagram.'),
    icon: 'smartphone',
    category: 'design',
    defaultPriority: 'normal',
    slaDays: 2,
    item: 'story',
    fields: [
      platformsField(),
      field({ id: 'count', type: 'number', label: L('عدد الستوري', 'Number of stories'), required: true, min: 1, max: 10 }),
      field({ id: 'message', type: 'long_text', label: L('الرسالة', 'Message'), required: true }),
      field({
        id: 'cta',
        type: 'single_select',
        label: L('الإجراء المطلوب', 'Call to action'),
        required: false,
        options: [opt('link', 'رابط', 'Link'), opt('poll', 'تصويت', 'Poll'), opt('none', 'بدون', 'None')],
      }),
      field({
        id: 'cta_link',
        type: 'links',
        label: L('الرابط', 'Link'),
        required: true,
        maxItems: 1,
        showIf: { field: 'cta', equals: 'link' },
      }),
    ],
  },
  {
    key: 'ad-campaign',
    name: L('حملة إعلانية', 'Ad campaign'),
    description: L('إطلاق حملة ممولة على سناب أو تيك توك أو ميتا.', 'Launch a paid campaign on Snapchat, TikTok or Meta.'),
    icon: 'megaphone',
    category: 'ads',
    defaultPriority: 'high',
    slaDays: 5,
    item: 'ad_campaign',
    fields: [
      field({
        id: 'objective',
        type: 'single_select',
        label: L('الهدف', 'Objective'),
        required: true,
        options: [
          opt('awareness', 'الوعي', 'Awareness'),
          opt('traffic', 'زيارات', 'Traffic'),
          opt('leads', 'عملاء محتملون', 'Leads'),
          opt('sales', 'مبيعات', 'Sales'),
        ],
      }),
      platformsField(),
      field({ id: 'budget', type: 'number', label: L('الميزانية (ر.س)', 'Budget (SAR)'), required: true, min: 1000, max: 1000000 }),
      field({ id: 'start_date', type: 'date', label: L('تاريخ البدء', 'Start date'), required: true }),
      field({ id: 'duration_days', type: 'number', label: L('المدة بالأيام', 'Duration (days)'), required: false, min: 1, max: 90 }),
      field({ id: 'audience', type: 'long_text', label: L('الجمهور المستهدف', 'Target audience'), required: true }),
      field({ id: 'landing', type: 'links', label: L('صفحة الهبوط', 'Landing page'), required: false, maxItems: 1 }),
      field({ id: 'has_creatives', type: 'checkbox', label: L('لدينا تصاميم جاهزة', 'We have creatives ready'), required: false }),
      field({
        id: 'creatives',
        type: 'file',
        label: L('التصاميم', 'Creatives'),
        required: true,
        maxItems: 10,
        showIf: { field: 'has_creatives', equals: true },
      }),
    ],
  },
  {
    key: 'photoshoot',
    name: L('جلسة تصوير', 'Photoshoot'),
    description: L('تصوير منتجات أو أطباق أو فريق العمل.', 'Products, food, team or location photography.'),
    icon: 'camera',
    category: 'design',
    defaultPriority: 'normal',
    slaDays: 10,
    item: 'photo_shoot',
    fields: [
      field({
        id: 'shoot_type',
        type: 'single_select',
        label: L('نوع التصوير', 'Shoot type'),
        required: true,
        options: [
          opt('product', 'منتجات', 'Products'),
          opt('food', 'أطباق', 'Food'),
          opt('team', 'فريق العمل', 'Team'),
          opt('location', 'الموقع', 'Location'),
        ],
      }),
      field({ id: 'location', type: 'short_text', label: L('مكان التصوير', 'Location'), required: true }),
      field({ id: 'preferred_date', type: 'date', label: L('التاريخ المفضل', 'Preferred date'), required: false }),
      field({
        id: 'items',
        type: 'number',
        label: L('عدد المنتجات أو الأطباق', 'Number of products or dishes'),
        required: false,
        min: 1,
        max: 200,
      }),
      field({ id: 'shot_list', type: 'long_text', label: L('قائمة اللقطات', 'Shot list'), required: false }),
      photos('لوحة الإلهام', 'Moodboard'),
    ],
  },
  {
    key: 'website-change',
    name: L('تعديل على الموقع', 'Website change'),
    description: L('تحديث محتوى أو صور أو إصلاح مشكلة في الموقع.', 'Update content or images, or fix something on the website.'),
    icon: 'globe',
    category: 'web',
    defaultPriority: 'normal',
    slaDays: 3,
    item: null,
    fields: [
      field({ id: 'pages', type: 'links', label: L('الصفحات', 'Pages'), required: true, maxItems: 5 }),
      field({
        id: 'change_type',
        type: 'single_select',
        label: L('نوع التعديل', 'Type of change'),
        required: true,
        options: [
          opt('content', 'محتوى', 'Content'),
          opt('images', 'صور', 'Images'),
          opt('bug', 'إصلاح مشكلة', 'Bug fix'),
          opt('new_page', 'صفحة جديدة', 'New page'),
        ],
      }),
      field({ id: 'details', type: 'long_text', label: L('التفاصيل', 'Details'), required: true }),
      photos('لقطات شاشة', 'Screenshots'),
    ],
  },
  {
    key: 'branding',
    name: L('هوية بصرية', 'Branding'),
    description: L('شعار، ألوان، خطوط أو دليل الهوية.', 'Logo, colors, typography or brand guidelines.'),
    icon: 'palette',
    category: 'branding',
    defaultPriority: 'normal',
    slaDays: 15,
    item: null,
    fields: [
      field({
        id: 'scope',
        type: 'multi_select',
        label: L('نطاق العمل', 'Scope'),
        required: true,
        options: [
          opt('logo', 'الشعار', 'Logo'),
          opt('colors', 'الألوان', 'Colors'),
          opt('typography', 'الخطوط', 'Typography'),
          opt('guidelines', 'دليل الهوية', 'Guidelines'),
          opt('stationery', 'المطبوعات', 'Stationery'),
        ],
      }),
      field({ id: 'current_colors', type: 'color', label: L('الألوان الحالية', 'Current colors'), required: false, maxItems: 6 }),
      field({ id: 'values', type: 'long_text', label: L('قيم العلامة وشخصيتها', 'Brand values and personality'), required: true }),
      field({ id: 'competitors', type: 'links', label: L('منافسون', 'Competitors'), required: false, maxItems: 5 }),
      photos('ملفات الهوية الحالية', 'Current brand files'),
    ],
  },
  {
    key: 'other',
    name: L('طلب آخر', 'Other'),
    description: L('أي شيء آخر تحتاجه من فريقنا.', 'Anything else you need from our team.'),
    icon: 'clipboard-list',
    category: 'other',
    defaultPriority: 'normal',
    slaDays: 5,
    item: null,
    fields: [
      field({ id: 'details', type: 'long_text', label: L('تفاصيل الطلب', 'Request details'), required: true }),
      photos('ملفات', 'Files'),
    ],
  },
];

type Status =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'needs_info'
  | 'accepted'
  | 'in_progress'
  | 'in_review'
  | 'delivered'
  | 'closed'
  | 'rejected'
  | 'cancelled';
type Who = 'am' | 'owner' | 'member' | 'team0' | 'team1';
type Comment = { by: Who; body: string; internal?: boolean; h: number };
type RequestSeed = {
  type: string;
  title: string;
  brief: Brief;
  status: Status;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  daysAgo: number;
  by: 'owner' | 'member';
  reason?: string;
  comments?: Comment[];
  /** Brief file field to fill with a seeded image. */
  fileField?: string;
  attachment?: boolean;
  desired?: number;
  extra?: boolean;
  billable?: boolean;
  links?: string[];
};

const inDays = (d: number) => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  return x.toISOString().slice(0, 10);
};

/** The path each final status took (after "submitted"). */
const pathTo: Record<Status, Status[]> = {
  draft: [],
  submitted: [],
  under_review: ['under_review'],
  needs_info: ['under_review', 'needs_info'],
  accepted: ['under_review', 'accepted'],
  in_progress: ['under_review', 'accepted', 'in_progress'],
  in_review: ['under_review', 'accepted', 'in_progress', 'in_review'],
  delivered: ['under_review', 'accepted', 'in_progress', 'delivered'],
  closed: ['under_review', 'accepted', 'in_progress', 'delivered', 'closed'],
  rejected: ['under_review', 'rejected'],
  cancelled: ['cancelled'],
};

const perClient: Record<string, RequestSeed[]> = {
  'najd-heritage': [
    {
      type: 'social-post',
      title: 'منشور عرض نهاية الأسبوع',
      brief: {
        platforms: ['instagram', 'snapchat'],
        goal: 'offer',
        message: 'خصم **20٪** على الأطباق الرئيسية:\n- الخميس\n- الجمعة',
        offer: 'خصم 20٪',
        show_price: false,
        size: { ratio: '4:5' },
        colors: ['#7a3e1d', '#e9b872'],
        photos: [],
        references: [],
      },
      status: 'needs_info',
      priority: 'high',
      daysAgo: 2,
      by: 'member',
      reason: 'نحتاج صور الأطباق بدقة عالية، وهل العرض يشمل الطلبات الخارجية؟',
      comments: [{ by: 'am', h: 3, internal: true, body: 'ملاحظة داخلية: العميل يرفض الخطوط الرفيعة، استخدموا خط الهوية الثقيل.' }],
    },
    {
      type: 'reel-video',
      title: 'ريلز كواليس المطبخ',
      brief: {
        duration: 's30',
        platforms: ['instagram', 'tiktok'],
        concept: 'لقطات سريعة من تحضير الكبسة مع موسيقى تراثية.',
        has_script: false,
        music: 'trending',
        references: [],
        photos: [],
      },
      status: 'in_progress',
      daysAgo: 6,
      by: 'owner',
      comments: [
        { by: 'am', h: 4, body: 'حجزنا التصوير يوم الأحد في الفرع الرئيسي.' },
        { by: 'owner', h: 6, body: 'ممتاز، الشيف متاح من 10 صباحًا.' },
        { by: 'team0', h: 50, body: 'انتهى التصوير، نعمل على المونتاج الآن.' },
      ],
    },
    {
      type: 'story',
      title: 'ستوري الافتتاح الجديد',
      brief: {
        platforms: ['snapchat'],
        count: 3,
        message: 'افتتاح فرع الملقا يوم الخميس.',
        cta: 'link',
        cta_link: ['https://najdheritage.example/malqa'],
      },
      status: 'submitted',
      daysAgo: 0,
      by: 'member',
      desired: 3,
    },
    {
      type: 'ad-campaign',
      title: 'حملة سناب لافتتاح الفرع',
      brief: {
        objective: 'awareness',
        platforms: ['snapchat'],
        budget: 15000,
        start_date: inDays(-5),
        duration_days: 14,
        audience: 'الرياض، 18-40، مهتمون بالمطاعم والتجارب العائلية.',
        landing: ['https://najdheritage.example/new-branch'],
        has_creatives: false,
      },
      status: 'delivered',
      priority: 'urgent',
      daysAgo: 12,
      by: 'owner',
      billable: true,
      comments: [{ by: 'am', h: 70, body: 'انطلقت الحملة، التقرير الأول بعد أسبوع.' }],
    },
    {
      type: 'social-post',
      title: 'منشور اليوم الوطني',
      brief: {
        platforms: ['instagram', 'x'],
        goal: 'awareness',
        message: 'فخورون بوطننا.',
        show_price: false,
        photos: [],
        references: [],
        colors: [],
      },
      status: 'closed',
      daysAgo: 20,
      by: 'owner',
      fileField: 'photos',
    },
    {
      type: 'photoshoot',
      title: 'تصوير قائمة الشتاء',
      brief: { shoot_type: 'food', location: 'الفرع الرئيسي — حي الملقا', items: 12, shot_list: '', photos: [] },
      status: 'draft',
      daysAgo: 1,
      by: 'member',
    },
  ],
  'darb-coffee': [
    {
      type: 'carousel',
      title: 'كاروسيل أصول حبوب القهوة',
      brief: {
        platforms: ['instagram'],
        slides: 5,
        story: '- الشريحة 1: إثيوبيا\n- الشريحة 2: كولومبيا\n- الشريحة 3: اليمن',
        size: { ratio: '1:1' },
        photos: [],
        references: [],
      },
      status: 'under_review',
      daysAgo: 1,
      by: 'member',
      attachment: true,
    },
    {
      type: 'reel-video',
      title: 'ريلز المشروب الموسمي',
      brief: {
        duration: 's15',
        platforms: ['instagram', 'tiktok'],
        concept: 'تحضير مشروب الزعفران والهيل.',
        has_script: true,
        script: 'افتتاحية: صوت صب القهوة…',
        music: 'brand',
        references: [],
        photos: [],
      },
      status: 'accepted',
      daysAgo: 3,
      by: 'owner',
    },
    {
      type: 'story',
      title: 'ستوري ساعات رمضان',
      brief: { platforms: ['instagram', 'snapchat'], count: 2, message: 'ساعات العمل الجديدة.', cta: 'none' },
      status: 'closed',
      daysAgo: 15,
      by: 'member',
    },
    {
      type: 'other',
      title: 'تحديث البايو في الحسابات',
      brief: { details: 'نبغى تحديث البايو بساعات العمل الجديدة.', photos: [] },
      status: 'cancelled',
      daysAgo: 6,
      by: 'member',
      reason: 'حدّثناه بأنفسنا، شكرًا!',
    },
    {
      type: 'branding',
      title: 'هوية لخط منتجات جديد',
      brief: {
        scope: ['logo', 'colors'],
        current_colors: ['#1f3a2e', '#c9a66b'],
        values: 'قهوة مختصة بلمسة سعودية.',
        competitors: [],
        photos: [],
      },
      status: 'rejected',
      daysAgo: 9,
      by: 'owner',
      reason: 'مشاريع الهوية الكاملة خارج نطاق الباقة الحالية؛ سنرسل عرض سعر منفصل.',
    },
  ],
  'future-smile': [
    {
      type: 'social-post',
      title: 'منشور توعوي عن التنظيف',
      brief: {
        platforms: ['instagram'],
        goal: 'engagement',
        message: 'خمس عادات يومية لأسنان صحية.',
        show_price: false,
        photos: [],
        references: [],
        colors: [],
      },
      status: 'in_review',
      daysAgo: 4,
      by: 'member',
      comments: [{ by: 'team0', h: 30, internal: true, body: 'راجعوا المصطلحات الطبية مع د. ناصر قبل التسليم.' }],
    },
    {
      type: 'website-change',
      title: 'تحديث صفحة الأسعار',
      brief: {
        pages: ['https://futuresmile.example/prices'],
        change_type: 'content',
        details: 'إضافة باقة التقويم الشفاف وتحديث الأسعار.',
        photos: [],
      },
      status: 'submitted',
      daysAgo: 1,
      by: 'owner',
    },
    {
      type: 'ad-campaign',
      title: 'حملة عروض التقويم',
      brief: {
        objective: 'leads',
        platforms: ['instagram', 'snapchat'],
        budget: 20000,
        start_date: inDays(10),
        duration_days: 30,
        audience: 'المنطقة الشرقية، 20-45.',
        landing: ['https://futuresmile.example/offers'],
        has_creatives: false,
      },
      status: 'needs_info',
      daysAgo: 3,
      by: 'owner',
      reason: 'هل نستهدف الدمام والخبر فقط أم كل المنطقة الشرقية؟ ونحتاج موافقة على نص العرض.',
    },
    {
      type: 'reel-video',
      title: 'فيديو جولة في العيادة',
      brief: {
        duration: 's60',
        platforms: ['instagram'],
        concept: 'جولة في العيادة الجديدة.',
        has_script: false,
        music: 'none',
        references: [],
        photos: [],
      },
      status: 'closed',
      daysAgo: 18,
      by: 'member',
    },
  ],
  'gulf-vision': [
    {
      type: 'photoshoot',
      title: 'تصوير الشقة النموذجية',
      brief: {
        shoot_type: 'location',
        location: 'مشروع الواجهة البحرية — البرج أ',
        preferred_date: inDays(4),
        items: 1,
        shot_list: '- الصالة\n- المطبخ\n- الإطلالة',
        photos: [],
      },
      status: 'accepted',
      daysAgo: 2,
      by: 'owner',
    },
    {
      type: 'carousel',
      title: 'كاروسيل خطط السداد',
      brief: {
        platforms: ['instagram', 'linkedin'],
        slides: 4,
        story: 'دفعة أولى 5٪ وخطط مرنة.',
        size: { ratio: '4:5' },
        photos: [],
        references: [],
      },
      status: 'in_progress',
      daysAgo: 5,
      by: 'member',
    },
    {
      type: 'branding',
      title: 'دليل هوية المشروع الجديد',
      brief: {
        scope: ['guidelines', 'typography'],
        current_colors: ['#14213d', '#fca311'],
        values: 'فخامة، ثقة، إطلالة على البحر.',
        competitors: [],
        photos: [],
      },
      status: 'submitted',
      daysAgo: 0,
      by: 'owner',
      extra: true,
    },
    {
      type: 'social-post',
      title: 'منشور إطلاق المرحلة الثانية',
      brief: {
        platforms: ['instagram', 'x', 'linkedin'],
        goal: 'awareness',
        message: 'إطلاق المرحلة الثانية من الواجهة البحرية.',
        show_price: true,
        price: 950000,
        photos: [],
        references: [],
        colors: [],
      },
      status: 'delivered',
      daysAgo: 8,
      by: 'owner',
    },
  ],
  'lujain-fashion': [
    {
      type: 'reel-video',
      title: 'ريلز مجموعة العيد',
      brief: {
        duration: 's30',
        platforms: ['instagram', 'tiktok'],
        concept: 'عرض سريع للمجموعة بألوان الربيع.',
        has_script: false,
        music: 'trending',
        references: [],
        photos: [],
      },
      status: 'submitted',
      daysAgo: 1,
      by: 'owner',
    },
    {
      type: 'social-post',
      title: 'منشور التخفيضات',
      brief: {
        platforms: ['instagram'],
        goal: 'offer',
        message: 'تخفيضات حتى 40٪.',
        offer: 'حتى 40٪',
        show_price: false,
        photos: [],
        references: [],
        colors: [],
      },
      status: 'in_progress',
      daysAgo: 3,
      by: 'member',
    },
    {
      type: 'ad-campaign',
      title: 'حملة تيك توك للمجموعة',
      brief: {
        objective: 'sales',
        platforms: ['tiktok'],
        budget: 8000,
        start_date: inDays(7),
        duration_days: 10,
        audience: 'جدة والرياض، 18-35، مهتمات بالأزياء.',
        landing: [],
        has_creatives: false,
      },
      status: 'under_review',
      daysAgo: 1,
      by: 'owner',
      extra: true,
    },
    {
      type: 'story',
      title: 'ستوري وصول القطع الجديدة',
      brief: { platforms: ['instagram'], count: 4, message: 'وصلت القطع الجديدة.', cta: 'poll' },
      status: 'closed',
      daysAgo: 14,
      by: 'owner',
    },
  ],
};

const hoursAfter = (d: Date, h: number) => new Date(d.getTime() + h * 3600000);

export async function seedRequestsData(opts: {
  db: Db;
  ids: Record<string, string>;
  clientIds: Record<string, string>;
  orgId: string;
  clients: ClientLite[];
  staffNames: Record<string, string>;
  upload: (path: string, body: Buffer, contentType: string) => Promise<void>;
}) {
  const { db, ids, orgId } = opts;
  const now = Date.now();
  const at = (daysAgo: number, plusHours = 0) => new Date(Math.min(now - daysAgo * 86400000 + plusHours * 3600000, now - 600000));

  // --- Types -----------------------------------------------------------------
  const types: Record<string, { id: string }> = {};
  for (const [i, ts] of typeSeeds.entries()) {
    const [row] = await db
      .insert(schema.requestTypes)
      .values({
        organizationId: orgId,
        key: ts.key,
        name: ts.name,
        description: ts.description,
        icon: ts.icon,
        category: ts.category,
        defaultPriority: ts.defaultPriority,
        slaDays: ts.slaDays,
        packageItemType: ts.item,
        isActive: true,
        formSchema: { fields: ts.fields },
        sortOrder: i + 1,
        createdBy: ids.faisal!,
        createdAt: at(60),
      })
      .returning({ id: schema.requestTypes.id });
    types[ts.key] = row!;
  }

  // --- Requests ----------------------------------------------------------------
  let total = 0;
  for (const c of opts.clients) {
    const clientId = opts.clientIds[c.slug]!;
    const owner = c.users.find((u) => u.role === 'client_owner')!.key;
    const member = (c.users.find((u) => u.role === 'client_member') ?? c.users[0]!).key;
    const who = (k: Who) => ({ am: c.am, owner, member, team0: c.team[0]!, team1: c.team[1] ?? c.team[0]! })[k];
    const sideOf = (k: Who) => (k === 'owner' || k === 'member' ? 'client' : 'agency');

    // Oldest first so per-client numbers follow submission order.
    const list = [...(perClient[c.slug] ?? [])].sort((a, b) => b.daysAgo - a.daysAgo);
    for (const r of list) {
      const submittedAt = at(r.daysAgo, -3);
      const steps = pathTo[r.status];
      const stepTimes = steps.map((_, i) => at(r.daysAgo, -3 + (i + 1) * (r.status === 'cancelled' ? 2 : 4 + i * 10)));
      const stepAt = (s: Status) => stepTimes[steps.indexOf(s)] ?? null;
      const author = ids[who(r.by)]!;

      // A brief file field / general attachment gets a real uploaded image.
      const brief = { ...r.brief };
      const fileIds: { fileId: string; fieldId: string | null }[] = [];
      for (const target of [r.fileField ? r.fileField : null, r.attachment ? '__general' : null].filter(Boolean) as string[]) {
        const fileId = crypto.randomUUID();
        const name = target === '__general' ? 'brief.pdf' : 'reference-photo.png';
        const isImage = name.endsWith('.png');
        const body = isImage ? artworkPng(1080, 1080, c.colors[0], c.colors[1], c.colors[2]) : simplePdf(r.title, ['Brief', 'References']);
        const path = `org/${orgId}/clients/${clientId}/requests/${fileId}-${name}`;
        await opts.upload(path, body, isImage ? 'image/png' : 'application/pdf');
        await db.insert(schema.files).values({
          id: fileId,
          organizationId: orgId,
          clientId,
          name,
          storagePath: path,
          mimeType: isImage ? 'image/png' : 'application/pdf',
          sizeBytes: body.length,
          kind: isImage ? 'image' : 'pdf',
          visibility: 'client',
          source: 'attachment',
          uploadedBy: author,
          uploaderSide: 'client',
          createdAt: submittedAt,
        });
        if (target === '__general') fileIds.push({ fileId, fieldId: null });
        else {
          brief[target] = [fileId];
          fileIds.push({ fileId, fieldId: target });
        }
      }

      const delivered = stepAt('delivered');
      const lastComment = r.comments?.length ? hoursAfter(submittedAt, Math.max(...r.comments.map((x) => x.h))) : submittedAt;
      const [row] = await db
        .insert(schema.requests)
        .values({
          organizationId: orgId,
          clientId,
          requestTypeId: types[r.type]!.id,
          title: r.title,
          brief,
          referenceLinks: r.links ?? [],
          status: r.status,
          priority: r.priority ?? 'normal',
          createdBy: author,
          submittedBy: r.status === 'draft' ? null : author,
          desiredDate: r.desired ? inDays(r.desired) : null,
          isExtra: Boolean(r.extra),
          isBillable: Boolean(r.billable),
          submittedAt: r.status === 'draft' ? null : submittedAt,
          firstResponseAt: stepTimes[0] ?? null,
          acceptedAt: stepAt('accepted'),
          deliveredAt: delivered,
          closedAt: stepAt('closed'),
          lastActivityAt: new Date(Math.max(submittedAt.getTime(), lastComment.getTime(), ...stepTimes.map((d) => d.getTime()))),
          createdAt: hoursAfter(submittedAt, -1),
        })
        .returning({ id: schema.requests.id });
      const requestId = row!.id;
      total++;

      if (fileIds.length) {
        await db
          .insert(schema.requestAttachments)
          .values(
            fileIds.map((f) => ({
              requestId,
              fileId: f.fileId,
              fieldId: f.fieldId,
              organizationId: orgId,
              clientId,
              createdAt: submittedAt,
            })),
          );
      }
      if (r.status === 'draft') continue;

      // History (the insert trigger only writes it for requests inserted as "submitted").
      const history: (typeof schema.requestStatusHistory.$inferInsert)[] = [];
      if (r.status !== 'submitted') {
        history.push({
          organizationId: orgId,
          clientId,
          requestId,
          fromStatus: 'draft',
          toStatus: 'submitted',
          actorId: author,
          actorSide: 'client',
          createdAt: submittedAt,
        });
      }
      let prev: Status = 'submitted';
      for (const [i, step] of steps.entries()) {
        const clientStep = step === 'cancelled' || step === 'closed';
        history.push({
          organizationId: orgId,
          clientId,
          requestId,
          fromStatus: prev,
          toStatus: step,
          reason: step === 'needs_info' || step === 'rejected' || step === 'cancelled' ? (r.reason ?? null) : null,
          actorId: clientStep ? author : ids[c.am]!,
          actorSide: clientStep ? 'client' : 'agency',
          createdAt: stepTimes[i]!,
        });
        prev = step;
      }
      if (history.length) await db.insert(schema.requestStatusHistory).values(history);

      // Discussion.
      const [thread] = await db
        .select({ id: schema.threads.id })
        .from(schema.threads)
        .where(and(eq(schema.threads.subjectType, 'request'), eq(schema.threads.subjectId, requestId)));
      const reasonStep = steps.find((s) => s === 'needs_info' || s === 'rejected');
      const discussion: Comment[] = [...(r.comments ?? [])];
      for (const cm of discussion) {
        await db.insert(schema.comments).values({
          organizationId: orgId,
          clientId,
          threadId: thread!.id,
          authorId: ids[who(cm.by)]!,
          authorSide: sideOf(cm.by),
          body: cm.body,
          visibility: cm.internal ? 'internal' : 'client',
          createdAt: hoursAfter(submittedAt, cm.h),
        });
      }
      if (reasonStep && r.reason) {
        await db.insert(schema.comments).values({
          organizationId: orgId,
          clientId,
          threadId: thread!.id,
          authorId: ids[c.am]!,
          authorSide: 'agency',
          body: r.reason,
          visibility: 'client',
          createdAt: stepAt(reasonStep)!,
        });
      }
      await db
        .insert(schema.threadReads)
        .values({ threadId: thread!.id, userId: ids[c.am]!, organizationId: orgId, clientId, lastReadAt: new Date() })
        .onConflictDoNothing();
      await db
        .insert(schema.threadReads)
        .values({ threadId: thread!.id, userId: author, organizationId: orgId, clientId, lastReadAt: submittedAt })
        .onConflictDoNothing();
    }
  }

  // An internal priority change so the agency timeline shows one.
  const [urgent] = await db
    .select({ id: schema.requests.id, clientId: schema.requests.clientId })
    .from(schema.requests)
    .where(eq(schema.requests.priority, 'urgent'))
    .limit(1);
  if (urgent) {
    await db.insert(schema.requestEvents).values({
      organizationId: orgId,
      clientId: urgent.clientId,
      requestId: urgent.id,
      actorId: ids.noura!,
      actorSide: 'agency',
      type: 'priority_changed',
      fromValue: 'high',
      toValue: 'urgent',
      visibility: 'internal',
      createdAt: at(11),
    });
  }

  // Request notifications so the bells aren't empty.
  const [question] = await db
    .select({ id: schema.requests.id, reference: schema.requests.reference, title: schema.requests.title })
    .from(schema.requests)
    .where(and(eq(schema.requests.clientId, opts.clientIds['najd-heritage']!), eq(schema.requests.status, 'needs_info')))
    .limit(1);
  const [fresh] = await db
    .select({ id: schema.requests.id, reference: schema.requests.reference, title: schema.requests.title })
    .from(schema.requests)
    .where(and(eq(schema.requests.clientId, opts.clientIds['najd-heritage']!), eq(schema.requests.status, 'submitted')))
    .limit(1);
  if (question && fresh) {
    await db.insert(schema.notifications).values([
      {
        organizationId: orgId,
        userId: ids.abeer!,
        type: 'request_needs_info',
        category: 'requests',
        params: {
          actor: opts.staffNames.noura!,
          reference: question.reference ?? '',
          title: question.title,
          client: '',
          status: 'needs_info',
        },
        link: `/portal/requests/${question.id}`,
        actorId: ids.noura!,
        createdAt: at(1),
      },
      {
        organizationId: orgId,
        userId: ids.noura!,
        type: 'request_submitted',
        category: 'requests',
        params: { actor: 'عبير السالم', reference: fresh.reference ?? '', title: fresh.title, client: 'مطاعم نجد الأصيلة' },
        link: `/requests/${fresh.id}`,
        actorId: ids.abeer!,
        createdAt: at(0),
      },
    ]);
  }

  const [{ n }] = (await db.execute<{ n: number }>(
    sql`select count(*)::int as n from public.package_usage_entries where source_type = 'request'`,
  )) as unknown as [{ n: number }];
  console.info(`✓ Seeded ${typeSeeds.length} request types and ${total} requests (${n} counted against packages).`);
}
