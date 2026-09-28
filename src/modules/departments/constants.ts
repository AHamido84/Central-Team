export const departmentColors = ['primary', 'violet', 'rose', 'amber', 'emerald', 'sky', 'slate'] as const;
export type DepartmentColor = (typeof departmentColors)[number];

/** Token-based swatches (light/dark safe) used for department chips. */
export const departmentColorClass: Record<DepartmentColor, string> = {
  primary: 'bg-primary-soft text-primary-soft-foreground',
  violet: 'bg-[color-mix(in_oklab,#8b5cf6_14%,var(--surface))] text-[color-mix(in_oklab,#8b5cf6_80%,var(--foreground))]',
  rose: 'bg-[color-mix(in_oklab,#f43f5e_14%,var(--surface))] text-[color-mix(in_oklab,#f43f5e_80%,var(--foreground))]',
  amber: 'bg-[color-mix(in_oklab,#f59e0b_16%,var(--surface))] text-[color-mix(in_oklab,#d97706_85%,var(--foreground))]',
  emerald: 'bg-[color-mix(in_oklab,#10b981_14%,var(--surface))] text-[color-mix(in_oklab,#059669_85%,var(--foreground))]',
  sky: 'bg-[color-mix(in_oklab,#0ea5e9_14%,var(--surface))] text-[color-mix(in_oklab,#0284c7_85%,var(--foreground))]',
  slate: 'bg-surface-muted text-muted-foreground',
};
