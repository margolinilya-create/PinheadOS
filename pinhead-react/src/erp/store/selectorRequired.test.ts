// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { relative } from 'node:path';
import { readSource, sourceFiles, SRC_DIR } from '../../testutil/sourceFiles';
import { withoutJsComments } from '../utils/migrations.testutil';

/**
 * `useErpStore()` БЕЗ СЕЛЕКТОРА ПОДПИСЫВАЕТ КОМПОНЕНТ НА ВЕСЬ СТОР
 * (обзор 26.09, п. 7).
 *
 * Такой компонент перерисовывается на КАЖДОЕ изменение состояния — включая
 * каждое событие realtime и каждый патч этапа в чужом заказе, — хотя берёт
 * из стора две-три функции, которые не меняются никогда. Два таких вызова
 * (секция файлов заказа и вкладка файлов разработки) стояли в карточках,
 * открытых часами. Правило проекта — `useShallow` для объектных селекторов —
 * тут не срабатывало: селектора не было вовсе.
 *
 * Мутация (проверена 26.09): вернуть `useErpStore()` в `FilesSection.jsx` —
 * красный с именем файла.
 */
describe('useErpStore всегда зовётся с селектором', () => {
  it('в компонентах нет `useErpStore()` без аргумента', () => {
    const offenders = sourceFiles(SRC_DIR, { ext: /\.(jsx|tsx)$/ })
      .filter((p) => /\buseErpStore\(\s*\)/.test(withoutJsComments(readSource(p))))
      .map((p) => relative(SRC_DIR, p));
    expect(offenders, 'подписка на весь стор — дайте селектор (useShallow для объекта)').toEqual([]);
  });
});
