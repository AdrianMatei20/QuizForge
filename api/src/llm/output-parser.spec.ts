import { z } from 'zod';
import { parseModelOutput, stripCodeFences } from './output-parser.js';

describe('stripCodeFences', () => {
  it('removes a ```json fence', () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('removes a fence without a language and surrounding whitespace', () => {
    expect(stripCodeFences('  \n```\n{"a":1}\n```\n ')).toBe('{"a":1}');
  });

  it('leaves unfenced text alone (apart from trimming)', () => {
    expect(stripCodeFences(' {"a":"```"} ')).toBe('{"a":"```"}');
  });

  it('does not strip a fence that only opens', () => {
    expect(stripCodeFences('```json\n{"a":1}')).toBe('```json\n{"a":1}');
  });
});

describe('parseModelOutput', () => {
  const schema = z.object({
    items: z.array(z.object({ 'a/b': z.string(), count: z.number().int() })),
  });

  it('returns typed data and the raw JSON for valid output', () => {
    const outcome = parseModelOutput(
      '{"items":[{"a/b":"x","count":1}]}',
      schema,
    );

    expect(outcome).toEqual({
      ok: true,
      data: { items: [{ 'a/b': 'x', count: 1 }] },
      json: { items: [{ 'a/b': 'x', count: 1 }] },
    });
  });

  it('accepts fenced JSON', () => {
    expect(parseModelOutput('```json\n{"items":[]}\n```', schema).ok).toBe(
      true,
    );
  });

  it('reports malformed JSON without quoting the output', () => {
    const outcome = parseModelOutput('{"items": [ SECRET', schema);

    expect(outcome).toEqual({
      ok: false,
      violations: [{ message: 'The response is not valid JSON.' }],
    });
    expect(JSON.stringify(outcome)).not.toContain('SECRET');
  });

  it('reports schema issues with escaped JSON pointers', () => {
    const outcome = parseModelOutput(
      '{"items":[{"a/b":1,"count":1.5}]}',
      schema,
    );

    expect(outcome.ok).toBe(false);
    const pointers = outcome.ok ? [] : outcome.violations.map((v) => v.pointer);
    expect(pointers).toEqual(['#/items/0/a~1b', '#/items/0/count']);
  });

  it('points at the root for a wrong top-level type', () => {
    const outcome = parseModelOutput('[]', schema);

    expect(outcome.ok ? [] : outcome.violations).toEqual([
      { pointer: '#', message: expect.any(String) },
    ]);
  });

  it('does not quote unknown key names from the output', () => {
    const strict = z.strictObject({ name: z.string() });

    const outcome = parseModelOutput('{"name":"a","SECRET_KEY":1}', strict);

    expect(outcome).toEqual({
      ok: false,
      violations: [
        { pointer: '#', message: 'Contains properties that are not allowed.' },
      ],
    });
  });

  it('keeps zod transforms out of the raw JSON', () => {
    const trimmed = z.object({ name: z.string().transform((s) => s.trim()) });

    const outcome = parseModelOutput('{"name":"  Ada  "}', trimmed);

    expect(outcome).toMatchObject({
      ok: true,
      data: { name: 'Ada' },
      json: { name: '  Ada  ' },
    });
  });
});
