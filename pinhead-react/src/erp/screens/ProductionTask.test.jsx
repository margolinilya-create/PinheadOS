import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProductionTask from './ProductionTask';
import { useErpStore } from '../store/useErpStore';
import { attachDomainSlices } from '../store/domainSlices';

attachDomainSlices();

/**
 * §6.2 обхода 04.09 (блокер Б4): страница задания монтирует ту же панель
 * действий, что строка очереди, и своей роли не имела. Очередь отвечает
 * «что взять следующим», страница — «работаю над этим», а отвечать на второй
 * вопрос она начинала ТРЕТЬИМ экраном: сверху справка «Задание» и «Маршрут
 * и прогресс», ТЗ и кнопки под ними. На 768×1024, ради которых пилот
 * и запущен, это прокрутка до того, ради чего сюда пришли.
 *
 * Сторож смотрит ПОЛОЖЕНИЕ В ДОКУМЕНТЕ: наличие блока было и до правки.
 */

const DEPT = {
  id: 'd1', code: 'sewing', name: 'Швейный цех',
  is_production: true, active: true, sort_order: 1, gate_material_kinds: [],
};
const STAGE = {
  id: 'st1', item_id: 'i1', department_id: 'd1', status: 'in_progress',
  qty_done: 10, qty_rework: 0, depends_on: [], sort_order: 10,
  planned_end: null, started_at: null, finished_at: null, executor: 'internal',
};
const ORDER = {
  id: 'o1', bitrix_id: '4821', title: 'Худи «Ромашка»', status: 'active',
  due_date: '2026-09-30', launch_date: '2026-09-01', tz_required: false,
  materials: [], procurement_tasks: [], attachments: [], warehouse_tasks: [],
  items: [{ id: 'i1', order_id: 'o1', product_type: 'Худи', variant: 'чёрное', qty: 100, stages: [STAGE], prints: [] }],
};

beforeEach(() => {
  useErpStore.setState({
    orders: [ORDER],
    departments: [DEPT],
    loaded: true,
    loadError: null,
    loadAll: vi.fn(async () => true),
    loadOne: vi.fn(async () => true),
    myDeptId: 'd1',
    myDeptLoaded: true,
    myRole: 'worker',
    bootstrapLoaded: true,
    permissionsLoaded: true,
    permissionMatrix: null,
    bypasses: [],
    planSlots: [],
    employees: [],
    employeesLoaded: true,
    loadEmployees: vi.fn(async () => true),
    loadStageReworkEvents: vi.fn(async () => ({})),
  });
});

const renderTask = () => render(
  <MemoryRouter initialEntries={['/task/st1']}>
    <Routes><Route path="/task/:stageId" element={<ProductionTask />} /></Routes>
  </MemoryRouter>,
);

describe('страница производственного задания', () => {
  it('ТЗ и действия стоят выше справки и маршрута', () => {
    renderTask();
    const tz = screen.getByText('ТЗ и действия');
    const facts = screen.getByText('Задание');
    const route = screen.getByText('Маршрут и прогресс');
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(tz.compareDocumentPosition(facts) & FOLLOWING).toBeTruthy();
    expect(tz.compareDocumentPosition(route) & FOLLOWING).toBeTruthy();
  });

  /** Справка не убрана — она уехала вниз: к ней возвращаются глазами */
  it('справка и маршрут остались на странице', () => {
    renderTask();
    expect(screen.getByText('Задание')).toBeInTheDocument();
    expect(screen.getByText('Маршрут и прогресс')).toBeInTheDocument();
  });
});

/**
 * ПРАВКА ЗАКАЗЧИКА 13.09, П. 4: экран задания приведён к компактной рабочей
 * структуре по референсу.
 *
 * «Вверху — название этапа/изделия и статус; отдельной компактной строкой —
 * ключевая информация по заказу: заказ, изделие, количество, выполнено, срок
 * завершения; слева — блок „ТЗ и действия"… справа — „Маршрут и прогресс";
 * ниже — компактный блок „Задание" только с рабочими данными этапа… Пустые
 * значения с „—" в режиме просмотра не выводить».
 */
describe('страница задания — раскладка 13.09', () => {
  it('ключевая строка заказа стоит ВЫШЕ «ТЗ и действий»', () => {
    renderTask();
    const key = screen.getByText('Выполнено');
    const tz = screen.getByText('ТЗ и действия');
    expect(key.compareDocumentPosition(tz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // и несёт ровно то, что названо в документе
    for (const label of ['Заказ', 'Изделие', 'Количество', 'Выполнено', 'Срок']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('блок «Задание» больше не повторяет заказ, клиента и менеджера', () => {
    renderTask();
    const facts = screen.getByText('Задание').closest('section');
    expect(facts).not.toBeNull();
    // Они теперь в строке выше и в карточке заказа: дважды отвечать
    // на один вопрос дефинишн-листом незачем
    for (const gone of ['Клиент', 'Менеджер', 'Срок клиента']) {
      expect(facts.textContent).not.toContain(gone);
    }
    // Рабочие данные этапа остались
    expect(facts.textContent).toContain('Исполнитель');
  });

  it('пустые значения не выводятся прочерком', () => {
    renderTask();
    const facts = screen.getByText('Задание').closest('section');
    // У фикстуры нет ни материалов, ни плановой даты, ни переделки
    expect(facts.textContent).not.toContain('План этапа');
    expect(facts.textContent).not.toContain('Материал');
    expect(facts.textContent).not.toContain('Материалы не ожидаются');
    // И блока файлов нет вовсе, а не «Файлов пока нет»
    expect(screen.queryByText('Файлы')).not.toBeInTheDocument();
  });

  it('заполненное показывается', () => {
    useErpStore.setState({
      orders: [{
        ...ORDER,
        items: [{
          ...ORDER.items[0],
          stages: [{ ...STAGE, planned_end: '2026-09-25', assignee: 'Пётр' }],
        }],
      }],
    });
    renderTask();
    const facts = screen.getByText('Задание').closest('section');
    expect(facts.textContent).toContain('План этапа');
    expect(facts.textContent).toContain('Пётр');
  });

  /**
   * П. 9: у этапа с файловым результатом количества нет вовсе — «Выполнено»
   * показывало бы вечные «0 из 100 шт».
   */
  it('у этапа-программы вышивки вместо «Выполнено» — состояние файла', () => {
    useErpStore.setState({
      orders: [{
        ...ORDER,
        items: [{
          ...ORDER.items[0],
          stages: [{ ...STAGE, qty_done: 0, result_kind: 'embroidery_program' }],
        }],
      }],
    });
    renderTask();
    expect(screen.queryByText('Выполнено')).not.toBeInTheDocument();
    expect(screen.getByText('Результат')).toBeInTheDocument();
    expect(screen.getByText('нет программы')).toBeInTheDocument();
  });

  /**
   * Правка 14.09, п. 5: вход в переписку СО СТРАНИЦЫ ЗАДАНИЯ, с контекстом
   * задачи. Кнопка раскрывает чат здесь же — увод на карточку заказа стоил
   * бы цеху возврата и потерянного места, а пришёл он сюда работать.
   */
  /**
   * С правки 20.09 (п. 4) чат открывается ОКНОМ ПОВЕРХ ERP, а не
   * раскрывается на месте: «на компьютере открывать чат в отдельном окне
   * поверх ERP». Раскрытая лента уводила вниз маршрут, файлы и комментарии —
   * чтобы ответить, приходилось терять из виду само задание.
   *
   * Само окно монтируется в оболочке раздела, поэтому здесь проверяется
   * то, за что отвечает страница: кнопка просит открыть переписку ИМЕННО
   * ЭТОЙ задачи.
   */
  it('обсуждение задачи открывается окном, с контекстом этапа', async () => {
    const openChatWindow = vi.fn();
    useErpStore.setState({
      openChatWindow,
      loadChatUnread: vi.fn(async () => {}),
      chatUnread: {},
    });
    renderTask();

    fireEvent.click(screen.getByRole('button', { name: /Открыть чат/ }));
    await waitFor(() => expect(openChatWindow).toHaveBeenCalled());

    // Контекст — ЭТАП: пустой открыл бы общую переписку сделки, и счётчик
    // задачи гасился бы просмотром чужих сообщений
    const [orderId, , context] = openChatWindow.mock.calls.at(-1);
    expect(orderId).toBe(ORDER.id);
    expect(context).toEqual({ stageId: STAGE.id });
  });
});
