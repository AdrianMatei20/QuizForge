import {
  computeReviewStats,
  contentDiffers,
  type ReviewedQuestion,
} from './review-stats.js';
import type { QuestionStatus } from './quiz.types.js';

const ORIGINAL = {
  stem: 'What do plants release?',
  options: ['Oxygen', 'Nitrogen', 'Helium', 'Argon'],
  correctIndex: 0,
  explanation: 'Photosynthesis releases oxygen.',
};

/** A question as saved: the original's content, options shuffled. */
function question(overrides: Partial<ReviewedQuestion> = {}): ReviewedQuestion {
  return {
    status: 'approved',
    stem: ORIGINAL.stem,
    options: ['Helium', 'Oxygen', 'Argon', 'Nitrogen'],
    correctIndex: 1,
    explanation: ORIGINAL.explanation,
    original: ORIGINAL,
    ...overrides,
  };
}

describe('contentDiffers', () => {
  it('is false for the shuffled original: reordering options is not an edit', () => {
    expect(contentDiffers(question())).toBe(false);
  });

  it('ignores case and whitespace changes', () => {
    expect(
      contentDiffers(
        question({
          stem: '  what do PLANTS   release? ',
          explanation: 'photosynthesis releases oxygen.',
          options: ['helium', ' OXYGEN', 'Argon', 'Nitrogen'],
        }),
      ),
    ).toBe(false);
  });

  it.each<[string, Partial<ReviewedQuestion>]>([
    ['the stem', { stem: 'Which gas do plants release?' }],
    ['the explanation', { explanation: 'Plants give off oxygen.' }],
    ['an option text', { options: ['Helium', 'Oxygen', 'Argon', 'Neon'] }],
    // Same options, but a different one is marked correct.
    ['the correct answer', { correctIndex: 0 }],
  ])('is true when %s changes', (_what, overrides) => {
    expect(contentDiffers(question(overrides))).toBe(true);
  });
});

describe('computeReviewStats', () => {
  const withStatus = (status: QuestionStatus, edited = false) =>
    question({
      status,
      ...(edited ? { stem: 'A teacher rewrote this stem.' } : {}),
    });

  it('computes counts and rates on fixed data', () => {
    // 4 approved (1 edited), 1 rejected, 2 drafts, plus 3 regenerated.
    const current = [
      withStatus('approved', true),
      withStatus('approved'),
      withStatus('approved'),
      withStatus('approved'),
      withStatus('rejected'),
      withStatus('draft'),
      withStatus('draft', true), // edited drafts do not count toward editRate
    ];

    expect(computeReviewStats(current, 3)).toEqual({
      total: 7,
      byStatus: { draft: 2, approved: 4, rejected: 1 },
      regenerated: 3,
      editRate: 1 / 4,
      rejectRate: 1 / 5, // rejected / (approved + rejected)
      missRate: 4 / 8, // (1 rejected + 3 regenerated) / (4 + 1 + 3)
    });
  });

  it('reports null rates when there is nothing to divide by', () => {
    expect(computeReviewStats([withStatus('draft')], 0)).toEqual({
      total: 1,
      byStatus: { draft: 1, approved: 0, rejected: 0 },
      regenerated: 0,
      editRate: null,
      rejectRate: null,
      missRate: null,
    });
  });

  it('counts regenerated questions as misses even with no rejections', () => {
    const stats = computeReviewStats([withStatus('approved')], 1);

    expect(stats.rejectRate).toBe(0);
    expect(stats.missRate).toBe(1 / 2);
    expect(stats.editRate).toBe(0);
  });

  it('gives an editRate of 1 when every approved question was edited', () => {
    const stats = computeReviewStats(
      [withStatus('approved', true), withStatus('approved', true)],
      0,
    );

    expect(stats.editRate).toBe(1);
  });
});
