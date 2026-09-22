import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { StageReportForm } from './StageReportForm';
import { useErpStore } from '../store/useErpStore';
import { attachDomainSlices } from '../store/domainSlices';

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
    stages: [{ id: 'cut' }, { id: 'st1' }],
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

    expect(screen.getByText(/введено 12 шт при принятых из закроя 10/)).toBeInTheDocument();
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
    expect(screen.queryByText(/при принятых из закроя/)).not.toBeInTheDocument();
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
    expect(screen.getByText('Нельзя указать больше, чем покроено')).toBeInTheDocument();
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
 * на позиции, где она заполнена, а список рулонов оказывался пустым —
 * «после добавления одного рулона система ошибочно считает, что все
 * принятые рулоны уже в списке».
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
        { id: 'r-1', seq: 1, label: 'Рулон №1', status: 'in_stock' },
        { id: 'r-2', seq: 2, label: 'Рулон №2', status: 'in_stock' },
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
    useErpStore.setState({ orders: [listOrder], detailIds: [], loadOne });
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
    // До ответа секция молчит, а не врёт «склад ещё не принял рулоны»
    expect(screen.queryByText(/Склад ещё не принял рулоны/)).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Добавить рулон/ })).toBeEnabled();
  });

  it('рулоны приёмки видны в селекте, а размеры берутся из сетки позиции', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /Добавить рулон/ }));

    // Оба принятых рулона — в выборе, а не один
    const roll = screen.getByLabelText('Рулон, строка 1');
    expect(within(roll).getByRole('option', { name: /Рулон №1/ })).toBeInTheDocument();
    expect(within(roll).getByRole('option', { name: /Рулон №2/ })).toBeInTheDocument();
    // Добавили один — второй остаётся свободным
    expect(screen.queryByText('Все принятые рулоны уже в списке')).not.toBeInTheDocument();

    // Размер подписан количеством ИЗ ЗАКАЗА, а не взят из стандартной шкалы
    const size = screen.getByLabelText('Размер, строка 1');
    expect(within(size).getByRole('option', { name: 'XS (в заказе 200)' })).toBeInTheDocument();
  });
});
