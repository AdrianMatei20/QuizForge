import { JsonLinesParser } from './json-lines-parser.js';

/** Feeds all chunks, then ends the stream; returns every line in order. */
function parse(chunks: string[]): string[] {
  const parser = new JsonLinesParser();
  return [...chunks.flatMap((chunk) => parser.push(chunk)), ...parser.end()];
}

describe('JsonLinesParser', () => {
  it('joins a line split across chunks', () => {
    const parser = new JsonLinesParser();

    expect(parser.push('{"stem":"Wh')).toEqual([]);
    expect(parser.push('at is recur')).toEqual([]);
    expect(parser.push('sion?"}\n')).toEqual(['{"stem":"What is recursion?"}']);
  });

  it('returns several lines from one chunk', () => {
    const parser = new JsonLinesParser();

    expect(parser.push('{"a":1}\n{"b":2}\n{"c":')).toEqual([
      '{"a":1}',
      '{"b":2}',
    ]);
    expect(parser.push('3}\n')).toEqual(['{"c":3}']);
  });

  it('returns a final line that has no newline when the stream ends', () => {
    const parser = new JsonLinesParser();

    expect(parser.push('{"a":1}\n{"b":2}')).toEqual(['{"a":1}']);
    expect(parser.end()).toEqual(['{"b":2}']);
    expect(parser.end()).toEqual([]);
  });

  it('drops code-fence lines and blank lines', () => {
    expect(parse(['```json\n{"a":1}\n\n   \n{"b":2}\n```\n'])).toEqual([
      '{"a":1}',
      '{"b":2}',
    ]);
    expect(parse(['```\n{"a":1}\n```'])).toEqual(['{"a":1}']);
  });

  it('handles a code fence split across chunks', () => {
    expect(parse(['``', '`js', 'on\n{"a":1}\n`', '``'])).toEqual(['{"a":1}']);
  });

  it('tolerates CRLF line endings and surrounding spaces', () => {
    expect(parse(['  {"a":1}  \r\n{"b":2}\r\n'])).toEqual([
      '{"a":1}',
      '{"b":2}',
    ]);
  });

  it('gives the same lines whatever the chunk size', () => {
    const text = '```json\n{"a":1}\n{"b":"x y"}\n\n{"c":[1,2]}\n```';
    const expected = ['{"a":1}', '{"b":"x y"}', '{"c":[1,2]}'];

    for (const size of [1, 2, 3, 7, 1000]) {
      const chunks = Array.from(
        { length: Math.ceil(text.length / size) },
        (_, i) => text.slice(i * size, (i + 1) * size),
      );
      expect(parse(chunks), `chunk size ${size}`).toEqual(expected);
    }
  });

  it('keeps a line that only contains backticks among other text', () => {
    expect(parse(['{"code":"```x```"}\n'])).toEqual(['{"code":"```x```"}']);
  });
});
