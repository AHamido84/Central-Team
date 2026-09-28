/**
 * Phase 2 seed: request forms (one with two published versions, one draft) and realistic requests for every
 * seeded client in every status, with conversations, internal notes, attachments and lifecycle history.
 * Runs as the table owner (no auth.uid()), so the request triggers accept the historical timestamps given here.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import * as schema from '../src/lib/db/schema';
import type { RequestFormField } from '../src/modules/requests/form-schema';
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

const platforms = [
  opt('instagram', 'إنستغرام', 'Instagram'),
  opt('snapchat', 'سناب شات', 'Snapchat'),
  opt('tiktok', 'تيك توك', 'TikTok'),
  opt('x', 'إكس', 'X'),
];

type FormSeed = {
  key: string;
  name: { ar: string; en: string };
  description: { ar: string; en: string };
  icon: string;
  category: string;
  defaultPriority: string;
  response: number | null;
  resolution: number | null;
  versions: RequestFormField[][];
  draft?: boolean;
};

const formSeeds: FormSeed[] = [
  {
    key: 'social-post',
    name: L('تصميم منشور', 'Social post design'),
    description: L('منشور أو كاروسيل أو ستوري لمنصات التواصل.', 'A post, carousel or story for social media.'),
    icon: 'image',
    category: 'design',
    defaultPriority: 'normal',
    response: 8,
    resolution: 40,
    versions: [
      [
        { id: 'platforms', type: 'multi_select', label: L('المنصات', 'Platforms'), required: false, options: platforms },
        { id: 'message', type: 'long_text', label: L('الرسالة الأساسية', 'Key message'), required: true },
        { id: 'references', type: 'url', label: L('رابط مرجعي', 'Reference link'), required: false },
      ],
      [
        { id: 'platforms', type: 'multi_select', label: L('المنصات', 'Platforms'), required: true, options: platforms },
        {
          id: 'format',
          type: 'single_select',
          label: L('الصيغة', 'Format'),
          required: true,
          options: [opt('single', 'صورة واحدة', 'Single image'), opt('carousel', 'كاروسيل', 'Carousel'), opt('story', 'ستوري', 'Story')],
        },
        {
          id: 'message',
          type: 'long_text',
          label: L('الرسالة الأساسية', 'Key message'),
          help: L('ما الذي يجب أن يتذكره المتابع؟', 'What should the follower remember?'),
          required: true,
        },
        { id: 'offer', type: 'short_text', label: L('العرض أو السعر', 'Offer or price'), required: false },
        { id: 'references', type: 'url', label: L('رابط مرجعي', 'Reference link'), required: false },
        { id: 'include_logo', type: 'checkbox', label: L('إظهار الشعار بوضوح', 'Show the logo prominently'), required: false },
      ],
    ],
  },
  {
    key: 'short-video',
    name: L('فيديو قصير (ريلز)', 'Short video (reel)'),
    description: L('ريلز أو تيك توك من الفكرة حتى المونتاج.', 'Reels or TikTok from concept to edit.'),
    icon: 'clapperboard',
    category: 'video',
    defaultPriority: 'normal',
    response: 8,
    resolution: 72,
    versions: [
      [
        {
          id: 'duration',
          type: 'single_select',
          label: L('المدة', 'Duration'),
          required: true,
          options: [opt('s15', '15 ثانية', '15 seconds'), opt('s30', '30 ثانية', '30 seconds'), opt('s60', '60 ثانية', '60 seconds')],
        },
        { id: 'platforms', type: 'multi_select', label: L('المنصات', 'Platforms'), required: true, options: platforms },
        { id: 'concept', type: 'long_text', label: L('الفكرة', 'Concept'), required: true },
        { id: 'script_ready', type: 'checkbox', label: L('لدينا نص جاهز', 'We have a script ready'), required: false },
        { id: 'references', type: 'url', label: L('فيديو مرجعي', 'Reference video'), required: false },
      ],
    ],
  },
  {
    key: 'ad-campaign',
    name: L('حملة إعلانية ممولة', 'Paid ad campaign'),
    description: L('إطلاق حملة على سناب أو تيك توك أو ميتا.', 'Launch a campaign on Snapchat, TikTok or Meta.'),
    icon: 'megaphone',
    category: 'ads',
    defaultPriority: 'high',
    response: 4,
    resolution: 24,
    versions: [
      [
        {
          id: 'objective',
          type: 'single_select',
          label: L('الهدف', 'Objective'),
          required: true,
          options: [
            opt('awareness', 'الوعي بالعلامة', 'Awareness'),
            opt('traffic', 'زيارات', 'Traffic'),
            opt('leads', 'عملاء محتملون', 'Leads'),
            opt('sales', 'مبيعات', 'Sales'),
          ],
        },
        { id: 'budget', type: 'number', label: L('الميزانية (ر.س)', 'Budget (SAR)'), required: true, min: 1000, max: 1000000 },
        { id: 'start_date', type: 'date', label: L('تاريخ البدء', 'Start date'), required: true },
        { id: 'duration_days', type: 'number', label: L('المدة بالأيام', 'Duration (days)'), required: false, min: 1, max: 90 },
        { id: 'audience', type: 'long_text', label: L('الجمهور المستهدف', 'Target audience'), required: true },
        { id: 'landing', type: 'url', label: L('صفحة الهبوط', 'Landing page'), required: false },
      ],
    ],
  },
  {
    key: 'design-revision',
    name: L('تعديل على تصميم', 'Design revision'),
    description: L('تعديلات على عمل سُلّم لكم.', 'Changes to something we delivered.'),
    icon: 'repeat',
    category: 'design',
    defaultPriority: 'high',
    response: 4,
    resolution: 16,
    versions: [
      [
        { id: 'changes', type: 'long_text', label: L('التعديلات المطلوبة', 'Requested changes'), required: true },
        { id: 'link', type: 'url', label: L('رابط التصميم', 'Link to the design'), required: false },
      ],
    ],
  },
  {
    key: 'content-writing',
    name: L('كتابة محتوى', 'Content writing'),
    description: L('نصوص للمنشورات والمدونة والإعلانات.', 'Copy for posts, blog and ads.'),
    icon: 'pen-line',
    category: 'content',
    defaultPriority: 'normal',
    response: 8,
    resolution: 48,
    versions: [
      [
        { id: 'topic', type: 'short_text', label: L('الموضوع', 'Topic'), required: true },
        {
          id: 'tone',
          type: 'single_select',
          label: L('نبرة الكتابة', 'Tone of voice'),
          required: false,
          options: [opt('formal', 'رسمية', 'Formal'), opt('friendly', 'ودّية', 'Friendly'), opt('playful', 'مرحة', 'Playful')],
        },
        { id: 'words', type: 'number', label: L('عدد الكلمات التقريبي', 'Approximate word count'), required: false, min: 20, max: 3000 },
        { id: 'notes', type: 'long_text', label: L('ملاحظات', 'Notes'), required: false },
      ],
    ],
  },
  {
    key: 'general',
    name: L('طلب عام', 'General request'),
    description: L('أي شيء آخر تحتاجه من فريقنا.', 'Anything else you need from our team.'),
    icon: 'clipboard-list',
    category: 'other',
    defaultPriority: 'normal',
    response: 24,
    resolution: null,
    versions: [[{ id: 'details', type: 'long_text', label: L('تفاصيل الطلب', 'Request details'), required: true }]],
  },
  {
    key: 'photo-shoot',
    name: L('جلسة تصوير منتجات', 'Product photo shoot'),
    description: L('تصوير احترافي لمنتجاتكم أو فرعكم.', 'Professional photos of your products or branch.'),
    icon: 'camera',
    category: 'design',
    defaultPriority: 'normal',
    response: 24,
    resolution: 120,
    draft: true,
    versions: [
      [
        { id: 'location', type: 'short_text', label: L('موقع التصوير', 'Location'), required: true },
        { id: 'products', type: 'number', label: L('عدد المنتجات', 'Number of products'), required: true, min: 1, max: 200 },
        { id: 'date', type: 'date', label: L('التاريخ المفضل', 'Preferred date'), required: false },
      ],
    ],
  },
];

type Status = 'submitted' | 'in_review' | 'in_progress' | 'waiting_client' | 'completed' | 'declined' | 'cancelled';
type Comment = { by: 'am' | 'owner' | 'member' | 'team0' | 'team1'; body: string; internal?: boolean; h: number };
type RequestSeed = {
  form: string;
  title: string;
  answers: Record<string, unknown>;
  status: Status;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  daysAgo: number;
  by: 'owner' | 'member';
  assignee?: 'am' | 'team0' | 'team1';
  comments: Comment[];
  attachment?: boolean;
  desired?: number;
};

const inDays = (d: number) => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  return x.toISOString().slice(0, 10);
};

/** Request templates, rotated across clients so every client gets a realistic mix. */
function requestsFor(ci: number): RequestSeed[] {
  const sets: RequestSeed[][] = [
    [
      {
        form: 'social-post',
        title: 'منشور عرض نهاية الأسبوع',
        answers: {
          platforms: ['instagram', 'snapchat'],
          format: 'carousel',
          message: 'خصم 20٪ على كل الأطباق الرئيسية يومي الخميس والجمعة.',
          offer: 'خصم 20٪',
          include_logo: true,
          references: null,
        },
        status: 'in_progress',
        priority: 'high',
        daysAgo: 3,
        by: 'member',
        assignee: 'team0',
        attachment: true,
        desired: 2,
        comments: [
          { by: 'am', h: 2, body: 'وصلنا الطلب، سيبدأ فريق التصميم اليوم. هل تفضلون الخلفية الداكنة كالحملة السابقة؟' },
          { by: 'member', h: 5, body: 'نعم الخلفية الداكنة أفضل، ونبغى صورة الكبسة في الشريحة الأولى.' },
          { by: 'am', h: 6, internal: true, body: 'ملاحظة داخلية: العميل يرفض عادة الخطوط الرفيعة، استخدموا خط الهوية الثقيل.' },
          { by: 'team0', h: 26, body: 'جهّزنا المسودة الأولى، سنشاركها قبل نهاية اليوم.' },
        ],
      },
      {
        form: 'ad-campaign',
        title: 'حملة سناب لافتتاح الفرع الجديد',
        answers: {
          objective: 'awareness',
          budget: 15000,
          start_date: inDays(6),
          duration_days: 14,
          audience: 'الرياض، 18-40، مهتمون بالمطاعم والتجارب العائلية.',
          landing: 'https://example.com/new-branch',
        },
        status: 'waiting_client',
        priority: 'urgent',
        daysAgo: 2,
        by: 'owner',
        assignee: 'am',
        comments: [
          { by: 'am', h: 1, body: 'ممتاز! نحتاج صور الفرع الجديد وموقعه على الخريطة لإعداد الاستهداف الجغرافي.' },
          { by: 'owner', h: 4, body: 'الصور عند المصور، نرسلها غدًا إن شاء الله.' },
          { by: 'am', h: 20, body: 'بانتظار الصور وموقع الفرع لنبدأ الإعداد 🙏' },
        ],
      },
      {
        form: 'short-video',
        title: 'ريلز كواليس المطبخ',
        answers: {
          duration: 's30',
          platforms: ['instagram', 'tiktok'],
          concept: 'لقطات سريعة من تحضير الأطباق مع موسيقى تراثية.',
          script_ready: false,
          references: null,
        },
        status: 'submitted',
        priority: 'normal',
        daysAgo: 0,
        by: 'member',
        comments: [],
      },
      {
        form: 'design-revision',
        title: 'تعديل ألوان منيو رمضان',
        answers: { changes: 'نحتاج اللون الذهبي أفتح قليلًا وتكبير الأسعار.', link: null },
        status: 'completed',
        priority: 'high',
        daysAgo: 12,
        by: 'owner',
        assignee: 'team0',
        comments: [
          { by: 'team0', h: 3, body: 'تم التعديل وأرفقنا النسخة النهائية في مجلد هذا الشهر.' },
          { by: 'owner', h: 6, body: 'ممتاز، شكرًا لكم.' },
        ],
      },
    ],
    [
      {
        form: 'content-writing',
        title: 'نصوص منشورات أسبوع القهوة',
        answers: { topic: 'قصص عن مصادر حبوب القهوة', tone: 'friendly', words: 120, notes: 'خمسة منشورات قصيرة.' },
        status: 'in_review',
        priority: 'normal',
        daysAgo: 1,
        by: 'member',
        assignee: 'team1',
        comments: [{ by: 'team1', h: 3, body: 'نراجع الطلب الآن، هل تريدون النصوص بالعربية والإنجليزية؟' }],
      },
      {
        form: 'social-post',
        title: 'ستوري إطلاق المشروب الموسمي',
        answers: {
          platforms: ['instagram'],
          format: 'story',
          message: 'مشروب الزعفران والهيل متوفر لفترة محدودة.',
          offer: null,
          include_logo: true,
          references: null,
        },
        status: 'completed',
        priority: 'normal',
        daysAgo: 9,
        by: 'owner',
        assignee: 'team0',
        attachment: true,
        comments: [
          { by: 'team0', h: 5, body: 'هذه ثلاث نسخ للستوري، أي واحدة تفضلون؟' },
          { by: 'owner', h: 8, body: 'الثانية ممتازة 👌' },
        ],
      },
      {
        form: 'general',
        title: 'تحديث البايو في الحسابات',
        answers: { details: 'نبغى تحديث البايو في كل الحسابات بساعات العمل الجديدة.' },
        status: 'cancelled',
        priority: 'low',
        daysAgo: 6,
        by: 'member',
        comments: [{ by: 'member', h: 2, body: 'ألغينا الطلب، حدّثناه بأنفسنا. شكرًا!' }],
      },
      {
        form: 'ad-campaign',
        title: 'حملة تيك توك لفرع جدة',
        answers: {
          objective: 'traffic',
          budget: 8000,
          start_date: inDays(3),
          duration_days: 10,
          audience: 'جدة، 18-35، محبو القهوة المختصة.',
          landing: null,
        },
        status: 'submitted',
        priority: 'high',
        daysAgo: 2,
        by: 'owner',
        comments: [],
      },
    ],
    [
      {
        form: 'short-video',
        title: 'فيديو توعوي عن تبييض الأسنان',
        answers: {
          duration: 's60',
          platforms: ['instagram', 'snapchat'],
          concept: 'الطبيب يشرح الفرق بين التبييض المنزلي وفي العيادة.',
          script_ready: true,
          references: null,
        },
        status: 'in_progress',
        priority: 'normal',
        daysAgo: 4,
        by: 'member',
        assignee: 'team0',
        comments: [
          { by: 'am', h: 2, body: 'حجزنا موعد التصوير في فرع الدمام يوم الأحد صباحًا.' },
          { by: 'member', h: 4, body: 'تمام، الدكتور ناصر متاح من 9 إلى 11.' },
          { by: 'am', h: 5, internal: true, body: 'داخلي: لا تُظهر أسعار الخدمات في الفيديو حسب طلبهم السابق.' },
        ],
      },
      {
        form: 'ad-campaign',
        title: 'حملة عروض تقويم الأسنان',
        answers: {
          objective: 'leads',
          budget: 20000,
          start_date: inDays(10),
          duration_days: 30,
          audience: 'المنطقة الشرقية، 20-45، مهتمون بالتجميل.',
          landing: 'https://futuresmile.example/offers',
        },
        status: 'waiting_client',
        priority: 'high',
        daysAgo: 3,
        by: 'owner',
        assignee: 'team1',
        comments: [
          { by: 'team1', h: 3, body: 'نحتاج موافقتكم على نص الإعلان والعرض قبل الإطلاق.' },
          { by: 'team1', h: 26, body: 'تذكير: بانتظار الموافقة على النص المرفق في المحادثة.' },
        ],
      },
      {
        form: 'content-writing',
        title: 'مقالات المدونة لشهر التوعية',
        answers: { topic: 'العناية بأسنان الأطفال', tone: 'formal', words: 800, notes: 'ثلاث مقالات.' },
        status: 'submitted',
        priority: 'low',
        daysAgo: 1,
        by: 'member',
        comments: [],
      },
      {
        form: 'design-revision',
        title: 'تعديل لوحة الاستقبال',
        answers: { changes: 'تصحيح رقم الهاتف وإضافة شعار الهيئة.', link: null },
        status: 'completed',
        priority: 'high',
        daysAgo: 15,
        by: 'owner',
        assignee: 'team0',
        comments: [{ by: 'team0', h: 4, body: 'أرسلنا النسخة المعدلة للطباعة.' }],
      },
    ],
    [
      {
        form: 'social-post',
        title: 'منشورات مشروع الواجهة البحرية',
        answers: {
          platforms: ['instagram', 'x'],
          format: 'carousel',
          message: 'شقق بإطلالة بحرية مع خطط سداد مرنة.',
          offer: 'دفعة أولى 5٪',
          include_logo: true,
          references: 'https://gulfvision.example/waterfront',
        },
        status: 'in_review',
        priority: 'high',
        daysAgo: 1,
        by: 'owner',
        assignee: 'am',
        attachment: true,
        comments: [{ by: 'am', h: 2, body: 'نراجع المخططات المرفقة ونعود لكم بالمقترح غدًا.' }],
      },
      {
        form: 'short-video',
        title: 'جولة مصورة داخل الشقة النموذجية',
        answers: {
          duration: 's60',
          platforms: ['instagram', 'tiktok'],
          concept: 'جولة بالدرون ثم داخل الشقة مع تعليق صوتي.',
          script_ready: false,
          references: null,
        },
        status: 'in_progress',
        priority: 'normal',
        daysAgo: 5,
        by: 'member',
        assignee: 'team0',
        comments: [
          { by: 'team0', h: 6, body: 'التصوير يوم الثلاثاء، نحتاج مفاتيح الشقة قبلها بيوم.' },
          { by: 'member', h: 9, body: 'تم التنسيق مع مدير المبيعات.' },
        ],
      },
      {
        form: 'general',
        title: 'تجهيز عرض تقديمي للمستثمرين',
        answers: { details: 'عرض من 12 شريحة بالهوية الجديدة لاجتماع الشهر القادم.' },
        status: 'submitted',
        priority: 'normal',
        daysAgo: 0,
        by: 'owner',
        comments: [],
      },
      {
        form: 'ad-campaign',
        title: 'حملة لينكدإن للمستثمرين',
        answers: {
          objective: 'leads',
          budget: 25000,
          start_date: inDays(-10),
          duration_days: 21,
          audience: 'مستثمرون ومديرون تنفيذيون في الخليج.',
          landing: null,
        },
        status: 'completed',
        priority: 'normal',
        daysAgo: 18,
        by: 'owner',
        assignee: 'team1',
        comments: [{ by: 'team1', h: 5, body: 'انطلقت الحملة، التقرير الأسبوعي كل أحد.' }],
      },
    ],
    [
      {
        form: 'social-post',
        title: 'إطلاق مجموعة العيد',
        answers: {
          platforms: ['instagram', 'snapchat', 'tiktok'],
          format: 'carousel',
          message: 'مجموعة العيد الجديدة بألوان الربيع.',
          offer: null,
          include_logo: false,
          references: null,
        },
        status: 'waiting_client',
        priority: 'high',
        daysAgo: 2,
        by: 'owner',
        assignee: 'team0',
        comments: [
          { by: 'team0', h: 3, body: 'نحتاج صور المنتجات بخلفية بيضاء، هل هي جاهزة؟' },
          { by: 'owner', h: 5, body: 'سنصورها هذا الأسبوع.' },
          { by: 'team0', h: 22, body: 'بانتظار الصور لإكمال التصاميم.' },
        ],
      },
      {
        form: 'content-writing',
        title: 'أوصاف المنتجات للمتجر',
        answers: { topic: 'أوصاف 20 قطعة جديدة', tone: 'playful', words: 60, notes: 'بالعربية والإنجليزية.' },
        status: 'in_progress',
        priority: 'normal',
        daysAgo: 3,
        by: 'member',
        assignee: 'team1',
        comments: [{ by: 'team1', h: 4, body: 'انتهينا من 12 وصفًا، الباقي غدًا.' }],
      },
      {
        form: 'design-revision',
        title: 'تعديل بنر التخفيضات',
        answers: { changes: 'تغيير النسبة من 30٪ إلى 40٪.', link: null },
        status: 'completed',
        priority: 'urgent',
        daysAgo: 7,
        by: 'member',
        assignee: 'team0',
        comments: [{ by: 'team0', h: 1, body: 'تم التعديل ونُشر البنر.' }],
      },
      {
        form: 'general',
        title: 'استشارة بخصوص شريك التوصيل',
        answers: { details: 'نحتاج رأيكم في الإعلان المشترك مع تطبيق التوصيل.' },
        status: 'submitted',
        priority: 'normal',
        daysAgo: 0,
        by: 'owner',
        comments: [],
      },
    ],
  ];
  return sets[ci % sets.length]!;
}

/** Legacy request on the first published version of the social-post form (shows versioning). */
const legacyRequest: RequestSeed = {
  form: 'social-post@1',
  title: 'منشور اليوم الوطني',
  answers: { platforms: ['instagram', 'x'], message: 'فخورون بوطننا — عروض خاصة بمناسبة اليوم الوطني.', references: null },
  status: 'completed',
  priority: 'normal',
  daysAgo: 20,
  by: 'owner',
  assignee: 'am',
  comments: [{ by: 'am', h: 4, body: 'تم النشر، شكرًا لتعاونكم.' }],
};

const declinedRequest: RequestSeed = {
  form: 'general',
  title: 'تصميم لوحة إعلانية للطريق',
  answers: { details: 'لوحة طرق بمقاس 12×4 متر على طريق الملك فهد.' },
  status: 'declined',
  priority: 'normal',
  daysAgo: 8,
  by: 'member',
  assignee: 'am',
  comments: [{ by: 'am', h: 3, body: 'اللوحات الخارجية خارج نطاق الباقة الحالية، يسعدنا إرسال عرض سعر منفصل.' }],
};

const pathTo: Record<Status, Status[]> = {
  submitted: [],
  in_review: ['in_review'],
  in_progress: ['in_review', 'in_progress'],
  waiting_client: ['in_review', 'in_progress', 'waiting_client'],
  completed: ['in_review', 'in_progress', 'completed'],
  declined: ['in_review', 'declined'],
  cancelled: ['cancelled'],
};

function addWorkingHours(start: Date, hours: number) {
  const d = new Date(start);
  let left = hours;
  while (left > 0) {
    const dow = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Riyadh' })).getDay();
    if (dow !== 5 && dow !== 6) left--;
    d.setHours(d.getHours() + 1);
  }
  return d;
}

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
  const at = (daysAgo: number, plusHours = 0) => new Date(now - daysAgo * 86400000 + plusHours * 3600000);

  // --- Forms ------------------------------------------------------------------
  const forms: Record<string, { id: string; versions: string[]; response: number | null; resolution: number | null }> = {};
  for (const [i, f] of formSeeds.entries()) {
    const [form] = await db
      .insert(schema.requestForms)
      .values({
        organizationId: orgId,
        key: f.key,
        name: f.name,
        description: f.description,
        icon: f.icon,
        category: f.category,
        status: 'draft',
        defaultPriority: f.defaultPriority,
        responseSlaHours: f.response,
        resolutionSlaHours: f.resolution,
        sortOrder: i + 1,
        createdBy: ids.faisal!,
        createdAt: at(60),
      })
      .returning();
    const versionIds: string[] = [];
    for (const [vi, fields] of f.versions.entries()) {
      const [v] = await db
        .insert(schema.requestFormVersions)
        .values({
          organizationId: orgId,
          formId: form!.id,
          version: vi + 1,
          fields,
          publishedAt: f.draft ? null : at(60 - vi * 25),
          publishedBy: f.draft ? null : ids.faisal!,
          createdBy: ids.faisal!,
          createdAt: at(60 - vi * 25),
        })
        .returning();
      versionIds.push(v!.id);
    }
    if (!f.draft) {
      await db
        .update(schema.requestForms)
        .set({ status: 'published', currentVersionId: versionIds.at(-1)! })
        .where(eq(schema.requestForms.id, form!.id));
    }
    forms[f.key] = { id: form!.id, versions: versionIds, response: f.response, resolution: f.resolution };
  }

  // --- Requests ---------------------------------------------------------------
  let total = 0;
  for (const [ci, c] of opts.clients.entries()) {
    const clientId = opts.clientIds[c.slug]!;
    const owner = c.users.find((u) => u.role === 'client_owner')!.key;
    const member = (c.users.find((u) => u.role === 'client_member') ?? c.users[0]!).key;
    const who = (k: Comment['by'] | RequestSeed['by'] | NonNullable<RequestSeed['assignee']>) =>
      ({ am: c.am, owner, member, team0: c.team[0]!, team1: c.team[1] ?? c.team[0]! })[k];
    const sideOf = (k: Comment['by']) => (k === 'owner' || k === 'member' ? 'client' : 'agency');

    const list = [...requestsFor(ci), ...(ci === 0 ? [legacyRequest, declinedRequest] : ci === 2 ? [declinedRequest] : [])];
    for (const r of list) {
      const [formKey, versionNo] = r.form.split('@') as [string, string | undefined];
      const form = forms[formKey]!;
      const versionId = versionNo ? form.versions[Number(versionNo) - 1]! : form.versions.at(-1)!;
      const createdAt = at(r.daysAgo, -3);
      const steps = pathTo[r.status];
      const stepTimes = steps.map(
        (_, i) => new Date(Math.min(createdAt.getTime() + (i + 1) * (r.status === 'cancelled' ? 2 : 3 + i * 8) * 3600000, now - 600000)),
      );
      const lastComment = r.comments.length ? new Date(createdAt.getTime() + Math.max(...r.comments.map((x) => x.h)) * 3600000) : createdAt;
      const lastActivity = new Date(
        Math.max(lastComment.getTime(), ...stepTimes.map((d) => d.getTime()), createdAt.getTime()) +
          (r.status === 'waiting_client' ? 3600000 : 0),
      );
      const firstAgency = [
        ...stepTimes.filter((_, i) => steps[i] !== 'cancelled'),
        ...r.comments.filter((x) => sideOf(x.by) === 'agency' && !x.internal).map((x) => new Date(createdAt.getTime() + x.h * 3600000)),
      ].sort((a, b) => a.getTime() - b.getTime())[0];
      const insertStatus: Status = r.status === 'waiting_client' ? 'in_progress' : r.status;
      const [row] = await db
        .insert(schema.requests)
        .values({
          organizationId: orgId,
          clientId,
          formId: form.id,
          formVersionId: versionId,
          title: r.title,
          answers: r.answers,
          status: insertStatus,
          priority: r.priority,
          assigneeId: r.assignee ? ids[who(r.assignee)]! : null,
          submittedBy: ids[who(r.by)]!,
          submittedSide: 'client',
          desiredDate: r.desired ? inDays(r.desired) : null,
          responseDueAt: form.response ? addWorkingHours(createdAt, form.response) : null,
          resolutionDueAt: form.resolution ? addWorkingHours(createdAt, form.resolution) : null,
          firstResponseAt: firstAgency ?? null,
          resolvedAt: r.status === 'completed' || r.status === 'declined' ? stepTimes.at(-1)! : null,
          cancelledAt: r.status === 'cancelled' ? stepTimes.at(-1)! : null,
          lastActivityAt: lastActivity,
          createdAt,
        })
        .returning({ id: schema.requests.id });
      const requestId = row!.id;
      total++;

      // Lifecycle history (the insert trigger already wrote "submitted").
      const history: (typeof schema.requestEvents.$inferInsert)[] = [];
      if (r.assignee) {
        history.push({
          organizationId: orgId,
          clientId,
          requestId,
          actorId: ids[c.am]!,
          actorSide: 'agency',
          type: 'assigned',
          toValue: ids[who(r.assignee)]!,
          visibility: 'internal',
          createdAt: new Date(createdAt.getTime() + 1800000),
        });
      }
      let prev: Status = 'submitted';
      for (const [i, step] of steps.entries()) {
        if (step === 'waiting_client') continue; // written by the status update below
        const actorKey = step === 'cancelled' ? r.by : (r.assignee ?? 'am');
        history.push({
          organizationId: orgId,
          clientId,
          requestId,
          actorId: ids[who(actorKey)]!,
          actorSide: step === 'cancelled' ? 'client' : 'agency',
          type: 'status_changed',
          fromValue: prev,
          toValue: step,
          visibility: 'client',
          createdAt: stepTimes[i]!,
        });
        prev = step;
      }
      if (history.length) await db.insert(schema.requestEvents).values(history);

      // Conversation.
      const [thread] = await db
        .select({ id: schema.threads.id })
        .from(schema.threads)
        .where(and(eq(schema.threads.subjectType, 'request'), eq(schema.threads.subjectId, requestId)));
      for (const cm of r.comments) {
        await db.insert(schema.comments).values({
          organizationId: orgId,
          clientId,
          threadId: thread!.id,
          authorId: ids[who(cm.by)]!,
          authorSide: sideOf(cm.by),
          body: cm.body,
          visibility: cm.internal ? 'internal' : 'client',
          createdAt: new Date(createdAt.getTime() + cm.h * 3600000),
        });
      }
      await db
        .insert(schema.threadReads)
        .values({ threadId: thread!.id, userId: ids[c.am]!, organizationId: orgId, clientId, lastReadAt: new Date() })
        .onConflictDoNothing();
      await db
        .insert(schema.threadReads)
        .values({ threadId: thread!.id, userId: ids[who(r.by)]!, organizationId: orgId, clientId, lastReadAt: at(r.daysAgo, 2) })
        .onConflictDoNothing();

      if (r.status === 'waiting_client') {
        // Set after the conversation so client replies above don't auto-resume it; attribute the change to the assignee.
        const when = new Date(Math.max(lastComment.getTime() + 300000, (stepTimes.at(-2)?.getTime() ?? 0) + 3600000));
        await db.update(schema.requests).set({ status: 'waiting_client' }).where(eq(schema.requests.id, requestId));
        const [event] = await db
          .select({ id: schema.requestEvents.id })
          .from(schema.requestEvents)
          .where(and(eq(schema.requestEvents.requestId, requestId), eq(schema.requestEvents.toValue, 'waiting_client')))
          .orderBy(desc(schema.requestEvents.createdAt))
          .limit(1);
        await db
          .update(schema.requestEvents)
          .set({ actorId: ids[who(r.assignee ?? 'am')]!, actorSide: 'agency', createdAt: when })
          .where(eq(schema.requestEvents.id, event!.id));
      }

      if (r.attachment) {
        const fileId = crypto.randomUUID();
        const name = r.form.startsWith('social') ? 'reference-post.png' : 'brief.pdf';
        const isImage = name.endsWith('.png');
        const body = isImage ? artworkPng(1080, 1080, c.colors[0], c.colors[1], c.colors[2]) : simplePdf(r.title, ['Brief', 'Details']);
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
          uploadedBy: ids[who(r.by)]!,
          uploaderSide: 'client',
          createdAt,
        });
        await db.insert(schema.requestAttachments).values({ requestId, fileId, organizationId: orgId, clientId, createdAt });
      }
    }
  }

  // A couple of request notifications so the bells aren't empty.
  const [najdRequest] = await db
    .select({ id: schema.requests.id, number: schema.requests.number, title: schema.requests.title })
    .from(schema.requests)
    .where(and(eq(schema.requests.clientId, opts.clientIds['najd-heritage']!), eq(schema.requests.status, 'waiting_client')))
    .limit(1);
  if (najdRequest) {
    const number = `REQ-${String(najdRequest.number).padStart(4, '0')}`;
    await db.insert(schema.notifications).values([
      {
        organizationId: orgId,
        userId: ids.mohammed!,
        type: 'request_status_changed',
        category: 'requests',
        params: { actor: opts.staffNames.noura!, number, title: najdRequest.title, status: 'waiting_client', client: '' },
        link: `/portal/requests/${najdRequest.id}`,
        actorId: ids.noura!,
        createdAt: at(1),
      },
      {
        organizationId: orgId,
        userId: ids.noura!,
        type: 'request_submitted',
        category: 'requests',
        params: { actor: 'محمد الراشد', number, title: najdRequest.title, client: 'مطاعم نجد الأصيلة' },
        link: `/requests/${najdRequest.id}`,
        actorId: ids.mohammed!,
        createdAt: at(2),
      },
    ]);
  }
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from public.request_forms`)) as unknown as [{ n: number }];
  console.info(`✓ Seeded ${n} request forms and ${total} requests.`);
}
