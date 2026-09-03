import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FabricPurchasing from './FabricPurchasing';
import { useErpStore } from '../store/useErpStore';
import { attachDomainSlices } from '../store/domainSlices';

// Экран рендерится напрямую, минуя lazyScreen, — стор подключает тест
attachDomainSlices();

/**
 * ТРИ СОСТОЯНИЯ ЭКРАНА ЗАКУПКИ.
 *
 * ЗАЧЕМ ЭТОТ СТОРОЖ. До 03.09 `LoadFailed` и `TableSkeleton` физически лежали
 * ВНУТРИ `<PurchaseCard>`, то есть под условием `loaded && selectedOrder`.
 * Отступ у них был сброшен к левому краю — строки выглядели верхнеуровневыми,
 * и комментарий рядом уверял, что правило UX-2 соблюдено. В тексте оно и было
 * соблюдено; в дереве `loadError && !loaded` внутри блока, требующего
 * `loaded`, недостижимо по построению.
 *
 * Цена: закупщик по цеховому Wi-Fi видел один заголовок «Закупка» — и пока
 * идёт запрос, и НАВСЕГДА при его отказе, потому что `if (!loaded) loadAll()`
 * второй раз не срабатывает, а кнопки «Повторить» на экране не существовало.
 *
 * Проверка идёт по ЭКРАНУ, а не по исходнику: перенеси кто-нибудь состояния
 * обратно внутрь карточки — тест краснеет, как бы ни выглядели отступы.
 */

const loadAll = vi.fn(async () => true);

function setStore(patch) {
  useErpStore.setState({
    departments: [{ id: 'd-sup', code: 'supply', name: 'Закупка', active: true, is_production: false }],
    orders: [],
    loaded: true,
    loadError: false,
    loadAll,
    ...patch,
  });
}

const renderScreen = () => render(
  <MemoryRouter><FabricPurchasing /></MemoryRouter>,
);

describe('Закупка — состояния экрана', () => {
  beforeEach(() => { loadAll.mockClear(); });

  it('сбой загрузки: «Не удалось загрузить» и кнопка «Повторить»', () => {
    setStore({ loaded: false, loadError: true });
    renderScreen();
    expect(screen.getByText(/Не удалось загрузить/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Повторить/ })).toBeInTheDocument();
  });

  it('загрузка: скелетон, а не пустая страница', () => {
    setStore({ loaded: false, loadError: false });
    renderScreen();
    expect(screen.getByLabelText('Загрузка закупки')).toBeInTheDocument();
  });

  it('при сбое скелетон не показывается — иначе экран «грузится» вечно', () => {
    setStore({ loaded: false, loadError: true });
    renderScreen();
    expect(screen.queryByLabelText('Загрузка закупки')).not.toBeInTheDocument();
  });

  /**
   * Ровно тот случай, который ломался: заказ не выбран (а выбрать нечего —
   * данных нет). Прежняя разметка не показывала в этом состоянии НИЧЕГО.
   */
  it('состояния видны и без выбранного заказа', () => {
    setStore({ loaded: false, loadError: true, orders: [] });
    renderScreen();
    expect(screen.getByText(/Не удалось загрузить/)).toBeInTheDocument();
  });

  it('загруженный экран не показывает ни ошибку, ни скелетон', () => {
    setStore({ loaded: true, loadError: false });
    renderScreen();
    expect(screen.queryByText(/Не удалось загрузить/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Загрузка закупки')).not.toBeInTheDocument();
  });
});
