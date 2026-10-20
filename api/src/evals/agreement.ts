import type { EvalReport, JudgeVerdict } from './eval.types.js';

export const SAMPLE_SIZE = 20;

export const SAMPLE_COLUMNS = [
  'run_id',
  'lesson',
  'question',
  'type',
  'stem',
  'options',
  'marked_answer',
  'source_quote',
  'judge_answer_correct',
  'judge_answerable_from_lesson',
  'judge_tests_understanding',
  'judge_verdict',
  'judge_reason',
  'my_verdict',
] as const;

/** The judge passes a question only when all three checks pass. */
export function judgePasses(verdict: JudgeVerdict): boolean {
  return (
    verdict.answerCorrect &&
    verdict.answerableFromLesson &&
    verdict.testsUnderstanding
  );
}

const yesNo = (value: boolean) => (value ? 'yes' : 'no');

/**
 * Up to `size` judged questions, chosen uniformly at random (a partial
 * Fisher-Yates shuffle), as CSV rows with an empty my_verdict column.
 * `random` is injectable so tests get a fixed sample.
 */
export function sampleRows(
  report: EvalReport,
  size = SAMPLE_SIZE,
  random: () => number = Math.random,
): string[][] {
  const judged = report.lessons.flatMap((lesson) =>
    lesson.questions.flatMap((question) =>
      question.verdict ? [{ lesson, question, verdict: question.verdict }] : [],
    ),
  );
  for (let i = 0; i < Math.min(size, judged.length); i++) {
    const j = i + Math.floor(random() * (judged.length - i));
    [judged[i], judged[j]] = [
      judged[j] as (typeof judged)[number],
      judged[i] as (typeof judged)[number],
    ];
  }
  const rows = judged
    .slice(0, size)
    .map(({ lesson, question, verdict }) => [
      report.run.id,
      lesson.slug,
      String(question.number),
      question.type,
      question.stem,
      question.options
        .map((option, i) => `${'ABCD'[i] ?? i + 1}. ${option}`)
        .join('\n'),
      `${'ABCD'[question.correctIndex] ?? question.correctIndex + 1}. ${question.options[question.correctIndex] ?? ''}`,
      question.sourceQuote,
      yesNo(verdict.answerCorrect),
      yesNo(verdict.answerableFromLesson),
      yesNo(verdict.testsUnderstanding),
      judgePasses(verdict) ? 'pass' : 'fail',
      verdict.reason,
      '',
    ]);
  return [[...SAMPLE_COLUMNS], ...rows];
}

/** What a person may type in my_verdict. Anything else is reported, not guessed. */
export function parseVerdict(
  value: string,
): 'pass' | 'fail' | 'empty' | 'invalid' {
  const normalized = value.trim().toLowerCase();
  if (normalized === '') return 'empty';
  if (['pass', 'p', 'yes', 'y', 'true', 'ok', '1'].includes(normalized))
    return 'pass';
  if (['fail', 'f', 'no', 'n', 'false', '0'].includes(normalized))
    return 'fail';
  return 'invalid';
}

export interface AgreementReport {
  /** Rows with a usable my_verdict. */
  compared: number;
  empty: number;
  /** Row numbers (1-based, header excluded) with a verdict that is neither pass nor fail. */
  invalidRows: number[];
  agreed: number;
  /** agreed / compared; null with nothing compared. */
  agreement: number | null;
  /** [judge][me] counts. */
  matrix: {
    passPass: number;
    passFail: number;
    failPass: number;
    failFail: number;
  };
  /**
   * Cohen's kappa: agreement corrected for what two raters would reach by
   * chance with the same pass rates. 1 is perfect, 0 is no better than
   * chance. Null when chance agreement is already 100% (e.g. both always
   * said pass), where kappa is undefined.
   */
  kappa: number | null;
}

/** Compares my_verdict with judge_verdict for every row of a filled-in sample. */
export function computeAgreement(rows: string[][]): AgreementReport {
  const [header, ...data] = rows;
  if (!header) {
    throw new Error('The CSV file is empty');
  }
  const column = (name: string) => {
    const index = header.findIndex((cell) => cell.trim() === name);
    if (index === -1) {
      throw new Error(`The CSV file has no "${name}" column`);
    }
    return index;
  };
  const judgeColumn = column('judge_verdict');
  const mineColumn = column('my_verdict');

  const matrix = { passPass: 0, passFail: 0, failPass: 0, failFail: 0 };
  let empty = 0;
  const invalidRows: number[] = [];
  data.forEach((row, i) => {
    const mine = parseVerdict(row[mineColumn] ?? '');
    const judge = parseVerdict(row[judgeColumn] ?? '');
    if (mine === 'empty') {
      empty++;
      return;
    }
    if (mine === 'invalid' || (judge !== 'pass' && judge !== 'fail')) {
      invalidRows.push(i + 1);
      return;
    }
    if (judge === 'pass') {
      matrix[mine === 'pass' ? 'passPass' : 'passFail']++;
    } else {
      matrix[mine === 'pass' ? 'failPass' : 'failFail']++;
    }
  });

  const compared =
    matrix.passPass + matrix.passFail + matrix.failPass + matrix.failFail;
  const agreed = matrix.passPass + matrix.failFail;
  let kappa: number | null = null;
  if (compared > 0) {
    const judgePass = (matrix.passPass + matrix.passFail) / compared;
    const minePass = (matrix.passPass + matrix.failPass) / compared;
    const chance = judgePass * minePass + (1 - judgePass) * (1 - minePass);
    kappa = chance === 1 ? null : (agreed / compared - chance) / (1 - chance);
  }
  return {
    compared,
    empty,
    invalidRows,
    agreed,
    agreement: compared === 0 ? null : agreed / compared,
    matrix,
    kappa,
  };
}
