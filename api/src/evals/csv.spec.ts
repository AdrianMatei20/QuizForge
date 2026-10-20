import { detectSeparator, parseCsv, toCsv } from './csv.js';

describe('CSV', () => {
  const rows = [
    ['stem', 'options', 'my_verdict'],
    ['Plain', 'A. one', ''],
    ['With, comma', 'A. "quoted"\nB. second line', 'pass'],
  ];

  it('writes a byte-order mark, quotes only when needed, and uses CRLF', () => {
    expect(toCsv(rows)).toBe(
      '﻿stem,options,my_verdict\r\nPlain,A. one,\r\n"With, comma","A. ""quoted""\nB. second line",pass\r\n',
    );
  });

  it('reads back exactly what it wrote', () => {
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('reads a file a spreadsheet saved with semicolons (e.g. Excel in a Romanian locale)', () => {
    const saved = 'stem;my_verdict\r\n"Is 1,5 a number?";fail\r\n\r\n';
    expect(detectSeparator(saved)).toBe(';');
    expect(parseCsv(saved)).toEqual([
      ['stem', 'my_verdict'],
      ['Is 1,5 a number?', 'fail'],
    ]);
  });

  it('accepts LF line endings and a last line without a line break', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});
