import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
    fabric_m: 0, fabric_cut_good: 0, fabric_calc: false, fabric_incomplete: false,
  },
  series: [], bySku: [], byDept: [], fabricBySku: [],
};

const FILLED = {
  overview: {
    ...EMPTY.overview,
    released: 120, released_prev: 100, defect: 4, rework: 2, extra: 5,
    assembly_avg: 415.5, assembly_covered_qty: 120,
    fabric_kg: 48.6, fabric_rolls: 3, fabric_per_item: 0.9375,
    fabric_m: 112.5, fabric_cut_good: 120, fabric_calc: false, fabric_incomplete: false,
  },
  series: [{ bucket: '2026-09-15', released: 120, defect: 4, rework: 2, extra: 5, fabric: 48.6 }],
  bySku: [{
    sku_card_id: null, product_type: 'Футболка', released: 120, defect: 4, rework: 2,
    extra: 5, defect_pct: 3.2, assembly_avg: 415.5, orders: 2,
  }],
  byDept: [{ department_id: 'd-sew', released: 120, defect: 4, rework: 2, defect_pct: 3.2 }],
  fabricBySku: [{
    product_type: 'Футболка', material: 'Кулирка', width_cm: 180, fabric_m: 112.5,
    cut_good: 120, per_item: 0.9375, calc: false, incomplete: false, orders: 2,
  }],
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
    // В МЕТРАХ (правка 27.09, п. 5): «кг/изделие» → «м/изделие»
    expect(screen.getByText('Использовано ткани, м')).toBeInTheDocument();
    expect(screen.getByText('Средний расход ткани, м/изделие')).toBeInTheDocument();
    expect(screen.queryByText(/ткани, кг/)).not.toBeInTheDocument();
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

/**
 * ТКАНЬ В МЕТРАХ И ВЫГРУЗКА (правка 27.09, п. 5).
 * Отсутствие метров — словами «Нет данных», а не прочерком; выгрузка
 * отдаёт тот же снимок файлом CSV (формат сторожит `analyticsCsv.test.ts`).
 */
describe('раздел «Аналитика» — метры и выгрузка CSV', () => {
  it('нет метров — плитка ткани говорит «Нет данных»', () => {
    useErpStore.setState({ analytics: EMPTY });
    render(<AnalyticsTab />);
    const card = screen.getByText('Использовано ткани, м').parentElement;
    expect(within(card).getByText('Нет данных')).toBeInTheDocument();
  });

  it('ячейка «Ткань, м» без данных — «Нет данных», ноль остаётся нулём', () => {
    useErpStore.setState({
      analytics: {
        ...FILLED,
        series: [
          { bucket: '2026-09-14', released: 1, defect: 0, rework: 0, extra: 0, fabric: null },
          { bucket: '2026-09-15', released: 1, defect: 0, rework: 0, extra: 0, fabric: 0 },
        ],
      },
    });
    render(<AnalyticsTab />);
    expect(screen.getByRole('row', { name: /2026-09-14/ })).toHaveTextContent('Нет данных');
    expect(screen.getByRole('row', { name: /2026-09-15/ })).toHaveTextContent('0,00 м');
  });

  it('ячейка «Ткань, м» в динамике помечает расчёт и неполные данные', () => {
    useErpStore.setState({
      analytics: {
        ...FILLED,
        series: [
          { bucket: '2026-09-13', released: 1, defect: 0, rework: 0, extra: 0, fabric: 2,
            fabric_calc: true, fabric_incomplete: true },
          { bucket: '2026-09-14', released: 1, defect: 0, rework: 0, extra: 0, fabric: 3,
            fabric_calc: false, fabric_incomplete: false },
          { bucket: '2026-09-15', released: 1, defect: 0, rework: 0, extra: 0, fabric: 4 },
        ],
      },
    });
    render(<AnalyticsTab />);
    const both = screen.getByRole('row', { name: /2026-09-13/ });
    const calc = within(both).getByTitle(/пересчитана из кг по коэффициенту рулона/);
    expect(calc).toHaveTextContent('расчёт');
    const partial = within(both).getByTitle(/не пересчитана/);
    expect(partial).toHaveTextContent('неполно');
    // Пояснение доступно и без наведения — скрытым текстом внутри отметки
    expect(calc.textContent).toContain('коэффициенту рулона');
    for (const b of ['2026-09-14', '2026-09-15']) {
      const row = screen.getByRole('row', { name: new RegExp(b) });
      expect(row).not.toHaveTextContent('расчёт');
      expect(row).not.toHaveTextContent('неполно');
    }
  });

  it('кнопка «Выгрузить CSV» отдаёт файл с BOM и метрами', async () => {
    const blobs = [];
    const create = vi.fn((b) => { blobs.push(b); return 'blob:x'; });
    const revoke = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const orig = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    try {
      render(<AnalyticsTab />);
      fireEvent.click(screen.getByRole('button', { name: 'Выгрузить CSV' }));
      expect(create).toHaveBeenCalledTimes(1);
      expect(click).toHaveBeenCalledTimes(1);
      expect(revoke).toHaveBeenCalledWith('blob:x');
      // jsdom-овский Blob без `text()`: читаем байты — BOM виден как EF BB BF
      const buf = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(new Uint8Array(r.result));
        r.readAsArrayBuffer(blobs[0]);
      });
      expect([...buf.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const text = new TextDecoder('utf-8').decode(buf);
      expect(text).toContain('Использовано ткани, м;112,5');
      expect(text).toContain('Расход полотна по моделям');
    } finally {
      URL.createObjectURL = orig.create;
      URL.revokeObjectURL = orig.revoke;
      click.mockRestore();
    }
  });

  it('без сводки выгружать нечего — кнопка недоступна', () => {
    useErpStore.setState({ analytics: null });
    render(<AnalyticsTab />);
    expect(screen.getByRole('button', { name: 'Выгрузить CSV' })).toBeDisabled();
  });
});
