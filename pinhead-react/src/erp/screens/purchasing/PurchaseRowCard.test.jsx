import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PurchaseRowCard } from './PurchaseRowCard';
import { useErpStore } from '../../store/useErpStore';
import { PURCHASE_FIELD_LABELS, PURCHASE_GROUPS, pricePerUnitLabel } from './purchaseLabels';

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

const renderCard = (m = MATERIAL, order = ORDER) => render(
  <MemoryRouter>
    <PurchaseRowCard
      order={order} m={m}
      onUpdate={onUpdate} onOpenOptions={onOpenOptions}
      onConfirmStock={onConfirmStock} onSetStatus={onSetStatus}
    />
  </MemoryRouter>,
);

const loadMaterialReceipts = vi.fn(async () => []);

/** Раскрыть «Подробности»: jsdom не переключает `details` кликом по summary */
function openDetails(container) {
  const details = container.querySelector('details');
  details.open = true;
  fireEvent(details, new Event('toggle'));
}

beforeEach(() => {
  useErpStore.setState({ loadMaterialReceipts, dictionaries: [], dictionariesLoaded: true });
  loadMaterialReceipts.mockClear();
  onUpdate.mockClear(); onOpenOptions.mockClear();
  onConfirmStock.mockClear(); onSetStatus.mockClear();
});

describe('строка закупки карточкой (планшет)', () => {
  /**
   * ОБРАТНАЯ СВЯЗЬ СКЛАД → ЗАКУПКА (обход 04.09). Приёмка ставит
   * `status = 'received'` при ЛЮБОМ исходе, поэтому строка показывала «Пришло»
   * и при недостаче, и при пересорте, и при прямом отказе. Кладовщик записывал
   * расхождение и комментарий — закупщик не видел ни того, ни другого.
   *
   * Проверяется карточка, потому что вердикт рисует общий `StatusCell`: он же
   * стоит в ячейке таблицы, и второй его копии в проекте нет.
   */
  it('вердикт склада и комментарий кладовщика видны в строке', () => {
    renderCard({
      ...MATERIAL, status: 'received', accept_status: 'shortage',
      qty_received: 40, accept_comment: 'пришло на две трети рулона меньше',
    });
    expect(screen.getByText('Недостача')).toBeInTheDocument();
    expect(screen.getByText(/пришло на две трети/)).toBeInTheDocument();
    // Принято — с остатком к приёмке: одно «40» не отвечает, довезли или нет
    expect(screen.getByText('40 м')).toBeInTheDocument();
    expect(screen.getByText(/осталось 60 м/)).toBeInTheDocument();
  });

  it('пересорт называет, что привезли на самом деле', () => {
    renderCard({
      ...MATERIAL, status: 'received', accept_status: 'mismatch',
      qty_received: 100, fact_name: 'Футер 2-нитка', fact_color: 'графит',
    });
    expect(screen.getByText('Пересорт')).toBeInTheDocument();
    expect(screen.getByText(/Футер 2-нитка · графит/)).toBeInTheDocument();
  });

  it('полная приёмка вердикта не рисует — сообщать не о чем', () => {
    renderCard({
      ...MATERIAL, status: 'received', accept_status: 'accepted_full', qty_received: 100,
    });
    for (const label of ['Недостача', 'Пересорт', 'Склад не принял', 'Принято частично']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('обе группы полей названы — разделение ролей переживает смену раскладки', () => {
    renderCard();
    expect(screen.getByText(PURCHASE_GROUPS[0].label)).toBeInTheDocument();
    expect(screen.getByText(PURCHASE_GROUPS[1].label)).toBeInTheDocument();
  });

  it('несёт поля строки таблицы, и каждое подписано', () => {
    /**
     * Вместе с шапкой таблицы исчезают названия колонок: «110» без подписи
     * ничего не значит. Подписи БЕРУТСЯ ИЗ ОБЩЕГО МОДУЛЯ (правка 24.08, п. 1).
     * С 05.10 (п. 6) в карточке ровно то, что в строке таблицы, остальное —
     * в «Подробностях».
     */
    const { container } = renderCard();
    const labels = [...container.querySelectorAll('[class*="dataCardFieldLabel"]')]
      .map((el) => el.textContent);
    expect(labels).toEqual([
      PURCHASE_FIELD_LABELS.qtyExpected,
      'Поставщик', PURCHASE_FIELD_LABELS.qtyOrdered, PURCHASE_FIELD_LABELS.qtyReceived,
      pricePerUnitLabel(MATERIAL.unit, []), 'Срок прихода',
    ]);
  });

  /**
   * ТРИ КОЛИЧЕСТВА (правка 05.10, п. 6): «нужно 100 кг, заказали 110 →
   * до приёмки 100/110/0; приняли 40 → 100/110/40». Принятое — только
   * чтение: его ведёт журнал приёмок.
   */
  it('до приёмки: нужно 100, заказано 110, принято 0 — и принятое не вводится', () => {
    renderCard({ ...MATERIAL, unit: 'кг' });
    expect(screen.getByLabelText(`${PURCHASE_FIELD_LABELS.qtyExpected}: Футер 3-нитка`)).toHaveValue(100);
    expect(screen.getByLabelText(`${PURCHASE_FIELD_LABELS.qtyOrdered}: Футер 3-нитка`)).toHaveValue(110);
    expect(screen.getByText('0 кг')).toBeInTheDocument();
    expect(screen.queryByLabelText(new RegExp(PURCHASE_FIELD_LABELS.qtyReceived))).not.toBeInTheDocument();
  });

  it('приняли 40: 100 / 110 / 40 и осталось 60', () => {
    renderCard({ ...MATERIAL, unit: 'кг', qty_received: 40, status: 'partial' });
    expect(screen.getByLabelText(`${PURCHASE_FIELD_LABELS.qtyExpected}: Футер 3-нитка`)).toHaveValue(100);
    expect(screen.getByLabelText(`${PURCHASE_FIELD_LABELS.qtyOrdered}: Футер 3-нитка`)).toHaveValue(110);
    expect(screen.getByText('40 кг')).toBeInTheDocument();
    expect(screen.getByText(/осталось 60 кг/)).toBeInTheDocument();
  });

  it('«нужно по заказу» подписано потребностью, а не «Заказано»', () => {
    const { container } = renderCard();
    const labels = [...container.querySelectorAll('[class*="dataCardFieldLabel"]')]
      .map((el) => el.textContent);
    expect(labels).toContain('Нужно по заказу');
    expect(labels).not.toContain('Заказано');
  });

  it('стоимость СЧИТАЕТСЯ, а не вводится — и живёт в подробностях', async () => {
    // Производная от количества и цены рядом с ними — это второй писатель
    const { container } = renderCard();
    expect(screen.queryByText('55 000')).not.toBeInTheDocument();
    openDetails(container);
    expect(await screen.findByText('55 000')).toBeInTheDocument();
    // Журнал поставок читается только раскрытой строкой
    await waitFor(() => expect(loadMaterialReceipts).toHaveBeenCalledWith(['m1']));
  });

  it('правка уходит наверх только при изменившемся значении', () => {
    renderCard();
    const plan = screen.getByLabelText(`${PURCHASE_FIELD_LABELS.qtyExpected}: Футер 3-нитка`);

    // То же значение — записи нет
    fireEvent.blur(plan, { target: { value: '100' } });
    expect(onUpdate).not.toHaveBeenCalled();

    fireEvent.blur(plan, { target: { value: '120' } });
    expect(onUpdate).toHaveBeenCalledWith('m1', { qty_expected: 120 });
  });

  it('комментарий менеджера — в подробностях и на чтение: это исходное задание', () => {
    const { container } = renderCard();
    openDetails(container);
    const note = screen.getByText('та же партия, что в прошлый раз');
    expect(note.tagName).toBe('SPAN');
    expect(screen.queryByLabelText(/Комментарий менеджера/)).not.toBeInTheDocument();
  });

  it('поставщик открывает варианты, а не правится текстом', () => {
    renderCard();
    fireEvent.click(screen.getByTitle('Варианты поставщиков: Футер 3-нитка'));
    expect(onOpenOptions).toHaveBeenCalledWith({ material: MATERIAL, order: ORDER });
  });

  /**
   * ОСНОВНОЙ СЦЕНАРИЙ ЗАКУПКИ (правка заказчика 12.09, п. 8):
   * «Не заказано» → «Заказано» → «В пути», и все три закупщик ставит сам.
   *
   * «Заказано» с 24.08 было ПОГАШЕНО («ставится по факту оформления»),
   * заказчик это решение отменил. Подстановка `autoOrderedStatus` осталась
   * и работает как подсказка — она срабатывает только из «Не заказано».
   */
  it('весь основной сценарий закупщик выбирает сам', () => {
    renderCard();
    expect(screen.getByRole('option', { name: 'Не заказано' })).toBeEnabled();
    expect(screen.getByRole('option', { name: 'Заказано' })).toBeEnabled();
    expect(screen.getByRole('option', { name: 'В пути' })).toBeEnabled();
  });

  /**
   * ПРИХОД ФИКСИРУЕТ СКЛАД, А НЕ ЗАКУПКА (п. 8 той же правки). Убирается ВВОД,
   * а не значение: `received` ставит `erp_material_accept` одной транзакцией
   * с журналом, и на нём держится материальный гейт цехов. Пункт остаётся
   * видимым и подписанным — пропавшая строка читается как поломка списка.
   */
  it('«Пришло» и «Частично» закупщик не выбирает — их ставит приёмка', () => {
    renderCard();
    const received = screen.getByRole('option', { name: /^Пришло/ });
    expect(received).toBeDisabled();
    expect(received.textContent).toMatch(/по приёмке склада/);
    expect(screen.getByRole('option', { name: /^Частично/ })).toBeDisabled();
  });

  /**
   * Уже принятый материал обязан показывать СВОЁ значение: погашенный пункт
   * оставил бы селект пустым, то есть соврал бы о состоянии строки.
   */
  it('уже принятый материал показывает своё значение, а не пустой селект', () => {
    renderCard({ ...MATERIAL, status: 'received' });
    expect(screen.getByLabelText('Статус Футер 3-нитка')).toHaveValue('received');
    expect(screen.getByRole('option', { name: 'Пришло' })).toBeEnabled();
  });

  it('материал со склада предлагает подтвердить наличие, а не менять статус', () => {
    renderCard({ ...MATERIAL, source: 'stock', status: 'pending' });
    fireEvent.click(screen.getByRole('button', { name: 'Наличие' }));
    expect(onConfirmStock).toHaveBeenCalledWith('m1');
    expect(screen.queryByLabelText(/^Статус /)).not.toBeInTheDocument();
  });

  /**
   * ПОДПИСЬ ЦЕНЫ — ЕДИНИЦЕЙ МАТЕРИАЛА, И В КАРТОЧКЕ ТОЖЕ (правка 21.09, п. 1).
   *
   * Здесь стоял литерал «Цена за ед., ₽», хотя подпись уже была вынесена
   * в общую функцию ради таблицы и модалки. Расхождение нашлось прогоном
   * 22.09: на планшете закупщик читал «за ед.» там, где в таблице «за кг».
   * Ровно такие молчаливые расхождения функция и должна была убрать.
   */
  it('подпись цены названа единицей материала, а не «за ед.»', () => {
    renderCard({ ...MATERIAL, unit: 'кг' });
    expect(screen.getByText('Цена за кг, ₽')).toBeInTheDocument();
    expect(screen.queryByText('Цена за ед., ₽')).not.toBeInTheDocument();
  });

  /**
   * ПУСТАЯ ЦЕНА ТКАНИ НАЗВАНА СЛОВАМИ (решение заказчика 22.09).
   *
   * Обязательность цены стоит только на ЗАВЕДЕНИИ строки: десять тканей
   * из семнадцати на бою заведены до правки, и запрет при каждой правке
   * запер бы их целиком. Значит, старые строки чинит человек — и он должен
   * увидеть, какие именно, а не догадываться по прочерку.
   */
  it('у ткани без цены сказано «Цена не указана»', () => {
    renderCard({ ...MATERIAL, price_per_unit: null });
    expect(screen.getByText('Цена не указана')).toBeInTheDocument();
  });

  /** У непроверяемого вида пустая цена — не находка: закупка фурнитуры живёт без неё */
  it('у фурнитуры без цены пометки нет — там цена не обязательна', () => {
    renderCard({ ...MATERIAL, kind: 'hardware', price_per_unit: null });
    expect(screen.queryByText('Цена не указана')).not.toBeInTheDocument();
  });

  /**
   * ПЕРЕХОД К ПРИЁМКЕ (правка 05.10, п. 7): «для ожидаемой поставки
   * „Принять поставку", для принятой „Открыть приёмку"… Если приёмка уже
   * есть — открывать её, а не создавать ещё одну».
   */
  it('задачи приёмки ещё нет — кнопка погашена и объясняет почему', () => {
    renderCard();
    expect(screen.getByRole('button', { name: 'Принять поставку' })).toBeDisabled();
    expect(screen.getByText('Задача приёмки появится, когда поставка будет в пути')).toBeInTheDocument();
  });

  it('поставка в пути — «Принять поставку» ведёт в задачу этой позиции на складе', () => {
    renderCard({ ...MATERIAL, status: 'in_transit' }, {
      ...ORDER,
      warehouse_tasks: [{ id: 'wt-9', task_type: 'material_receipt', material_id: 'm1', status: 'awaiting' }],
    });
    const link = screen.getByRole('link', { name: 'Принять поставку: Футер 3-нитка' });
    const href = new URL(link.getAttribute('href'), 'http://x');
    expect(href.pathname).toBe('/warehouse');
    expect(href.searchParams.get('task')).toBe('wt-9');
    expect(href.searchParams.get('from')).toBe('purchasing');
    expect(href.searchParams.get('supply')).toBe('o1');
  });

  it('принятая поставка — «Открыть приёмку» той же задачи', () => {
    renderCard({ ...MATERIAL, status: 'received', qty_received: 100 }, {
      ...ORDER,
      warehouse_tasks: [{ id: 'wt-9', task_type: 'material_receipt', material_id: 'm1', status: 'accepted' }],
    });
    const link = screen.getByRole('link', { name: 'Открыть приёмку: Футер 3-нитка' });
    expect(link.getAttribute('href')).toContain('task=wt-9');
  });
});
