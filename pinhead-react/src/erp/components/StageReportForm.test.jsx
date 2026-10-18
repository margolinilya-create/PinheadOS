import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { StageReportForm } from './StageReportForm';
import { useErpStore } from '../store/useErpStore';
import { attemptKeyFor } from '../store/attempts';
import { useConfirmStore } from '../../store/useConfirmStore';
import { attachDomainSlices } from '../store/domainSlices';
import { reportTotals } from '../utils/reportTotals';

attachDomainSlices();

/**
 * Форма отчёта цеха гейтилась ОДНИМ правом — «записывать результат», — а страж
 * этапов разбирает изменение по колонкам: `qty_rework` он проверяет отдельно,
 * под «оформлять брак».
 *
 * Матрица прав редактируема. Стоит снять у роли «Оформлять брак» — и человек
 * по-прежнему видел поле «В переделку», заполнял его и получал 42501 на
 * сохранении. Падал ВЕСЬ отчёт: вместе с браком терялось уже введённое
 * «сшито», а тост говорил про права вообще. Запрещённое «кнопка есть, действие
 * падает», причём в самой частой форме цеха.
 */

const DEPT = {
  id: 'd-sew',
  name: 'Швейный',
  result_fields: [
    { code: 'sewn', label: 'Сшито', unit: 'шт', required: true, target: 'qty_good' },
    { code: 'defect', label: 'Брак', unit: 'шт', required: false, target: 'qty_defect' },
    { code: 'rework', label: 'В переделку', unit: 'шт', required: false, target: 'qty_rework' },
  ],
};

const ENTRY = {
  order: { id: 'o1', title: 'Заказ' },
  item: { id: 'it1', qty: 100, stages: [] },
  stage: { id: 'st1', item_id: 'it1', department_id: 'd-sew', qty_done: 0, depends_on: [] },
};

function renderForm(props = {}) {
  return render(
    <StageReportForm
      entry={ENTRY}
      dept={DEPT}
      busy={false}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
      {...props}
    />,
  );
}

describe('поля брака показываются только с правом на брак', () => {
  it('с правом видны все поля участка', () => {
    renderForm({ canDefect: true });
    expect(screen.getByLabelText(/Сшито/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Брак/)).toBeInTheDocument();
    expect(screen.getByLabelText(/В переделку/)).toBeInTheDocument();
  });

  it('без права остаётся только выработка', () => {
    renderForm({ canDefect: false });
    expect(screen.getByLabelText(/Сшито/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Брак/)).toBeNull();
    expect(screen.queryByLabelText(/В переделку/)).toBeNull();
  });

  /**
   * Форма не «урезанная», а рабочая: «сшито» без «в переделку» — законный
   * отчёт цеха, и обязательное поле остаётся обязательным.
   */
  it('без права отчёт всё равно можно сдать', () => {
    renderForm({ canDefect: false });
    expect(screen.getByRole('button', { name: /Сдать результат/i })).toBeInTheDocument();
  });

  it('по умолчанию право есть — старые вызовы не меняют поведения', () => {
    renderForm();
    expect(screen.getByLabelText(/В переделку/)).toBeInTheDocument();
  });
});

/**
 * ПРАВКА ЗАКАЗЧИКА 16.09, П. 6: «Вместо одиночных полей „Сшито", „Брак",
 * „В переделку" вывести таблицу результата по каждому размеру позиции.
 * Размерная сетка и колонка „Принято из закроя, шт" подтягиваются
 * автоматически из фактического результата этапа „Закрой"… Проверка
 * по каждой строке: Сшито + Брак + В переделку не может превышать количество,
 * фактически принятое из закроя по этому размеру».
 *
 * Сторож держит три вещи: одиночные поля ушли (иначе у трёх чисел два
 * писателя), «принято» подтянулось из отчёта предыдущего этапа (а не
 * вводится руками) и превышение названо ЧИСЛАМИ до отправки.
 */
describe('результат пошива по размерам (правка 16.09, п. 6)', () => {
  const SEWING = { ...DEPT, result_detail: 'sizes' };
  const ITEM = {
    id: 'it1', qty: 100, size_grid: [{ color: '—', sizes: { XS: 10, S: 20 } }],
    // Закрой закрыт со своим фактом: с правки 05.10 вход швейки — факт
    // закроя, а не тираж
    stages: [{ id: 'cut', status: 'done', qty_done: 30, qty_passthrough: false }, { id: 'st1' }],
  };
  const STAGE = { ...ENTRY.stage, depends_on: ['cut'] };

  const cutReport = (sizes) => ([{
    id: 'r1', stage_id: 'cut', warehouse_task_id: null, qty_in: null,
    qty_good: 0, qty_defect: 0, qty_rework: 0, qty_extra: 0,
    comment: null, extra: {}, author: null, author_id: null, created_at: '',
    sizes: Object.entries(sizes).map(([size, qty]) => ({
      id: `s${size}`, report_id: 'r1', color: '—', size,
      qty_good: qty, qty_defect: 0, qty_rework: 0, qty_extra: 0, created_at: '',
    })),
  }]);

  const renderSewing = (reports = cutReport({ XS: 10, S: 20 }), props = {}) => {
    useErpStore.setState({ loadStageReports: async () => reports });
    return render(
      <StageReportForm
        entry={{ ...ENTRY, item: ITEM, stage: STAGE }}
        dept={SEWING}
        busy={false}
        onSubmit={props.onSubmit ?? vi.fn()}
        onCancel={vi.fn()}
        {...props}
      />,
    );
  };

  it('одиночных полей «Сшито/Брак/В переделку» больше нет — их заменила таблица', async () => {
    renderSewing();
    await screen.findByRole('table');
    // Поля участка ушли: осталась таблица со своими колонками
    expect(screen.queryByLabelText('Сшито, шт')).not.toBeInTheDocument();
    expect(screen.getAllByRole('spinbutton', { name: /XS, Сшито/ })).toHaveLength(1);
  });

  it('«Принято из закроя» подтянуто из отчёта предыдущего этапа', async () => {
    renderSewing(cutReport({ XS: 9, S: 20 }));
    await screen.findByRole('table');
    const row = screen.getByRole('row', { name: /XS/ });
    // 9 — ровно то, что сдал закрой, а не тираж заказа
    expect(row).toHaveTextContent('9');
  });

  it('превышение принятого названо числами и гасит кнопку', async () => {
    renderSewing();
    await screen.findByRole('table');
    fireEvent.change(screen.getByRole('spinbutton', { name: /XS, Сшито/ }), {
      target: { value: '12' },
    });

    expect(screen.getByText(/больше 10 шт сдать нельзя.*введено 12/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Сдать результат/ })).toBeDisabled();
  });

  /**
   * ВТОРАЯ СДАЧА ВИДИТ ОСТАТОК (правка заказчика 27.09, п. 7): «после сдачи
   * 368 сшитых оставшиеся 104 пропали из учёта». Принято XS 10 / S 20;
   * первая сдача — XS 7 годных + 1 брак, S 20. Вторая обязана видеть
   * «осталось 2» по XS, «Осталось сдать 2» в шапке и не давать сдать 3.
   */
  it('вторая сдача считает остаток из принятых минус прежние сдачи', async () => {
    const own = [{
      id: 'r-own', stage_id: 'st1', qty_in: 30, qty_good: 27, qty_defect: 1, qty_rework: 0,
      sizes: [
        { color: '—', size: 'XS', qty_good: 7, qty_defect: 1, qty_rework: 0 },
        { color: '—', size: 'S', qty_good: 20, qty_defect: 0, qty_rework: 0 },
      ],
    }];
    useErpStore.setState({
      loadStageReports: async (ids) => (ids.includes('st1') ? own : cutReport({ XS: 10, S: 20 })),
    });
    render(
      <StageReportForm
        entry={{ ...ENTRY, item: ITEM, stage: { ...STAGE, qty_done: 27 } }}
        dept={SEWING}
        busy={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await screen.findByRole('table');
    // Правка 05.10: потолок — принятое (закрой закрыт на 30), а не тираж 100:
    // 30 − 27 сдано − 1 брак = 2 в шапке
    expect(await screen.findByText(/осталось сдать 2/)).toBeInTheDocument();
    const xs = screen.getByRole('row', { name: /XS/ });
    expect(xs).toHaveTextContent('в работе 2');
    // Прежние сдачи видны отдельно от новой партии (п. 3)
    expect(screen.getByRole('columnheader', { name: 'Сдано ранее' })).toBeInTheDocument();
    expect(xs).toHaveTextContent('7');
    fireEvent.change(screen.getByRole('spinbutton', { name: /XS, Сдаю сейчас/ }), {
      target: { value: '3' },
    });
    expect(screen.getByText(/больше 2 шт сдать нельзя/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Сдать результат/ })).toBeDisabled();
  });

  /**
   * ПРАВКА 05.10, п. 3 — пример документа: крой XS 34 / S 34 / M 34, первая
   * сдача 34 / 34 / 32. При следующем открытии: получено 102, сдано 100,
   * в работе M 2 — сдать можно эти 2 шт, а не ещё 50.
   */
  it('повторное открытие: крой 34/34/34, сдано 34/34/32 — в работе M 2', async () => {
    const grid = [{ color: 'белый', sizes: { XS: 50, S: 50, M: 50 } }];
    const cut = [{
      id: 'rc', stage_id: 'cut', sizes: ['XS', 'S', 'M'].map((size) => ({
        color: 'белый', size, qty_good: 34, qty_defect: 0, qty_rework: 0,
      })),
    }];
    const own = [{
      id: 'r1', stage_id: 'st1', qty_good: 100, qty_defect: 0, qty_rework: 0,
      sizes: [['XS', 34], ['S', 34], ['M', 32]].map(([size, q]) => ({
        color: 'белый', size, qty_good: q, qty_defect: 0, qty_rework: 0,
      })),
    }];
    useErpStore.setState({
      loadStageReports: async (ids) => (ids.includes('st1') ? own : cut),
    });
    const item = {
      id: 'it1', qty: 150, size_grid: grid, assembly_cost_per_unit: 415,
      stages: [{ id: 'cut', status: 'done', qty_done: 102, qty_passthrough: false }, { id: 'st1' }],
    };
    render(
      <StageReportForm
        entry={{ ...ENTRY, item, stage: { ...STAGE, qty_done: 100 } }}
        dept={SEWING}
        busy={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(await screen.findByText(/осталось сдать 2/)).toBeInTheDocument();
    expect(screen.getByText(/Принято в работу:/)).toHaveTextContent('102');
    expect(screen.getByRole('row', { name: /^M/ })).toHaveTextContent('в работе 2');
    expect(screen.getByRole('row', { name: /^XS/ })).toHaveTextContent('учтено');
    // Стоимость сборки стоит в поле, а не серой подсказкой
    expect(screen.getByLabelText(/Стоимость сборки за единицу/)).toHaveValue(415);
    fireEvent.change(screen.getByRole('spinbutton', { name: /^M · белый, Сдаю сейчас/ }), {
      target: { value: '3' },
    });
    expect(screen.getByRole('button', { name: /Сдать результат/ })).toBeDisabled();
  });

  it('стоимость сборки обязательна, пока её у позиции нет', async () => {
    renderSewing();
    await screen.findByRole('table');
    fireEvent.change(screen.getByRole('spinbutton', { name: /XS, Сшито/ }), {
      target: { value: '5' },
    });
    expect(screen.getByRole('button', { name: /Сдать результат/ })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Стоимость сборки за единицу/), {
      target: { value: '415.5' },
    });
    expect(screen.getByRole('button', { name: /Сдать результат/ })).toBeEnabled();
  });

  it('результат уезжает строками по размерам и стоимостью на позицию', async () => {
    const onSubmit = vi.fn();
    renderSewing(cutReport({ XS: 10, S: 20 }), { onSubmit });
    await screen.findByRole('table');

    fireEvent.change(screen.getByRole('spinbutton', { name: /XS, Сшито/ }), { target: { value: '9' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /^S, Сшито/ }), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText(/Стоимость сборки за единицу/), { target: { value: '415.5' } });
    fireEvent.click(screen.getByRole('button', { name: /Сдать результат/ }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      qtyGood: 29,
      assemblyCost: 415.5,
      sizes: [
        { color: '—', size: 'XS', qty_good: 9, qty_defect: 0, qty_rework: 0 },
        { color: '—', size: 'S', qty_good: 20, qty_defect: 0, qty_rework: 0 },
      ],
    }));
  });

  /**
   * FAIL-OPEN — условие выката: у этапов, закрытых до правки, размерных
   * строк нет. Читать их как «принято ноль» значило бы в день выката
   * остановить швейку на всех действующих заказах.
   */
  it('без размерных данных закроя потолок по размеру не появляется', async () => {
    renderSewing([]);
    await screen.findByRole('table');
    fireEvent.change(screen.getByRole('spinbutton', { name: /XS, Сшито/ }), {
      target: { value: '999' },
    });
    expect(screen.queryByText(/столько осталось из принятых/)).not.toBeInTheDocument();
  });
});

/**
 * РАЗМЕРНАЯ ВЕТКА У ПОЗИЦИИ БЕЗ СЕТКИ (правка заказчика 20.09, п. 8).
 *
 * До правки она включалась условием `result_detail === 'sizes' &&
 * item.size_grid?.length > 0`. На позиции, заведённой без размерной сетки
 * (на бою таких 21 из 49), швейка сдавала результат одним числом, а поля
 * «Стоимость сборки единицы» не было ВООБЩЕ — оно рисовалось внутри той же
 * ветки. Именно это заказчик и описал в документе.
 */
describe('швейка: размеры и стоимость сборки без размерной сетки позиции', () => {
  const SEWING = { ...DEPT, result_detail: 'sizes' };

  /** Этап швейки зависит от закроя, а закрой сдал размеры фактом */
  const withCutting = {
    order: { id: 'o1', title: 'Заказ' },
    item: {
      id: 'it1',
      qty: 100,
      size_grid: null, // сетки НЕТ — в этом вся правка
      stages: [{ id: 'cut1' }, { id: 'sew1' }],
    },
    stage: {
      id: 'sew1', item_id: 'it1', department_id: 'd-sew', qty_done: 0, depends_on: ['cut1'],
    },
  };

  function mockCuttingReports() {
    useErpStore.setState({
      loadStageReports: async () => ([{
        id: 'r1',
        stage_id: 'cut1',
        sizes: [
          { color: '—', size: 'M', qty_good: 30 },
          { color: '—', size: 'L', qty_good: 20 },
        ],
      }]),
    });
  }

  it('поле стоимости сборки есть даже без размерной сетки', async () => {
    mockCuttingReports();
    render(
      <StageReportForm
        entry={withCutting}
        dept={SEWING}
        busy={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(await screen.findByLabelText(/Стоимость сборки за единицу/))
      .toBeInTheDocument();
  });

  it('«Покроено» подтягивается из закроя — размерами, а не одним числом', async () => {
    mockCuttingReports();
    render(
      <StageReportForm
        entry={withCutting}
        dept={SEWING}
        busy={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // Заголовок колонки — формулировка документа
    expect(await screen.findByText('Покроено, шт')).toBeInTheDocument();
    // Строки — те размеры, что сдал закрой
    expect(await screen.findByLabelText(/^M, Сшито, шт$/)).toBeInTheDocument();
    expect(await screen.findByLabelText(/^L, Сшито, шт$/)).toBeInTheDocument();
  });

  /**
   * ЧЕРЕЗ НАНЕСЕНИЕ (правка 27.09, п. 6): между закроем и швейкой стоит
   * вышивка без размерного отчёта. Форма обязана загрузить отчёты ВСЕХ
   * предков и подтянуть «Покроено» из закроя — до правки здесь были
   * прочерки и «Итого 0» при «Принято в работу: 472».
   */
  it('«Покроено» доходит через вышивку без размерного отчёта', async () => {
    const asked = [];
    useErpStore.setState({
      loadStageReports: async (ids) => {
        asked.push(...ids);
        return [{
          id: 'r1', stage_id: 'cut1',
          sizes: [{ color: '—', size: 'M', qty_good: 30 }, { color: '—', size: 'L', qty_good: 20 }],
        }];
      },
    });
    render(
      <StageReportForm
        entry={{
          ...withCutting,
          item: {
            ...withCutting.item,
            stages: [
              { id: 'cut1', depends_on: [] },
              { id: 'emb1', depends_on: ['cut1'] },
              { id: 'sew1', depends_on: ['emb1'] },
            ],
          },
          stage: { ...withCutting.stage, depends_on: ['emb1'] },
        }}
        dept={SEWING}
        busy={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(await screen.findByText('Покроено, шт')).toBeInTheDocument();
    expect(await screen.findByLabelText(/^M, Сшито, шт$/)).toBeInTheDocument();
    // Отчёты спрошены у закроя, а не только у прямого предшественника
    expect(asked).toEqual(expect.arrayContaining(['cut1', 'emb1']));
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('30').length).toBeGreaterThan(0);
  });

  it('сшито больше покроенного — поле помечено ошибкой и названа причина', async () => {
    mockCuttingReports();
    render(
      <StageReportForm
        entry={withCutting}
        dept={SEWING}
        busy={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const field = await screen.findByLabelText(/^M, Сшито, шт$/);
    fireEvent.change(field, { target: { value: '40' } }); // покроено 30

    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Нельзя указать больше, чем осталось')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Сдать результат/ })).toBeDisabled();
  });
});

/**
 * ФОРМА СДАЧИ ОТКРЫВАЕТСЯ ИЗ ОЧЕРЕДИ ЦЕХА — то есть с ЛИСТОВЫМИ данными
 * заказа (правка 21.09, пп. 2, 3, 4).
 *
 * В `ORDER_LIST_SELECT` нет `items.size_grid`, а рулоны туда не входили
 * никогда. Обе вещи приезжали `undefined`, и обе ломались молча: закрой
 * предлагал стандартную шкалу и писал «у позиции нет размерной сетки»
 * на позиции, где она заполнена, а список рулонов оказывался пустым.
 */
describe('форма сдачи дозагружает полный заказ', () => {
  const CUTTING = {
    id: 'd-cut',
    name: 'Закройный',
    result_detail: 'rolls',
    result_fields: [
      { code: 'cut', label: 'Скроено', unit: 'шт', required: true, target: 'qty_good' },
    ],
  };

  /** Тот же заказ, каким его отдаёт СПИСОЧНАЯ выборка: без сетки и рулонов */
  const listOrder = {
    id: 'o-cut',
    title: 'Заказ',
    items: [{ id: 'it-cut', qty: 200, stages: [] }],
    materials: [],
  };
  /** И он же после `loadOne` */
  const fullOrder = {
    id: 'o-cut',
    title: 'Заказ',
    items: [{
      id: 'it-cut',
      qty: 200,
      stages: [],
      size_grid: [{ color: '—', sizes: { XS: 200 } }],
    }],
    materials: [{
      id: 'm-1',
      kind: 'fabric',
      name: 'кулирка',
      item_id: null,
      accept_status: 'accepted_full',
      rolls: [
        { id: 'r-1', seq: 1, label: 'Рулон №1', status: 'in_stock', length_m: 30, length_left_m: 30 },
        { id: 'r-2', seq: 2, label: 'Рулон №2', status: 'in_stock', length_m: 30, length_left_m: 30 },
      ],
    }],
  };

  const entryOf = (order) => ({
    order,
    item: order.items[0],
    stage: { id: 'st-cut', item_id: 'it-cut', department_id: 'd-cut', qty_done: 0, depends_on: [] },
  });

  function setup() {
    const loadOne = vi.fn(async () => {
      useErpStore.setState({ orders: [fullOrder], detailIds: ['o-cut'] });
      return fullOrder;
    });
    useErpStore.setState({
      orders: [listOrder], detailIds: [], loadOne,
      fabricLeftovers: [], loadFabricLeftovers: vi.fn(async () => []), loadOrderForeignRolls: vi.fn(async () => []),
    });
    render(
      <StageReportForm
        entry={entryOf(listOrder)}
        dept={CUTTING}
        busy={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    return { loadOne };
  }

  it('листовой заказ дотягивается, а не выдаётся за полный', async () => {
    const { loadOne } = setup();
    expect(loadOne).toHaveBeenCalledWith('o-cut');
    // До ответа секция молчит, а не врёт «склад ещё не принял ткань»
    expect(screen.queryByText(/Склад ещё не принял/)).not.toBeInTheDocument();
    expect(await screen.findByRole('radiogroup', { name: 'Рулон №1 — использование' })).toBeInTheDocument();
  });

  it('оба принятых рулона в «Расходе ткани», а размеры — из сетки позиции', async () => {
    setup();
    expect(await screen.findByRole('radiogroup', { name: 'Рулон №2 — использование' })).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /^XS/ });
    expect(row).toHaveTextContent('200');
    expect(screen.queryByText(/У позиции нет размерной сетки/)).not.toBeInTheDocument();
  });
});

/**
 * СДАЧА ЗАКРОЯ (правки 19.10, «Закрой»): выпуск один раз таблицей, расход —
 * режимами рулона, брак и комментарий — общие поля формы.
 */
describe('сдача закроя — результат один раз, расход по рулонам', () => {
  const CUTTING = {
    id: 'd-cut', name: 'Закройный', result_detail: 'rolls', allows_over_plan: true,
    result_fields: [
      { code: 'cut', label: 'Скроено', unit: 'шт', required: true, target: 'qty_good' },
      { code: 'defect', label: 'Брак', unit: 'шт', required: false, target: 'qty_defect' },
    ],
  };
  const roll = (id, seq, left) => ({
    id, seq, label: `Рулон №${seq}`, status: 'in_stock', qty: 20,
    length_m: left, length_source: 'supplier', length_left_m: left, kg_per_m: 0.4,
  });
  const order = {
    id: 'o-5', title: 'Заказ',
    items: [{ id: 'it-5', qty: 100, stages: [], size_grid: [{ color: 'чёрный', sizes: { S: 50, M: 50 } }] }],
    materials: [
      {
        id: 'm-f', kind: 'fabric', name: 'Футер', color: 'чёрный', item_id: null, accept_status: 'accepted_full',
        rolls: [roll('r-1', 1, 50), roll('r-2', 2, 50), roll('r-3', 3, 50)],
      },
      {
        id: 'm-r', kind: 'fabric', name: 'Рибана', color: 'чёрный', item_id: null, accept_status: 'accepted_full',
        rolls: [roll('r-9', 9, 10)],
      },
    ],
  };
  const entry = {
    order, item: order.items[0],
    stage: { id: 'st-5', item_id: 'it-5', department_id: 'd-cut', qty_done: 0, depends_on: [], status: 'in_progress' },
  };

  function setup(onSubmit = vi.fn(async () => true), orders = [order]) {
    const loadFabricLeftovers = vi.fn(async () => []);
    useErpStore.setState({
      orders, detailIds: ['o-5'], fabricLeftovers: [],
      loadFabricLeftovers, loadOrderForeignRolls: vi.fn(async () => []),
    });
    render(
      <StageReportForm entry={entry} dept={CUTTING} busy={false} onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    return { onSubmit, loadFabricLeftovers };
  }
  const mode = (seq, name) => fireEvent.click(
    within(screen.getByRole('radiogroup', { name: `Рулон №${seq} — использование` })).getByRole('radio', { name }),
  );
  const fill = () => {
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Скроено, шт — S' }), { target: { value: '40' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Скроено, шт — M' }), { target: { value: '60' } });
  };

  it('один вызов: sizes из таблицы, rolls только отмеченные, брак и комментарий один раз', async () => {
    const { onSubmit } = setup();
    fill();
    mode(1, 'Полностью');
    mode(2, 'Частично');
    fireEvent.change(screen.getByLabelText('Остаток, м — рулон №2'), { target: { value: '12' } });
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Рулон №2 — остаток' }))
      .getByRole('radio', { name: 'Остаток пригоден' }));
    expect(screen.getAllByLabelText(/^Брак/)).toHaveLength(1);
    expect(screen.queryByLabelText(/^Скроено, шт$/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Брак/), { target: { value: '2' } });
    fireEvent.change(screen.getByPlaceholderText('что именно пошло не так'), { target: { value: 'пятно' } });
    fireEvent.click(screen.getByRole('button', { name: /Сдать результат/ }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toMatchObject({ qtyGood: 100, qtyDefect: 2, comment: 'пятно' });
    expect(payload.sizes).toEqual([
      { color: 'чёрный', size: 'S', qty_good: 40 },
      { color: 'чёрный', size: 'M', qty_good: 60 },
    ]);
    expect(payload.rolls).toEqual([
      { roll_id: 'r-1', material_id: 'm-f', length_used_m: 50, finished: true },
      {
        roll_id: 'r-2', material_id: 'm-f', length_used_m: 38, finished: true,
        leftover: 'usable', leftover_measured_m: null,
      },
    ]);
  });

  it('двойной клик — один submitStageReport', async () => {
    let resolve;
    const onSubmit = vi.fn(() => new Promise((r) => { resolve = r; }));
    const { loadFabricLeftovers } = setup(onSubmit);
    fill();
    mode(1, 'Полностью');
    const button = screen.getByRole('button', { name: /Сдать результат/ });
    fireEvent.click(button);
    fireEvent.click(button);
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const before = loadFabricLeftovers.mock.calls.length;
    resolve(true);
    await vi.waitFor(() => expect(loadFabricLeftovers.mock.calls.length).toBeGreaterThan(before));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('повтор после сетевой ошибки — тот же client_key, значения формы сохранены', async () => {
    const onSubmit = vi.fn(async () => false);
    setup(onSubmit);
    fill();
    mode(1, 'Полностью');
    const button = screen.getByRole('button', { name: /Сдать результат/ });
    fireEvent.click(button);
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('spinbutton', { name: 'Скроено, шт — S' })).toHaveValue(40);
    expect(within(screen.getByRole('radiogroup', { name: 'Рулон №1 — использование' }))
      .getByRole('radio', { name: 'Полностью' })).toBeChecked();
    fireEvent.click(button);
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    const [first, second] = onSubmit.mock.calls.map((c) => c[0]);
    expect(second).toEqual(first);
    expect(attemptKeyFor('st-5', second)).toBe(attemptKeyFor('st-5', first));
  });

  it('выпуск без рулонов — подтверждение «Сдать без списания ткани?», отказ не отправляет', async () => {
    const { onSubmit } = setup();
    fill();
    fireEvent.click(screen.getByRole('button', { name: /Сдать результат/ }));
    await vi.waitFor(() => expect(useConfirmStore.getState().open).toBe(true));
    const dialog = useConfirmStore.getState();
    expect(dialog.title).toBe('Сдать без списания ткани?');
    expect(dialog.message).toBe('Ни один рулон не отмечен как использованный — метры не спишутся со склада.');
    expect(dialog.confirmLabel).toBe('Сдать без списания');
    expect(dialog.cancelLabel).toBe('Отметить рулоны');
    await act(async () => { useConfirmStore.getState()._close(false); });
    expect(onSubmit).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole('checkbox', { name: 'Выбрать все в группе Футер · чёрный' }),
    ));
  });

  /**
   * Р7 + брак (ревизия A4): без рулонов строки выпуска несут одно `qty_good`,
   * и `reportTotals` прежде брал брак из них — нулём. Теперь брак — скаляр формы.
   */
  it('«Сдать без списания» с браком — брак доходит до отчёта и reportTotals', async () => {
    const { onSubmit } = setup();
    fill();
    fireEvent.change(screen.getByLabelText(/^Брак/), { target: { value: '2' } });
    fireEvent.change(screen.getByPlaceholderText('что именно пошло не так'), { target: { value: 'пятно' } });
    fireEvent.click(screen.getByRole('button', { name: /Сдать результат/ }));
    await vi.waitFor(() => expect(useConfirmStore.getState().open).toBe(true));
    await act(async () => { useConfirmStore.getState()._close(true); });
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toMatchObject({ qtyGood: 100, qtyDefect: 2, comment: 'пятно', rolls: [] });
    expect(reportTotals(payload)).toMatchObject({ good: 100, defect: 2 });
  });

  it('сдача с ошибкой — alert и фокус на первом ошибочном поле', async () => {
    const { onSubmit } = setup();
    fill();
    mode(1, 'Частично');
    mode(2, 'Частично');
    fireEvent.click(screen.getByRole('button', { name: /Сдать результат/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Проверьте 2 рулона');
    expect(document.activeElement).toBe(screen.getByLabelText('Остаток, м — рулон №1'));
    expect(screen.getByLabelText('Остаток, м — рулон №1')).toHaveAttribute('aria-invalid', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('рулоны в работе прежних сдач — отдельной кнопкой «Завершить рулон»', () => {
    const inUse = { ...roll('r-1', 1, 50), status: 'in_use', length_left_m: 20 };
    setup(vi.fn(), [{ ...order, materials: [{ ...order.materials[0], rolls: [inUse] }] }]);
    expect(screen.getByRole('group', { name: 'Рулоны в работе' })).toHaveTextContent('Рулон №1');
  });
});
