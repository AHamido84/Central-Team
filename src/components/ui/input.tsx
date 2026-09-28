import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils/cn';

export const inputClass =
  'flex h-10 w-full min-w-0 rounded-md border border-input bg-surface px-3 text-[0.9375rem] shadow-xs transition-[border-color,box-shadow] duration-(--duration-fast) outline-none placeholder:text-subtle-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-danger/20 file:me-3 file:border-0 file:bg-transparent file:text-sm file:font-medium sm:h-9 sm:text-sm';

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return <input data-slot="input" type={type} className={cn(inputClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea data-slot="textarea" className={cn(inputClass, 'field-sizing-content min-h-20 py-2 leading-relaxed', className)} {...props} />
  );
}
