import { isCatchAllOption, normalizeStem, textLength } from './limits';

describe('textLength', () => {
  it('counts code points of the trimmed text, like the API', () => {
    expect(textLength('  hello  ')).toBe(5);
    // One emoji is one code point, though two UTF-16 units.
    expect(textLength('😀')).toBe(1);
    expect('😀'.length).toBe(2);
  });
});

describe('normalizeStem', () => {
  it('ignores case, spacing and trailing punctuation', () => {
    expect(normalizeStem('  What is  Recursion? ')).toBe(normalizeStem('what is recursion'));
  });
});

describe('isCatchAllOption', () => {
  it.each(['All of the above', 'none of the above.', '  NONE OF THE ABOVE '])(
    'flags "%s"',
    (option) => {
      expect(isCatchAllOption(option)).toBe(true);
    },
  );

  it('does not flag an option that only contains the phrase', () => {
    expect(isCatchAllOption('All of the above gases except argon')).toBe(false);
  });
});
