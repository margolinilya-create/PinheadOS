import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PurchaseRowCard } from './PurchaseRowCard';
import { PURCHASE_GROUPS } from './purchaseLabels';

/**
 * Строка закупки на планшете.
 *
 * ЗАЧЕМ СТОРОЖ. У таблицы закупки ЧЕТЫРНАДЦАТЬ колонок, и до этой правки она
 * рисовалась той же таблицей на любой ширине: на 768px это прокрутка на три
 * экрана, а «Закупка» входит в пилот наравне со «Складом» — то есть с планшета
 * с ней и работают.
 *
 * Проверяется не вид, а два условия, на которых карточка вообще имеет право
 * существовать:
 *
 *  1. Разделение полей на две группы («Потребность — задал менеджер» / «Факт —
 *     ведёт закупка») — прямое требование документа. Пока групп не было, обе
 *     роли писали в общую строку, и «нужно было 100 м → закупили 110» показать
 *     было нечем. В карточке группы обязаны выжить.
 *  2. Поля берутся из ТЕХ ЖЕ `PurchaseFields`, что рисует таблица, и правку
 *     пишут по тому же условию «значение изменилось». Вторая реализация
 *     разошлась бы с первой молча: обе «работают», просто пишут по-разному.
 */

const ORDER = { id: 'o1', bitrix_id: '4821', title: 'Худи «Ромашка»' };

const MATERIAL = {
  id: 'm1', name: 'Футер 3-нитка', kind: 'fabric', source: 'purchase',
  color: 'чёрный', unit: 'м',
  qty_expected: 100, manager_note: 'та же партия, что в прошлый раз',
  supplier: null, suppliers: [], article: null,
  qty_ordered: 110, price_per_unit: 500,
  ordered_on: null, eta_date: null, qty_received: null, received_at: null,
  responsible: null, status: 'pending', created_at: '2026-07-20T09:00:00Z',
};

const onUpdate = vi.fn();
const onOpenOptions = vi.fn();
const onConfirmStock = vi.fn();
const onSetStatus = vi.fn();

const renderCard = (m = MATERIAL) => render(
  <MemoryRouter>
    <PurchaseRowCard
      order={ORDER} m={m}
      onUpdate={onUpdate} onOpenOptions={onOpenOptions}
      onConfirmStock={onConfirmStock} onSetStatus={onSetStatus}
    />
  </MemoryRouter>,
);

beforeEach(() => {
  onUpdate.mockClear(); onOpenOptions.mockClear();
  onConfirmStock.mockClear(); onSetStatus.mockClear();
});

describe('строка закупки карточкой (планшет)', () => {
  it('обе группы полей названы — разделение ролей переживает смену раскладки', () => {
    renderCard();
    expect(screen.getByText(PURCHASE_GROUPS[0].label)).toBeInTheDocument();
    expect(screen.getByText(PURCHASE_GROUPS[1].label)).toBeInTheDocument();
  });

  it('несёт все поля таблицы, и каждое подписано', () => {
    /**
     * Вместе с шапкой таблицы исчезают названия колонок: «110» без слова
     * «Заказано» ничего не значит. Подписи ставятся явно.
     */
    const { container } = renderCard();
    /**
     * Читаем именно подписи полей карточки, а не любой текст: «Приход»
     * встречается ещё и среди значений селекта статуса, и поиск по тексту
     * нашёл бы два совпадения, ничего не проверив.
     */
    const labels = [...container.querySelectorAll('[class*="dataCardFieldLabel"]')]
      .map((el) => el.textContent);
    expect(labels).toEqual([
      'Материал', 'Нужно', 'Комментарий менеджера',
      'Поставщик', 'Артикул', 'Заказано', 'Цена за ед.', 'Стоимость',
      'Дата заказа', 'План прихода', 'Приход', 'Ответственный',
    ]);
  });

  it('стоимость СЧИТАЕТСЯ, а не вводится', () => {
    // Производная от количества и цены рядом с ними — это второй писатель
    renderCard();
    expect(screen.getByText('55 000')).toBeInTheDocument();
  });

  it('правка уходит наверх только при изменившемся значении', () => {
    renderCard();
    const plan = screen.getByLabelText('План Футер 3-нитка');

    // То же значение — записи нет
    fireEvent.blur(plan, { target: { value: '100' } });
    expect(onUpdate).not.toHaveBeenCalled();

    fireEvent.blur(plan, { target: { value: '120' } });
    expect(onUpdate).toHaveBeenCalledWith('m1', { qty_expected: 120 });
  });

  it('комментарий менеджера — на чтение: это исходное задание', () => {
    renderCard();
    const note = screen.getByText('та же партия, что в прошлый раз');
    expect(note.tagName).toBe('SPAN');
    expect(screen.queryByLabelText(/Комментарий менеджера/)).not.toBeInTheDocument();
  });

  it('поставщик открывает варианты, а не правится текстом', () => {
    renderCard();
    fireEvent.click(screen.getByTitle('Варианты поставщиков: Футер 3-нитка'));
    expect(onOpenOptions).toHaveBeenCalledWith({ material: MATERIAL, order: ORDER });
  });

  it('материал со склада предлагает подтвердить наличие, а не менять статус', () => {
    renderCard({ ...MATERIAL, source: 'stock', status: 'pending' });
    fireEvent.click(screen.getByRole('button', { name: 'Наличие' }));
    expect(onConfirmStock).toHaveBeenCalledWith('m1');
    expect(screen.queryByLabelText(/^Статус /)).not.toBeInTheDocument();
  });
});
