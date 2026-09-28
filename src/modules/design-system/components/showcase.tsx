'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Bell, Briefcase, FolderOpen, Inbox, Mail, MessageSquare, Plus, Save, Trash2, Upload, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { EmptyState, FileTypeIcon, PageHeader, SectionTitle, StatCard } from '@/components/patterns';
import { DataTable } from '@/components/patterns/data-table';
import { useFormat } from '@/components/providers';
import { LanguageSwitcher, ThemeToggle } from '@/components/shell/preferences-menu';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/overlays';
import {
  Avatar,
  AvatarGroup,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Kbd,
  Label,
  NativeSelect,
  Progress,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
} from '@/components/ui/primitives';
import { cn } from '@/lib/utils/cn';

export type PanelStrings = { title: string; body: string; primary: string; secondary: string; input: string; badge: string; stat: string };

const people = ['سارة القحطاني', 'Faisal Al-Harbi', 'نورة العتيبي', 'Reem Al-Dosari', 'خالد المطيري', 'Omar Al-Ghamdi'].map((name, i) => ({ id: String(i), name }));

function Swatch({ name, varName }: { name: string; varName: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-9 shrink-0 rounded-md border border-border" style={{ backgroundColor: `var(${varName})` }} />
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{name}</span>
        <code className="block text-[0.6875rem] text-subtle-foreground" dir="ltr">
          {varName}
        </code>
      </span>
    </div>
  );
}

/** Compact sample rendered in each locale × theme panel of the matrix. */
function Panel({ strings, dir, lang, theme }: { strings: PanelStrings; dir: 'rtl' | 'ltr'; lang: string; theme: 'light' | 'dark' }) {
  return (
    <div dir={dir} lang={lang} className={cn(theme, 'rounded-xl border border-border bg-background p-4 text-foreground')} data-testid={`panel-${lang}-${theme}`}>
      <p className="mb-3 text-xs font-medium text-subtle-foreground">
        {lang.toUpperCase()} · {theme}
      </p>
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <Avatar name={people[0]!.name} size="md" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{strings.title}</p>
            <p className="text-sm text-muted-foreground">{strings.body}</p>
          </div>
          <Badge tone="success" dot>
            {strings.badge}
          </Badge>
        </div>
        <Input className="mt-4" placeholder={strings.input} />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm">
            <Plus />
            {strings.primary}
          </Button>
          <Button size="sm" variant="outline">
            {strings.secondary}
          </Button>
        </div>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-subtle-foreground">
            <span>{strings.stat}</span>
            <span className="tabular">65%</span>
          </div>
          <Progress value={65} />
        </div>
      </Card>
    </div>
  );
}

type Row = { id: string; name: string; role: string; status: 'active' | 'pending' };

export function DesignSystemShowcase({ panels }: { panels: { ar: PanelStrings; en: PanelStrings } }) {
  const t = useTranslations('designSystem');
  const tc = useTranslations('common');
  const f = useFormat();
  const [checked, setChecked] = useState(true);
  const [switched, setSwitched] = useState(true);
  const [confirm, setConfirm] = useState(false);

  const rows: Row[] = people.map((p, i) => ({ id: p.id, name: p.name, role: t(i % 2 ? 'sampleRoleDesigner' : 'sampleRoleManager'), status: i % 3 ? 'active' : 'pending' }));
  const columns: ColumnDef<Row, unknown>[] = [
    { id: 'name', header: tc('name'), accessorFn: (r) => r.name, cell: ({ row }) => <span className="flex items-center gap-2"><Avatar name={row.original.name} size="xs" />{row.original.name}</span> },
    { id: 'role', header: tc('role'), accessorFn: (r) => r.role },
    { id: 'status', header: tc('status'), accessorFn: (r) => r.status, cell: ({ row }) => <Badge tone={row.original.status === 'active' ? 'success' : 'info'} dot>{tc(row.original.status)}</Badge> },
  ];

  return (
    <div className="space-y-12" data-testid="design-system">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <LanguageSwitcher variant="full" />
            <ThemeToggle />
          </>
        }
      />

      <section>
        <SectionTitle title={t('matrix')} />
        <p className="-mt-2 mb-4 text-sm text-muted-foreground">{t('matrixHint')}</p>
        <div className="grid gap-4 md:grid-cols-2">
          <Panel strings={panels.ar} dir="rtl" lang="ar" theme="light" />
          <Panel strings={panels.ar} dir="rtl" lang="ar" theme="dark" />
          <Panel strings={panels.en} dir="ltr" lang="en" theme="light" />
          <Panel strings={panels.en} dir="ltr" lang="en" theme="dark" />
        </div>
      </section>

      <section>
        <SectionTitle title={t('colors')} />
        <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Primary', '--primary'],
            ['Primary soft', '--primary-soft'],
            ['Accent', '--accent'],
            ['Background', '--background'],
            ['Surface', '--surface'],
            ['Surface muted', '--surface-muted'],
            ['Border', '--border'],
            ['Foreground', '--foreground'],
            ['Success', '--success'],
            ['Warning', '--warning'],
            ['Danger', '--danger'],
            ['Info', '--info'],
          ].map(([name, v]) => (
            <Swatch key={v} name={name!} varName={v!} />
          ))}
        </Card>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {[50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => (
            <span key={step} className="flex h-10 w-14 items-end rounded-md p-1 text-[0.625rem] font-medium" style={{ backgroundColor: `var(--indigo-${step})`, color: step >= 500 ? 'white' : 'var(--indigo-950)' }}>
              {step}
            </span>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle title={t('typography')} />
        <Card className="space-y-3 p-5">
          <p className="text-display font-semibold">{t('sampleHeading')}</p>
          <p className="text-h1 font-semibold">{t('sampleHeading')}</p>
          <p className="text-h2 font-semibold">{t('sampleHeading')}</p>
          <p className="text-h3 font-semibold">{t('sampleHeading')}</p>
          <p>{t('sampleBody')}</p>
          <p className="text-sm text-muted-foreground">{t('sampleBody')}</p>
          <p className="text-xs text-subtle-foreground">{t('sampleBody')}</p>
          <p className="tabular text-h3">{f.currency(1450000)} · {f.number(1234567.89)} · {f.date(new Date(), 'long')} · {f.percent(0.72)}</p>
        </Card>
      </section>

      <section>
        <SectionTitle title={t('buttons')} />
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Button>{t('primary')}</Button>
            <Button variant="secondary">{t('secondary')}</Button>
            <Button variant="outline">{t('outline')}</Button>
            <Button variant="ghost">{t('ghost')}</Button>
            <Button variant="soft">{t('soft')}</Button>
            <Button variant="destructive">
              <Trash2 />
              {tc('delete')}
            </Button>
            <Button variant="link">{t('link')}</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">{t('small')}</Button>
            <Button>{t('medium')}</Button>
            <Button size="lg">{t('large')}</Button>
            <Button loading>{tc('loading')}</Button>
            <Button disabled>{t('disabled')}</Button>
            <Tooltip content={tc('upload')}>
              <Button size="icon" variant="outline" aria-label={tc('upload')}>
                <Upload />
              </Button>
            </Tooltip>
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle title={t('forms')} />
        <Card className="grid gap-5 p-5 md:grid-cols-2">
          <Field label={tc('name')} hint={t('hint')} required>
            {(p) => <Input {...p} placeholder={t('placeholder')} />}
          </Field>
          <Field label={tc('email')} error="invalid_email">
            {(p) => <Input {...p} type="email" dir="ltr" defaultValue="sara@" />}
          </Field>
          <Field label={tc('role')}>
            {(p) => (
              <NativeSelect {...p}>
                <option>{t('sampleRoleManager')}</option>
                <option>{t('sampleRoleDesigner')}</option>
              </NativeSelect>
            )}
          </Field>
          <Field label={t('textarea')} optional>
            {(p) => <Textarea {...p} placeholder={t('placeholder')} />}
          </Field>
          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} />
              {t('checkbox')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={switched} onCheckedChange={setSwitched} />
              {t('switch')}
            </label>
          </div>
          <RadioGroup defaultValue="a" className="flex gap-6">
            {['a', 'b'].map((v) => (
              <div key={v} className="flex items-center gap-2">
                <RadioGroupItem value={v} id={`r-${v}`} />
                <Label htmlFor={`r-${v}`}>{t('option', { n: v === 'a' ? 1 : 2 })}</Label>
              </div>
            ))}
          </RadioGroup>
        </Card>
      </section>

      <section>
        <SectionTitle title={t('dataDisplay')} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label={t('statClients')} value={f.number(24)} delta={12} deltaLabel={f.percent(0.12)} icon={Briefcase} footer={t('statFooter')} />
          <StatCard label={t('statMessages')} value={f.number(8)} delta={-3} deltaLabel={f.percent(0.03)} icon={MessageSquare} />
          <StatCard label={t('statFiles')} value={f.number(312)} delta={0} deltaLabel={f.percent(0)} icon={FolderOpen} />
          <Card className="p-5">
            <CardTitle className="mb-3 text-sm">{t('avatars')}</CardTitle>
            <div className="flex items-center gap-2">
              {(['xs', 'sm', 'md', 'lg'] as const).map((s) => (
                <Avatar key={s} name={people[0]!.name} size={s} />
              ))}
            </div>
            <div className="mt-3">
              <AvatarGroup people={people} max={4} />
            </div>
          </Card>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(['neutral', 'brand', 'success', 'warning', 'danger', 'info', 'accent', 'outline'] as const).map((tone) => (
            <Badge key={tone} tone={tone} dot>
              {tone}
            </Badge>
          ))}
          <Kbd>⌘K</Kbd>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>{t('cardTitle')}</CardTitle>
                <CardDescription>{t('cardDescription')}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Progress value={30} />
              <Progress value={70} tone="success" />
              <Progress value={100} tone="warning" />
            </CardContent>
          </Card>
          <Card className="space-y-3 p-5">
            <p className="text-sm font-medium">{t('skeletons')}</p>
            <div className="flex gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
            <Skeleton className="h-20" />
          </Card>
          <Card className="space-y-2 p-5">
            <p className="text-sm font-medium">{t('fileCards')}</p>
            {(['image', 'pdf', 'video', 'document'] as const).map((k) => (
              <div key={k} className="flex items-center gap-3 rounded-md border border-border p-2">
                <FileTypeIcon kind={k} className="size-8" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  <bdi>{`campaign-${k}.${k === 'image' ? 'png' : k === 'video' ? 'mp4' : k === 'pdf' ? 'pdf' : 'docx'}`}</bdi>
                </span>
                <span className="text-xs text-subtle-foreground">{f.bytes(1024 * 1024 * 2.4)}</span>
              </div>
            ))}
          </Card>
        </div>
      </section>

      <section>
        <SectionTitle title={t('emptyStates')} />
        <Card>
          <EmptyState icon={Inbox} title={t('emptyTitle')} description={t('emptyBody')} action={<Button><Plus />{tc('create')}</Button>} secondaryAction={<Button variant="ghost">{t('learnMore')}</Button>} />
        </Card>
      </section>

      <section>
        <SectionTitle title={t('navigation')} />
        <Card className="p-5">
          <Tabs defaultValue="one">
            <TabsList>
              <TabsTrigger value="one">
                <Users />
                {t('tabOne')}
              </TabsTrigger>
              <TabsTrigger value="two">
                <Bell />
                {t('tabTwo')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="one">
              <p className="text-sm text-muted-foreground">{t('tabOneBody')}</p>
            </TabsContent>
            <TabsContent value="two">
              <p className="text-sm text-muted-foreground">{t('tabTwoBody')}</p>
            </TabsContent>
          </Tabs>
        </Card>
      </section>

      <section>
        <SectionTitle title={t('overlays')} />
        <Card className="flex flex-wrap gap-2 p-5">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">{t('openDialog')}</Button>
            </DialogTrigger>
            <DialogContent closeLabel={tc('close')}>
              <DialogHeader>
                <DialogTitle>{t('dialogTitle')}</DialogTitle>
                <DialogDescription>{t('dialogBody')}</DialogDescription>
              </DialogHeader>
              <DialogBody>
                <Field label={tc('name')}>{(p) => <Input {...p} />}</Field>
              </DialogBody>
              <DialogFooter>
                <Button>
                  <Save />
                  {tc('save')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">{t('openDrawer')}</Button>
            </SheetTrigger>
            <SheetContent closeLabel={tc('close')} className="p-5">
              <SheetTitle>{t('drawerTitle')}</SheetTitle>
              <SheetDescription className="mt-1">{t('dialogBody')}</SheetDescription>
            </SheetContent>
          </Sheet>
          <Button variant="outline" onClick={() => setConfirm(true)}>
            {t('openConfirm')}
          </Button>
          <ConfirmDialog
            open={confirm}
            onOpenChange={setConfirm}
            title={t('confirmTitle')}
            description={t('confirmBody')}
            confirmLabel={tc('delete')}
            cancelLabel={tc('cancel')}
            destructive
            onConfirm={() => toast.success(t('toastSuccess'))}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">{t('openMenu')}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>{tc('actions')}</DropdownMenuLabel>
              <DropdownMenuItem>
                <Mail />
                {t('menuItem')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive>
                <Trash2 />
                {tc('delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={() => toast.success(t('toastSuccess'))}>
            {t('toast')}
          </Button>
          <Button variant="outline" onClick={() => toast.error(t('toastError'))}>
            {t('toastErrorButton')}
          </Button>
        </Card>
      </section>

      <section>
        <SectionTitle title={t('dataTable')} />
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          searchFn={(r, q) => r.name.toLowerCase().includes(q)}
          bulkActions={(selected, clear) => (
            <Button size="sm" variant="outline" onClick={clear}>
              {t('clearSelection', { count: selected.length })}
            </Button>
          )}
          mobileCard={(r) => (
            <div className="flex items-center gap-3 px-4 py-3">
              <Avatar name={r.name} size="sm" />
              <span className="flex-1 truncate text-sm">{r.name}</span>
              <Badge>{r.role}</Badge>
            </div>
          )}
        />
      </section>
    </div>
  );
}
