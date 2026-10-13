import { describe, it, expect } from 'vitest';
import { setIn, getIn } from './pathSet';

describe('setIn / getIn', () => {
  it('пишет вглубь без мутации и сохраняет массивы', () => {
    const src = { a: { b: [1, 2, 3] } };
    const out = setIn(src, ['a', 'b', '1'], 9);
    expect(out).toEqual({ a: { b: [1, 9, 3] } });
    expect(Array.isArray(out.a.b)).toBe(true);
    expect(src.a.b[1]).toBe(2);
    expect(getIn(out, ['a', 'b', '1'])).toBe(9);
  });
  it('создаёт отсутствующие уровни', () => {
    expect(setIn({}, ['x', '0'], 5)).toEqual({ x: [5] });
  });
});
