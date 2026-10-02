'use client';

import { Download, Maximize2, MessageSquarePlus, Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { FileTypeIcon } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/primitives';
import { cn } from '@/lib/utils/cn';
import type { AnnotationItem, VersionFile } from '@/modules/deliverables/server/queries';

export type Pending =
  | { kind: 'point'; fileId: string; x: number; y: number }
  | { kind: 'timestamp'; fileId: string; timeSeconds: number }
  | { kind: 'general' };

export function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Numbered pin; numbers follow the annotation order in the sidebar. */
function Pin({
  n,
  x,
  y,
  active,
  pending,
  resolved,
  onClick,
  label,
}: {
  n?: number;
  x: number;
  y: number;
  active?: boolean;
  pending?: boolean;
  resolved?: boolean;
  onClick?: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      aria-label={label}
      // Image coordinates are physical (0 = left edge of the picture), independent of the page direction.
      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
      className={cn(
        'absolute z-10 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs font-bold shadow-md transition-transform focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        pending
          ? 'animate-pulse bg-warning text-white'
          : resolved
            ? 'bg-surface-muted text-muted-foreground'
            : 'bg-primary text-primary-foreground',
        active && 'scale-125 ring-2 ring-primary',
      )}
      data-testid={pending ? 'pin-pending' : 'annotation-pin'}
    >
      {n ?? '+'}
    </button>
  );
}

export function ImageViewer({
  file,
  annotations,
  numbering,
  activeId,
  pending,
  canAnnotate,
  onPin,
  onSelect,
}: {
  file: VersionFile;
  annotations: AnnotationItem[];
  numbering: Map<string, number>;
  activeId: string | null;
  pending: Pending | null;
  canAnnotate: boolean;
  onPin: (x: number, y: number) => void;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations('deliverables.viewer');
  const [zoom, setZoom] = useState(1);
  const pins = annotations.filter((a) => a.kind === 'point' && a.fileId === file.id && a.x !== null && a.y !== null);
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
          aria-label={t('zoomOut')}
          data-testid="zoom-out"
        >
          <Minus />
        </Button>
        <span className="tabular w-12 text-center text-xs text-muted-foreground" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}
          aria-label={t('zoomIn')}
          data-testid="zoom-in"
        >
          <Plus />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => setZoom(1)} aria-label={t('fit')}>
          <Maximize2 />
        </Button>
        {canAnnotate ? <p className="ms-auto text-xs text-muted-foreground">{t('clickToPin')}</p> : null}
      </div>
      <div className="max-h-[75dvh] overflow-auto rounded-xl bg-surface-muted/60 p-2 sm:p-4" dir="ltr" data-testid="image-stage">
        {/* The wrapper hugs the picture so pins (fractions of the image) land on the same spot at every zoom level. */}
        <div className="relative mx-auto w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from Storage */}
          <img
            src={file.url ?? ''}
            alt={file.name}
            style={zoom === 1 ? undefined : { height: `${Math.round(65 * zoom)}dvh`, maxWidth: 'none' }}
            className={cn(
              'block h-auto max-h-[65dvh] w-auto max-w-full rounded-md shadow-sm select-none',
              zoom !== 1 && 'max-h-none',
              canAnnotate && 'cursor-crosshair',
            )}
            draggable={false}
            onClick={(e) => {
              if (!canAnnotate) return;
              const r = e.currentTarget.getBoundingClientRect();
              onPin(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
            }}
            data-testid="viewer-image"
          />
          {pins.map((a) => (
            <Pin
              key={a.id}
              n={numbering.get(a.id)}
              x={a.x!}
              y={a.y!}
              active={a.id === activeId}
              resolved={Boolean(a.resolvedAt)}
              onClick={() => onSelect(a.id)}
              label={t('pinLabel', { n: numbering.get(a.id) ?? 0 })}
            />
          ))}
          {pending?.kind === 'point' && pending.fileId === file.id ? <Pin x={pending.x} y={pending.y} pending label={t('newPin')} /> : null}
        </div>
      </div>
    </div>
  );
}

export function VideoViewer({
  file,
  annotations,
  numbering,
  activeId,
  pending,
  canAnnotate,
  onTime,
  onSelect,
}: {
  file: VersionFile;
  annotations: AnnotationItem[];
  numbering: Map<string, number>;
  activeId: string | null;
  pending: Pending | null;
  canAnnotate: boolean;
  onTime: (seconds: number) => void;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations('deliverables.viewer');
  const video = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(file.durationSeconds ?? 0);
  const [current, setCurrent] = useState(0);
  const marks = annotations.filter((a) => a.kind === 'timestamp' && a.fileId === file.id && a.timeSeconds !== null);
  const active = annotations.find((a) => a.id === activeId);
  useEffect(() => {
    if (active?.kind === 'timestamp' && active.fileId === file.id && video.current) video.current.currentTime = active.timeSeconds ?? 0;
  }, [active, file.id]);
  const total = duration || Math.max(1, ...marks.map((m) => m.timeSeconds ?? 0));
  return (
    <div className="grid gap-3">
      <div className="overflow-hidden rounded-xl bg-black">
        <video
          ref={video}
          src={file.url ?? undefined}
          poster={file.thumbUrl ?? undefined}
          controls
          playsInline
          preload="metadata"
          className="mx-auto max-h-[70dvh] w-full"
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          data-testid="viewer-video"
        >
          <track kind="captions" />
        </video>
      </div>
      <div className="grid gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t('timeline')}</span>
          <span dir="ltr" className="tabular">
            {formatTime(current)} / {formatTime(total)}
          </span>
          {canAnnotate ? (
            <Button
              variant="soft"
              size="sm"
              className="ms-auto"
              onClick={() => {
                video.current?.pause();
                onTime(video.current?.currentTime ?? 0);
              }}
              data-testid="comment-at-time"
            >
              <MessageSquarePlus />
              {t('commentAt', { time: formatTime(current) })}
            </Button>
          ) : null}
        </div>
        {/* The timeline runs left→right like the player's own progress bar, in both languages. */}
        <div
          dir="ltr"
          role={canAnnotate ? 'button' : undefined}
          tabIndex={canAnnotate ? 0 : undefined}
          aria-label={canAnnotate ? t('timelineHint') : undefined}
          className={cn('relative h-8 rounded-md bg-surface-muted', canAnnotate && 'cursor-pointer')}
          onClick={(e) => {
            if (!canAnnotate) return;
            const r = e.currentTarget.getBoundingClientRect();
            const s = ((e.clientX - r.left) / r.width) * total;
            if (video.current) {
              video.current.currentTime = s;
              video.current.pause();
            }
            onTime(s);
          }}
          onKeyDown={(e) => {
            if (canAnnotate && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              onTime(video.current?.currentTime ?? 0);
            }
          }}
          data-testid="video-timeline"
        >
          <span
            className="absolute inset-y-0 start-0 rounded-md bg-primary/15"
            style={{ width: `${Math.min(100, (current / total) * 100)}%` }}
          />
          {marks.map((m) => (
            <Tooltip key={m.id} content={`${formatTime(m.timeSeconds!)} · ${m.body}`}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(m.id);
                }}
                style={{ left: `${Math.min(100, ((m.timeSeconds ?? 0) / total) * 100)}%` }}
                className={cn(
                  'absolute top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-[0.625rem] font-bold shadow',
                  m.resolvedAt ? 'bg-surface text-muted-foreground' : 'bg-primary text-primary-foreground',
                  m.id === activeId && 'ring-2 ring-primary',
                )}
                aria-label={t('markerLabel', { n: numbering.get(m.id) ?? 0, time: formatTime(m.timeSeconds ?? 0) })}
                data-testid="timeline-marker"
              >
                {numbering.get(m.id)}
              </button>
            </Tooltip>
          ))}
          {pending?.kind === 'timestamp' && pending.fileId === file.id ? (
            <span
              className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-warning"
              style={{ left: `${Math.min(100, (pending.timeSeconds / total) * 100)}%` }}
              aria-hidden
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function DocumentViewer({ file }: { file: VersionFile }) {
  const t = useTranslations('deliverables.viewer');
  const f = useFormat();
  return (
    <div className="grid gap-3">
      {file.kind === 'pdf' && file.url ? (
        <iframe
          src={file.url}
          title={file.name}
          className="h-[70dvh] w-full rounded-xl border border-border bg-surface"
          data-testid="viewer-pdf"
        />
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
          <FileTypeIcon kind={file.kind} className="size-12" />
          <div className="min-w-0 flex-1">
            <bdi className="block truncate font-medium">{file.name}</bdi>
            <span className="text-xs text-muted-foreground">{f.bytes(file.sizeBytes)}</span>
          </div>
        </div>
      )}
      {file.url ? (
        <Button asChild variant="outline" size="sm" className="justify-self-start">
          <a href={file.url} download={file.name} target="_blank" rel="noreferrer">
            <Download />
            {t('download')}
          </a>
        </Button>
      ) : null}
    </div>
  );
}
