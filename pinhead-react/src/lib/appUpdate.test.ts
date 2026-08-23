import { describe, expect, it, vi, beforeEach } from 'vitest';
import { isChunkLoadError, handlePossibleUpdate, resetUpdatePrompt } from './appUpdate';
import { useConfirmStore } from '../store/useConfirmStore';

/**
 * «Вышло обновление»: распознавание устаревшей вкладки.
 *
 * Планшет в цеху держат открытым сутками. Выкатка меняет имена чанков, файлы
 * прошлого деплоя исчезают, и первый переход на ленивый экран падает. Раньше
 * человек видел «⚠ Что-то пошло не так» — то есть повод звать мастера вместо
 * одной кнопки.
 */
describe('распознавание устаревшей вкладки', () => {
  beforeEach(() => resetUpdatePrompt());

  it.each([
    // Chromium
    'Failed to fetch dynamically imported module: https://app/assets/Warehouse-a1b2.js',
    // Firefox
    'error loading dynamically imported module',
    // Safari / WebKit
    'Importing a module script failed.',
    // Пока SPA-rewrite ловил /assets/*, сервер отдавал HTML вместо модуля
    'Failed to load module script: Expected a JavaScript module script but the server '
      + 'responded with a MIME type of "text/html".',
  ])('узнаёт: %s', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  /**
   * ОТРИЦАТЕЛЬНАЯ ПОЛОВИНА ВАЖНЕЕ. Если экран упал уже ПОСЛЕ загрузки, совет
   * «обновите страницу» вредный: перезагрузка не поможет, а набранное в форме
   * пропадёт. Без этих примеров функция незаметно превратилась бы
   * в «предлагать обновление на любую ошибку».
   */
  it.each([
    ['обычная ошибка кода', new TypeError('x is not a function')],
    ['отказ прав от RLS', new Error('new row violates row-level security policy')],
    ['обрыв связи', new TypeError('Failed to fetch')],
    ['пустое сообщение', new Error('')],
    ['ничего', null],
  ])('не принимает за обновление: %s', (_label, error) => {
    expect(isChunkLoadError(error)).toBe(false);
  });
});

describe('реакция на устаревшую вкладку', () => {
  beforeEach(() => {
    resetUpdatePrompt();
    useConfirmStore.setState({ open: false, _resolver: null, title: '', nonce: 0 });
  });

  const chunkError = new Error('Failed to fetch dynamically imported module: /assets/x.js');

  it('спрашивает человека, а не перезагружает молча', async () => {
    const reload = vi.fn();
    expect(handlePossibleUpdate(chunkError, reload)).toBe(true);

    // Перезагрузки нет, пока человек не ответил: в соседней форме
    // может быть набран отчёт по этапу или количество в приёмке
    expect(reload).not.toHaveBeenCalled();
    expect(useConfirmStore.getState().open).toBe(true);
    expect(useConfirmStore.getState().title).toContain('обновление');

    useConfirmStore.getState()._close(true);
    // Два микротаска: `confirm()` разворачивает результат своим `.then`,
    // и только следом идёт наш обработчик
    await new Promise((r) => setTimeout(r, 0));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('«Позже» перезагрузку не делает', async () => {
    const reload = vi.fn();
    handlePossibleUpdate(chunkError, reload);
    useConfirmStore.getState()._close(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(reload).not.toHaveBeenCalled();
  });

  /**
   * Один сломанный переход обычно даёт несколько отказов подряд (Suspense
   * повторяет попытку, соседний ленивый чанк падает следом). Диалог при этом
   * должен быть ОДИН — иначе человек закрывает стопку одинаковых окон.
   */
  it('не спрашивает дважды за одну попытку', () => {
    const reload = vi.fn();
    handlePossibleUpdate(chunkError, reload);
    const nonce = useConfirmStore.getState().nonce;
    handlePossibleUpdate(chunkError, reload);
    expect(useConfirmStore.getState().nonce, 'диалог показан повторно').toBe(nonce);
  });

  it('чужую ошибку не трогает', () => {
    expect(handlePossibleUpdate(new TypeError('boom'), vi.fn())).toBe(false);
    expect(useConfirmStore.getState().open).toBe(false);
  });
});
