import { describe, expect, test } from 'bun:test';
import { compileTag } from '../src/db/sql/tag';

function tag(
  strings: TemplateStringsArray,
  ...values: unknown[]
): [TemplateStringsArray, unknown[]] {
  return [strings, values];
}

describe('compileTag', () => {
  test('no interpolations — text is the joined strings, bindings empty', () => {
    const [s, v] = tag`SELECT 1`;
    const { text, bindings } = compileTag(s, v, 'question');
    expect(text).toBe('SELECT 1');
    expect(bindings).toEqual([]);
  });

  test('single interpolation, question style → one ?', () => {
    const name = 'alpha';
    const [s, v] = tag`SELECT * FROM widgets WHERE name = ${name}`;
    const { text, bindings } = compileTag(s, v, 'question');
    expect(text).toBe('SELECT * FROM widgets WHERE name = ?');
    expect(bindings).toEqual(['alpha']);
  });

  test('single interpolation, numbered style → $1', () => {
    const id = 42;
    const [s, v] = tag`SELECT * FROM post WHERE id = ${id}`;
    const { text, bindings } = compileTag(s, v, 'numbered');
    expect(text).toBe('SELECT * FROM post WHERE id = $1');
    expect(bindings).toEqual([42]);
  });

  test('multiple interpolations preserve order, numbered ascends', () => {
    const lo = 10;
    const hi = 20;
    const [s, v] = tag`SELECT * FROM w WHERE qty > ${lo} AND qty < ${hi}`;
    const { text, bindings } = compileTag(s, v, 'numbered');
    expect(text).toBe('SELECT * FROM w WHERE qty > $1 AND qty < $2');
    expect(bindings).toEqual([10, 20]);
  });

  test('question-style repeats literal ?', () => {
    const a = 1;
    const b = 2;
    const c = 3;
    const [s, v] = tag`VALUES (${a}, ${b}, ${c})`;
    const { text, bindings } = compileTag(s, v, 'question');
    expect(text).toBe('VALUES (?, ?, ?)');
    expect(bindings).toEqual([1, 2, 3]);
  });

  test('interpolation at the very start of the template', () => {
    const n = 5;
    const [s, v] = tag`${n} LIMIT`;
    const { text, bindings } = compileTag(s, v, 'question');
    expect(text).toBe('? LIMIT');
    expect(bindings).toEqual([5]);
  });

  test('interpolation-only template', () => {
    const x = 42;
    const [s, v] = tag`${x}`;
    const q = compileTag(s, v, 'question');
    expect(q.text).toBe('?');
    expect(q.bindings).toEqual([42]);
    const n = compileTag(s, v, 'numbered');
    expect(n.text).toBe('$1');
    expect(n.bindings).toEqual([42]);
  });

  test('attacker string is not concatenated into SQL', () => {
    const attacker = "'; DROP TABLE users; --";
    const [s, v] = tag`SELECT * FROM users WHERE name = ${attacker}`;
    const { text, bindings } = compileTag(s, v, 'question');
    // The attacker payload must live in bindings, never in the SQL text.
    expect(text).toBe('SELECT * FROM users WHERE name = ?');
    expect(text).not.toContain('DROP');
    expect(bindings).toEqual([attacker]);
  });

  test('null / undefined / Date / boolean pass through bindings untouched', () => {
    const d = new Date('2026-04-24T00:00:00Z');
    const [s, v] = tag`X ${null} ${undefined} ${true} ${d}`;
    const { text, bindings } = compileTag(s, v, 'question');
    expect(text).toBe('X ? ? ? ?');
    expect(bindings[0]).toBeNull();
    expect(bindings[1]).toBeUndefined();
    expect(bindings[2]).toBe(true);
    expect(bindings[3]).toBe(d);
  });
});
