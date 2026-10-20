import {
  evalReport,
  LESSONS,
  PASS,
  question,
  REPAIRED_LESSON,
} from '../../test/support/eval-report.js';
import {
  escapeMarkdown,
  formatRate,
  renderMarkdownReport,
  weakestQuestions,
  weakness,
} from './eval-report.js';

describe('renderMarkdownReport', () => {
  it('renders the fixed report (snapshot: src/evals/__snapshots__/eval-report.md)', async () => {
    const markdown = renderMarkdownReport(
      evalReport(),
      '2026-10-19T151500Z-v2.json',
    );

    // A file snapshot, so a reviewer can read the expected report as Markdown.
    await expect(markdown).toMatchFileSnapshot(
      './__snapshots__/eval-report.md',
    );
  });

  it('puts a warning at the top of a dry-run report', () => {
    const markdown = renderMarkdownReport(
      evalReport(LESSONS, { dryRun: true }),
      'x.json',
    );

    const firstSection = markdown.split('\n\n')[1];
    expect(firstSection).toContain('Dry run: these numbers are meaningless.');
  });

  it('says when the daily budget cut the run short', () => {
    const markdown = renderMarkdownReport(
      evalReport([
        ...LESSONS,
        {
          ...LESSONS[2]!,
          slug: '04-budget',
          errorCode: 'budget_exceeded',
          firstAnswer: null,
        },
      ]),
      'x.json',
    );

    expect(markdown).toContain('The daily LLM budget ran out: 1 lesson(s)');
  });
});

describe('weakest questions', () => {
  it('ranks a wrong answer above an unanswerable question above word matching', () => {
    expect(weakness({ ...PASS, answerCorrect: false })).toBeGreaterThan(
      weakness({
        ...PASS,
        answerableFromLesson: false,
        testsUnderstanding: false,
      }),
    );
    expect(weakness(PASS)).toBe(0);
  });

  it('lists only flagged questions, weakest first, and at most the limit', () => {
    const weak = weakestQuestions(LESSONS);
    expect(weak.map((w) => w.question.number)).toEqual([2, 1]);

    const many = {
      ...REPAIRED_LESSON,
      questions: Array.from({ length: 15 }, (_, i) =>
        question(i + 1, { verdict: { ...PASS, testsUnderstanding: false } }),
      ),
    };
    expect(weakestQuestions([many])).toHaveLength(10);
  });
});

describe('formatting', () => {
  it('formats rates, with a dash for nothing to divide by', () => {
    expect(formatRate(1)).toBe('100%');
    expect(formatRate(2 / 3)).toBe('66.7%');
    expect(formatRate(null)).toBe('–');
  });

  it('escapes model text so it cannot break a table or inject markup', () => {
    expect(escapeMarkdown('a | b\n*c* <script>')).toBe(
      'a \\| b \\*c\\* &lt;script&gt;',
    );
  });
});
