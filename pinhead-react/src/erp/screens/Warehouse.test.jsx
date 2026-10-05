import { useEffect } from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import Warehouse from './Warehouse';
import { useErpStore } from '../store/useErpStore';
import { attachDomainSlices } from '../store/domainSlices';

// Экран рендерится напрямую, минуя lazyScreen, — стор подключает тест
attachDomainSlices();

/**
 * Состояния экрана «Склад» и его раскладка на планшете.
 *
 * ЗАЧЕМ. «Склад» — экран пилота, работают с ним с планшета. Две вещи ломались
 * молча и обе выглядели как рабочий экран:
 *
 *  1. Скелетона не было вовсе. Пока данные едут, страница пуста — неотличимо
 *     от «задач склада нет». Правило UX-2 требует «ошибка → скелетон → пусто»,
 *     и скелетон висит на `!loaded && !loadError`, а не на `loading`: при сбое
 *     `loading` уже false, и экран замер бы навсегда.
 *  2. Пустое состояние не различало «работы нет» и «фильтр всё отсеял», а
 *     сбросить подбор было нечем — человек видел серую строку и уходил.
 *
 *  3. Ниже 1024px рисовалась та же таблица из шести колонок: колонка
 *     «Действие» уезжала за край экрана, то есть кнопка, ради которой на этот
 *     экран и приходят, была не видна. Комментарий в `playwright.config.ts`
 *     при этом утверждал, что экран показывает карточки, — их не было.
 */

const DEPTS = [
  { id: 'd-sew', code: 'sewing', name: 'Швейный цех', active: true, is_production: true },
];

const ORDER = {
  id: 'o1', bitrix_id: '4821', title: 'Худи «Ромашка»', status: 'active',
  materials: [{ id: 'm1', name: 'Футер 3-нитка' }],
  items: [{ id: 'i1', product_type: 'Худи', variant: 'чёрное', qty: 500, stages: [] }],
  warehouse_tasks: [
    {
      id: 'wt1', order_id: 'o1', task_type: 'material_receipt',
      status: 'awaiting', deadline: '2026-07-28', created_at: '2026-07-20T09:00:00Z',
    },
    {
      id: 'wt2', order_id: 'o1', task_type: 'pack_ship',
      status: 'shipped', deadline: '2026-07-30', created_at: '2026-07-21T09:00:00Z',
    },
  ],
};

const loadAll = vi.fn(async () => true);
const loadSubcontracting = vi.fn(async () => true);

/** Базовое состояние стора; каждый тест доопределяет только своё */
function setStore(patch) {
  useErpStore.setState({
    departments: DEPTS,
    orders: [],
    loaded: true,
    loadError: null,
    loadAll,
    loadSubcontracting,
    subcontractingLoaded: true,
    subcontracting: [],
    ...patch,
  });
}

/**
 * Компактная раскладка включается `matchMedia` — в jsdom его нет вовсе,
 * поэтому `useMediaQuery` по умолчанию отдаёт false (десктоп). Здесь мы его
 * заводим, чтобы проверить именно ту ветку, которой на планшете и нет.
 */
function mockCompact(matches) {
  window.matchMedia = (query) => ({
    matches,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });
}

const renderScreen = () => render(<MemoryRouter><Warehouse /></MemoryRouter>);

beforeEach(() => {
  loadAll.mockClear();
  loadSubcontracting.mockClear();
  setStore({});
});

afterEach(() => {
  delete window.matchMedia;
});

describe('«Склад»: три состояния экрана', () => {
  it('пока данные едут — скелетон, а не пустая страница', () => {
    setStore({ loaded: false, loadError: null });
    renderScreen();
    expect(screen.getByRole('status', { name: /Загрузка задач склада/ })).toBeInTheDocument();
  });

  it('при сбое загрузки — ошибка с повтором, и скелетона больше нет', () => {
    // `loading` при сбое уже false: скелетон, повешенный на него, замер бы навсегда
    setStore({ loaded: false, loadError: 'network' });
    renderScreen();
    expect(screen.getByRole('alert')).toHaveTextContent(/Не удалось загрузить задачи склада/);
    expect(screen.queryByRole('status', { name: /Загрузка задач склада/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    expect(loadAll).toHaveBeenCalled();
  });

  it('задач нет вовсе — объяснение, откуда они берутся', () => {
    setStore({ orders: [{ ...ORDER, warehouse_tasks: [] }] });
    renderScreen();
    expect(screen.getByText('Задач склада нет')).toBeInTheDocument();
    expect(screen.getByText(/приёмку материалов заводит закупка/)).toBeInTheDocument();
    // Это НЕ «ничего не найдено»: сбрасывать нечего
    expect(screen.queryByRole('button', { name: /Сбросить/ })).not.toBeInTheDocument();
  });

  it('задачи есть, но подбор их отсеял — другой текст и кнопка сброса', () => {
    setStore({ orders: [ORDER] });
    renderScreen();
    // Поиск, под который не подходит ни одна задача
    fireEvent.change(screen.getByLabelText('Поиск задач склада'), { target: { value: 'zzz' } });
    expect(screen.getByText(/Ничего не найдено по запросу «zzz»/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
    /**
     * Сброс снимает и «Только открытые»: чаще всего задача не пропала,
     * а закрылась, и прячет её именно эта галочка. Поэтому строк становится
     * ДВЕ — вместе с отгруженной упаковкой, которой не было и до поиска.
     */
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(3); // шапка + две задачи
    expect(rows[2]).toHaveTextContent('Упаковка и отгрузка');
  });
});

describe('«Склад»: раскладка планшета', () => {
  it('на широком экране — таблица', () => {
    mockCompact(false);
    setStore({ orders: [ORDER] });
    const { container } = renderScreen();
    expect(container.querySelector('table')).not.toBeNull();
  });

  it('на планшете — карточки, и кнопка с операцией у каждой', () => {
    mockCompact(true);
    setStore({ orders: [ORDER] });
    const { container } = renderScreen();

    // Таблицы нет вовсе: именно её шестая колонка уезжала за край экрана
    expect(container.querySelector('table')).toBeNull();

    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(1); // по умолчанию видны только открытые
    expect(cards[0]).toHaveAccessibleName(/Приёмка материалов — заказ Худи/);
    // Действие называет операцию (правка 05.10, п. 8), а не «Открыть» у всех
    expect(screen.getByRole('button', { name: 'Принять материал' })).toBeInTheDocument();
  });

  it('карточка подписывает поля — вместе с шапкой таблицы исчезают названия колонок', () => {
    mockCompact(true);
    setStore({ orders: [ORDER] });
    renderScreen();
    const card = screen.getByRole('article');
    expect(card).toHaveTextContent('Содержимое');
    expect(card).toHaveTextContent('Срок');
    expect(card).toHaveTextContent('№4821');
  });
});

/**
 * §3.4 обхода 04.09: колонка «Срок» читала только `erp_warehouse_tasks.deadline`,
 * а его не ставит НИКТО — на боевой базе он пуст у всех 84 задач, включая
 * маркировку, где поле ввода есть. Колонка стояла прочерками, а величина,
 * по которой склад расставляет приоритет, — срок сдачи ЗАКАЗА — не была видна
 * нигде. Показывается в ОБЕИХ раскладках: подпись живёт в одном месте.
 */
describe('Склад — срок задачи', () => {
  const withoutOwn = {
    ...ORDER, due_date: '2026-08-15',
    warehouse_tasks: [{ ...ORDER.warehouse_tasks[0], deadline: null }],
  };

  it.each([
    ['планшет (карточки)', true],
    ['десктоп (таблица)', false],
  ])('%s: своего срока нет — показан срок заказа и назван', (_n, compact) => {
    mockCompact(compact);
    setStore({ orders: [withoutOwn] });
    renderScreen();
    expect(screen.getByText(/срок заказа/)).toBeInTheDocument();
  });

  it('свой срок задачи сильнее и чужим не подписан', () => {
    mockCompact(false);
    setStore({ orders: [{ ...withoutOwn, warehouse_tasks: [ORDER.warehouse_tasks[0]] }] });
    renderScreen();
    expect(screen.queryByText(/срок заказа/)).not.toBeInTheDocument();
  });
});

/**
 * РАБОЧИЙ ЭКРАН СКЛАДА (правка заказчика 05.10, п. 8) и переход из закупки
 * (п. 7). Проверки постановки: «в списке несколько страниц, найти „Тест
 * новый" без перебора страниц; во вкладке материалов нет отгрузок
 * и приёмок готовых изделий; принять поставку — поиск и вкладка
 * сохраняются, закрытая задача исчезает из открытых; без даты поставки
 * „не задан", срок заказа отдельно; в отгрузке кнопка „Отгрузить"».
 */
describe('Склад — вкладки, поиск, адрес', () => {
  const mat = (i, patch = {}) => ({
    id: `m${i}`, name: `Кулирка ${i}`, kind: 'fabric', unit: 'кг', color: 'чёрный',
    supplier: 'Астра', qty_expected: 100, qty_received: null, eta_date: null, ...patch,
  });
  const receipt = (i, patch = {}) => ({
    id: `r${i}`, order_id: 'o9', task_type: 'material_receipt', material_id: `m${i}`,
    status: 'awaiting', deadline: null, created_at: `2026-10-01T09:${String(i).padStart(2, '0')}:00Z`,
    ...patch,
  });
  const MATS = Array.from({ length: 14 }, (_, i) => mat(i + 1));
  MATS[13] = mat(14, { name: 'Тест новый', eta_date: '2026-10-09' });
  const BIG = {
    id: 'o9', bitrix_id: '9001', title: 'Большой заказ', status: 'active', due_date: '2026-10-20',
    materials: MATS, items: [{ id: 'i9', product_type: 'Худи', qty: 50, stages: [] }],
    warehouse_tasks: [
      ...MATS.map((_, i) => receipt(i + 1)),
      { id: 'ship', order_id: 'o9', task_type: 'pack_ship', status: 'ready_to_ship', created_at: '2026-10-02T09:00:00Z' },
      { id: 'fg', order_id: 'o9', task_type: 'fg_receipt', status: 'awaiting', created_at: '2026-10-02T09:00:00Z' },
    ],
  };

  /** Текущий адрес — его пишет эффект, а не рендер (правило react-hooks) */
  const where = { loc: null };
  function Spy() {
    const l = useLocation();
    useEffect(() => { where.loc = l; });
    return null;
  }
  const renderAt = (url) => render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/warehouse" element={<><Warehouse /><Spy /></>} />
        <Route path="/purchasing" element={<Spy />} />
      </Routes>
    </MemoryRouter>,
  );
  const sp = () => new URLSearchParams(where.loc.search);

  beforeEach(() => {
    mockCompact(false);
    setStore({ orders: [BIG] });
  });

  it('рабочие вкладки — операции склада, «Все» отдельно', () => {
    renderAt('/warehouse');
    for (const name of ['Все', 'Приёмка материалов', 'Готовые изделия', 'Подряд', 'Отгрузка']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
  });

  it('во вкладке материалов нет отгрузок и приёмок готовых изделий', () => {
    renderAt('/warehouse?tab=materials');
    expect(screen.queryByRole('button', { name: 'Отгрузить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Принять изделия' })).toBeNull();
    // Колонки вкладки — про поставку
    const heads = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(heads.join('|')).toMatch(/Материал и цвет.*К приёмке.*Срок поставки/);
  });

  it('«Тест новый» на последней странице находится поиском без перебора', () => {
    renderAt('/warehouse?tab=materials');
    expect(screen.queryByText('Тест новый')).toBeNull(); // не на первой странице
    fireEvent.change(screen.getByLabelText('Поиск задач склада'), { target: { value: 'Тест новый' } });
    expect(screen.getByText('Тест новый')).toBeInTheDocument();
    expect(sp().get('q')).toBe('Тест новый');
    expect(sp().get('tab')).toBe('materials');
  });

  it('смена поиска возвращает на первую страницу', () => {
    renderAt('/warehouse?tab=materials&page=2');
    fireEvent.change(screen.getByLabelText('Поиск задач склада'), { target: { value: 'кул' } });
    expect(sp().has('page')).toBe(false);
  });

  it('без даты поставки — «не задан», срок заказа отдельной подписью', () => {
    renderAt('/warehouse?tab=materials');
    const row = screen.getAllByRole('row').find((r) => r.textContent.includes('Кулирка 1 '));
    expect(within(row).getByText('не задан')).toBeInTheDocument();
    expect(within(row).getByText('срок заказа 20.10.2026')).toBeInTheDocument();
    expect(within(row).getByText('100 кг')).toBeInTheDocument();
    expect(within(row).getByText(/поставщик: Астра/)).toBeInTheDocument();
  });

  it('фильтр по сроку оставляет задачи с ближайшей поставкой', () => {
    renderAt('/warehouse?tab=materials&due=week');
    expect(screen.getByText('Тест новый')).toBeInTheDocument();
    expect(screen.queryByText(/Кулирка 1\b/)).toBeNull();
  });

  it('в отгрузке кнопка «Отгрузить»; кнопка открывает форму, а не проводит операцию', () => {
    renderAt('/warehouse?tab=shipping');
    fireEvent.click(screen.getByRole('button', { name: 'Отгрузить' }));
    expect(sp().get('task')).toBe('ship');
    expect(screen.getByRole('dialog', { name: 'Упаковка и отгрузка' })).toBeInTheDocument();
  });

  it('открытая задача в адресе; закрытие оставляет вкладку, поиск и страницу', () => {
    renderAt('/warehouse?tab=materials&q=кул&page=2&task=r3');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(sp().get('task')).toBeNull();
    expect(sp().get('tab')).toBe('materials');
    expect(sp().get('q')).toBe('кул');
    expect(sp().get('page')).toBe('2');
  });

  it('принятая задача уходит из открытых, вкладка и поиск остаются', () => {
    renderAt('/warehouse?tab=materials&q=Тест');
    expect(screen.getByText('Тест новый')).toBeInTheDocument();
    // Приёмка сохранена: стор перечитал заказ, задача закрыта
    act(() => {
      setStore({ orders: [{ ...BIG, warehouse_tasks: BIG.warehouse_tasks.map((t) => (t.id === 'r14' ? { ...t, status: 'accepted' } : t)) }] });
    });
    expect(screen.queryByRole('button', { name: 'Принять ткань' })).toBeNull();
    expect(sp().get('q')).toBe('Тест');
  });

  it('из закупки: приёмка открыта сразу, «← К закупке» и закрытие ведут обратно', () => {
    const back = encodeURIComponent('supply=o9&q=кул&page=2');
    renderAt(`/warehouse?task=r14&from=purchasing&supply=o9&back=${back}`);
    const dialog = screen.getByRole('dialog', { name: 'Приёмка материалов' });
    expect(dialog.className).toMatch(/drawerPanelWide/);
    expect(within(dialog).getByRole('link', { name: /К закупке/ }))
      .toHaveAttribute('href', '/purchasing?supply=o9&q=кул&page=2');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    expect(where.loc.pathname).toBe('/purchasing');
    expect(where.loc.search).toBe('?supply=o9&q=кул&page=2');
  });
});
