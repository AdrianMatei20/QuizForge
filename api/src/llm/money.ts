/**
 * USD amounts as BigInt micro-dollars (1 USD = 1_000_000 micros), so money is
 * never a float. Decimal strings come in from config and Postgres numeric
 * columns and go back out as strings with 6 decimal places, matching
 * llm_calls.cost_usd numeric(12,6).
 */

const MICROS_PER_USD = 1_000_000n;
const USD_DECIMAL = /^(\d+)(?:\.(\d{1,6}))?$/;

/** Parses "4", "0.10" or "0.000123" into micros. Rejects negatives, exponents and more than 6 decimals. */
export function parseUsd(value: string): bigint {
  const match = USD_DECIMAL.exec(value);
  if (!match) {
    throw new Error(`"${value}" is not a USD amount with at most 6 decimals`);
  }
  const [, whole = '0', fraction = ''] = match;
  return BigInt(whole) * MICROS_PER_USD + BigInt(fraction.padEnd(6, '0'));
}

/** Formats micros as a decimal string with exactly 6 decimals, e.g. 7000n -> "0.007000". */
export function formatUsd(micros: bigint): string {
  if (micros < 0n) {
    throw new Error('Negative USD amounts are not supported');
  }
  const whole = micros / MICROS_PER_USD;
  const fraction = (micros % MICROS_PER_USD).toString().padStart(6, '0');
  return `${whole}.${fraction}`;
}

export interface TokenCharge {
  tokens: number;
  pricePerMillionUsd: string;
}

/**
 * Total cost of some token charges, rounded half-up to the nearest
 * micro-dollar once, after summing exactly:
 * tokens * (micro-dollars per million tokens) / 1_000_000 = micro-dollars.
 */
export function tokenCostMicros(charges: TokenCharge[]): bigint {
  let exact = 0n;
  for (const { tokens, pricePerMillionUsd } of charges) {
    if (!Number.isSafeInteger(tokens) || tokens < 0) {
      throw new Error(
        `Token count must be a non-negative integer, got ${tokens}`,
      );
    }
    exact += BigInt(tokens) * parseUsd(pricePerMillionUsd);
  }
  return (exact + 500_000n) / 1_000_000n;
}
