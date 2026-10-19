import type { GeneratedQuestion, GeneratedQuiz } from './quiz-output.schema.js';
import type { QuizSettings } from './quiz.types.js';
import {
  correctIndexInRange,
  countQuoteWords,
  editedQuestionViolations,
  noCatchAllOptions,
  normalizeForQuote,
  normalizeStem,
  normalizeText,
  optionsAreDistinct,
  questionCountMatches,
  quizRules,
  type QuizRuleContext,
  regeneratedQuestionRules,
  sourceQuotesAppearInLesson,
  sourceQuotesAreLongEnough,
  stemsAreUnique,
  typesAreRequested,
} from './rules.js';

const LESSON =
  'Plants make food by photosynthesis. They use sunlight, water and carbon dioxide.\n' +
  'The process releases oxygen as a "by-product" into the air.';

function mc(overrides: Partial<GeneratedQuestion> = {}): GeneratedQuestion {
  return {
    type: 'multiple_choice',
    stem: 'What do plants release?',
    options: ['Oxygen', 'Nitrogen', 'Helium', 'Argon'],
    correctIndex: 0,
    explanation: 'Photosynthesis releases oxygen.',
    sourceQuote: 'The process releases oxygen as a "by-product" into the air.',
    ...overrides,
  } as GeneratedQuestion;
}

function tf(overrides: Partial<GeneratedQuestion> = {}): GeneratedQuestion {
  return {
    type: 'true_false',
    stem: 'Plants use sunlight.',
    options: ['True', 'False'],
    correctIndex: 0,
    explanation: 'The lesson says plants use sunlight.',
    sourceQuote: 'They use sunlight, water and carbon dioxide.',
    ...overrides,
  } as GeneratedQuestion;
}

const quiz = (...questions: GeneratedQuestion[]): GeneratedQuiz => ({
  questions,
});

function context(
  settings: Partial<QuizSettings> = {},
  minQuoteWords = 5,
): QuizRuleContext {
  return {
    lessonContent: LESSON,
    minQuoteWords,
    settings: {
      count: 2,
      difficulty: 'easy',
      types: ['multiple_choice', 'true_false'],
      ...settings,
    },
  };
}

describe('normalization helpers', () => {
  it('normalizeText lowercases, trims and collapses whitespace', () => {
    expect(normalizeText('  Hello \n  World\t')).toBe('hello world');
  });

  it('normalizeStem also drops trailing punctuation', () => {
    expect(normalizeStem('What is  recursion ?')).toBe('what is recursion');
    expect(normalizeStem('None of the above.')).toBe('none of the above');
  });

  it('normalizeForQuote straightens quote characters and collapses whitespace, keeping case', () => {
    expect(normalizeForQuote('“It’s”\n  Here')).toBe('"It\'s" Here');
  });
});

describe('optionsAreDistinct', () => {
  it('passes when all options differ', () => {
    expect(optionsAreDistinct(quiz(mc(), tf()), context())).toEqual([]);
  });

  it('names the question and both options when two are identical after trim and lowercase', () => {
    const question = mc({
      options: ['Oxygen', 'Nitrogen', 'Helium', '  oxygen '],
    });

    expect(optionsAreDistinct(quiz(tf(), question), context())).toEqual([
      'question 2: options 1 and 4 are identical',
    ]);
  });

  it('reports each repeat against the first occurrence', () => {
    const question = mc({ options: ['A', 'a', 'B', 'A'] });

    expect(optionsAreDistinct(quiz(question), context())).toEqual([
      'question 1: options 1 and 2 are identical',
      'question 1: options 1 and 4 are identical',
    ]);
  });
});

describe('correctIndexInRange', () => {
  it('passes for the first and last valid index', () => {
    expect(
      correctIndexInRange(
        quiz(mc({ correctIndex: 3 }), tf({ correctIndex: 1 })),
        context(),
      ),
    ).toEqual([]);
  });

  it.each([
    [
      mc({ correctIndex: 4 }),
      'question 1: correctIndex 4 is out of range (must be 0 to 3)',
    ],
    [
      tf({ correctIndex: 2 }),
      'question 1: correctIndex 2 is out of range (must be 0 to 1)',
    ],
    [
      mc({ correctIndex: -1 }),
      'question 1: correctIndex -1 is out of range (must be 0 to 3)',
    ],
  ])('rejects an index outside the options', (question, message) => {
    expect(correctIndexInRange(quiz(question), context())).toEqual([message]);
  });
});

describe('noCatchAllOptions', () => {
  it('passes for ordinary options', () => {
    expect(noCatchAllOptions(quiz(mc()), context())).toEqual([]);
  });

  it.each(['All of the above', 'none of the above.', '  NONE OF THE ABOVE  '])(
    'rejects "%s"',
    (option) => {
      const question = mc({
        options: ['Oxygen', 'Nitrogen', 'Helium', option],
      });

      expect(noCatchAllOptions(quiz(question), context())).toEqual([
        'question 1: option 4 is "all of the above" or "none of the above", which is not allowed',
      ]);
    },
  );

  it('does not flag an option that only contains the phrase', () => {
    const question = mc({
      options: [
        'Oxygen',
        'Nitrogen',
        'Helium',
        'All of the above gases except argon',
      ],
    });

    expect(noCatchAllOptions(quiz(question), context())).toEqual([]);
  });
});

describe('stemsAreUnique', () => {
  it('passes when stems differ', () => {
    expect(stemsAreUnique(quiz(mc(), tf()), context())).toEqual([]);
  });

  it('rejects stems that match after normalization, naming both questions', () => {
    const questions = quiz(
      mc({ stem: 'What do plants release?' }),
      tf(),
      mc({ stem: '  what do PLANTS   release' }),
    );

    expect(stemsAreUnique(questions, context())).toEqual([
      'question 3: stem is the same as question 1',
    ]);
  });
});

describe('sourceQuotesAppearInLesson', () => {
  it('passes for verbatim quotes', () => {
    expect(sourceQuotesAppearInLesson(quiz(mc(), tf()), context())).toEqual([]);
  });

  it('tolerates different whitespace, curly quotes and wrapping quotation marks', () => {
    const question = mc({
      sourceQuote: '“releases oxygen as a “by-product” into\n the air”',
    });

    expect(sourceQuotesAppearInLesson(quiz(question), context())).toEqual([]);
  });

  it('rejects a quote that is not in the lesson', () => {
    const question = tf({ sourceQuote: 'Plants sleep at night.' });

    expect(sourceQuotesAppearInLesson(quiz(mc(), question), context())).toEqual(
      ['question 2: sourceQuote does not appear in the lesson'],
    );
  });

  it('is case-sensitive', () => {
    const question = mc({ sourceQuote: 'the process releases oxygen' });

    expect(sourceQuotesAppearInLesson(quiz(question), context())).toEqual([
      'question 1: sourceQuote does not appear in the lesson',
    ]);
  });
});

describe('countQuoteWords', () => {
  it('counts whitespace-separated words after normalization', () => {
    expect(countQuoteWords('  They use\n sunlight,   water ')).toBe(4);
  });

  it('ignores wrapping quotation marks and tokens without letters or digits', () => {
    expect(countQuoteWords('“one two – three …”')).toBe(3);
  });

  it('counts a token such as log2(n) as one word', () => {
    expect(countQuoteWords('runs in log2(n) steps')).toBe(4);
  });
});

describe('sourceQuotesAreLongEnough', () => {
  const withQuote = (sourceQuote: string) => quiz(mc({ sourceQuote }));

  it('passes a quote with exactly the minimum number of words', () => {
    expect(
      sourceQuotesAreLongEnough(
        withQuote('Plants make food by photosynthesis.'),
        context(),
      ),
    ).toEqual([]);
  });

  it('passes a quote longer than the minimum', () => {
    expect(sourceQuotesAreLongEnough(quiz(mc(), tf()), context())).toEqual([]);
  });

  it('rejects a quote one word short, naming the question and both counts', () => {
    expect(
      sourceQuotesAreLongEnough(
        quiz(tf(), mc({ sourceQuote: 'The process releases oxygen' })),
        context(),
      ),
    ).toEqual(['question 2: sourceQuote has 4 words; at least 5 are required']);
  });

  it('does not let wrapping quotes or punctuation-only tokens reach the minimum', () => {
    expect(
      sourceQuotesAreLongEnough(
        withQuote('"The process releases — oxygen"'),
        context(),
      ),
    ).toEqual(['question 1: sourceQuote has 4 words; at least 5 are required']);
  });

  it('uses the singular for a one-word quote', () => {
    expect(sourceQuotesAreLongEnough(withQuote('oxygen'), context())).toEqual([
      'question 1: sourceQuote has 1 word; at least 5 are required',
    ]);
  });

  it('respects a configured minimum', () => {
    const quote = withQuote('The process releases oxygen');

    expect(sourceQuotesAreLongEnough(quote, context({}, 3))).toEqual([]);
    expect(sourceQuotesAreLongEnough(quote, context({}, 8))).toEqual([
      'question 1: sourceQuote has 4 words; at least 8 are required',
    ]);
  });
});

describe('questionCountMatches', () => {
  it('passes when the count matches', () => {
    expect(
      questionCountMatches(quiz(mc(), tf()), context({ count: 2 })),
    ).toEqual([]);
  });

  it('rejects too few or too many questions', () => {
    expect(questionCountMatches(quiz(mc()), context({ count: 3 }))).toEqual([
      'expected 3 questions, got 1',
    ]);
    expect(
      questionCountMatches(quiz(mc(), tf(), tf()), context({ count: 2 })),
    ).toEqual(['expected 2 questions, got 3']);
  });
});

describe('typesAreRequested', () => {
  it('passes when every type was requested', () => {
    expect(typesAreRequested(quiz(mc(), tf()), context())).toEqual([]);
  });

  it('rejects a type that was not requested', () => {
    expect(
      typesAreRequested(quiz(tf(), mc()), context({ types: ['true_false'] })),
    ).toEqual([
      'question 2: type "multiple_choice" was not requested (allowed: true_false)',
    ]);
  });
});

describe('quizRules', () => {
  it('returns nothing for a valid quiz', () => {
    expect(quizRules(context())(quiz(mc(), tf()))).toEqual([]);
  });

  it('collects violations from every rule', () => {
    const bad = quiz(
      mc({ options: ['A', 'a', 'None of the above', 'B'], correctIndex: 9 }),
      mc({ sourceQuote: 'invented' }),
      tf(),
    );

    expect(
      quizRules(context({ count: 2, types: ['multiple_choice'] }))(bad),
    ).toEqual([
      'expected 2 questions, got 3',
      'question 3: type "true_false" was not requested (allowed: multiple_choice)',
      'question 1: options 1 and 2 are identical',
      'question 1: correctIndex 9 is out of range (must be 0 to 3)',
      'question 1: option 3 is "all of the above" or "none of the above", which is not allowed',
      'question 2: stem is the same as question 1',
      'question 2: sourceQuote has 1 word; at least 5 are required',
      'question 2: sourceQuote does not appear in the lesson',
    ]);
  });
});

describe('editedQuestionViolations', () => {
  const others = [
    { position: 1, stem: 'Plants use sunlight.' },
    { position: 3, stem: 'Where does oxygen go?' },
  ];

  it('passes a valid edit', () => {
    expect(editedQuestionViolations(mc(), 2, others)).toEqual([]);
  });

  it('does not require the sourceQuote once a human has edited the question', () => {
    const edited = mc({ sourceQuote: 'not in the lesson' });

    expect(editedQuestionViolations(edited, 2, others)).toEqual([]);
  });

  it('labels violations with the question position and checks stems against the other questions', () => {
    const edited = mc({
      stem: '  where does OXYGEN go ',
      options: ['Oxygen', 'oxygen', 'None of the above', 'Argon'],
      correctIndex: 4,
    });

    expect(editedQuestionViolations(edited, 2, others)).toEqual([
      'question 2: options 1 and 2 are identical',
      'question 2: correctIndex 4 is out of range (must be 0 to 3)',
      'question 2: option 3 is "all of the above" or "none of the above", which is not allowed',
      'question 2: stem is the same as question 3',
    ]);
  });
});

describe('regeneratedQuestionRules', () => {
  const rules = regeneratedQuestionRules({
    lessonContent: LESSON,
    settings: {
      count: 3,
      difficulty: 'medium',
      types: ['multiple_choice', 'true_false'],
    },
    minQuoteWords: 5,
    type: 'multiple_choice',
    replacedStem: 'What do plants release?',
    others: [{ position: 2, stem: 'Plants use sunlight.' }],
  });

  it('passes a new, valid question of the same type', () => {
    expect(rules(mc({ stem: 'What do plants make food by?' }))).toEqual([]);
  });

  it('rejects a stem that repeats the replaced question', () => {
    expect(rules(mc({ stem: 'what do plants release' }))).toEqual([
      'question: stem is the same as the question it replaces',
    ]);
  });

  it('rejects a stem that repeats another question in the quiz', () => {
    expect(rules(mc({ stem: 'Plants use sunlight' }))).toEqual([
      'question: stem is the same as question 2, which is already in the quiz',
    ]);
  });

  it("requires the replaced question's type, even if the quiz allows both", () => {
    expect(rules(tf({ stem: 'Plants make food by photosynthesis.' }))).toEqual([
      'question: type "true_false" was not requested (allowed: multiple_choice)',
    ]);
  });

  it('still applies the sourceQuote rules to model output', () => {
    expect(
      rules(mc({ stem: 'A new question?', sourceQuote: 'Plants sleep' })),
    ).toEqual([
      'question: sourceQuote has 2 words; at least 5 are required',
      'question: sourceQuote does not appear in the lesson',
    ]);
  });
});
