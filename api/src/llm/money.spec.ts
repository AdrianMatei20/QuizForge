import { formatUsd, parseUsd, tokenCostMicros } from './money.js';

describe('parseUsd', () => {
  it.each([
    ['0', 0n],
    ['4', 4_000_000n],
    ['0.10', 100_000n],
    ['5.00', 5_000_000n],
    ['0.000001', 1n],
    ['12.345678', 12_345_678n],
  ])('parses "%s" as %d micros', (value, micros) => {
    expect(parseUsd(value)).toBe(micros);
  });

  it.each(['', '-1', '1.', '.5', '1.2345678', '1e3', 'abc', ' 1', '0.1 '])(
    'rejects "%s"',
    (value) => {
      expect(() => parseUsd(value)).toThrow('is not a USD amount');
    },
  );
});

describe('formatUsd', () => {
  it.each([
    [0n, '0.000000'],
    [1n, '0.000001'],
    [7_000n, '0.007000'],
    [12_345_678n, '12.345678'],
  ])('formats %d micros as "%s"', (micros, text) => {
    expect(formatUsd(micros)).toBe(text);
  });

  it('round-trips with parseUsd', () => {
    expect(formatUsd(parseUsd('3.141592'))).toBe('3.141592');
  });

  it('rejects negative amounts', () => {
    expect(() => formatUsd(-1n)).toThrow();
  });
});

describe('tokenCostMicros', () => {
  it('multiplies tokens by the price per million', () => {
    // 1,000 * $2/M + 500 * $10/M = $0.007
    expect(
      tokenCostMicros([
        { tokens: 1_000, pricePerMillionUsd: '2.00' },
        { tokens: 500, pricePerMillionUsd: '10.00' },
      ]),
    ).toBe(7_000n);
  });

  it('rounds half up, once, after summing', () => {
    // Each charge alone is 0.4 micros (would round to 0); together 0.8 rounds to 1.
    const charge = { tokens: 4, pricePerMillionUsd: '0.10' };
    expect(tokenCostMicros([charge])).toBe(0n);
    expect(tokenCostMicros([charge, charge])).toBe(1n);
    // 5 * $0.10/M = 0.5 micros, which rounds up.
    expect(tokenCostMicros([{ tokens: 5, pricePerMillionUsd: '0.10' }])).toBe(
      1n,
    );
  });

  it('stays exact for large token counts', () => {
    expect(
      tokenCostMicros([{ tokens: 123_456_789, pricePerMillionUsd: '20.00' }]),
    ).toBe(2_469_135_780n);
  });

  it.each([-1, 1.5, Number.NaN])('rejects a token count of %d', (tokens) => {
    expect(() =>
      tokenCostMicros([{ tokens, pricePerMillionUsd: '1' }]),
    ).toThrow('non-negative integer');
  });
});
