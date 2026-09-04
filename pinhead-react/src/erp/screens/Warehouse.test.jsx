import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

  it('на планшете — карточки, и кнопка «Открыть» у каждой', () => {
    mockCompact(true);
    setStore({ orders: [ORDER] });
    const { container } = renderScreen();

    // Таблицы нет вовсе: именно её шестая колонка уезжала за край экрана
    expect(container.querySelector('table')).toBeNull();

    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(1); // по умолчанию видны только открытые
    expect(cards[0]).toHaveAccessibleName(/Приёмка материалов — заказ Худи/);
    expect(screen.getByRole('button', { name: 'Открыть' })).toBeInTheDocument();
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
