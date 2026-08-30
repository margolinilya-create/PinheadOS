import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DevCard } from './DevCard';
import { useErpStore } from '../../store/useErpStore';
import { attachDomainSlices } from '../../store/domainSlices';

attachDomainSlices();

/**
 * Карточка разработки после правок 22.08.
 *
 * ЗДЕСЬ СТОРОЖИТСЯ ДВА ТРЕБОВАНИЯ, КОТОРЫЕ ЛЕГКО ПОТЕРЯТЬ:
 *
 * 1. П. 4.13 — «Построение лекал» нельзя закрыть без технического названия
 *    лекал. Проверка живёт в карточке, а не в списке задач: название
 *    принадлежит разработке, а `DevTasksSection` о ней не знает.
 * 2. П. 4.14 — введённое название попадает в финальный технический пакет
 *    само. Отдельного «переноса» не существует по построению: поле одно,
 *    `erp_experimental.pattern_tech_name`, и его же читает пакет. Тест
 *    проверяет именно это — что запись идёт в РАЗРАБОТКУ, а не в задачу.
 */

const confirmWithInput = vi.fn();
vi.mock('../../../store/useConfirmStore', () => ({
  confirm: vi.fn(async () => true),
  confirmWithInput: (...args) => confirmWithInput(...args),
}));

const DEPTS = [
  { id: 'd1', code: 'sewing', name: 'Швейный', active: true, is_production: true },
];

const task = (over = {}) => ({
  id: 't1', experimental_id: 'e1', task_type: 'patterns', title: null,
  responsible: null, due_date: null, status: 'in_progress', blocked_reason: null,
  depends_on: [], cycle: 0, sort_order: 10, qty: null, comment: null, result: null,
  department_id: null, stage_id: null, done_on: null,
  created_at: '', updated_at: '', ...over,
});

const DEV = {
  id: 'e1', order_id: 'o1', item_id: 'i1', tech_name: 'Худи Free Fit',
  technologist: 'Иванова', pattern_tech_name: null, outcome: null,
  tasks: [task()], attachments: [],
  order: { title: 'Худи', bitrix_id: '4821' },
};

const ORDER = { id: 'o1', bitrix_id: '4821', title: 'Худи', materials: [], items: [] };

function setup(devPatch = {}) {
  const onUpdate = vi.fn(async () => true);
  const onUpdateTask = vi.fn(async () => true);
  const onAddTasks = vi.fn(async () => [{ id: 'new' }]);
  useErpStore.setState({ departments: DEPTS, dictionaries: [] });
  render(
    <MemoryRouter>
      <DevCard
        dev={{ ...DEV, ...devPatch }}
        order={ORDER}
        departments={DEPTS}
        canManage
        onUpdate={onUpdate}
        onAddTasks={onAddTasks}
        onUpdateTask={onUpdateTask}
        onSendTask={vi.fn()}
        onClose={vi.fn()}
        onApproveSample={vi.fn()}
        onUploadFile={vi.fn()}
        onRemoveFile={vi.fn()}
      />
    </MemoryRouter>,
  );
  return { onUpdate, onUpdateTask, onAddTasks };
}

/**
 * Задачу этапа закрывает МАРШРУТ (правка 30.08, п. 3): блок «Задачи этапов»
 * показывает только дополнительные работы технолога, а обязательных задач
 * этапов больше не создаётся вовсе. Поэтому кнопка здесь — «Завершить лекала»
 * из «Основного маршрута разработки», а не «Готово» из таблицы задач.
 */
const completeStage = (label = 'Завершить лекала') => screen.getByRole('button', { name: label });

/** Первый диалог маршрута — «будут отмечены готовыми…», без ввода */
const confirmStage = () => confirmWithInput.mockResolvedValueOnce({ ok: true, value: '' });

beforeEach(() => {
  confirmWithInput.mockReset();
});

describe('построение лекал требует результата', () => {
  it('без названия лекал задача не закрывается', async () => {
    confirmStage();
    confirmWithInput.mockResolvedValue({ ok: false, value: '' });
    const { onUpdate, onUpdateTask } = setup();

    fireEvent.click(completeStage());

    await waitFor(() => expect(confirmWithInput).toHaveBeenCalledTimes(2));
    expect(onUpdate).not.toHaveBeenCalled();
    // Отказались вводить — задача осталась открытой
    expect(onUpdateTask).not.toHaveBeenCalled();
  });

  it('введённое название уходит В РАЗРАБОТКУ — это и есть перенос в пакет', async () => {
    confirmStage();
    confirmWithInput.mockResolvedValue({ ok: true, value: 'PNHD-T04-FreeFit-v1' });
    const { onUpdate, onUpdateTask } = setup();

    fireEvent.click(completeStage());

    await waitFor(() => expect(onUpdateTask).toHaveBeenCalled());
    expect(onUpdate).toHaveBeenCalledWith('e1', { pattern_tech_name: 'PNHD-T04-FreeFit-v1' });
    expect(onUpdateTask).toHaveBeenCalledWith('t1', { status: 'done' });
    // Порядок: название сохраняется ДО закрытия задачи, иначе результат
    // потеряется молча при отказе записи
    expect(onUpdate.mock.invocationCallOrder[0])
      .toBeLessThan(onUpdateTask.mock.invocationCallOrder[0]);
  });

  it('название уже есть — второй раз не спрашиваем', async () => {
    confirmStage();
    const { onUpdateTask } = setup({ pattern_tech_name: 'PNHD-T04-v1' });

    fireEvent.click(completeStage());

    await waitFor(() => expect(onUpdateTask).toHaveBeenCalled());
    // Ровно один диалог — подтверждение самого этапа, без вопроса о названии
    expect(confirmWithInput).toHaveBeenCalledTimes(1);
  });

  /** У задач других типов проверки нет: название описывает лекала */
  it('другой этап закрывает без вопросов о лекалах', async () => {
    confirmStage();
    // Название лекал НЕ задано — проверка привязана к типу задачи, а не
    // к тому, что поле заполнено
    const { onUpdateTask } = setup({ tasks: [task({ id: 't2', task_type: 'sewing_sample' })] });

    fireEvent.click(completeStage('Завершить пошив'));

    await waitFor(() => expect(onUpdateTask).toHaveBeenCalledWith('t2', { status: 'done' }));
    expect(confirmWithInput).toHaveBeenCalledTimes(1);
  });
});

/**
 * П. 3 документа 30.08: «блок „Задачи этапов" должен содержать только
 * дополнительные внутренние задачи». Обязательная задача этапа туда
 * не попадает — иначе рядом с маршрутом снова заведётся второй список
 * тех же строк.
 */
describe('блок задач показывает только дополнительные работы', () => {
  it('этапная задача в блоке не перечислена', () => {
    setup();
    expect(
      screen.getByText(/Дополнительных задач нет/),
      'этапная задача попала в блок дополнительных — это второй список тех же строк',
    ).toBeInTheDocument();
  });
});

/**
 * П. 4.16: «не нужно заставлять пользователя повторно выбирать одного и того же
 * технолога в каждой микро-задаче». Основной ответственный задан на уровне
 * разработки, у задачи он остаётся переопределяемым.
 */
describe('ответственный по умолчанию', () => {
  it('новая задача получает проработчика разработки', async () => {
    const { onAddTasks } = setup();

    // С правки 24.08 форма раскрывается кнопкой в шапке блока задач:
    // развёрнутая всегда, она отодвигала вниз саму работу
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить задачу' }));
    fireEvent.change(screen.getByLabelText('Тип задачи'), { target: { value: 'Примерка' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }));

    await waitFor(() => expect(onAddTasks).toHaveBeenCalled());
    expect(onAddTasks.mock.calls[0][0][0]).toMatchObject({ responsible: 'Иванова' });
  });
});

/**
 * ВКЛАДКИ И ПОСТОЯННАЯ СПРАВКА (референс заказчика 24.08).
 *
 * Сторожится не наличие подписей, а два свойства, которые легко потерять
 * при следующей правке раскладки:
 *  · «почему стоит» и «что делать дальше» видны на ЛЮБОЙ вкладке — правило
 *    проекта запрещает прятать их за переключателем;
 *  · вкладка живёт в адресе, иначе ссылку на финальный пакет не переслать.
 */
describe('вкладки карточки', () => {
  const BLOCKED = {
    tasks: [task({ status: 'blocked', blocked_reason: 'Нет ткани' })],
  };

  it('по умолчанию открыты «Задачи» — в карточку приходят работать', () => {
    setup();
    expect(screen.getByRole('tab', { name: /Задачи/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Основной маршрут разработки' })).toBeInTheDocument();
  });

  it('переключение вкладки меняет панель', () => {
    setup();
    fireEvent.click(screen.getByRole('tab', { name: /Финальный пакет/ }));
    expect(screen.getByRole('heading', { name: 'Другой итог разработки' })).toBeInTheDocument();
    // Панель именно переключилась, а не добавилась ниже
    expect(screen.queryByRole('heading', { name: 'Основной маршрут разработки' })).toBeNull();
  });

  it('блокер и следующее действие видны на ЛЮБОЙ вкладке', () => {
    setup(BLOCKED);
    const aside = screen.getByRole('complementary', { name: 'Справка по разработке' });
    expect(aside).toHaveTextContent('Нет ткани');

    fireEvent.click(screen.getByRole('tab', { name: /Финальный пакет/ }));
    expect(
      screen.getByRole('complementary', { name: 'Справка по разработке' }),
      'справка исчезла при переключении вкладки — «почему стоит» спрятано за переключателем',
    ).toHaveTextContent('Нет ткани');
  });

  it('панель связана с активной вкладкой для скринридера', () => {
    setup();
    const panel = document.getElementById('dev-tabpanel');
    expect(panel).toHaveAttribute('role', 'tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', 'dev-tab-tasks');
    expect(screen.getByRole('tab', { name: /Задачи/ })).toHaveAttribute('aria-controls', 'dev-tabpanel');
  });

  /**
   * `id` вкладок не должны совпадать с вкладками карточки заказа: два набора
   * с одинаковыми `id` — невалидный DOM и порванная связь панели со вкладкой.
   */
  it('вкладки несут свой префикс id', () => {
    setup();
    expect(screen.getByRole('tab', { name: /^Информация/ })).toHaveAttribute('id', 'dev-tab-info');
  });
});
