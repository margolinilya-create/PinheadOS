import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddPurchaseModal } from './AddPurchaseModal';
import { useErpStore } from '../../store/useErpStore';
import { validatePurchaseForm } from './purchaseLabels';

/**
 * ПОДСВЕТКА ОБЯЗАТЕЛЬНЫХ ПОЛЕЙ «НОВОЙ ЗАКУПКИ» (правка заказчика 27.09, п. 1).
 *
 * «При нажатии „Добавить" в окне „Новая закупка" подсвечивать красной
 * обводкой все незаполненные обязательные поля. Пользователь должен сразу
 * видеть, что нужно дозаполнить». До правки — тост на ПЕРВОЙ ошибке и ничего
 * на полях.
 *
 * Проверяется результат для человека и для скринридера: `aria-invalid`
 * на каждом пустом обязательном поле, текст под ним, фокус на первом,
 * и что строка при этом НЕ заводится.
 */

const ORDERS = [
  { id: 'o-1', bitrix_id: '61000', title: 'Худи для ВЦ', status: 'active', items: [] },
];

beforeEach(() => {
  useErpStore.setState({ dictionaries: [], dictionariesLoaded: true });
});

function setup(props = {}) {
  const onAdd = vi.fn().mockResolvedValue({ id: 'm-1' });
  const onClose = vi.fn();
  render(<AddPurchaseModal orders={ORDERS} onAdd={onAdd} onClose={onClose} {...props} />);
  return { onAdd, onClose };
}

describe('validatePurchaseForm', () => {
  const base = { order_id: 'o-1', name: 'Кулирка', source: 'purchase', qty_expected: '10', price_per_unit: '900', kind: 'fabric' };
  const opts = { priceRequired: true, priceLabel: 'Цена за кг, ₽' };

  it('заполненная форма — без ошибок', () => {
    expect(validatePurchaseForm(base, opts)).toEqual({});
  });

  it('называет ВСЕ пустые обязательные поля разом, а не первое', () => {
    const errors = validatePurchaseForm(
      { ...base, order_id: '', name: '  ', qty_expected: '', price_per_unit: '' }, opts,
    );
    expect(Object.keys(errors).sort()).toEqual(['name', 'order_id', 'price_per_unit', 'qty_expected']);
    expect(errors.price_per_unit).toBe('Укажите «Цена за кг, ₽»');
  });

  it('количество обязательно только у закупки, цена — только у ткани', () => {
    expect(validatePurchaseForm({ ...base, source: 'stock', qty_expected: '' }, opts)).toEqual({});
    expect(validatePurchaseForm(
      { ...base, price_per_unit: '' }, { priceRequired: false, priceLabel: 'Цена за единицу, ₽' },
    )).toEqual({});
    // Ноль и отрицательное — не количество и не цена
    expect(validatePurchaseForm({ ...base, qty_expected: '0' }, opts)).toHaveProperty('qty_expected');
    expect(validatePurchaseForm({ ...base, price_per_unit: '-1' }, opts)).toHaveProperty('price_per_unit');
  });
});

describe('AddPurchaseModal — подсветка обязательных полей', () => {
  it('до нажатия «Добавить» подсветки нет', () => {
    setup();
    expect(screen.getByLabelText('Материал')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Заказ')).not.toHaveAttribute('aria-invalid');
  });

  it('пустая форма: четыре поля помечены, строка не заводится, фокус на первом', async () => {
    const { onAdd } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    const order = screen.getByLabelText('Заказ');
    const name = screen.getByLabelText('Материал');
    const qty = screen.getByLabelText('Нужно по заказу');
    const price = screen.getByLabelText(/^Цена за/);
    for (const el of [order, name, qty, price]) {
      expect(el).toHaveAttribute('aria-invalid', 'true');
      expect(el.className).toMatch(/inputError/);
    }
    expect(screen.getByText('Выберите заказ')).toBeInTheDocument();
    expect(screen.getByText('Укажите материал')).toBeInTheDocument();
    expect(screen.getByText('Укажите «Нужно по заказу»')).toBeInTheDocument();
    expect(screen.getByText(/Укажите «Цена за/)).toBeInTheDocument();
    // Ошибка связана с полем и для скринридера
    expect(order).toHaveAttribute('aria-describedby', 'err-purchase-order');

    await waitFor(() => expect(order).toHaveFocus());
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('заполнение снимает подсветку с поля сразу, без повторного нажатия', () => {
    setup({ orderId: 'o-1' });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    const name = screen.getByLabelText('Материал');
    expect(name).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(name, { target: { value: 'Кулирка 230' } });
    expect(name).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText('Укажите материал')).not.toBeInTheDocument();
    // Заказ предвыбран — он и не подсвечивался
    expect(screen.getByLabelText('Заказ')).not.toHaveAttribute('aria-invalid');
  });

  it('у нетканевого материала цена не обязательна и не подсвечивается', () => {
    setup({ orderId: 'o-1' });
    fireEvent.change(screen.getByLabelText('Тип материала'), { target: { value: 'hardware' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    expect(screen.getByLabelText(/^Цена за/)).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Материал')).toHaveAttribute('aria-invalid', 'true');
  });

  it('заполненная форма заводит строку и закрывает окно', async () => {
    const { onAdd, onClose } = setup({ orderId: 'o-1' });
    fireEvent.change(screen.getByLabelText('Материал'), { target: { value: 'Кулирка 230' } });
    fireEvent.change(screen.getByLabelText('Нужно по заказу'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText(/^Цена за/), { target: { value: '950' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0]).toBe('o-1');
    expect(onAdd.mock.calls[0][1]).toMatchObject({
      name: 'Кулирка 230', qty_expected: 40, price_per_unit: 950, status: 'pending',
    });
    // «Заказано поставщику» не подставляется из потребности (правка 05.10, п. 6)
    expect(onAdd.mock.calls[0][1].qty_ordered).toBeNull();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

/**
 * ПРАВКА 05.10, П. 6. «При создании есть „фактическое количество", хотя
 * приёмки ещё не было… Поля группами… Ткань — ширина и плотность; готовое
 * изделие — размерная сетка; поля другого типа скрывать». Проверки
 * постановки: «нужно 100 кг, заказали 110 → до приёмки 100/110/0;
 * добавление из заказа — заказ выбран; ткань→готовое изделие — поля ткани
 * скрываются, появляется сетка».
 */
describe('AddPurchaseModal — правка 05.10', () => {
  const GARMENT_ORDER = {
    id: 'o-2', bitrix_id: '61001', title: 'Футболки', status: 'active',
    items: [{
      id: 'i-1', product_type: 'Футболка', variant: 'белая', qty: 30,
      production_type: 'ready_garment', garment_source: 'purchased',
      size_grid: [{ color: 'белый', sizes: { S: 10, M: 20 } }],
    }],
  };

  it('«фактического количества» нет; заказ из закупки уже выбран', () => {
    setup({ orderId: 'o-1' });
    expect(screen.queryByLabelText(/Фактическое/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Заказано поставщику')).toBeInTheDocument();
    expect(screen.getByLabelText('Заказ')).toHaveValue('o-1');
  });

  it('поля разложены по группам', () => {
    setup();
    for (const name of ['Материал и поставщик', 'Количество и цена', 'Даты', 'Параметры ткани']) {
      expect(screen.getByRole('group', { name })).toBeInTheDocument();
    }
  });

  it('подписи количества и цены несут выбранную единицу', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Единица измерения'), { target: { value: 'кг' } });
    expect(screen.getByText(/^Нужно по заказу, кг/)).toBeInTheDocument();
    expect(screen.getByText('Заказано поставщику, кг')).toBeInTheDocument();
    expect(screen.getByText(/^Цена за кг, ₽/)).toBeInTheDocument();
  });

  it('нужно 100, заказали 110 — уходят обе величины, принятого форма не пишет', async () => {
    const { onAdd } = setup({ orderId: 'o-1' });
    fireEvent.change(screen.getByLabelText('Материал'), { target: { value: 'Кулирка' } });
    fireEvent.change(screen.getByLabelText('Нужно по заказу'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Заказано поставщику'), { target: { value: '110' } });
    fireEvent.change(screen.getByLabelText(/^Цена за/), { target: { value: '900' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    const row = onAdd.mock.calls[0][1];
    expect(row).toMatchObject({ qty_expected: 100, qty_ordered: 110 });
    expect(row).not.toHaveProperty('qty_received');
  });

  it('ткань → готовое изделие: поля ткани скрываются, появляется сетка', () => {
    setup({ orders: [GARMENT_ORDER], orderId: 'o-2' });
    expect(screen.getByLabelText('Ширина полотна, см')).toBeInTheDocument();
    expect(screen.queryByLabelText('Готовое изделие из позиции заказа')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Тип материала'), { target: { value: 'finished_good' } });
    expect(screen.queryByLabelText('Ширина полотна, см')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Плотность, г/м²')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Размерная сетка' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Готовое изделие из позиции заказа'), { target: { value: 'i-1' } });
    expect(screen.getByLabelText(/^S.*Заказано поставщику/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^M.*Заказано поставщику/)).toBeInTheDocument();
  });

  it('у фурнитуры нет ни параметров ткани, ни сетки', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Тип материала'), { target: { value: 'hardware' } });
    expect(screen.queryByRole('group', { name: 'Параметры ткани' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Размерная сетка' })).not.toBeInTheDocument();
  });
});
