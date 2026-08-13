import { describe, expect, it } from 'vitest';
import { DEPARTMENTS, DEPT_ICONS, deptIcon } from './departments';
import { ICONS } from '../components/icons';

/**
 * Иконка участка — единственное, что остаётся от пункта меню в СВЁРНУТОМ
 * сайдбаре (на планшете цеха он свёрнут по умолчанию). Совпадение иконок
 * там превращает разные цеха в неразличимые пункты — M-12 отчёта QA
 * 13.08.2026: «Шелкография» и «ДТФ» рисовались одним принтером,
 * «Вышивка» и «Швейка» — одной иглой.
 *
 * Тест проверяет два свойства сразу: иконки различны и все они существуют
 * в наборе. Второе не менее важно — опечатка в имени даёт молчаливый
 * запасной «queue», то есть ровно тот же дубль, только необъяснимый.
 */
describe('иконки участков', () => {
  it('у каждого участка своя иконка', () => {
    const byIcon = new Map<string, string[]>();
    for (const [code, icon] of Object.entries(DEPT_ICONS)) {
      byIcon.set(icon, [...(byIcon.get(icon) ?? []), code]);
    }
    const clashes = [...byIcon.entries()]
      .filter(([, codes]) => codes.length > 1)
      .map(([icon, codes]) => `${icon}: ${codes.join(', ')}`);
    expect(clashes, `в свёрнутом меню эти цеха неразличимы — ${clashes.join(' · ')}`).toEqual([]);
  });

  it('все имена иконок существуют в наборе', () => {
    const missing = Object.entries(DEPT_ICONS)
      .filter(([, icon]) => !(icon in ICONS))
      .map(([code, icon]) => `${code} → ${icon}`);
    expect(missing, `нет такой иконки: ${missing.join(', ')}`).toEqual([]);
  });

  it('у каждого участка сида иконка задана явно, а не запасная', () => {
    // Запасная «queue» — это снова дубль: все безымянные цеха станут похожи
    const fallback = DEPARTMENTS
      .filter((d) => !(d.code in DEPT_ICONS))
      .map((d) => `${d.code} (${deptIcon(d.code)})`);
    expect(fallback, `иконка не задана: ${fallback.join(', ')}`).toEqual([]);
  });
});
