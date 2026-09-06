import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MATERIAL_KIND_LABELS, MATERIAL_ROLE_LABELS } from '../types';
import {
  FABRIC_ROLE_VALUES, kindHasRole, materialRoleForKind, materialRoleLabel,
} from './materialRole';

/**
 * ДВА КЛАССИФИКАТОРА МАТЕРИАЛА ОБЯЗАНЫ ОТЛИЧАТЬСЯ.
 *
 * Владелец решил оставить оба — «Вид» (что это физически) и «Назначение»
 * (где в изделии). Пока форма предлагала все семь назначений при любом виде,
 * четыре из них были теми же словами, что и вид, а `main` стояло по умолчанию:
 * молния уезжала «Основным полотном».
 */

const SRC = (p: string) => readFileSync(join(process.cwd(), 'src/erp', p), 'utf8');

describe('назначение материала отличается от его вида', () => {
  it('предлагаемые назначения НЕ ПОВТОРЯЮТ виды', () => {
    const kinds = new Set(Object.keys(MATERIAL_KIND_LABELS));
    const same = FABRIC_ROLE_VALUES.filter((r) => kinds.has(r));
    expect(same, `назначение дублирует вид: ${same.join(', ')}`).toEqual([]);
  });

  /**
   * Набор ВЫВОДИТСЯ вычитанием видов, а не перечислен руками. Утверждение
   * ловит обе крайности: и возврат дубля, и схлопывание набора в пустоту
   * (тогда поле «Назначение» исчезло бы у ткани молча).
   */
  it('информацию несут ровно три назначения — про ткань', () => {
    expect([...FABRIC_ROLE_VALUES]).toEqual(['main', 'trim', 'lining']);
  });

  it('назначение спрашивается только у ткани', () => {
    expect(kindHasRole('fabric')).toBe(true);
    for (const kind of Object.keys(MATERIAL_KIND_LABELS)) {
      if (kind !== 'fabric') expect(kindHasRole(kind), kind).toBe(false);
    }
  });

  it('назначение, повторяющее вид, не печатается', () => {
    expect(materialRoleLabel('main')).toBe('Основное полотно');
    expect(materialRoleLabel('lining')).toBe('Подклад');
    // Legacy-строки с прода: рядом стоит колонка «Вид» с тем же словом
    expect(materialRoleLabel('hardware')).toBeNull();
    expect(materialRoleLabel('labels')).toBeNull();
    expect(materialRoleLabel(null)).toBeNull();
  });

  it('у не-ткани назначение не записывается, каким бы ни осталось состояние формы', () => {
    // Человек выбрал «Подклад», потом сменил вид на фурнитуру
    expect(materialRoleForKind('hardware', 'lining')).toBeNull();
    expect(materialRoleForKind('fabric', 'lining')).toBe('lining');
    expect(materialRoleForKind('fabric', 'packaging')).toBeNull();
  });

  /**
   * Словарь подписей и тип НЕ СОКРАЩЕНЫ: две строки на проде заведены
   * со старым назначением, а CHECK базы принимает семь значений. Гейт стоит
   * там, где человек выбирает, — в форме.
   */
  it('словарь подписей сохраняет legacy-значения', () => {
    expect(Object.keys(MATERIAL_ROLE_LABELS)).toHaveLength(7);
  });

  it('форма предлагает ВЫВЕДЕННЫЙ набор, а не весь словарь', () => {
    const form = SRC('screens/orders/create/PurchaseListSection.jsx');
    expect(form, 'селект назначения обязан идти по FABRIC_ROLE_VALUES')
      .toMatch(/FABRIC_ROLE_VALUES\.map/);
    expect(form, 'весь словарь назначений форме больше не предлагается')
      .not.toMatch(/Object\.entries\(MATERIAL_ROLE_LABELS\)/);
    expect(form, 'поле назначения показывается только у ткани')
      .toMatch(/kindHasRole\(/);
  });

  it('печатный лист не показывает назначение, повторяющее вид', () => {
    const print = SRC('screens/purchasing/PurchaseListPrint.jsx');
    expect(print).toMatch(/materialRoleLabel\(/);
    expect(print, 'сырой словарь в ячейке вернул бы «фурнитура | Фурнитура»')
      .not.toMatch(/MATERIAL_ROLE_LABELS\[/);
  });

  it('в базу назначение уходит через общее правило', () => {
    const modal = SRC('screens/orders/CreateOrderModal.jsx');
    expect(modal).toMatch(/materialRoleForKind\(/);
  });
});
