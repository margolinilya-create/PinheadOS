import { describe, it, expect, vi } from 'vitest';
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

  it('недобор плана предлагает «Принято частично», а не «полностью»', () => {
    renderOne(PLANNED);
    fireEvent.change(qtyField(), { target: { value: '60' } });
    expect(statusField()).toHaveValue('accepted_partial');
    // Недостача названа и в таблице «План↔Факт», и в строке следствия
    expect(screen.getAllByText(/не хватает 60/).length).toBeGreaterThan(0);
  });

  it('план закрыт — «Принято полностью»', () => {
    renderOne(PLANNED);
    fireEvent.change(qtyField(), { target: { value: '120' } });
    expect(statusField()).toHaveValue('accepted_full');
    expect(screen.getByText(/план закрыт/)).toBeInTheDocument();
  });

  /** Суждение сильнее арифметики: пересорт из чисел не выводится вовсе */
  it('выбранный человеком статус числа больше не перебивают', () => {
    renderOne(PLANNED);
    fireEvent.change(statusField(), { target: { value: 'mismatch' } });
    fireEvent.change(qtyField(), { target: { value: '120' } });
    expect(statusField()).toHaveValue('mismatch');
  });

  it('плана нет — судить не о чем, следствие не показывается', () => {
    const noPlan = { ...PLANNED, qty_expected: null };
    renderOne(noPlan);
    fireEvent.change(qtyField(noPlan), { target: { value: '60' } });
    expect(screen.queryByText(/будет принято/)).not.toBeInTheDocument();
    expect(statusField(noPlan)).toHaveValue('accepted_full');
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
describe('рулоны при приёмке ткани (правка 16.09, п. 5)', () => {
  const UNITS = [
    { id: 'u1', kind: 'unit', code: 'кг', name: 'Килограммы', sort_order: 1, active: true, meta: { rolls: true } },
    { id: 'u2', kind: 'unit', code: 'шт', name: 'Штуки', sort_order: 2, active: true, meta: {} },
  ];

  const renderWith = (unit, onAccept = vi.fn(async () => true)) => {
    useErpStore.setState({ dictionaries: UNITS });
    render(
      <MaterialReceiptCard
        order={{ ...ORDER, materials: [{ ...MATERIAL, status: 'in_transit', unit }] }}
        task={{ ...TASK, material_id: 'm1' }}
        onAccept={onAccept}
      />,
    );
    return onAccept;
  };

  it.each([['кг'], ['Килограммы']])(
    'поле рулонов есть у единицы «%s» — узнаётся и код, и имя справочника', (unit) => {
      renderWith(unit);
      expect(screen.getByLabelText(/Количество рулонов/)).toBeInTheDocument();
    },
  );

  it('у штучного материала поля рулонов нет', () => {
    renderWith('шт');
    expect(screen.queryByLabelText(/Количество рулонов/)).not.toBeInTheDocument();
  });

  it('приход в кг без числа рулонов не отправляется, причина названа', () => {
    const onAccept = renderWith('кг');
    fireEvent.change(screen.getByLabelText(/Сколько пришло сейчас/), { target: { value: '48.6' } });

    expect(screen.getByText(/укажите количество рулонов/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Принять/ })).toBeDisabled();
    expect(onAccept).not.toHaveBeenCalled();
  });

  /**
   * ВЕС КАЖДОГО РУЛОНА (правка 21.09, п. 2): «после указания количества
   * рулонов раскрывать строки для ввода фактического веса каждого рулона.
   * Сумма веса всех рулонов должна совпадать с общим фактически принятым
   * количеством ткани. Если сумма не совпадает, не давать завершить приёмку
   * и показать понятную ошибку».
   */
  it('после числа рулонов раскрываются строки веса — по одной на рулон', () => {
    renderWith('кг');
    expect(screen.queryByLabelText(/Вес рулона 1/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Количество рулонов/), { target: { value: '3' } });

    expect(screen.getByLabelText(/Вес рулона 1/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Вес рулона 3/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Вес рулона 4/)).not.toBeInTheDocument();
  });

  it('сумма весов не сходится с приходом — приёмка не отправляется, расхождение названо числом', () => {
    const onAccept = renderWith('кг');
    fireEvent.change(screen.getByLabelText(/Сколько пришло сейчас/), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Количество рулонов/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Вес рулона 1/), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/Вес рулона 2/), { target: { value: '45' } });

    expect(screen.getByText(/не хватает 5/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Принять/ })).toBeDisabled();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('заполненные рулоны уезжают вместе с приходом и весами', async () => {
    const onAccept = renderWith('кг');
    fireEvent.change(screen.getByLabelText(/Сколько пришло сейчас/), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Количество рулонов/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Вес рулона 1/), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText(/Вес рулона 2/), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: /Принять/ }));

    await vi.waitFor(() => expect(onAccept).toHaveBeenCalled());
    expect(onAccept).toHaveBeenCalledWith('m1', expect.objectContaining({
      qty: 100, rolls: 2,
      // Вес уезжает внутри параметров рулона (правка 27.09, п. 4); ширины
      // и плотности не вводили — сервер подставит их из материала
      rollParams: [
        expect.objectContaining({ weight_kg: 60 }),
        expect.objectContaining({ weight_kg: 40 }),
      ],
    }));
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

  it('у ткани без единицы поле рулонов есть', () => {
    useErpStore.setState({ dictionaries: UNITS });
    render(
      <MaterialReceiptCard
        order={{ ...ORDER, materials: [{ ...MATERIAL, status: 'in_transit', unit: null }] }}
        task={{ ...TASK, material_id: 'm1' }}
        onAccept={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Количество рулонов/)).toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText(/Добавить рулонов/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Вес рулона 1, Футер 3-нитка'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Вес рулона 2, Футер 3-нитка'), { target: { value: '20' } });
    // 35 из 40 — не сходится, кнопка погашена, расхождение названо числом
    expect(screen.getByRole('button', { name: 'Добавить рулоны' })).toBeDisabled();
    expect(screen.getByText(/не хватает 5/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Вес рулона 2, Футер 3-нитка'), { target: { value: '25' } });
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
