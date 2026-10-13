import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import SkuCardPage from './SkuCardPage';
import { useErpStore } from '../../store/useErpStore';
import { attachDomainSlices } from '../../store/domainSlices';

// Экран рендерится напрямую, минуя lazyScreen, — стор подключает тест
attachDomainSlices();

/**
 * КАРТОЧКА МОДЕЛИ: ТРИ ДЕЙСТВИЯ — ТРИ ПРАВА.
 *
 * Клиентская половина `erp_sku_card_guard`. Страж СТРОЖЕ интерфейса даёт
 * «кнопка есть, действие падает», мягче — дыру; поэтому здесь проверяется
 * ровно то, что стражу разрешено: правку гасит `sku.edit`, выпуск в работу —
 * `sku.publish`, архив — `sku.archive`. Одного общего права хватило бы, чтобы
 * все три отличия исчезли молча — кнопки-то нарисовались бы.
 */

const CARD = {
  id: 'sku-a',
  code: 'HOOD-320',
  name: 'Худи оверсайз 320',
  category: 'hoodies',
  description: null,
  fit: 'oversize',
  pattern_tech_name: 'HD-320-OS',
  pattern_version: '2',
  card_version: 3,
  status: 'draft',
  experimental_id: null,
  source_item_id: null,
  final_package: {},
  price_min: null,
  price_max: null,
  created_by: null,
  created_at: '2026-07-10T08:00:00Z',
  updated_at: '2026-07-10T08:00:00Z',
};

const loadSkuCards = vi.fn(async () => true);
const loadSkuCardDetail = vi.fn(async () => ({ versions: [], files: [] }));
const loadSkuCardStats = vi.fn(async () => ({ orders: 0, qty: 0, lastOrderAt: null }));

/** Права подменяются на уровне модуля доступа: матрица сюда не приезжает */
let allowed = [];
vi.mock('../../store/useErpAccess', () => ({
  useErpAccess: () => ({
    can: (p) => allowed.includes(p),
    canActIn: () => true,
    canDo: (p) => allowed.includes(p),
    isPrivileged: false,
    isAdmin: false,
    role: 'technologist',
    myDeptId: null,
  }),
}));

function setStore(patch = {}) {
  useErpStore.setState({
    skuCards: [CARD],
    skuCardsLoaded: true,
    skuCardsError: null,
    skuPriceCodes: ['HOOD-320'],
    loadSkuCards,
    loadSkuCardDetail,
    loadSkuCardStats,
    ...patch,
  });
}

function renderCard() {
  return render(
    <MemoryRouter initialEntries={['/sku-card/sku-a']}>
      <Routes>
        <Route path="/sku-card/:cardId" element={<SkuCardPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('карточка модели', () => {
  beforeEach(() => {
    allowed = ['sku.view'];
    setStore();
  });

  it('показывает артикул и версию карточки', async () => {
    renderCard();
    expect(await screen.findByText(/HOOD-320/)).toBeInTheDocument();
    expect(screen.getByText(/версия карточки 3/)).toBeInTheDocument();
  });

  it('без sku.publish выпуска в работу не предлагает', async () => {
    renderCard();
    await screen.findByText(/HOOD-320/);
    expect(screen.queryByRole('button', { name: /Выпустить в работу/ })).toBeNull();
  });

  it('с sku.publish кнопка выпуска есть', async () => {
    allowed = ['sku.view', 'sku.publish'];
    renderCard();
    expect(await screen.findByRole('button', { name: /Выпустить в работу/ })).toBeInTheDocument();
  });

  it('без sku.archive архивировать нечем', async () => {
    allowed = ['sku.view', 'sku.publish'];
    renderCard();
    await screen.findByText(/HOOD-320/);
    expect(screen.queryByRole('button', { name: /В архив/ })).toBeNull();
  });

  it('с sku.archive кнопка архива есть', async () => {
    allowed = ['sku.view', 'sku.archive'];
    renderCard();
    expect(await screen.findByRole('button', { name: /В архив/ })).toBeInTheDocument();
  });

  /**
   * БЕЗ ПРАВА ЭКРАН ОСТАЁТСЯ НА ЧТЕНИЕ, А НЕ ПРЯЧЕТСЯ: правило проекта.
   * Нативный `fieldset[disabled]` гасит все поля разом — честно и для
   * клавиатуры, и для скринридера.
   */
  it('без sku.edit поля видны, но неактивны', async () => {
    renderCard();
    const name = await screen.findByLabelText(/Название модели/);
    expect(name).toBeDisabled();
    expect(screen.getByText(/правка требует права/)).toBeInTheDocument();
  });

  it('с sku.edit поля правятся', async () => {
    allowed = ['sku.view', 'sku.edit'];
    renderCard();
    expect(await screen.findByLabelText(/Название модели/)).not.toBeDisabled();
  });

  /**
   * «Выпущен ли артикул в прайс» СПРАШИВАЕТСЯ У ПРАЙСА: второй флаг в карточке
   * разошёлся бы с ним в первую же публикацию. Молчим, когда выпущен.
   */
  it('молчит про прайс, когда артикул в нём есть', async () => {
    renderCard();
    await screen.findByText(/HOOD-320/);
    expect(screen.queryByText(/Нет в прайсе визарда/)).toBeNull();
  });

  it('говорит, когда артикула в прайсе нет', async () => {
    setStore({ skuPriceCodes: [] });
    renderCard();
    expect(await screen.findByText(/Нет в прайсе визарда/)).toBeInTheDocument();
  });

  /**
   * ОТКРЫТИЕ ПЕРЕЧИТЫВАЕТ КАРТОЧКУ. Подписки realtime у каталога нет
   * намеренно (это справочник), и «перечитывается при открытии» обязано быть
   * правдой, а не объяснением в `NO_REALTIME`.
   */
  it('при открытии перечитывает карточку, историю и файлы', async () => {
    renderCard();
    await waitFor(() => expect(loadSkuCardDetail).toHaveBeenCalledWith('sku-a'));
  });
});
