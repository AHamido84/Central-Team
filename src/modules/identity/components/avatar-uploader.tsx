'use client';

import { Camera, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/primitives';
import { PUBLIC_ASSETS_BUCKET, publicAssetUrl } from '@/lib/storage';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { requestAvatarUploadAction } from '@/modules/identity/server/actions';

/** Downscales to a square-ish 512px WebP in the browser so avatars stay small (UI.md §8). */
async function resizeImage(file: File, max = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/webp', 0.88));
}

export function AvatarUploader({ name, value, onChange }: { name: string; value: string | null; onChange: (path: string | null) => void }) {
  const t = useTranslations();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('errors.file_type_not_allowed'));
      return;
    }
    setBusy(true);
    try {
      const blob = await resizeImage(file);
      const res = await requestAvatarUploadAction({ contentType: 'image/webp', size: blob.size });
      if (!res.ok) throw new Error(res.error.code);
      const { error } = await getSupabaseBrowserClient()
        .storage.from(PUBLIC_ASSETS_BUCKET)
        .uploadToSignedUrl(res.data.path, res.data.token, blob, { contentType: 'image/webp' });
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
      <Avatar name={name || '?'} src={publicAssetUrl(value)} size="xl" />
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(e) => void onFile(e.target.files?.[0])}
          data-testid="avatar-input"
        />
        <Button type="button" variant="outline" size="sm" loading={busy} onClick={() => input.current?.click()}>
          {busy ? null : <Camera />}
          {value ? t('onboarding.changePhoto') : t('onboarding.uploadPhoto')}
        </Button>
        {value ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            <Trash2 />
            {t('common.remove')}
          </Button>
        ) : null}
        <p className="w-full text-xs text-subtle-foreground">{t('onboarding.photoHint')}</p>
      </div>
    </div>
  );
}
