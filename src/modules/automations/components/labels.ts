/** `lead.created` / `lead.source` → `lead_created` / `lead_source` (message keys can't contain dots). */
export const labelKey = (key: string) => key.replace(/\./g, '_');
