/**
 * SQL for a CHECK constraint limiting a column to fixed values, e.g.
 * checkIn('status', ['ok', 'error']) -> `"status" IN ('ok', 'error')`.
 * The values come from code constants, never from user input.
 */
export function checkIn(column: string, values: readonly string[]): string {
  return `"${column}" IN (${values.map((value) => `'${value}'`).join(', ')})`;
}
