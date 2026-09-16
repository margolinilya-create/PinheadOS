import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnalyticsTab } from './AnalyticsTab';
import { useErpStore } from '../../store/useErpStore';
import { attachDomainSlices } from '../../store/domainSlices';

attachDomainSlices();

/**
 * ПРАВКА ЗАКАЗЧИКА 16.09, П. 7: раздел «Аналитика», первая итерация.
 *
 * Сторож держит то, что легче всего потерять молча:
 *   · показатели называются так, как их называет документ (выпуск, плюсы,
 *     себестоимость сборки, ткань, расход на изделие);
 *   · пустой период говорит СЛОВАМИ, чего именно нет, — плоский ноль на
 *     графике читается как поломка системы, и это прямо оговорено в плане;
 *   · колонки «отклонение от норматива» НЕТ вовсе (решение владельца:
 *     норматива пока не существует, а пустая колонка обещает данные);
 *   · смена фильтра пересчитывает сводку, а не показывает прежнюю.
 */

const DEPTS = [
  { id: 'd-cut', code: 'cutting', name: 'Закройный цех', active: true, is_production: true },
  { id: 'd-sew', code: 'sewing', name: 'Швейный цех', active: true, is_production: true },
];

const EMPTY = {
  overview: {
    from: '2026-08-18', to: '2026-09-16', prev_from: '2026-07-19', prev_to: '2026-08-17',
    released: 0, released_prev: 0, defect: 0, rework: 0, extra: 0,
    assembly_avg: null, assembly_covered_qty: 0,
    fabric_kg: 0, fabric_rolls: 0, fabric_per_item: null,
  },
  series: [], bySku: [], byDept: [],
};

const FILLED = {
  overview: {
    ...EMPTY.overview,
    released: 120, released_prev: 100, defect: 4, rework: 2, extra: 5,
    assembly_avg: 415.5, assembly_covered_qty: 120,
    fabric_kg: 48.6, fabric_rolls: 3, fabric_per_item: 0.405,
  },
  series: [{ bucket: '2026-09-15', released: 120, defect: 4, rework: 2, extra: 5, fabric: 48.6 }],
  bySku: [{
    sku_card_id: null, product_type: 'Футболка', released: 120, defect: 4, rework: 2,
    extra: 5, defect_pct: 3.2, assembly_avg: 415.5, orders: 2,
  }],
  byDept: [{ department_id: 'd-sew', released: 120, defect: 4, rework: 2, defect_pct: 3.2 }],
};

let loadAnalytics;

beforeEach(() => {
  loadAnalytics = vi.fn(async () => FILLED);
  useErpStore.setState({
    departments: DEPTS,
    dictionaries: [],
    analytics: FILLED,
    analyticsLoading: false,
    loadAnalytics,
  });
});

describe('раздел «Аналитика» — показатели', () => {
  it('показывает пять показателей документа', () => {
    render(<AnalyticsTab />);
    expect(screen.getByText('Выпущено изделий, шт')).toBeInTheDocument();
    expect(screen.getByText('Количество плюсов, шт')).toBeInTheDocument();
    expect(screen.getByText('Средняя себестоимость сборки, ₽/шт')).toBeInTheDocument();
    expect(screen.getByText('Использовано ткани, кг')).toBeInTheDocument();
    expect(screen.getByText('Средний расход ткани, кг/изделие')).toBeInTheDocument();
  });

  it('сравнивает с предыдущим сопоставимым периодом', () => {
    render(<AnalyticsTab />);
    expect(screen.getByText(/\+20 к прошлому периоду \(100\)/)).toBeInTheDocument();
  });

  /**
   * Среднее по трём позициям из тридцати читается как среднее по всему,
   * если не сказать, сколько изделий в него вошло.
   */
  it('у себестоимости названо покрытие', () => {
    useErpStore.setState({
      analytics: {
        ...FILLED,
        overview: { ...FILLED.overview, assembly_covered_qty: 40 },
      },
    });
    render(<AnalyticsTab />);
    expect(screen.getByText(/покрыто 40 шт из 120/)).toBeInTheDocument();
  });

  it('колонки «отклонение от норматива» нет — норматива пока не существует', () => {
    render(<AnalyticsTab />);
    expect(screen.queryByText(/норматив/i)).not.toHaveAttribute('scope', 'col');
    expect(screen.queryByRole('columnheader', { name: /отклонение/i })).not.toBeInTheDocument();
  });

  it('брак по цехам показан отдельно — там он и возникает', () => {
    render(<AnalyticsTab />);
    expect(screen.getByRole('row', { name: /Швейный цех/ })).toHaveTextContent('3.2%');
  });
});

describe('раздел «Аналитика» — пустой период', () => {
  it('говорит словами, чего именно нет, а не рисует нули', () => {
    useErpStore.setState({ analytics: EMPTY });
    render(<AnalyticsTab />);
    expect(screen.getByText(/За выбранный период данных нет/)).toBeInTheDocument();
    expect(screen.getByText(/начинают копиться с правок 16\.09/)).toBeInTheDocument();
  });

  it('при пустом периоде сравнение честно объясняет отсутствие базы', () => {
    useErpStore.setState({ analytics: EMPTY });
    render(<AnalyticsTab />);
    expect(screen.getByText(/в прошлом периоде выпуска не было/)).toBeInTheDocument();
  });
});

describe('раздел «Аналитика» — фильтры', () => {
  it('сводка запрашивается при открытии', () => {
    render(<AnalyticsTab />);
    expect(loadAnalytics).toHaveBeenCalledWith(expect.objectContaining({
      bucket: 'day', product: null, dept: null,
    }));
  });

  it('фильтры периода, изделия, цеха и детализации на месте', () => {
    render(<AnalyticsTab />);
    expect(screen.getByLabelText('Начало периода')).toBeInTheDocument();
    expect(screen.getByLabelText('Конец периода')).toBeInTheDocument();
    expect(screen.getByLabelText('Изделие')).toBeInTheDocument();
    expect(screen.getByLabelText('Цех')).toBeInTheDocument();
    expect(screen.getByLabelText('Детализация')).toBeInTheDocument();
  });
});
