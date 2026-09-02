import { priceQuote } from './pricing';

describe('priceQuote', () => {
  it('totals a simple line with GST', () => {
    const t = priceQuote([{ quantity: 2, unitPrice: 1000, taxRate: 18 }]);

    expect(t.subtotal).toBe(2000);
    expect(t.discountAmount).toBe(0);
    expect(t.taxAmount).toBe(360);
    expect(t.total).toBe(2360);
  });

  it('applies a line discount before tax', () => {
    const t = priceQuote([
      { quantity: 1, unitPrice: 1000, discountPercent: 10, taxRate: 18 },
    ]);

    expect(t.lines[0].lineTotal).toBe(900);
    expect(t.subtotal).toBe(900);
    expect(t.taxAmount).toBe(162);
    expect(t.total).toBe(1062);
  });

  it('applies the quote discount on top of line discounts', () => {
    const t = priceQuote(
      [{ quantity: 1, unitPrice: 1000, discountPercent: 10, taxRate: 18 }],
      50,
    );

    // 1000 -10% = 900, then -50% = 450 taxable, 18% = 81
    expect(t.subtotal).toBe(900);
    expect(t.discountAmount).toBe(450);
    expect(t.taxAmount).toBe(81);
    expect(t.total).toBe(531);
  });

  it('keeps subtotal - discount + tax = total', () => {
    const t = priceQuote(
      [
        { quantity: 3, unitPrice: 1999.99, discountPercent: 7.5, taxRate: 18 },
        { quantity: 1, unitPrice: 499.5, taxRate: 5 },
        { quantity: 2.5, unitPrice: 120.25, discountPercent: 3, taxRate: 12 },
      ],
      12.5,
    );

    expect(t.total).toBeCloseTo(t.subtotal - t.discountAmount + t.taxAmount, 2);
  });

  it('does not drift on the classic float case', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; in paise it is exactly 30.
    const t = priceQuote([
      { quantity: 1, unitPrice: 0.1, taxRate: 0 },
      { quantity: 1, unitPrice: 0.2, taxRate: 0 },
    ]);

    expect(t.subtotal).toBe(0.3);
    expect(t.total).toBe(0.3);
  });

  it('rounds a fractional quantity to the paisa once', () => {
    const t = priceQuote([{ quantity: 1.5, unitPrice: 333.33, taxRate: 0 }]);

    // 1.5 x 333.33 = 499.995 -> 500.00 (a single rounding, not per step)
    expect(t.subtotal).toBe(500);
  });

  it('breaks tax out by rate, as a GST invoice must', () => {
    const t = priceQuote([
      { quantity: 1, unitPrice: 1000, taxRate: 18 },
      { quantity: 1, unitPrice: 1000, taxRate: 5 },
      { quantity: 1, unitPrice: 500, taxRate: 18 },
    ]);

    expect(t.taxByRate).toEqual([
      { rate: 5, taxable: 1000, tax: 50 },
      { rate: 18, taxable: 1500, tax: 270 },
    ]);
    expect(t.taxAmount).toBe(320);
  });

  it('spreads the quote discount across rates rather than one bucket', () => {
    const t = priceQuote(
      [
        { quantity: 1, unitPrice: 1000, taxRate: 18 },
        { quantity: 1, unitPrice: 1000, taxRate: 5 },
      ],
      50,
    );

    // Each line is halved before its own rate applies.
    expect(t.taxByRate).toEqual([
      { rate: 5, taxable: 500, tax: 25 },
      { rate: 18, taxable: 500, tax: 90 },
    ]);
    expect(t.taxAmount).toBe(115);
  });

  it('handles an empty quote', () => {
    const t = priceQuote([]);
    expect(t).toMatchObject({
      subtotal: 0,
      discountAmount: 0,
      taxAmount: 0,
      total: 0,
    });
  });

  it('clamps a nonsensical discount instead of inverting the total', () => {
    const over = priceQuote([{ quantity: 1, unitPrice: 100, taxRate: 0 }], 150);
    expect(over.total).toBe(0);

    const under = priceQuote(
      [{ quantity: 1, unitPrice: 100, taxRate: 0 }],
      -20,
    );
    expect(under.total).toBe(100);
  });

  it('treats missing rates and discounts as zero', () => {
    const t = priceQuote([{ quantity: 2, unitPrice: 50 }]);
    expect(t).toMatchObject({ subtotal: 100, taxAmount: 0, total: 100 });
  });

  it('never returns a fraction of a paisa', () => {
    const t = priceQuote(
      [{ quantity: 7, unitPrice: 33.33, discountPercent: 3.7, taxRate: 18 }],
      6.3,
    );

    for (const value of [t.subtotal, t.discountAmount, t.taxAmount, t.total]) {
      expect(Number.isInteger(Math.round(value * 100))).toBe(true);
      expect(value).toBeCloseTo(Math.round(value * 100) / 100, 10);
    }
  });
});
