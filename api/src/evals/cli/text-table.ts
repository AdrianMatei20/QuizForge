/** A plain-text table for the terminal: columns padded to their widest cell. */
export function textTable(rows: string[][]): string {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  const line = (row: string[]) =>
    row
      .map((cell, i) =>
        i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0),
      )
      .join('  ')
      .trimEnd();
  const [header, ...body] = rows;
  if (!header) {
    return '';
  }
  return [
    line(header),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...body.map(line),
  ].join('\n');
}
