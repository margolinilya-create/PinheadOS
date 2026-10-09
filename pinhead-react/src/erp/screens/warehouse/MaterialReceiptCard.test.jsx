import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MaterialReceiptCard } from './MaterialReceiptCard';
import { useErpStore } from '../../store/useErpStore';

/**
 * ЗАДАЧА ПРИНАДЛЕЖИТ ПОЗИЦИИ ЗАКУПКИ (правка 12.09, вторая порция, баг 01).
 *
 * До правки карточка показывала ВСЕ материалы заказа — в том числе не
 * заказанные — и предлагала их принять, хотя задачу заводил запуск этапа
 * закупки. Теперь её заводит переход конкретной позиции в статус «В пути»,
 * и карточка показывает ровно её.
 *
 * Приёмки, закрытые до правки, `material_id` не имеют: там список остаётся
 * прежним, иначе история осталась бы без содержимого.
 */

const ORDER = { id: 'o1', bitrix_id: '4821', title: 'Худи «Ромашка»', materials: [] };
const TASK = { id: 't1', task_type: 'material_receipt', status: 'awaiting' };

// История поставок читает журнал приходов точечно (05.10, п. 4) — здесь пустой
beforeEach(() => {
  useErpStore.setState({ loadMaterialReceipts: vi.fn(async () => []) });
});

const MATERIAL = {
  id: 'm1', name: 'Футер 3-нитка', kind: 'fabric', status: 'pending',
  qty_expected: 100, qty_received: null, accept_status: null,
};

describe('карточка приёмки материалов', () => {
  it('показывает ТОЛЬКО позицию своей задачи', () => {
    const other = { ...MATERIAL, id: 'm2', name: 'Бирка тканевая', status: 'pending' };
    render(
      <MaterialReceiptCard
        order={{ ...ORDER, materials: [{ ...MATERIAL, status: 'in_transit' }, other] }}
        task={{ ...TASK, material_id: 'm1' }}
        onAccept={vi.fn()}
      />,
    );
    // Название стоит и в шапке блока, и в колонке «План» — берём все
    expect(screen.getAllByText(/Футер 3-нитка/).length).toBeGreaterThan(0);
    // Вторая позиция ещё не заказана — принимать её склад не должен
    expect(screen.queryByText(/Бирка тканевая/)).toBeNull();
  });

  it('позиция удалена из закупки — карточка говорит это словами', () => {
    render(
      <MaterialReceiptCard
        order={ORDER} task={{ ...TASK, material_id: 'm-gone' }} onAccept={vi.fn()} />,
    );
    /* Заголовок без содержимого читается как поломка */
    expect(screen.getByText(/больше не заведена в заказе/)).toBeInTheDocument();
  });

  it('строки есть — приёмка по каждой', () => {
    render(
      <MaterialReceiptCard
        order={{ ...ORDER, materials: [MATERIAL] }} task={TASK} onAccept={vi.fn()} />,
    );
    // Название стоит и в шапке блока, и в колонке «План» — берём все
    expect(screen.getAllByText('Футер 3-нитка').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Закупка ещё не завела/)).not.toBeInTheDocument();
  });
});

/**
 * §3.4 обхода 04.09: форма спрашивала статус приёмки РУКАМИ, и селект стоял
 * со значением «Принято полностью» по умолчанию — приёмка 60 из 120 уезжала
 * полной, если про него забыли. Проект от таких статусов уже ушёл дважды
 * (подряд, закупка): «статус ставится ПО ФАКТУ, а не выбирается рядом с ним».
 *
 * Из чисел выводится ровно то, что из них следует: закрыт план или нет.
 * «Пересорт» и «Не принято» — суждение кладовщика, и они остаются выбором.
 */
describe('приёмка: статус выводится из чисел', () => {
  const PLANNED = {
    ...MATERIAL, qty_expected: 120, unit: 'кг', status: 'received', qty_received: null,
  };
  const renderOne = (m) => render(
    <MaterialReceiptCard
      order={{ ...ORDER, materials: [m] }} task={TASK} onAccept={vi.fn()} />,
  );
  const qtyField = (m = PLANNED) => screen.getByLabelText(`Сколько пришло сейчас, ${m.name}`);
  const statusField = (m = PLANNED) => screen.getByLabelText(`Статус приёмки ${m.name}`);
  /** Итог — в закреплённом низу формы (правка 05.10, п. 8) */
  const summary = () => screen.getByText(/Будет принято/);

  it('недобор плана — «Принято частично», а не «полностью»', () => {
    renderOne(PLANNED);
    fireEvent.change(qtyField(), { target: { value: '60' } });
    expect(summary()).toHaveTextContent('Будет принято 60 из 120 кг — не хватает 60 → Принято частично');
    // Ручной выбор не тронут: статус ведут числа
    expect(statusField()).toHaveValue('');
  });

  it('план закрыт — «Принято полностью»', () => {
    renderOne(PLANNED);
    fireEvent.change(qtyField(), { target: { value: '120' } });
    expect(summary()).toHaveTextContent('— план закрыт → Принято полностью');
  });

  /** «Полную и частичную приёмку считать по всем поставкам» (05.10, п. 4) */
  it('считается по всем поставкам: 40 уже принято, пришло 80 — полная', () => {
    renderOne({ ...PLANNED, qty_received: 40 });
    fireEvent.change(qtyField(), { target: { value: '80' } });
    expect(summary()).toHaveTextContent('Будет принято 120 из 120 кг — план закрыт → Принято полностью');
  });

  /** Разница с заказанным — отдельно, и в обе стороны */
  it('сверх заказа — названо отдельно', () => {
    renderOne(PLANNED);
    fireEvent.change(qtyField(), { target: { value: '125' } });
    expect(summary()).toHaveTextContent('сверх заказа 5');
  });

  /** Суждение сильнее арифметики: пересорт из чисел не выводится вовсе */
  it('выбранное человеком отклонение числа не перебивают', () => {
    renderOne(PLANNED);
    fireEvent.change(statusField(), { target: { value: 'mismatch' } });
    fireEvent.change(qtyField(), { target: { value: '120' } });
    expect(statusField()).toHaveValue('mismatch');
    expect(summary()).toHaveTextContent('→ Пересорт');
  });

  it('вручную выбираются только отклонения: частичная и полная — по числам', () => {
    renderOne(PLANNED);
    const values = [...statusField().querySelectorAll('option')].map((o) => o.value);
    expect(values).toEqual(['', 'shortage', 'mismatch', 'rejected']);
  });

  it('плана нет — судить не о чем, следствие не показывается', () => {
    const noPlan = { ...PLANNED, qty_expected: null };
    renderOne(noPlan);
    fireEvent.change(qtyField(noPlan), { target: { value: '60' } });
    expect(screen.queryByText(/Будет принято/)).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Итог приёмки' })).toHaveTextContent('→ Принято полностью');
  });
});

/**
 * ПРАВКА ЗАКАЗЧИКА 16.09, П. 5: «Если материал учитывается в кг, под полем
 * „Пришло сейчас, килограммы" добавить дополнительное ОБЯЗАТЕЛЬНОЕ поле
 * „Количество рулонов, шт."».
 *
 * Сторож держит три вещи, и все три — про настоящий дефект, а не про вид:
 * поле появляется по СПРАВОЧНИКУ (в `unit` на бою лежат и «кг», и
 * «Килограммы» — код и имя одного значения, сравнение строки не сработало бы
 * на трёх строках из семи); у нерулонной единицы поля нет вовсе; приёмка без
 * числа рулонов не отправляется, и причина названа рядом с кнопкой.
 */
describe('рулоны при приёмке ткани (правка 16.09, п. 5; строками — 05.10, п. 4)', () => {
  const UNITS = [
    { id: 'u1', kind: 'unit', code: 'кг', name: 'Килограммы', sort_order: 1, active: true, meta: { rolls: true } },
    { id: 'u2', kind: 'unit', code: 'шт', name: 'Штуки', sort_order: 2, active: true, meta: {} },
  ];

  const renderWith = (unit, onAccept = vi.fn(async () => true), patch = {}) => {
    useErpStore.setState({ dictionaries: UNITS, loadMaterialReceipts: vi.fn(async () => []) });
    render(
      <MaterialReceiptCard
        order={{ ...ORDER, materials: [{ ...MATERIAL, status: 'in_transit', unit, ...patch }] }}
        task={{ ...TASK, material_id: 'm1' }}
        onAccept={onAccept}
      />,
    );
    return onAccept;
  };
  const addRoll = () => fireEvent.click(screen.getByRole('button', { name: 'Добавить строку рулона' }));

  it.each([['кг'], ['Килограммы']])(
    'строки рулонов есть у единицы «%s» — узнаётся и код, и имя справочника', (unit) => {
      renderWith(unit);
      expect(screen.getByLabelText(/Вес рулона 1/)).toBeInTheDocument();
    },
  );

  it('у штучного материала строк рулонов нет', () => {
    renderWith('шт');
    expect(screen.queryByLabelText(/Вес рулона/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Добавить строку рулона' })).not.toBeInTheDocument();
  });

  it('поля «Количество рулонов» нет: число рулонов — число строк', () => {
    renderWith('кг');
    expect(screen.queryByLabelText(/Количество рулонов/)).not.toBeInTheDocument();
    addRoll(); addRoll();
    expect(screen.getByLabelText(/Вес рулона 3/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Вес рулона 4/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Убрать строку рулона 2' }));
    expect(screen.queryByLabelText(/Вес рулона 3/)).not.toBeInTheDocument();
  });

  it('у каждого поля строки — подпись с единицей измерения', () => {
    renderWith('кг');
    for (const header of ['Вес, кг', 'Ширина, см', 'Плотность, г/м²', 'Фактический метраж, м', 'Расчётный метраж, м']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
  });

  it('приход в кг без веса рулона не отправляется, причина названа', () => {
    const onAccept = renderWith('кг');
    fireEvent.change(screen.getByLabelText(/Сколько пришло сейчас/), { target: { value: '48.6' } });
    expect(screen.getByText(/Укажите вес каждого рулона/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Принять/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Убрать строку рулона 1' }));
    expect(screen.getByText(/Добавьте рулоны/)).toBeInTheDocument();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('сумма весов не сходится с поставкой — ошибка, не сохраняется, расхождение названо числом', () => {
    const onAccept = renderWith('кг');
    fireEvent.change(screen.getByLabelText(/Сколько пришло сейчас/), { target: { value: '100' } });
    addRoll();
    fireEvent.change(screen.getByLabelText(/Вес рулона 1/), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/Вес рулона 2/), { target: { value: '45' } });
    expect(screen.getByText(/не хватает 5/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Принять/ })).toBeDisabled();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('заполненные рулоны уезжают вместе с приходом и весами', async () => {
    const onAccept = renderWith('кг');
    fireEvent.change(screen.getByLabelText(/Сколько пришло сейчас/), { target: { value: '100' } });
    addRoll();
    fireEvent.change(screen.getByLabelText(/Вес рулона 1/), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText(/Вес рулона 2/), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: /Принять/ }));

    await vi.waitFor(() => expect(onAccept).toHaveBeenCalled());
    expect(onAccept).toHaveBeenCalledWith('m1', expect.objectContaining({
      qty: 100, rolls: 2,
      rollParams: [
        expect.objectContaining({ weight_kg: 60 }),
        expect.objectContaining({ weight_kg: 40 }),
      ],
    }));
  });

  /**
   * СЦЕНАРИЙ ЗАКАЗЧИКА (05.10, п. 4): «принять 100 кг двумя рулонами по 50 кг,
   * 180 см, 250 г/м² → оба 111,11 м „расчёт"; для одного указать факт 109 м».
   */
  it('100 кг двумя рулонами по 50 кг, 180 см, 250 г/м²: расчёт 111,11 м, факт 109 м', async () => {
    const onAccept = renderWith('кг', undefined, { width_cm: 180, density_gsm: 250 });
    // Ширина и плотность подставлены из закупки
    expect(screen.getByLabelText(/Ширина рулона 1/)).toHaveValue(180);
    expect(screen.getByLabelText(/Плотность рулона 1/)).toHaveValue(250);
    fireEvent.change(screen.getByLabelText(/Сколько пришло сейчас/), { target: { value: '100' } });
    addRoll();
    fireEvent.change(screen.getByLabelText(/Вес рулона 1/), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/Вес рулона 2/), { target: { value: '50' } });
    expect(screen.getAllByText(/111,11 м · расчёт/)).toHaveLength(2);

    fireEvent.change(screen.getByLabelText(/Фактический метраж рулона 2/), { target: { value: '109' } });
    expect(screen.getAllByText(/111,11 м · расчёт/)).toHaveLength(1);
    expect(screen.getByText(/111,11 м · для справки/)).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Итог приёмки' })).toHaveTextContent('Рулонов: 2 · вес 100 кг из 100 кг · метраж 220,11 м');

    // Ширину можно поменять у конкретного рулона — у соседнего она прежняя
    fireEvent.change(screen.getByLabelText(/Ширина рулона 1/), { target: { value: '150' } });
    expect(screen.getByLabelText(/Ширина рулона 2/)).toHaveValue(180);
    fireEvent.change(screen.getByLabelText(/Ширина рулона 1/), { target: { value: '180' } });

    fireEvent.click(screen.getByRole('button', { name: /Принять/ }));
    await vi.waitFor(() => expect(onAccept).toHaveBeenCalled());
    const [, payload] = onAccept.mock.calls[0];
    expect(payload.rollParams).toEqual([
      { weight_kg: 50, width_cm: 180, density_gsm: 250, length_m: null, length_source: null },
      { weight_kg: 50, width_cm: 180, density_gsm: 250, length_m: 109, length_source: 'supplier' },
    ]);
    expect(payload.accept_status).toBe('accepted_full');
  });

  it('двойной клик не принимает поставку дважды', async () => {
    let resolve;
    const onAccept = vi.fn(() => new Promise((r) => { resolve = r; }));
    renderWith('кг', onAccept);
    fireEvent.change(screen.getByLabelText(/Сколько пришло сейчас/), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText(/Вес рулона 1/), { target: { value: '40' } });
    const button = screen.getByRole('button', { name: /Принять/ });
    fireEvent.click(button);
    fireEvent.click(button);
    await vi.waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
    resolve(true);
  });

  it('после сохранения — новая поставка с новыми строками рулонов', async () => {
    const onAccept = renderWith('кг');
    fireEvent.change(screen.getByLabelText(/Сколько пришло сейчас/), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText(/Вес рулона 1/), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: /Принять/ }));
    await vi.waitFor(() => expect(onAccept).toHaveBeenCalled());
    await vi.waitFor(() => expect(screen.getByLabelText(/Вес рулона 1/)).toHaveValue(null));
  });

  /** Сравнение план/факт, документы и история — свёрнуты (05.10, п. 8) */
  it('сведения закупки свёрнуты, сверху — главное о поставке', () => {
    renderWith('кг', undefined, { supplier: 'Текстиль-Опт', color: 'чёрный', qty_received: 40 });
    for (const summaryText of ['Сравнение с закупкой (план / факт)', 'Документы', 'История поставок и рулонов']) {
      expect(screen.getByText(summaryText).closest('details')).not.toBeNull();
    }
    expect(screen.getByLabelText(/Накладная прихода/).closest('details')).not.toBeNull();
    expect(screen.getByText('Поставщик', { selector: 'dt' }).nextSibling).toHaveTextContent('Текстиль-Опт');
    expect(screen.getByText('Ранее принято', { selector: 'dt' }).nextSibling).toHaveTextContent('40 кг');
  });
});

/**
 * «Закупка 100 кг: принять 40, потом 60 — после первой частичная, после
 * второй полная, обе поставки и все рулоны в истории» (05.10, п. 4).
 */
describe('приёмка двумя поставками', () => {
  const UNITS = [
    { id: 'u1', kind: 'unit', code: 'кг', name: 'Килограммы', sort_order: 1, active: true, meta: { rolls: true } },
  ];
  const FABRIC = { ...MATERIAL, unit: 'кг', status: 'received', qty_expected: 100, width_cm: 180, density_gsm: 250 };
  const RECEIPTS = [
    { id: 'rc1', material_id: 'm1', qty: 40, accept_status: 'accepted_partial', received_on: '2026-10-01', invoice: 'Н-1', created_at: '2026-10-01' },
    { id: 'rc2', material_id: 'm1', qty: 60, accept_status: 'accepted_full', received_on: '2026-10-03', invoice: null, created_at: '2026-10-03' },
  ];
  const ROLLS = [
    { id: 'r1', receipt_id: 'rc1', seq: 1, label: 'Рулон №1', qty: 40, length_m: 88.89, length_source: 'calc', status: 'in_stock' },
    { id: 'r2', receipt_id: 'rc2', seq: 2, label: 'Рулон №2', qty: 30, length_m: 66.67, length_source: 'calc', status: 'in_stock' },
    { id: 'r3', receipt_id: 'rc2', seq: 3, label: 'Рулон №3', qty: 30, length_m: 65, length_source: 'supplier', length_calc_m: 66.67, status: 'in_stock' },
  ];
  const renderAt = (material) => {
    useErpStore.setState({ dictionaries: UNITS, loadMaterialReceipts: vi.fn(async () => RECEIPTS) });
    return render(
      <MaterialReceiptCard order={{ ...ORDER, materials: [material] }} task={{ ...TASK, material_id: 'm1' }} onAccept={vi.fn()} />,
    );
  };

  it('первая поставка 40 из 100 — частичная', () => {
    renderAt({ ...FABRIC, qty_received: 0 });
    fireEvent.change(screen.getByLabelText(/Сколько пришло сейчас/), { target: { value: '40' } });
    expect(screen.getByText(/Будет принято/)).toHaveTextContent('40 из 100 кг — не хватает 60 → Принято частично');
  });

  it('вторая поставка 60 после 40 — полная', () => {
    renderAt({ ...FABRIC, qty_received: 40, accept_status: 'accepted_partial', rolls: [ROLLS[0]] });
    fireEvent.change(screen.getByLabelText(/Сколько пришло сейчас/), { target: { value: '60' } });
    expect(screen.getByText(/Будет принято/)).toHaveTextContent('100 из 100 кг — план закрыт → Принято полностью');
  });

  it('вторая поставка — «Принять поставку», а не «Обновить приёмку» (QA 09.10)', () => {
    renderAt({ ...FABRIC, qty_received: 40, accept_status: 'accepted_partial', rolls: [ROLLS[0]] });
    expect(screen.getByRole('button', { name: 'Принять поставку' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Обновить приёмку' })).toBeNull();
  });

  it('в истории — обе поставки и все рулоны со своими номерами', async () => {
    renderAt({ ...FABRIC, qty_received: 100, accept_status: 'accepted_full', rolls: ROLLS });
    expect(await screen.findByText(/Поставка 1/)).toHaveTextContent('40 кг · Принято частично · накладная Н-1 · рулонов 1');
    expect(screen.getByText(/Поставка 2/)).toHaveTextContent('60 кг · Принято полностью · рулонов 2');
    expect(screen.getByText(/Рулон №1 —/)).toHaveTextContent('40 кг · 88,89 м (расчёт)');
    expect(screen.getByText(/Рулон №3 —/)).toHaveTextContent('65,00 м (по данным поставщика) · расчёт 66,67 м');
  });
});

/**
 * ТКАНЬ БЕЗ РУЛОНОВ (правка 01.10, п. 1): «у склада при приёмке пропали
 * пункты по количеству рулонов и ширине полотна. К уже закрытому приходу
 * нужно разрешить добавить рулоны без повторного поступления и удвоения
 * остатка».
 */
describe('ткань без разбивки по рулонам (правка 01.10, п. 1)', () => {
  const UNITS = [
    { id: 'u1', kind: 'unit', code: 'кг', name: 'Килограммы', sort_order: 1, active: true, meta: { rolls: true } },
  ];

  it('у ткани без единицы строки рулонов есть', () => {
    useErpStore.setState({ dictionaries: UNITS });
    render(
      <MaterialReceiptCard
        order={{ ...ORDER, materials: [{ ...MATERIAL, status: 'in_transit', unit: null }] }}
        task={{ ...TASK, material_id: 'm1' }}
        onAccept={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Вес рулона 1/)).toBeInTheDocument();
  });

  const accepted = {
    ...MATERIAL, status: 'received', unit: 'кг', accept_status: 'accepted_full',
    qty_received: 40, rolls: [],
  };

  const renderAccepted = (material, onAddRolls = vi.fn(async () => true)) => {
    useErpStore.setState({ dictionaries: UNITS });
    render(
      <MaterialReceiptCard
        order={{ ...ORDER, materials: [material] }}
        task={{ ...TASK, status: 'accepted', material_id: 'm1' }}
        onAccept={vi.fn()}
        onAddRolls={onAddRolls}
      />,
    );
    return onAddRolls;
  };

  it('принятая без рулонов — сообщение и добавление рулонов без нового прихода', async () => {
    const onAddRolls = renderAccepted(accepted);
    expect(screen.getByText('Ткань принята без разбивки по рулонам')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Добавить строку добавляемого рулона' }));
    fireEvent.change(screen.getByLabelText('Вес добавляемого рулона 1, Футер 3-нитка'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Вес добавляемого рулона 2, Футер 3-нитка'), { target: { value: '20' } });
    // 35 из 40 — не сходится, кнопка погашена, расхождение названо числом
    expect(screen.getByRole('button', { name: 'Добавить рулоны' })).toBeDisabled();
    expect(screen.getByText(/не хватает 5/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Вес добавляемого рулона 2, Футер 3-нитка'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить рулоны' }));
    expect(onAddRolls).toHaveBeenCalledTimes(1);
    const [materialId, payload, key] = onAddRolls.mock.calls[0];
    expect(materialId).toBe('m1');
    expect(payload.map((r) => r.weight_kg)).toEqual([15, 25]);
    expect(key).toBeTruthy();
  });

  it('всё принятое разбито по рулонам — блока нет', () => {
    renderAccepted({
      ...accepted,
      rolls: [{ id: 'r1', seq: 1, label: 'Рулон №1', qty: 40, status: 'in_stock' }],
    });
    expect(screen.queryByText(/без разбивки по рулонам/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Добавить рулоны' })).toBeNull();
  });
});
