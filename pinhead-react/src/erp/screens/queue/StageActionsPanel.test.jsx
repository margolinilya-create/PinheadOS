import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StageActionsPanel } from './StageActionsPanel';

/**
 * Действия цеха над заданием — общий компонент строки очереди и страницы
 * производственного задания.
 *
 * Ключевое здесь — контракт payload у onDefect: форма брака переехала из
 * панели в пошаговый DefectWizard, и состав объекта не должен был измениться.
 */

/** Все права выданы: гейты матрицы проверяются отдельно, здесь — поведение формы */
const ALL_PERMS = { any: true, take: true, progress: true, complete: true, block: true, defect: true };

const ORDER = {
  id: 'o1',
  title: 'Худи «Ромашка»',
  bitrix_id: '4821',
  due_date: '2026-08-30',
  packaging: 'none',
  stickers: 'none',
  attachments: [],
  materials: [],
  procurement_tasks: [],
};

const OTHER_STAGE = { id: 's2', department_id: 'd2', status: 'done' };

function makeEntry(group, patch = {}) {
  const stage = {
    id: 's1',
    department_id: 'd1',
    status: group === 'done' ? 'done' : group === 'blocked' ? 'blocked' : group,
    qty_done: 0,
    qty_rework: 0,
    planned_end: null,
    block_reason: group === 'blocked' ? 'Нет ниток' : null,
    overdue_ack_at: null,
    overdue_comment: null,
    ...patch,
  };
  const item = { id: 'i1', product_type: 'Худи', variant: null, qty: 10, stages: [stage, OTHER_STAGE] };
  return { order: ORDER, item, stage, reason: null, group };
}

const DEPT_SHORT = new Map([['d2', 'Закрой']]);

function renderCard(entry, { perms = ALL_PERMS } = {}) {
  const handlers = {
    onStart: vi.fn(), onDone: vi.fn(), onProgress: vi.fn(), onBlock: vi.fn(),
    onUnblock: vi.fn(), onDefect: vi.fn(), onAckOverdue: vi.fn(),
  };
  render(
    <MemoryRouter>
      <StageActionsPanel
        entry={entry}
        perms={perms}
        deptShortById={DEPT_SHORT}
        actions={handlers}
        showTz={false}
      />
    </MemoryRouter>,
  );
  return handlers;
}

describe('StageActionsPanel — действия по группам', () => {
  it('ready: «Взять в работу» и «Проблема»', () => {
    renderCard(makeEntry('ready'));
    expect(screen.getByRole('button', { name: /Взять в работу/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Проблема/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Завершить этап/ })).toBeNull();
  });

  it('in_progress: «Частично», «Готово», «Брак», «Проблема»', () => {
    renderCard(makeEntry('in_progress'));
    for (const name of [/Записать результат/, /Завершить этап/, /Брак/, /Проблема/]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('done: только «Брак / переделка»', () => {
    renderCard(makeEntry('done'));
    expect(screen.getByRole('button', { name: /Брак \/ переделка/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Взять в работу/ })).toBeNull();
  });

  it('blocked: «Снять блокировку» вызывает onUnblock', async () => {
    const handlers = renderCard(makeEntry('blocked'));
    fireEvent.click(screen.getByRole('button', { name: 'Снять блокировку' }));
    await waitFor(() => expect(handlers.onUnblock).toHaveBeenCalledTimes(1));
  });

  it('без прав матрицы кнопок нет', () => {
    renderCard(makeEntry('ready'), {
      perms: { any: false, take: false, progress: false, complete: false, block: false, defect: false },
    });
    expect(screen.queryByRole('button', { name: /Взять в работу/ })).toBeNull();
  });

  it('снятое право «Оформлять брак» убирает кнопку, остальные остаются', () => {
    renderCard(makeEntry('in_progress'), { perms: { ...ALL_PERMS, defect: false } });
    expect(screen.queryByRole('button', { name: /^Брак$/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Проблема/ })).toBeInTheDocument();
  });

  /**
   * Правка заказчика 30.08, п. 9. Раньше «Взять в работу» лишь ОТКРЫВАЛА
   * форму плана, а действие выполняла вторая кнопка «В работу» — со стороны
   * цеха это выглядело как «нажал, ничего не произошло, нажал ещё раз».
   * Поле плана осталось (решение сессии 39 «дату спрашивают все входы
   * в работу»), но стоит рядом с кнопкой и предзаполнено.
   */
  it('«Взять в работу» срабатывает С ПЕРВОГО нажатия и передаёт дату', async () => {
    const handlers = renderCard(makeEntry('ready'));
    const date = screen.getByLabelText('Плановая дата завершения');
    expect(date.value).toBeTruthy();   // предзаполнено, а не пусто
    fireEvent.change(date, { target: { value: '2026-08-20' } });
    fireEvent.click(screen.getByRole('button', { name: /Взять в работу/ }));
    await waitFor(() => expect(handlers.onStart).toHaveBeenCalledWith(expect.objectContaining({ group: 'ready' }), '2026-08-20'));
    expect(handlers.onStart).toHaveBeenCalledTimes(1);
  });

  it('второй кнопки для взятия в работу больше нет', () => {
    // Сторож на возврат двухшагового потока: именно он и был дефектом
    renderCard(makeEntry('ready'));
    expect(screen.queryByRole('button', { name: /^В работу$/ })).toBeNull();
  });

  it('«Проблема» требует текст и передаёт его в onBlock', async () => {
    const handlers = renderCard(makeEntry('ready'));
    fireEvent.click(screen.getByRole('button', { name: /Проблема/ }));
    const block = screen.getByRole('button', { name: 'Заблокировать' });
    expect(block).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/брак кроя/i), { target: { value: 'Порвался нож' } });
    fireEvent.click(screen.getByRole('button', { name: 'Заблокировать' }));
    await waitFor(() => expect(handlers.onBlock).toHaveBeenCalledWith(expect.anything(), 'Порвался нож', null));
  });
});

/**
 * Поле «сколько сдано» было предзаполнено всем остатком, и один тап по «Записать
 * результат» уводил qty_done в полный тираж: reportProgress при newDone >= total
 * закрывает этап и открывает следующий цех. То есть кнопка молча делала то, что
 * соседняя «Завершить этап» делает через confirmStageDone. Цена ошибки — тираж,
 * которого физически нет, у следующего цеха.
 */
describe('StageActionsPanel — запись частичной готовности', () => {
  it('поле пустое, кнопка выключена, пока число не введено', () => {
    renderCard(makeEntry('in_progress'));
    const input = screen.getByRole('spinbutton', { name: /Сколько сделано/ });
    expect(input).toHaveValue(null);
    expect(screen.getByRole('button', { name: /Записать результат/ })).toBeDisabled();
  });

  it('в подсказке и метке — остаток, а не весь тираж', () => {
    renderCard(makeEntry('in_progress', { qty_done: 4 }));
    const input = screen.getByRole('spinbutton', { name: /осталось 6 из 10/ });
    expect(input).toHaveAttribute('placeholder', 'из 6');
    expect(input).toHaveAttribute('max', '6');
  });

  it('передаёт в onProgress введённое число, а не остаток', async () => {
    const handlers = renderCard(makeEntry('in_progress'));
    fireEvent.change(screen.getByRole('spinbutton', { name: /Сколько сделано/ }), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Записать результат/ }));
    await waitFor(() => expect(handlers.onProgress).toHaveBeenCalledWith(expect.anything(), 4));
  });

  it('после записи поле снова пустое — следующее число вводится осознанно', async () => {
    const handlers = renderCard(makeEntry('in_progress'));
    const input = screen.getByRole('spinbutton', { name: /Сколько сделано/ });
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /Записать результат/ }));
    await waitFor(() => expect(handlers.onProgress).toHaveBeenCalled());
    await waitFor(() => expect(input).toHaveValue(null));
  });
});

describe('StageActionsPanel — мастер брака', () => {
  let handlers;
  beforeEach(() => {
    handlers = renderCard(makeEntry('in_progress'));
    fireEvent.click(screen.getByRole('button', { name: /^Брак$/ }));
  });

  const wizard = () => screen.getByRole('dialog', { name: 'Брак / переделка' });

  it('открывается боковой панелью с первым шагом', () => {
    expect(wizard()).toBeInTheDocument();
    expect(screen.getByLabelText(/Сколько штук в брак/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Причина брака/)).toBeInTheDocument();
  });

  it('«Далее» заблокировано, пока не заполнены количество и причина', () => {
    const next = screen.getByRole('button', { name: 'Далее' });
    expect(next).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Сколько штук в брак/), { target: { value: '3' } });
    expect(next).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Причина брака/), { target: { value: 'Пятно' } });
    expect(next).toBeEnabled();
  });

  it('количество больше, чем в позиции, показывает ошибку и не пускает дальше', () => {
    fireEvent.change(screen.getByLabelText(/Сколько штук в брак/), { target: { value: '99' } });
    fireEvent.change(screen.getByLabelText(/Причина брака/), { target: { value: 'Пятно' } });
    expect(screen.getByText('В позиции всего 10 шт')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Далее' })).toBeDisabled();
  });

  it('второй шаг предлагает вернуть на другой этап маршрута', () => {
    fireEvent.change(screen.getByLabelText(/Сколько штук в брак/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Причина брака/), { target: { value: 'Пятно' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));

    const select = screen.getByLabelText('Где устранять');
    expect(within(select).getByText('Вернуть: Закрой')).toBeInTheDocument();
    expect(within(select).getByText('На закупку (материал испорчен)')).toBeInTheDocument();
    expect(within(select).getByText('Отправить подрядчику')).toBeInTheDocument();
  });

  it('простой случай: payload сохраняет прежний состав', async () => {
    fireEvent.change(screen.getByLabelText(/Сколько штук в брак/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Причина брака/), { target: { value: 'Кривая строчка' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    fireEvent.click(screen.getByRole('button', { name: 'В переделку' }));

    await waitFor(() => expect(handlers.onDefect).toHaveBeenCalledTimes(1));
    const [, payload, photo] = handlers.onDefect.mock.calls[0];
    expect(payload).toEqual({
      qty: 2,
      reason: 'Кривая строчка',
      target: 'current',
      needsMaterial: false,
      cause: 'other',
      supplier: null,
      plannedDate: null,
      materialName: null,
      subcontractOperation: null,
      contractor: null,
      /*
       * СОСТАВ РАСШИРЕН 23.08 — осознанно. Возврат брака переводит этап
       * в работу, и до этой правки он делал это, не спрашивая план завершения
       * вовсе: такой этап выпадал из контроля сроков целиком. Поле идёт
       * с подстановкой (`defaultPlannedEnd`), поэтому в payload оно НЕ пустое
       * даже когда человек ничего не трогал: у фикстуры нет ни норматива,
       * ни срока заказа, значит предлагается сегодня.
       *
       * `plannedDate` рядом — ДРУГОЕ поле: срок замены материала в задаче
       * закупщику. Их легко перепутать, поэтому оба стоят в одном ожидании.
       */
      reworkPlannedEnd: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(photo).toBeNull();
  });

  /**
   * План переделки принадлежит ЭТАПУ-ПОЛУЧАТЕЛЮ, а не тому, кто нашёл брак.
   *
   * `reportDefect` разбирает это как `receiver = targetStage ?? stage`, и
   * второе прочтение того же правила в форме разошлось бы с первым молча:
   * дата уехала бы не тому этапу, и «Загрузка цехов» показала бы работу
   * не в том цехе.
   */
  it('план переделки спрашивается и уходит вместе с браком', async () => {
    fireEvent.change(screen.getByLabelText(/Сколько штук в брак/), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/Причина брака/), { target: { value: 'Перекроить' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));

    const plan = screen.getByLabelText('План завершения переделки');
    expect(plan, 'до 23.08 возврат брака дату не спрашивал вовсе').toBeInTheDocument();
    fireEvent.change(plan, { target: { value: '2026-09-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'В переделку' }));

    await waitFor(() => expect(handlers.onDefect).toHaveBeenCalledTimes(1));
    const [, payload] = handlers.onDefect.mock.calls[0];
    expect(payload.reworkPlannedEnd).toBe('2026-09-10');
  });

  it('подпись поля называет ЦЕХ-получателя — он меняется вместе с «Где устранять»', async () => {
    fireEvent.change(screen.getByLabelText(/Сколько штук в брак/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Причина брака/), { target: { value: 'Брак кроя' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));

    fireEvent.change(screen.getByLabelText('Где устранять'), { target: { value: 's2' } });
    // Подсказку `Field` рисует отдельным элементом и связывает через
    // aria-describedby — берём её по этой связи, а не по обёртке разметки
    const field = screen.getByLabelText('План завершения переделки');
    const hintId = field.getAttribute('aria-describedby');
    expect(document.getElementById(hintId)).toHaveTextContent('Кто делает: Закрой');
  });

  it('возврат подрядчику: операция и контрагент попадают в payload', async () => {
    fireEvent.change(screen.getByLabelText(/Сколько штук в брак/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Причина брака/), { target: { value: 'Перешить' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    fireEvent.change(screen.getByLabelText('Где устранять'), { target: { value: 'subcontractor' } });
    fireEvent.change(screen.getByLabelText('Операция подряда'), { target: { value: 'Перешив низа' } });
    fireEvent.change(screen.getByLabelText('Контрагент'), { target: { value: 'ООО Швейка' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить подрядчику' }));

    await waitFor(() => expect(handlers.onDefect).toHaveBeenCalledTimes(1));
    const [, payload] = handlers.onDefect.mock.calls[0];
    expect(payload).toMatchObject({
      target: 'subcontractor',
      subcontractOperation: 'Перешив низа',
      contractor: 'ООО Швейка',
    });
  });

  it('на закупку: needsMaterial форсится, материал и срок уходят в payload', async () => {
    fireEvent.change(screen.getByLabelText(/Сколько штук в брак/), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/Причина брака/), { target: { value: 'Прожгли ткань' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    fireEvent.change(screen.getByLabelText('Где устранять'), { target: { value: 'procurement' } });
    fireEvent.change(screen.getByLabelText('Материал'), { target: { value: 'Кулирка чёрная' } });
    fireEvent.change(screen.getByLabelText('Плановая дата замены'), { target: { value: '2026-08-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'В переделку + заявка' }));

    await waitFor(() => expect(handlers.onDefect).toHaveBeenCalledTimes(1));
    const [, payload] = handlers.onDefect.mock.calls[0];
    expect(payload).toMatchObject({
      target: 'procurement',
      needsMaterial: true,
      materialName: 'Кулирка чёрная',
      plannedDate: '2026-08-10',
    });
  });

  it('возврат «на закупку» форсит галку «нужен новый материал»', () => {
    fireEvent.change(screen.getByLabelText(/Сколько штук в брак/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Причина брака/), { target: { value: 'Прожгли' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));

    const check = screen.getByLabelText(/Нужен новый материал/);
    expect(check).not.toBeChecked();

    fireEvent.change(screen.getByLabelText('Где устранять'), { target: { value: 'procurement' } });
    // галка отражает факт: закупка нужна по определению, менять её нельзя
    expect(check).toBeChecked();
    expect(check).toBeDisabled();
  });

  it('«Назад» возвращает на первый шаг, «Отмена» закрывает мастер', () => {
    fireEvent.change(screen.getByLabelText(/Сколько штук в брак/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Причина брака/), { target: { value: 'Пятно' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    fireEvent.click(screen.getByRole('button', { name: /Назад/ }));
    expect(screen.getByLabelText(/Сколько штук в брак/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog', { name: 'Брак / переделка' })).toBeNull();
    expect(handlers.onDefect).not.toHaveBeenCalled();
  });
});

/**
 * ИЕРАРХИЯ ДЕЙСТВИЙ (обход 04.09). «Завершить этап» необратимо и пишет весь
 * тираж, «Записать результат» — обычная дневная сдача. Главной кнопкой стояло
 * ПЕРВОЕ: самая заметная цель на экране закрывала этап.
 *
 * Проверяется КЛАССОМ варианта, а не наличием кнопок: обе были на месте
 * и раньше — вопрос в том, какая из них выглядит главной.
 */
describe('иерархия действий этапа в работе', () => {
  it('главная кнопка — «Записать результат», а не «Завершить этап»', () => {
    renderCard(makeEntry('in_progress'));
    const progress = screen.getByRole('button', { name: /Записать результат/ });
    const complete = screen.getByRole('button', { name: /Завершить этап/ });
    // Классы CSS-модуля в тестах — прокси-заглушки с именем ключа
    expect(progress.className).toMatch(/primary/);
    expect(complete.className).not.toMatch(/primary/);
    expect(complete.className).toMatch(/secondary/);
  });
});
