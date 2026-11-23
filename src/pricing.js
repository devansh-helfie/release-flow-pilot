export const UNIT_PRICE = 10;
export const BULK_MIN_QTY = 10;
export const BULK_DISCOUNT_PERCENT = 10;
// Intentional TEST-only defect for the QA demo (QA_DEMO=fail in TEST).
export const DEFECT_DISCOUNT_PERCENT = 1;
const MAX_QTY = 100000;

export function parseQty(raw) {
  const text = String(raw ?? '').trim();
  if (!/^[0-9]+$/.test(text)) {
    throw new RangeError(`qty must be a whole number, got "${text}"`);
  }
  const qty = Number(text);
  if (qty < 1 || qty > MAX_QTY) {
    throw new RangeError(`qty must be between 1 and ${MAX_QTY}, got ${qty}`);
  }
  return qty;
}

// Returns { qty, unitPrice, discountPercent, total } with total rounded to 2 decimals.
export function priceFor(qty, { bulkDiscount, qaDefect }) {
  const unitPrice = UNIT_PRICE;
  let discountPercent = 0;

  if (bulkDiscount && qty >= BULK_MIN_QTY) {
    discountPercent = qaDefect ? DEFECT_DISCOUNT_PERCENT : BULK_DISCOUNT_PERCENT;
  }

  const total = qty * unitPrice * (1 - discountPercent / 100);
  return { qty, unitPrice, discountPercent, total: Math.round(total * 100) / 100 };
}
