import { describe, it, expect } from 'vitest';
import { allowedFor } from './allowedColors';
import { offeredColors } from './suppliers';
import { SUPPLIERS_SEED } from './seeds';

const medastex = offeredColors(SUPPLIERS_SEED.find((s) => s.id === 'medastex'));
const cottonprom = offeredColors(SUPPLIERS_SEED.find((s) => s.id === 'cottonprom'));
const codes = (list: readonly { code: string }[] | null) => list?.map((c) => c.code) ?? null;

describe('allowedFor — ограничение цветов модели по палитре поставщика ткани (К10)', () => {
  it('ограничения нет (null, undefined, нет правил) — палитра целиком', () => {
    expect(allowedFor(null, medastex)).toBeNull();
    expect(allowedFor(undefined, medastex)).toBeNull();
    expect(allowedFor({ allowedColors: null }, medastex)).toBeNull();
    expect(allowedFor({}, medastex)).toBeNull();
  });

  it('пустой список кодов — не ограничение, а палитра целиком', () => {
    expect(allowedFor({ allowedColors: [] }, medastex)).toBeNull();
  });

  it('коды из палитры поставщика — только они, в порядке палитры', () => {
    const got = allowedFor({ allowedColors: ['01-02', '01-01'] }, medastex);
    expect(codes(got)).toEqual(['01-01', '01-02']);
  });

  it('ограничение кодами Медастекс + ткань другого поставщика → не пусто: палитра целиком', () => {
    const medasCodes = medastex.slice(0, 3).map((c) => c.code);
    expect(allowedFor({ allowedColors: medasCodes }, cottonprom)).toBeNull();
  });

  it('смешанный список — только коды этой палитры', () => {
    const got = allowedFor({ allowedColors: ['01-01', cottonprom[0].code] }, cottonprom);
    expect(codes(got)).toEqual([cottonprom[0].code]);
  });

  it('у поставщика нет цветов — null (палитра пуста и так)', () => {
    expect(allowedFor({ allowedColors: ['01-01'] }, [])).toBeNull();
  });

  it('не меняет входные массивы', () => {
    const allowed = ['01-01'];
    const before = medastex.map((c) => c.code);
    allowedFor({ allowedColors: allowed }, medastex);
    expect(allowed).toEqual(['01-01']);
    expect(medastex.map((c) => c.code)).toEqual(before);
  });
});
