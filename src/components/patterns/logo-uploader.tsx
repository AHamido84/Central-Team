'use client';

import { ImageUp, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/primitives';
import { PUBLIC_ASSETS_BUCKET, publicAssetUrl } from '@/lib/storage';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { requestLogoUploadAction } from '@/modules/organizations/server/actions';

/** Square logo uploader for the organization or a client (public-assets bucket, ≤ 2 MB). */
export function LogoUploader({
  name,
  value,
  onChange,
  target,
  clientId = null,
  disabled,
}: {
  name: string;
  value: string | null;
  onChange: (path: string | null) => void;
  target: 'organization' | 'client';
  clientId?: string | null;
  disabled?: boolean;
}) {
  const t = useTranslations();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const onFile = async (file?: File) => {
    if (!file) return;
    const type = file.type as 'image/png' | 'image/jpeg' | 'image/webp';
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) return void toast.error(t('errors.file_type_not_allowed'));
    if (file.size > 2 * 1024 * 1024) return void toast.error(t('errors.file_too_large'));
    setBusy(true);
    try {
      const res = await requestLogoUploadAction({ target, clientId, contentType: type, size: file.size });
      if (!res.ok) throw new Error(res.error.code);
      const { error } = await getSupabaseBrowserClient()
        .storage.from(PUBLIC_ASSETS_BUCKET)
        .uploadToSignedUrl(res.data.path, res.data.token, file, { contentType: type });
      if (error) throw error;
      onChange(res.data.path);
    } catch {
      toast.error(t('errors.upload_failed'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="flex items-center gap-4">
      <Avatar name={name || '?'} src={publicAssetUrl(value)} size="xl" square />
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          className="sr-only"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <Button type="button" variant="outline" size="sm" loading={busy} disabled={disabled} onClick={() => input.current?.click()}>
          {busy ? null : <ImageUp />}
          {value ? t('admin.organization.changeLogo') : t('admin.organization.uploadLogo')}
        </Button>
        {value && !disabled ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            <Trash2 />
            {t('common.remove')}
          </Button>
        ) : null}
        <p className="w-full text-xs text-subtle-foreground">{t('admin.organization.logoHint')}</p>
      </div>
    </div>
  );
}
