/**
 * Just enough RFC 4180 CSV for the sample files: a field is quoted when it
 * contains the separator, a quote or a line break, and quotes inside are
 * doubled. Hand-written instead of a dependency because the format is small
 * and the edge cases are covered by tests.
 */

/** Excel only reads a CSV as UTF-8 when it starts with a byte-order mark. */
const BOM = '﻿';

function quoteField(field: string, separator: string): string {
  return field.includes(separator) || /["\r\n]/.test(field)
    ? `"${field.replaceAll('"', '""')}"`
    : field;
}

/** CRLF line endings, as RFC 4180 specifies and Excel expects. */
export function toCsv(rows: string[][], separator = ','): string {
  return (
    BOM +
    rows
      .map((row) =>
        row.map((field) => quoteField(field, separator)).join(separator),
      )
      .join('\r\n') +
    '\r\n'
  );
}

/**
 * The separator a spreadsheet saved the file with: Excel uses ";" in locales
 * where "," is the decimal mark (Romanian, German, ...). Decided by the
 * header line, outside quotes.
 */
export function detectSeparator(text: string): ',' | ';' {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (const char of text) {
    if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && (char === '\n' || char === '\r')) {
      break;
    } else if (!quoted && char === ',') {
      commas++;
    } else if (!quoted && char === ';') {
      semicolons++;
    }
  }
  return semicolons > commas ? ';' : ',';
}

/** Rows of fields. Accepts CRLF or LF, a leading BOM, and quoted fields with line breaks. */
export function parseCsv(input: string): string[][] {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const separator = detectSeparator(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === separator) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') {
        i++;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Spreadsheets often leave empty lines at the end.
  return rows.filter((fields) => fields.some((value) => value.trim() !== ''));
}
