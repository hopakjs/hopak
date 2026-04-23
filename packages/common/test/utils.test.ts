import { describe, expect, test } from 'bun:test';
import { deepMerge } from '../src';

describe('deepMerge', () => {
  test('merges nested plain objects', () => {
    const out = deepMerge({ a: { x: 1, y: 2 } }, { a: { y: 20, z: 30 } });
    expect(out).toEqual({ a: { x: 1, y: 20, z: 30 } });
  });

  test('undefined in source is ignored', () => {
    const out = deepMerge({ a: 1, b: 2 }, { a: undefined, b: 20 });
    expect(out).toEqual({ a: 1, b: 20 });
  });

  test('arrays in source replace target arrays', () => {
    const out = deepMerge({ list: [1, 2, 3] }, { list: [9] });
    expect(out.list).toEqual([9]);
  });

  test('drops __proto__ key — no prototype swap', () => {
    const attacker = JSON.parse('{"__proto__": {"isAdmin": true}}');
    const merged = deepMerge({ foo: 'bar' }, attacker);
    // Merged object keeps the normal Object prototype.
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect((merged as Record<string, unknown>).isAdmin).toBeUndefined();
    // Global Object.prototype stays clean.
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });

  test('drops constructor / prototype keys', () => {
    const attacker = JSON.parse('{"constructor": {"prototype": {"polluted": true}}}');
    const merged = deepMerge({} as Record<string, unknown>, attacker);
    expect(merged.constructor).toBe(Object);
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });
});
