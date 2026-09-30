/** Quote maths — mirrors `app.quote_recalculate` (line = round(quantity × unit price); total = subtotal − discount, ≥ 0). */
export type QuoteLine = { quantity: number; unitPriceMinor: number };

export const lineTotal = (l: QuoteLine) => Math.round(l.quantity * l.unitPriceMinor);

export function quoteTotals(lines: readonly QuoteLine[], discountMinor: number) {
  const subtotal = lines.reduce((n, l) => n + lineTotal(l), 0);
  return { subtotal, discount: Math.min(Math.max(0, discountMinor), subtotal), total: Math.max(0, subtotal - Math.max(0, discountMinor)) };
}
