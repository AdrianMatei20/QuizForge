import { EVAL_LESSONS_DIR } from './eval-paths.js';
import { loadEvalLessons, parseEvalLesson } from './eval-lesson.js';

const CONTENT = 'A lesson sentence that is long enough. '.repeat(8);

describe('parseEvalLesson', () => {
  it('reads the front matter and the lesson text', () => {
    const lesson = parseEvalLesson(
      '01-x',
      `---\ntitle: Recursion: the basics\ncount: 4\ndifficulty: hard\n---\n\n${CONTENT}\n`,
    );

    expect(lesson).toEqual({
      slug: '01-x',
      // Only the first colon separates key and value.
      title: 'Recursion: the basics',
      content: CONTENT.trim(),
      settings: {
        count: 4,
        difficulty: 'hard',
        types: ['multiple_choice', 'true_false'],
      },
    });
  });

  it.each([
    [CONTENT, 'must start with a front matter block'],
    [`---\ntitle: X\ncount: 11\ndifficulty: easy\n---\n${CONTENT}`, 'count'],
    [
      `---\ntitle: X\ncount: 4\ndifficulty: tricky\n---\n${CONTENT}`,
      'difficulty',
    ],
    [
      `---\ntitle: X\ncount: 4\ndifficulty: easy\nauthor: me\n---\n${CONTENT}`,
      'author',
    ],
    [`---\ntitle X\n---\n${CONTENT}`, 'is not "key: value"'],
  ])('rejects bad front matter (%#)', (text, message) => {
    expect(() => parseEvalLesson('bad', text)).toThrow(message);
  });

  it('applies the same length limits as the API', () => {
    expect(() =>
      parseEvalLesson(
        'short',
        '---\ntitle: X\ncount: 3\ndifficulty: easy\n---\nToo short.',
      ),
    ).toThrow();
  });
});

describe('the committed eval lessons', () => {
  it('are 10 valid lessons, in file-name order, and --limit takes the first ones', () => {
    const lessons = loadEvalLessons(EVAL_LESSONS_DIR);
    expect(lessons).toHaveLength(10);
    const slugs = lessons.map((lesson) => lesson.slug);
    expect(slugs).toEqual(slugs.toSorted());
    expect(
      loadEvalLessons(EVAL_LESSONS_DIR, 2).map((lesson) => lesson.slug),
    ).toEqual(['01-recursion', '02-binary-search']);
  });
});
