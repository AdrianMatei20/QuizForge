/**
 * npm run eval:agreement -- <file.csv>
 *
 * Reads a sample from eval:sample with my_verdict filled in and reports how
 * often you agreed with the judge: percent agreement, the 2x2 table, Cohen's
 * kappa, and every disagreement with the judge's reason.
 */
import { readFileSync } from 'node:fs';
import { computeAgreement, parseVerdict } from '../agreement.js';
import { parseCsv } from '../csv.js';
import { formatRate } from '../eval-report.js';
import { textTable } from './text-table.js';

const [file, ...rest] = process.argv.slice(2);
if (!file || rest.length > 0) {
  console.error('Usage: npm run eval:agreement -- <file.csv>');
  process.exit(2);
}

try {
  const rows = parseCsv(readFileSync(file, 'utf8'));
  const report = computeAgreement(rows);
  if (report.compared === 0) {
    console.log(
      `No row has a pass or fail in my_verdict yet (${report.empty} empty). Fill it in, then run this again.`,
    );
    process.exit(0);
  }
  const { matrix } = report;
  const kappa =
    report.kappa === null
      ? '– (undefined: every verdict on both sides was the same)'
      : report.kappa.toFixed(2);
  console.log(
    [
      `Compared: ${report.compared} question(s)${report.empty > 0 ? `, ${report.empty} without my_verdict skipped` : ''}`,
      `Agreement: ${formatRate(report.agreement)} (${report.agreed} of ${report.compared})`,
      `Cohen's kappa: ${kappa}`,
      '',
      textTable([
        ['', 'I said pass', 'I said fail'],
        ['Judge said pass', String(matrix.passPass), String(matrix.passFail)],
        ['Judge said fail', String(matrix.failPass), String(matrix.failFail)],
      ]),
    ].join('\n'),
  );
  if (report.invalidRows.length > 0) {
    console.log(
      `\nSkipped rows whose verdict is neither pass nor fail: ${report.invalidRows.join(', ')}`,
    );
  }

  const [header = [], ...data] = rows;
  const at = (name: string) => header.findIndex((cell) => cell.trim() === name);
  const disagreements = data.filter((row) => {
    const mine = parseVerdict(row[at('my_verdict')] ?? '');
    const judge = parseVerdict(row[at('judge_verdict')] ?? '');
    return (mine === 'pass' || mine === 'fail') && mine !== judge;
  });
  if (disagreements.length > 0) {
    console.log('\nDisagreements:');
    for (const row of disagreements) {
      console.log(
        `- ${row[at('lesson')]} question ${row[at('question')]}: judge ${row[at('judge_verdict')]}, you ${row[at('my_verdict')]?.trim()}\n  ${row[at('stem')]}\n  Judge's reason: ${row[at('judge_reason')]}`,
      );
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
