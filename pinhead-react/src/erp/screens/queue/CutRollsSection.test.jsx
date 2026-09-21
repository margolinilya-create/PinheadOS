import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CutRollsSection } from './CutRollsSection';

/**
 * ИТОГ ЗАКРОЯ И ПЛЮСЫ (правки заказчика 21.09, пп. 3 и 4).
 *
 * П. 4 дословно: «текущая строка „Всего скроено: 50 шт · расход: 20 кг ·
 * XS 50 · размеры выбраны из стандартной шкалы: у позиции нет размерной
 * сетки" перегружена и непонятна. Техническое сообщение смешано
 * с производственным итогом».
 */

const ORDER = {
  id: 'o-1',
  materials: [{
    id: 'm-1',
    kind: 'fabric',
    name: 'кулирка',
    item_id: null,
    accept_status: 'accepted_full',
    rolls: [
      { id: 'r-1', seq: 1, label: 'Рулон №1', status: 'in_stock' },
      { id: 'r-2', seq: 2, label: 'Рулон №2', status: 'in_stock' },
    ],
  }],
};

const ITEM = { id: 'it-1', qty: 200, size_grid: [{ color: '—', sizes: { XS: 50 } }] };

const entry = (rollId, qtyUsed, sizes) => ({
  rollId,
  qtyUsed,
  finished: false,
  sizes: sizes.map(([size, qty]) => ({ size, color: '—', qty })),
});

function renderSection(props = {}) {
  return render(
    <CutRollsSection
      order={ORDER}
      item={ITEM}
      entries={[entry('r-1', 20, [['XS', 50]])]}
      onChange={vi.fn()}
      {...props}
    />,
  );
}

describe('итог закроя', () => {
  it('короткий итог — два числа, разбивка отдельной строкой', () => {
    renderSection();
    expect(screen.getByText(/Скроено:/)).toHaveTextContent('Скроено: 50 шт · Расход: 20 кг');
    expect(screen.getByText(/По размерам:/)).toHaveTextContent('По размерам: XS — 50 шт');
  });

  it('технической фразы про стандартную шкалу в итоге нет', () => {
    renderSection();
    expect(screen.queryByText(/размеры выбраны из стандартной шкалы/)).not.toBeInTheDocument();
  });

  /**
   * «Если размерная сетка действительно отсутствует… показывать отдельное
   * предупреждение „Размерная сетка заказа не найдена", а не добавлять
   * технический текст в итог».
   */
  it('без сетки — отдельное предупреждение, а не приписка к итогу', () => {
    renderSection({ item: { id: 'it-1', qty: 200, size_grid: null } });
    expect(screen.getByText(/Размерная сетка заказа не найдена/)).toBeInTheDocument();
    expect(screen.getByText(/Скроено:/)).toHaveTextContent('Скроено: 50 шт · Расход: 20 кг');
  });

  it('с заполненной сеткой предупреждения нет', () => {
    renderSection();
    expect(screen.queryByText(/Размерная сетка заказа не найдена/)).not.toBeInTheDocument();
  });
});

describe('производственный плюс', () => {
  /** Пример из документа: в заказе XS 50, скроено 55 → плюс 5 */
  it('скроено больше заказа — плюс показан отдельной строкой', () => {
    renderSection({ entries: [entry('r-1', 20, [['XS', 55]])] });
    expect(screen.getByText(/Плюс:/)).toHaveTextContent('Плюс: XS — 5 шт');
    // Фактический раскрой сохраняется целиком, а не срезается до плана
    expect(screen.getByText(/Скроено:/)).toHaveTextContent('Скроено: 55 шт');
  });

  it('скроено по заказу — строки плюса нет вовсе', () => {
    renderSection();
    expect(screen.queryByText(/Плюс:/)).not.toBeInTheDocument();
  });

  /** «Плюсы считать отдельно по каждому размеру и суммарно по позиции» */
  it('плюс по нескольким размерам показывает и разбивку, и сумму', () => {
    render(
      <CutRollsSection
        order={ORDER}
        item={{ id: 'it-1', qty: 80, size_grid: [{ color: '—', sizes: { XS: 50, S: 30 } }] }}
        entries={[entry('r-1', 20, [['XS', 52], ['S', 33]])]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Плюс:/)).toHaveTextContent('Плюс: XS — 2 шт · S — 3 шт · всего 5 шт');
  });

  /** Закрой сдаёт частями: 30 сегодня, 25 завтра при плане 50 — это плюс 5 */
  it('прежние сдачи учтены: плюс появляется на второй части', () => {
    renderSection({
      entries: [entry('r-2', 15, [['XS', 25]])],
      reported: { '—\u0000XS': 30 },
    });
    expect(screen.getByText(/Плюс:/)).toHaveTextContent('Плюс: XS — 5 шт');
  });

  it('у позиции без сетки плюсов не бывает — сравнивать не с чем', () => {
    renderSection({
      item: { id: 'it-1', qty: 200, size_grid: null },
      entries: [entry('r-1', 20, [['XS', 500]])],
    });
    expect(screen.queryByText(/Плюс:/)).not.toBeInTheDocument();
  });
});
