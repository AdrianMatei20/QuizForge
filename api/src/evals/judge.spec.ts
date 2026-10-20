import { buildJudgeRequest, formatQuestionForJudge } from './judge.js';

const QUESTION = {
  stem: 'What stops a recursive function?',
  options: ['A loop', 'The base case', 'The call stack', 'A timeout'],
  correctIndex: 1,
};

describe('the judge request', () => {
  it('shows the question with lettered options and the marked answer, not the explanation or quote', () => {
    expect(formatQuestionForJudge(QUESTION)).toBe(
      'Question: What stops a recursive function?\n\nOptions:\nA. A loop\nB. The base case\nC. The call stack\nD. A timeout\n\nMarked answer: B',
    );
  });

  it('uses the judge prompt and model, and keeps the cache on', () => {
    const request = buildJudgeRequest({
      lessonContent: 'Lesson text',
      question: QUESTION,
      model: 'claude-sonnet-5-5',
      correlationId: 'run/judge/01-x',
    });

    expect(request).toMatchObject({
      feature: 'eval-judge',
      promptId: 'judge',
      promptVersion: 1,
      model: 'claude-sonnet-5-5',
      correlationId: 'run/judge/01-x',
      variables: { lesson: 'Lesson text' },
    });
    // Unset means LlmService's default: cached.
    expect(request.cache).toBeUndefined();
  });

  it('accepts a verdict and rejects a malformed one', () => {
    const { schema } = buildJudgeRequest({
      lessonContent: 'x',
      question: QUESTION,
      model: 'm',
      correlationId: 'c',
    });
    expect(
      schema.safeParse({
        answerCorrect: true,
        answerableFromLesson: false,
        testsUnderstanding: true,
        reason: 'Needs outside knowledge.',
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ answerCorrect: 'yes', reason: '' }).success).toBe(
      false,
    );
  });
});
