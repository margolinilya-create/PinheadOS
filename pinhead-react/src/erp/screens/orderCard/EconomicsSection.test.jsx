import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { EconomicsSection } from './EconomicsSection';
import { useErpStore } from '../../store/useErpStore';

/**
 * ЭКОНОМИКА ПОЗИЦИИ (правка заказчика 20.09, п. 9; метры и «Остатки
 * и потери» — 27.09, пп. 4, 8) — показ.
 *
 * ЗАЧЕМ ЭТОТ СТОРОЖ ВООБЩЕ ПОЯВИЛСЯ. Вкладка была написана и проверена
 * формулами (`utils/itemEconomics`), а САМ компонент не рендерил ни один
 * тест — и в нём жил битый импорт (`Skeleton` из `ErpSkeletons`, где его
 * нет). Весь набор был зелёным, упала СБОРКА. Отсюда правило: у экрана,
 * который собирают из чужих примитивов, обязан быть хотя бы один рендер —
 * он ловит то, чего не видит ни один тест формул.
 */

vi.mock('../../../store/useToastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const ORDER = {
  id: 'o1',
  title: 'Худи «Ромашка»',
  items: [{ id: 'i1', product_type: 'Худи', variant: 'чёрное', qty: 100 }],
};

const LOSSES_EMPTY = {
  leftovers_usable: [], leftovers_usable_cost: null,
  leftovers_scrap: [], leftovers_scrap_cost: null,
  adjustments: [], adjustments_open: 0,
  extras: { cut_extra: 0, by_size: [], finished: 0, shipped: 0, in_stock: 0, unit_cost: null, value: null },
  defects: [], defects_qty: 0, defects_cost: null,
  wip: [], wip_qty: 0, wip_rework: 0,
};

const ECONOMICS = {
  item_id: 'i1',
  product_type: 'Худи',
  variant: 'чёрное',
  qty: 100,
  economics: {
    item_id: 'i1',
    client_qty: 100,
    qty_cut: 82,
    qty_good: 80,
    qty_extra: 0,
    rolls_used: 3,
    fabric: { metres: 108.8, priced_metres: 108.8, calc_metres: 0, incomplete_kg: 0, rows: 3, avg_m_per_cut: 1.3268 },
    fabric_cost_total: 23500,
    fabric_cost_per_good: 293.75,
    assembly: { avg: 150, covered_qty: 80, source: 'reports', total: 12000 },
    direct_unit_cost: 443.75,
    losses: {
      ...LOSSES_EMPTY,
      leftovers_usable: [{
        roll_id: 'r4', label: 'Рулон №4', material: 'Кулирка', width_cm: 180, density_gsm: 240,
        length_m: 10, length_source: 'measured', kg: 4.32, price_per_m: 410.4, cost: 4104,
        owner_order_id: 'o1', used_elsewhere_m: 0,
      }],
      leftovers_usable_cost: 4104,
      wip: [{
        stage_id: 's-sew', department: 'Швейный цех', dept_code: 'sewing', status: 'in_progress',
        unaccounted: 2, rework: 0, by_size: [{ color: '—', size: 'M', qty: 2 }], cost: 573.2, calc: true,
      }],
      wip_qty: 2,
    },
    final_good: 80,
    shipped: 0,
    production_done: false,
    costs_filled: true,
    preliminary: true,
    costs: { fabric: 23500, scrap: null, assembly: 12000, total: 35500, missing: [] },
    unit_cost_good: 443.75,
    unit_cost_plan: 355,
  },
};

beforeEach(() => {
  useErpStore.setState({
    orderEconomics: {},
    economicsLoading: false,
    loadOrderEconomics: vi.fn(async () => {}),
  });
});

describe('вкладка «Экономика позиции»', () => {
  it('рисует величины расчёта: метры, два показателя на единицу, состав затрат', () => {
    useErpStore.setState({ orderEconomics: { o1: [ECONOMICS] } });
    render(<EconomicsSection order={ORDER} />);

    expect(screen.getByText('Основное полотно и пошив на единицу')).toBeInTheDocument();
    expect(screen.getByText('Выкроено')).toBeInTheDocument();
    // Расход — в метрах (правка 27.09, п. 4)
    expect(screen.getByText('Расход полотна, м')).toBeInTheDocument();
    expect(screen.getByText('108,80 м')).toBeInTheDocument();
    // Два показателя на единицу (п. 8), подпись второго — слово в слово с документом
    expect(screen.getByText('Себестоимость годной единицы')).toBeInTheDocument();
    expect(screen.getByText('Затраты на единицу клиентского тиража')).toBeInTheDocument();
    expect(screen.getByText(/Все затраты позиции распределены на клиентский тираж, включая изготовление плюсов/))
      .toBeInTheDocument();
    expect(screen.getByText(/Предварительный расчёт/)).toBeInTheDocument();
  });

  it('блок «Остатки и потери» раскрывается до рулонов и этапов', () => {
    useErpStore.setState({ orderEconomics: { o1: [ECONOMICS] } });
    render(<EconomicsSection order={ORDER} />);
    const block = screen.getByRole('region', { name: 'Остатки и потери по заказу' });
    expect(block).toHaveTextContent('Пригодные остатки ткани');
    expect(block).toHaveTextContent('Рулон №4');
    expect(block).toHaveTextContent('В работе и переделке');
    expect(block).toHaveTextContent('Швейный цех');
    expect(block).toHaveTextContent('M — 2 шт');
  });

  /**
   * На бою размерных строк закроя нет ни одной — пустое состояние и есть
   * первое, что увидит заказчик. «0 ₽» читалось бы как «производство
   * бесплатное», а не как «данных пока нет»; нулевой знаменатель —
   * «Нет данных для расчёта», а не ноль.
   */
  it('без рулонов закроя говорит, чего не хватает, а не показывает нули', () => {
    useErpStore.setState({
      orderEconomics: {
        o1: [{
          ...ECONOMICS,
          economics: {
            ...ECONOMICS.economics,
            qty_cut: 0,
            qty_good: 0,
            rolls_used: 0,
            fabric: { metres: 0, priced_metres: 0, calc_metres: 0, incomplete_kg: 0, rows: 0, avg_m_per_cut: null },
            fabric_cost_total: null,
            fabric_cost_per_good: null,
            assembly: { avg: null, covered_qty: 0, source: null, total: null },
            direct_unit_cost: null,
            losses: LOSSES_EMPTY,
            final_good: 0,
            costs_filled: false,
            costs: { fabric: null, scrap: null, assembly: null, total: null, missing: ['fabric', 'assembly'] },
            unit_cost_good: null,
            unit_cost_plan: null,
          },
        }],
      },
    });
    render(<EconomicsSection order={ORDER} />);

    expect(screen.getAllByText(/закрой ещё не сдавал результат по рулонам/).length)
      .toBeGreaterThan(0);
    expect(screen.getByText(/Расчёт неполный/)).toBeInTheDocument();
    expect(screen.getAllByText('Нет данных для расчёта').length).toBeGreaterThan(0);
    expect(screen.getByText(/не учтены: основное полотно/)).toBeInTheDocument();
  });

  it('у заказа без позиций — пустое состояние, а не пустая сетка', () => {
    useErpStore.setState({ orderEconomics: { o1: [] } });
    render(<EconomicsSection order={ORDER} />);
    expect(screen.getByText('Считать пока нечего')).toBeInTheDocument();
  });

  it('переключатель позиции появляется только при нескольких позициях', () => {
    useErpStore.setState({ orderEconomics: { o1: [ECONOMICS] } });
    const { unmount } = render(<EconomicsSection order={ORDER} />);
    expect(screen.queryByLabelText('Позиция заказа')).not.toBeInTheDocument();

    unmount();
    useErpStore.setState({
      orderEconomics: {
        o1: [ECONOMICS, { ...ECONOMICS, item_id: 'i2', product_type: 'Футболка' }],
      },
    });
    render(<EconomicsSection order={ORDER} />);
    expect(screen.getByLabelText('Позиция заказа')).toBeInTheDocument();
  });

  /** П. 1 (правка 28.09): сводка по ВСЕМ позициям, строка за строкой; null не становится нулём */
  it('сводка заказа складывает деньги всех позиций и называет нерассчитанные', () => {
    const second = {
      ...ECONOMICS,
      item_id: 'i2',
      product_type: 'Футболка',
      economics: {
        ...ECONOMICS.economics,
        item_id: 'i2',
        costs: { ...ECONOMICS.economics.costs, total: 4500 },
        losses: { ...ECONOMICS.economics.losses, leftovers_usable_cost: null },
      },
    };
    useErpStore.setState({ orderEconomics: { o1: [ECONOMICS, second] } });
    render(<EconomicsSection order={ORDER} />);
    const box = screen.getByRole('region', { name: 'Сводка заказа' });
    const row = (label) => within(box).getByRole('rowheader', { name: label }).closest('tr');

    expect(row('Затраты позиций')).toHaveTextContent('40 000 ₽');
    // У второй позиции остаток не рассчитан — в сумму не вошёл, и это сказано
    expect(row('Пригодные остатки ткани')).toHaveTextContent('4 104 ₽');
    expect(row('Пригодные остатки ткани')).toHaveTextContent('без учёта позиций, где не рассчитано: 1');
    // Не рассчитано ни у одной — словами, а не «0 ₽»
    expect(row('Окончательный брак')).toHaveTextContent('Не рассчитано');
    expect(row('Годные плюсы на складе')).toHaveTextContent('Не рассчитано');
    // Общей суммы «дополнительных расходов» нет — документ её запрещает
    expect(box).not.toHaveTextContent(/Дополнительные расходы/i);
  });

  /** П. 2: остаточная стоимость подтверждается кнопкой; подтверждённая показывает дату */
  it('остаточную стоимость можно подтвердить — кнопка зовёт действие стора', async () => {
    const confirmRollAdjustment = vi.fn(async () => true);
    const adj = {
      roll_id: 'r4', label: 'Рулон №4', before_m: 0.4, after_m: 0, delta_m: -0.4,
      reason: null, author: 'Иван', created_at: '2026-09-27T10:00:00Z',
    };
    useErpStore.setState({
      confirmRollAdjustment,
      orderEconomics: {
        o1: [{
          ...ECONOMICS,
          economics: {
            ...ECONOMICS.economics,
            losses: {
              ...ECONOMICS.economics.losses,
              adjustments: [
                { ...adj, adjustment_id: 'a1', kind: 'cost_residual', cost: 164, confirmed_at: null },
                { ...adj, adjustment_id: 'a2', kind: 'cost_residual', cost: 50, confirmed_at: '2026-09-28T09:00:00Z' },
              ],
              adjustments_open: 1,
            },
          },
        }],
      },
    });
    render(<EconomicsSection order={ORDER} />);

    expect(screen.getByText(/относится на позицию после подтверждения/)).toBeInTheDocument();
    expect(screen.getByText('подтверждено 28.09.2026')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Подтвердить' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(confirmRollAdjustment).toHaveBeenCalledWith('a1', 'o1', 'i1');
    await screen.findByRole('button', { name: 'Подтвердить' });
  });

  /** П. 5: счётчик возвратов в переделку уже внутри «не учтено» — не прибавляется */
  it('переделка — «в т.ч.», а не добавка к незавершённому', () => {
    useErpStore.setState({
      orderEconomics: {
        o1: [{
          ...ECONOMICS,
          economics: {
            ...ECONOMICS.economics,
            losses: {
              ...ECONOMICS.economics.losses,
              wip: [{ ...ECONOMICS.economics.losses.wip[0], unaccounted: 5, rework: 3 }],
              wip_qty: 5,
              wip_rework: 3,
            },
          },
        }],
      },
    });
    render(<EconomicsSection order={ORDER} />);
    const block = screen.getByRole('region', { name: 'Остатки и потери по заказу' });
    expect(block).toHaveTextContent('не учтено 5 шт · в т.ч. возвращалось в переделку: 3');
    expect(block).not.toHaveTextContent('не учтено 8');
    expect(block).not.toHaveTextContent(/в переделке 3 шт/);
  });

  /** П. 7: незаполненный пошив не принимается за ноль — показатели на единицу помечены */
  it('без стоимости пошива показатели на единицу помечены «без пошива»', () => {
    useErpStore.setState({
      orderEconomics: {
        o1: [{
          ...ECONOMICS,
          economics: {
            ...ECONOMICS.economics,
            assembly: { avg: null, covered_qty: 0, source: null, total: null },
            costs: { fabric: 23500, scrap: null, residual: 164, assembly: null, total: 23664, missing: ['assembly'] },
            unit_cost_good: 295.8,
            unit_cost_plan: 236.64,
            losses: {
              ...ECONOMICS.economics.losses,
              extras: { cut_extra: 2, by_size: [{ color: '—', size: 'M', qty: 2 }], finished: 2, shipped: 0, in_stock: 2, unit_cost: 295.8, value: 591.6 },
            },
          },
        }],
      },
    });
    render(<EconomicsSection order={ORDER} />);
    expect(screen.getByText('295,8 ₽ без пошива')).toBeInTheDocument();
    expect(screen.getByText('236,64 ₽ без пошива')).toBeInTheDocument();
    expect(screen.getByText(/Остаточная стоимость рулонов 164 ₽/)).toBeInTheDocument();
    const block = screen.getByRole('region', { name: 'Остатки и потери по заказу' });
    expect(block).toHaveTextContent('591,6 ₽ без пошива');
    expect(block).toHaveTextContent('по данным закроя');
  });
});
