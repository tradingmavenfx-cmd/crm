/**
 * Quote arithmetic.
 *
 * All money is computed in integer paise and only converted back at the edges.
 * Doing this in floats drifts - 0.1 + 0.2 is not 0.3, and a quote that prints a
 * total one paisa off its own lines is a quote nobody trusts.
 *
 * The convention matches a printed invoice:
 *   subtotal  = sum of lines, each already net of its own line discount
 *   discount  = the quote-level discount, applied on top
 *   tax       = per line, at that line's own rate, on the post-discount amount
 *   total     = subtotal - discount + tax
 */

export interface PricedLineInput {
  quantity: number;
  unitPrice: number;
  /** Discount on this line alone, percent */
  discountPercent?: number;
  /** GST rate for this line, percent */
  taxRate?: number;
}

export interface PricedLine extends PricedLineInput {
  /** Quantity x price, net of this line's own discount */
  lineTotal: number;
}

export interface QuoteTotals {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  lines: PricedLine[];
  /** Tax broken out by rate, which a GST invoice has to show */
  taxByRate: { rate: number; taxable: number; tax: number }[];
}

/** Major units -> integer paise, rounded half-up. */
function toPaise(amount: number): number {
  return Math.round((Number(amount) || 0) * 100);
}

function toMajor(paise: number): number {
  return Math.round(paise) / 100;
}

/** Applies a percentage to a paise amount, staying in integers. */
function percentOf(paise: number, percent: number): number {
  return Math.round((paise * (Number(percent) || 0)) / 100);
}

export function priceQuote(
  lines: PricedLineInput[],
  headerDiscountPercent = 0,
): QuoteTotals {
  const headerPct = Math.max(
    0,
    Math.min(100, Number(headerDiscountPercent) || 0),
  );

  const priced = lines.map((line) => {
    const quantity = Number(line.quantity) || 0;
    // Quantity may be fractional, so the gross is rounded to the paisa once,
    // here, and every later figure derives from that rounded value.
    const grossPaise = Math.round(toPaise(line.unitPrice) * quantity);
    const lineDiscountPaise = percentOf(grossPaise, line.discountPercent ?? 0);
    const netPaise = grossPaise - lineDiscountPaise;

    return {
      input: line,
      netPaise,
      taxRate: Number(line.taxRate ?? 0) || 0,
    };
  });

  const subtotalPaise = priced.reduce((sum, l) => sum + l.netPaise, 0);
  const headerDiscountPaise = percentOf(subtotalPaise, headerPct);

  // The header discount is spread across lines so tax stays correct per rate.
  const byRate = new Map<number, { taxablePaise: number; taxPaise: number }>();
  let taxPaiseTotal = 0;

  for (const line of priced) {
    const share = percentOf(line.netPaise, headerPct);
    const taxablePaise = line.netPaise - share;
    const taxPaise = percentOf(taxablePaise, line.taxRate);
    taxPaiseTotal += taxPaise;

    const bucket = byRate.get(line.taxRate) ?? { taxablePaise: 0, taxPaise: 0 };
    bucket.taxablePaise += taxablePaise;
    bucket.taxPaise += taxPaise;
    byRate.set(line.taxRate, bucket);
  }

  const totalPaise = subtotalPaise - headerDiscountPaise + taxPaiseTotal;

  return {
    subtotal: toMajor(subtotalPaise),
    discountAmount: toMajor(headerDiscountPaise),
    taxAmount: toMajor(taxPaiseTotal),
    total: toMajor(totalPaise),
    lines: priced.map((l) => ({
      ...l.input,
      lineTotal: toMajor(l.netPaise),
    })),
    taxByRate: [...byRate.entries()]
      .sort(([a], [b]) => a - b)
      .map(([rate, b]) => ({
        rate,
        taxable: toMajor(b.taxablePaise),
        tax: toMajor(b.taxPaise),
      })),
  };
}
