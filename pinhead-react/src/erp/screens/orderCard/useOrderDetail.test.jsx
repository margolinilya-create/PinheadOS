/**
 * Карточка заказа дозагружает ПОЛНЫЙ заказ столько раз, сколько нужно.
 *
 * ЗАЧЕМ. Списочная выборка (`ORDER_LIST_SELECT`) не тянет `items.size_grid`,
 * поэтому карточка обязана сходить за полным заказом и знает об этом
 * по `detailIds`. `loadAll` заказ перезаписывает, признак снимает — и с этого
 * момента дозагрузка нужна ЗАНОВО. Пока признак не снимался, размерная сетка
 * исчезала с карточки молча: разметка написана как
 * `{size_grid && size_grid.length > 0 && …}`, то есть блок просто пропадает,
 * без ошибки и без пустого состояния. Путь короткий — открыть карточку,
 * свернуть планшет, вернуться: возврат фокуса зовёт `resyncRealtime()`.
 *
 * ЧТО ИМЕННО СТОРОЖИТ ЭТОТ ФАЙЛ. Ровно два свойства хука: пропал признак —
 * ушёл запрос; заказ не нашёлся — повтора нет. Сам снятый признак сторожат
 * тесты стора (`useErpStore.test.ts`, «loadAll снимает отметку полноты»).
 *
 * Отдельно записано, чего здесь НЕТ: сторожа на `then` вместо `finally`
 * в `setLookedUpFor`. Обе версии ведут себя одинаково, потому что успешный
 * `loadOne` меняет стор, `useSyncExternalStore` перерисовывает синхронно,
 * и `alive` гасит колбэк раньше, чем тот сработает. Проверено прогоном
 * на обеих версиях. `then` оставлен как ЯВНОЕ намерение, а не как починка
 * дефекта — и тест, который «падал бы» на `finally`, был бы неправдой.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useOrderDetail } from './useOrderDetail';
import { useErpStore, resetErpStore } from '../../store/useErpStore';

const FULL = { id: 'o-1', title: 'Заказ', status: 'active', items: [], materials: [] };

function seed(loadOne) {
  useErpStore.setState({
    loaded: true,
    loadError: false,
    orders: [FULL],
    detailIds: [],
    departments: [],
    profilesList: [],
    employees: [],
    loadAll: vi.fn(),
    loadOne,
    loadOrderBundle: vi.fn().mockResolvedValue({ events: [], audit: [], comments: [] }),
  });
}

describe('useOrderDetail: дозагрузка полного заказа', () => {
  beforeEach(() => {
    resetErpStore();
  });

  it('без признака полноты заказ дозагружается', async () => {
    const loadOne = vi.fn(async (id) => {
      // Сетевой круг ДО записи в стор — тот же порядок, что у настоящего
      // `loadOne`: `await erpQuery(...)`, затем `set(...)`, затем return.
      // Без него мок менял стор синхронно, React успевал снять эффект,
      // и `alive` гасил `setLookedUpFor` — то есть тест проверял не тот путь
      await Promise.resolve();
      useErpStore.setState((s) => ({ detailIds: [...s.detailIds, id] }));
      return FULL;
    });
    seed(loadOne);

    renderHook(() => useOrderDetail('o-1'));

    await waitFor(() => expect(loadOne).toHaveBeenCalledWith('o-1'));
  });

  /**
   * Главный сторож волны: `loadAll` снял признак — карточка обязана сходить
   * за полным заказом ЗАНОВО. Прежний код этого не делал ни при каких условиях.
   */
  it('после потери признака полноты дозагрузка повторяется', async () => {
    const loadOne = vi.fn(async (id) => {
      // Сетевой круг ДО записи в стор — тот же порядок, что у настоящего
      // `loadOne`: `await erpQuery(...)`, затем `set(...)`, затем return.
      // Без него мок менял стор синхронно, React успевал снять эффект,
      // и `alive` гасил `setLookedUpFor` — то есть тест проверял не тот путь
      await Promise.resolve();
      useErpStore.setState((s) => ({ detailIds: [...s.detailIds, id] }));
      return FULL;
    });
    seed(loadOne);

    const { rerender } = renderHook(() => useOrderDetail('o-1'));
    await waitFor(() => expect(loadOne).toHaveBeenCalledTimes(1));

    // Ровно то, что делает loadAll: заказ на месте, но уже списочный
    useErpStore.setState({ detailIds: [] });
    rerender();

    await waitFor(() => expect(loadOne).toHaveBeenCalledTimes(2));
  });

  /**
   * И при этом никакого вечного повтора: заказ, которого нет (или который
   * не прочитался), `loadOne` отдаёт как `null` и признак полноты не поднимает.
   * Ради этого случая `lookedUpFor` и заведён — он обязан продолжать работать.
   */
  it('ненайденный заказ не уходит в бесконечный повтор', async () => {
    const loadOne = vi.fn().mockResolvedValue(null);
    seed(loadOne);
    useErpStore.setState({ orders: [] });

    const { result, rerender } = renderHook(() => useOrderDetail('o-1'));
    await waitFor(() => expect(loadOne).toHaveBeenCalledTimes(1));

    rerender();
    rerender();
    await waitFor(() => expect(result.current.notFound).toBe(true));

    expect(loadOne).toHaveBeenCalledTimes(1);
  });
});
