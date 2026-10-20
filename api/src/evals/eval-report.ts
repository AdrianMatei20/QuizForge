import type {
  EvalMetrics,
  EvalQuestion,
  EvalReport,
  JudgeVerdict,
  LessonResult,
  Rate,
} from './eval.types.js';

/** How many of the judge's weakest questions the report lists. */
export const WEAKEST_COUNT = 10;

const LETTERS = 'ABCDEFGHIJ';

export function formatRate(value: Rate): string {
  if (value === null) {
    return '–';
  }
  const percent = value * 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

/** "$0.0123": 4 decimals, enough to tell runs of a few cents apart. */
export function formatCost(costUsd: string): string {
  return `$${Number(costUsd).toFixed(4)}`;
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Model text is untrusted: one line, Markdown and HTML characters escaped,
 * so a stem cannot break the layout or inject markup into a rendered report.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\\`*_[\]#|]/g, (char) => `\\${char}`)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * How weak a question is by the judge's verdict: a wrong answer outweighs
 * everything, then a question the lesson cannot answer, then one that only
 * tests word matching. 0 means the judge found nothing wrong.
 */
export function weakness(verdict: JudgeVerdict): number {
  return (
    (verdict.answerCorrect ? 0 : 4) +
    (verdict.answerableFromLesson ? 0 : 2) +
    (verdict.testsUnderstanding ? 0 : 1)
  );
}

export interface WeakQuestion {
  lesson: LessonResult;
  question: EvalQuestion;
  verdict: JudgeVerdict;
}

/** Questions the judge flagged, weakest first; ties keep lesson and question order. */
export function weakestQuestions(
  lessons: LessonResult[],
  limit = WEAKEST_COUNT,
): WeakQuestion[] {
  return lessons
    .flatMap((lesson) =>
      lesson.questions.flatMap((question) =>
        question.verdict
          ? [{ lesson, question, verdict: question.verdict }]
          : [],
      ),
    )
    .filter(({ verdict }) => weakness(verdict) > 0)
    .map((weak, order) => ({ weak, order }))
    .sort(
      (a, b) =>
        weakness(b.weak.verdict) - weakness(a.weak.verdict) ||
        a.order - b.order,
    )
    .slice(0, limit)
    .map(({ weak }) => weak);
}

function table(header: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join(
    '\n',
  );
}

/** Metric rows: name, value, and a one-line definition a reviewer can check the number against. */
function summaryRows(m: EvalMetrics): string[][] {
  return [
    [
      'Schema-valid (first answer)',
      formatRate(m.schemaValidRate),
      'Lessons whose first answer matched the JSON schema',
    ],
    [
      'Rule-pass before repair',
      formatRate(m.rulePassBeforeRepairRate),
      'Lessons whose first answer passed the schema and every quiz rule',
    ],
    [
      'Repair rate',
      formatRate(m.repairRate),
      'Lessons that needed the repair call',
    ],
    [
      'sourceQuote found',
      formatRate(m.sourceQuoteFoundRate),
      'First-answer questions whose quote appears in the lesson (after repair it is 100% by the rules)',
    ],
    [
      'Duplicate stems',
      formatRate(m.duplicateStemRate),
      'First-answer questions repeating an earlier stem in the same quiz',
    ],
    [
      'Quote copy',
      formatRate(m.quoteCopyRate),
      'Final questions whose stem shares 6+ consecutive words with its own quote (lower is better)',
    ],
    [
      'Shared quote',
      formatRate(m.sharedQuoteRate),
      "Final questions whose quote overlaps another question's quote in the same quiz (lower is better)",
    ],
    [
      'Questions saved',
      `${m.questionsSaved} of ${m.questionsRequested}`,
      `${m.questionsDropped} dropped: requested minus saved in the final quiz`,
    ],
    [
      'Judge: answer correct',
      formatRate(m.answerCorrectRate),
      'The marked option is right, and the only right one',
    ],
    [
      'Judge: answerable from lesson',
      formatRate(m.answerableFromLessonRate),
      'Answerable from the lesson alone, without outside knowledge',
    ],
    [
      'Judge: tests understanding',
      formatRate(m.testsUnderstandingRate),
      'Not answerable by matching words against the lesson',
    ],
    [
      'Judged questions',
      `${m.judged}`,
      m.judgeErrors > 0
        ? `${m.judgeErrors} could not be judged (see below)`
        : 'Every final question',
    ],
    [
      'Generation',
      `${formatCost(m.generation.costUsd)}`,
      `${m.generation.calls} calls, ${m.generation.inputTokens.toLocaleString('en-US')} in / ${m.generation.outputTokens.toLocaleString('en-US')} out tokens, ${formatSeconds(m.generation.latencyMsTotal)} in total, slowest ${formatSeconds(m.generation.latencyMsMax)}`,
    ],
    [
      'Judge',
      `${formatCost(m.judge.costUsd)}`,
      `${m.judge.calls} calls (${m.judge.cacheHits} from cache), ${m.judge.inputTokens.toLocaleString('en-US')} in / ${m.judge.outputTokens.toLocaleString('en-US')} out tokens`,
    ],
  ];
}

function lessonOutcome(lesson: LessonResult): string {
  if (lesson.status === 'failed') {
    return `failed (${lesson.errorCode ?? 'unknown'})`;
  }
  return lesson.repaired ? 'ok after repair' : 'ok';
}

function firstAnswerText(lesson: LessonResult): string {
  const first = lesson.firstAnswer;
  if (!first) {
    return '–';
  }
  if (!first.schemaValid) {
    return 'schema invalid';
  }
  return first.rulesPassed ? 'valid' : 'rules failed';
}

function countOf(
  lesson: LessonResult,
  predicate: (question: EvalQuestion) => boolean,
): string {
  return lesson.questions.length === 0
    ? '–'
    : `${lesson.questions.filter(predicate).length}/${lesson.questions.length}`;
}

function judgeCounts(lesson: LessonResult): string {
  const verdicts = lesson.questions.flatMap((question) =>
    question.verdict ? [question.verdict] : [],
  );
  if (verdicts.length === 0) {
    return '–';
  }
  const of = (key: keyof Omit<JudgeVerdict, 'reason'>) =>
    `${verdicts.filter((verdict) => verdict[key]).length}/${verdicts.length}`;
  return `${of('answerCorrect')} · ${of('answerableFromLesson')} · ${of('testsUnderstanding')}`;
}

function lessonRows(lessons: LessonResult[]): string[][] {
  return lessons.map((lesson) => [
    `${escapeMarkdown(lesson.title)}<br>\`${lesson.slug}\``,
    `${lesson.count} · ${lesson.difficulty}`,
    lessonOutcome(lesson),
    firstAnswerText(lesson),
    `${lesson.questions.length}/${lesson.count}`,
    countOf(lesson, (question) => question.quoteCopy),
    countOf(lesson, (question) => question.sharedQuote),
    judgeCounts(lesson),
    formatCost(lesson.generation.costUsd),
    formatCost(lesson.judge.costUsd),
    formatSeconds(lesson.generation.latencyMs),
  ]);
}

const check = (ok: boolean) => (ok ? '✓' : '✗');

function weakQuestionSection(weak: WeakQuestion, rank: number): string {
  const { lesson, question, verdict } = weak;
  const options = question.options
    .map((option, i) => {
      const marked = i === question.correctIndex ? ' **(marked answer)**' : '';
      return `   - ${LETTERS[i] ?? i + 1}. ${escapeMarkdown(option)}${marked}`;
    })
    .join('\n');
  return [
    `${rank}. **${escapeMarkdown(lesson.title)}**, question ${question.number} (${lesson.difficulty}, ${question.type.replace('_', ' ')})`,
    `   ${escapeMarkdown(question.stem)}`,
    options,
    `   - Judge: ${check(verdict.answerCorrect)} answer correct · ${check(verdict.answerableFromLesson)} answerable from lesson · ${check(verdict.testsUnderstanding)} tests understanding`,
    `   - Reason: ${escapeMarkdown(verdict.reason)}`,
    `   - Source quote: "${escapeMarkdown(question.sourceQuote)}"${question.quoteCopy ? ' (the stem copies it)' : ''}`,
  ].join('\n');
}

/**
 * The report a reviewer reads: what ran, the headline numbers with their
 * definitions, one row per lesson, and the questions the judge liked least
 * with its reasons. Everything comes from `report`, so the same data renders
 * the same text (the snapshot test relies on it).
 */
export function renderMarkdownReport(
  report: EvalReport,
  jsonFileName: string,
): string {
  const { run, metrics, lessons } = report;
  const m = metrics.overall;
  const weakest = weakestQuestions(lessons);
  const unjudged = lessons.flatMap((lesson) =>
    lesson.questions
      .filter((question) => question.verdict === null)
      .map((question) => ({ lesson, question })),
  );
  const budgetStopped = lessons.filter(
    (lesson) => lesson.errorCode === 'budget_exceeded',
  ).length;

  const parts: string[] = [
    `# Eval: ${run.promptId} v${run.promptVersion} · ${run.model}`,
  ];

  if (run.dryRun) {
    parts.push(
      [
        '> [!WARNING]',
        '> **Dry run: these numbers are meaningless.** It used the fake LLM provider, which answers with canned quizzes',
        '> (only the sample lessons have their own) and judges every question the same way. It only shows that the',
        '> pipeline runs end to end.',
      ].join('\n'),
    );
  }
  if (budgetStopped > 0) {
    parts.push(
      `> [!CAUTION]\n> The daily LLM budget ran out: ${budgetStopped} lesson(s) were not generated, so this run is incomplete.`,
    );
  }

  parts.push(
    table(
      ['Run', ''],
      [
        ['Id', `\`${run.id}\``],
        ['Date', `${run.createdAt.replace('T', ' ').slice(0, 16)} UTC`],
        ['Prompt', `\`${run.promptId}\` v${run.promptVersion}`],
        [
          'Model',
          `\`${run.model}\`, effort ${run.effort ?? 'default (provider)'}`,
        ],
        [
          'Judge',
          `\`${run.judgeModel}\`, prompt \`judge\` v${run.judgePromptVersion}`,
        ],
        [
          'Lessons',
          `${m.lessons}${m.lessonsFailed > 0 ? ` (${m.lessonsFailed} failed)` : ''}`,
        ],
        ['Total cost', formatCost(m.totalCostUsd)],
      ],
    ),
  );

  parts.push(
    '## Summary',
    table(['Metric', 'Value', 'What it measures'], summaryRows(m)),
  );

  parts.push(
    '## Per lesson',
    'Judge column: answer correct · answerable from lesson · tests understanding, as questions passed / judged.',
    table(
      [
        'Lesson',
        'Asked',
        'Result',
        'First answer',
        'Saved',
        'Quote copy',
        'Shared quote',
        'Judge',
        'Generation',
        'Judging',
        'Latency',
      ],
      lessonRows(lessons),
    ),
  );

  parts.push('## Weakest questions');
  if (weakest.length === 0) {
    parts.push('The judge found no problem with any question.');
  } else {
    parts.push(
      weakest.length < WEAKEST_COUNT
        ? `The judge flagged ${weakest.length} question(s); all are listed, weakest first.`
        : `The ${WEAKEST_COUNT} questions the judge rated weakest: a wrong answer first, then not answerable from the lesson, then not testing understanding.`,
      weakest.map((weak, i) => weakQuestionSection(weak, i + 1)).join('\n\n'),
    );
  }

  if (unjudged.length > 0) {
    parts.push(
      '## Not judged',
      unjudged
        .map(
          ({ lesson, question }) =>
            `- ${escapeMarkdown(lesson.title)}, question ${question.number}: ${question.judgeError ?? 'unknown error'}`,
        )
        .join('\n'),
    );
  }

  parts.push(
    `---\nGenerated by \`npm run eval\`. Every question with its verdict is in [${jsonFileName}](${jsonFileName}).`,
  );
  return `${parts.join('\n\n')}\n`;
}
