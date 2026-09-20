import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EconomicsSection } from './EconomicsSection';
import { useErpStore } from '../../store/useErpStore';

/**
 * ЭКОНОМИКА ПОЗИЦИИ (правка заказчика 20.09, п. 9) — показ.
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

const ECONOMICS = {
  item_id: 'i1',
  product_type: 'Худи',
  variant: 'чёрное',
  qty: 100,
  economics: {
    qty_cut: 82,
    qty_good: 80,
    rolls_used: 3,
    fabric: [{
      unit: 'кг', qty_used: 47, cost: 23500, avg_per_cut: 0.5732, priced_qty: 47,
    }],
    fabric_cost_total: 23500,
    fabric_cost_per_good: 293.75,
    assembly: { avg: 150, covered_qty: 80, source: 'reports' },
    direct_unit_cost: 443.75,
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
  it('рисует величины расчёта', () => {
    useErpStore.setState({ orderEconomics: { o1: [ECONOMICS] } });
    render(<EconomicsSection order={ORDER} />);

    expect(screen.getByText('Прямая себестоимость единицы')).toBeInTheDocument();
    expect(screen.getByText('Выкроено')).toBeInTheDocument();
    // Расход подписан ЕДИНИЦЕЙ: «61 кг и 120 м» сложить нельзя, и число
    // без единицы здесь было бы выдумкой
    expect(screen.getByText('Расход полотна, кг')).toBeInTheDocument();
  });

  /**
   * На бою размерных строк закроя нет ни одной — пустое состояние и есть
   * первое, что увидит заказчик. «0 ₽» читалось бы как «производство
   * бесплатное», а не как «данных пока нет».
   */
  it('без рулонов закроя говорит, чего не хватает, а не показывает нули', () => {
    useErpStore.setState({
      orderEconomics: {
        o1: [{
          ...ECONOMICS,
          economics: {
            qty_cut: 0,
            qty_good: 0,
            rolls_used: 0,
            fabric: [],
            fabric_cost_total: null,
            fabric_cost_per_good: null,
            assembly: { avg: null, covered_qty: 0, source: null },
            direct_unit_cost: null,
          },
        }],
      },
    });
    render(<EconomicsSection order={ORDER} />);

    // Формулировка одна и та же в двух местах — в блоке расхода и в списке
    // нехваток; проверяется, что она есть, а не сколько раз
    expect(screen.getAllByText(/закрой ещё не сдавал результат по рулонам/).length)
      .toBeGreaterThan(0);
    expect(screen.getByText(/Расчёт неполный/)).toBeInTheDocument();
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
});
