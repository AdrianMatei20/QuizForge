import { canonicalJson } from './canonical-json.js';

describe('canonicalJson', () => {
  it('ignores key order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts keys in nested objects, including inside arrays', () => {
    expect(canonicalJson({ z: { y: 1, x: [{ d: 1, c: 2 }] } })).toBe(
      '{"z":{"x":[{"c":2,"d":1}],"y":1}}',
    );
  });

  it('keeps array order, because order is data', () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });

  it('distinguishes values that differ only in type', () => {
    expect(canonicalJson({ count: 2 })).not.toBe(canonicalJson({ count: '2' }));
  });

  it('handles primitives and null', () => {
    expect(canonicalJson('a')).toBe('"a"');
    expect(canonicalJson(null)).toBe('null');
  });
});
