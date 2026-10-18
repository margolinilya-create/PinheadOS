/**
 * Пять образцов владельца (К25): заказ v4 → `tzDocument()` даёт поля `*.tz.json`.
 * Ожидания собраны по спеке (строки 128–223) и разбору `docs/erp/tz-format-analysis.md`
 * ДО реализации (отдельный коммит); откуда каждое поле — `fixtures/README.md`.
 */
import { describe, it, expect } from 'vitest';
import { FIXTURE_NAMES, FIXTURE_OPTS, fixtureCatalogs, loadFixture } from '../../fixtures/loadFixture.testutil';
import { tzGroups } from './tzGroups';
import { tzDocument } from './tzDocument';

describe('tzDocument — пять образцов', () => {
  it.each(FIXTURE_NAMES)('%s: поля документа равны ожиданиям образца', (name) => {
    const { order, group, expected } = loadFixture(name);
    const groups = tzGroups(order);
    const doc = tzDocument(order, groups[group], fixtureCatalogs(), FIXTURE_OPTS);
    expect(doc).toMatchObject(expected);
  });

  it('68180 — три ТЗ (футболка, свитшот, поло), футболка двух цветов — одно ТЗ', () => {
    const { order } = loadFixture('68180-tee');
    const groups = tzGroups(order);
    expect(groups.map((g) => g.items.map((i) => i.key))).toEqual([
      ['68180-tee-black', '68180-tee-white'], ['68180-sweat'], ['68180-polo'],
    ]);
    expect(groups.map((g) => [g.index, g.total])).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('67108 — шесть нанесений, №2–4 на одном мокапе спины', () => {
    const { order } = loadFixture('67108');
    const doc = tzDocument(order, tzGroups(order)[0], fixtureCatalogs(), FIXTURE_OPTS);
    expect(doc.prints).toHaveLength(6);
    expect(doc.prints.slice(1, 4).map((p) => p.mockup?.view)).toEqual(['back', 'back', 'back']);
  });
});
