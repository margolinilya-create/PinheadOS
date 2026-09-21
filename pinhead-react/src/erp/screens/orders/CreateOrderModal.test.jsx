import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CreateOrderModal } from './CreateOrderModal';
import { useErpStore } from '../../store/useErpStore';
import { attachDomainSlices } from '../../store/domainSlices';
import { supabase } from '../../../lib/supabase';
import { addDays, factoryToday } from '../../../utils/date';

/**
 * Форма монтируется НАПРЯМУЮ, минуя `lazyScreen`, — доменные действия надо
 * подключить самому. Без этого проверка дубля № сделки (`findOrdersByBitrixId`,
 * доменный слайс с 14.09) падала в отложенном на 400 мс таймере: тест
 * к этому моменту уже завершался, поэтому отказ приходил не падением спеки,
 * а «Uncaught Exception» в отчёте прогона — то есть был виден только тому,
 * кто читает лог до конца.
 */
attachDomainSlices();

/**
 * Форма создания заказа — до этой правки не покрытая ни одним тестом, хотя именно
 * она блокировала работу: ТЗ загружалось только по кнопке «Создать заказ», ключ
 * объекта Storage содержал кириллицу, и Supabase отвечал InvalidKey. Заказ
 * не создавался, а интерфейс до последнего показывал файл приложенным.
 *
 * Здесь проверяется контракт, а не вёрстка:
 *  — файл уходит в бакет сразу при выборе, с честным статусом;
 *  — пока он не загружен, «Создать заказ» недоступна;
 *  — сбой не рушит форму: перезаливается только файл;
 *  — payload RPC несёт секцию tz с реальным путём (раньше её не проверял никто).
 */

const DEPARTMENTS = [
  { id: 'd-cut', code: 'cutting', name: 'Закройный цех', active: true, is_production: true, sort_order: 50 },
  { id: 'd-sew', code: 'sewing', name: 'Швейный цех', active: true, is_production: true, sort_order: 70 },
  { id: 'd-vto', code: 'vto', name: 'ВТО цех', active: true, is_production: true, sort_order: 80 },
  { id: 'd-qc', code: 'qc', name: 'ОТК', active: true, is_production: true, sort_order: 85 },
];

/** Управляемый ответ Storage: тест решает, когда и чем завершится загрузка */
let uploadCalls;
let uploadResult;

function pdf(name) {
  return new File(['%PDF-1.4'], name, { type: 'application/pdf' });
}

function setup() {
  const createOrder = vi.fn().mockResolvedValue({ id: 'o-new' });
  useErpStore.setState({
    departments: DEPARTMENTS,
    orders: [],
    loaded: true,
    createOrder,
    // Автосейв черновика (22.08) ходит в стор каждые 500 мс: без этих двух
    // действий он падал бы на «не функция» — то есть тест проверял бы форму
    // с неработающим автосохранением и молчал об этом
    saveOrderDraft: vi.fn().mockResolvedValue({ id: 'draft-1' }),
    deleteOrderDraft: vi.fn().mockResolvedValue(true),
    /**
     * Подсказка поля «Менеджер» (правки 07.09, п. 1) грузит список сотрудников.
     * Действие приезжает доменным чанком через `lazyScreen`, а тест монтирует
     * форму напрямую — поэтому подставляем его здесь, как и `saveOrderDraft`
     * выше. Данные (`employees`/`profilesList`) живут в ядре стора.
     */
    employees: [
      { id: 'e1', full_name: 'Мария', role: 'production_head', active: true, profile_id: null },
      { id: 'e2', full_name: 'Швея Света', role: 'worker', active: true, profile_id: null },
    ],
    profilesList: [],
    employeesLoaded: true,
    loadEmployees: vi.fn().mockResolvedValue(undefined),
  });
  render(
    <MemoryRouter>
      <CreateOrderModal onClose={vi.fn()} />
    </MemoryRouter>,
  );
  return { createOrder };
}

/**
 * Минимально достаточный заказ: название + изделие + тираж + решение
 * по закупке.
 *
 * Отметка «Закупка не требуется» входит в минимум с 20.08: документ требует
 * ОДНО ИЗ ДВУХ — приложенный лист закупки или явную отметку, — и без этого
 * заказ создать нельзя. Здесь она нужна, чтобы проверки ТЗ проверяли ТЗ,
 * а не спотыкались о лист закупки.
 */
function fillRequired() {
  fireEvent.change(screen.getByPlaceholderText('напр. BOX39 свитшоты'), {
    target: { value: 'BOX39 футболки' },
  });
  fireEvent.change(screen.getByPlaceholderText('футболка'), {
    target: { value: 'Футболка' },
  });
  fireEvent.change(screen.getByLabelText(/Кол-во/), { target: { value: '100' } });
  fireEvent.click(screen.getByLabelText('Закупка не требуется'));
}

/** Выбор PDF через скрытый input рядом с кнопкой «+ ТЗ позиции (PDF)» */
function pickItemPdf(file) {
  const btn = screen.getByRole('button', { name: '+ ТЗ позиции (PDF)' });
  const input = btn.parentElement.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [file] } });
}

const submitBtn = () => screen.getByRole('button', { name: /Создать заказ|Создание…/ });

beforeEach(() => {
  uploadCalls = [];
  uploadResult = { data: { path: 'ok' }, error: null };
  vi.mocked(supabase.storage.from).mockImplementation((bucket) => ({
    upload: vi.fn(async (path, file, opts) => {
      uploadCalls.push({ bucket, path, name: file.name, opts });
      return uploadResult;
    }),
    remove: vi.fn().mockResolvedValue({ data: null, error: null }),
    getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://cdn.test/f.pdf' } })),
    list: vi.fn().mockResolvedValue({ data: [], error: null }),
  }));
  window.localStorage.clear();
});

describe('CreateOrderModal — ТЗ в PDF', () => {
  it('файл уходит в бакет сразу при выборе, ключ строго ASCII', async () => {
    setup();
    fillRequired();
    pickItemPdf(pdf('ТЗ[59746] Футболки Regular для склада_норм.pdf'));

    await waitFor(() => expect(uploadCalls).toHaveLength(1));
    expect(uploadCalls[0].bucket).toBe('erp-attachments');
    expect(uploadCalls[0].path)
      .toBe('tz/new/' + uploadCalls[0].path.split('/')[2]
        + '/v1-TZ_59746_Futbolki_Regular_dlya_sklada_norm.pdf');
    // Кириллица в ключе — это InvalidKey от Storage и несозданный заказ
    expect(uploadCalls[0].path).toMatch(/^[\w/.-]+$/);
    // upsert обязателен: путь детерминированный, повтор перезаписывает свой же файл
    expect(uploadCalls[0].opts).toMatchObject({ upsert: true, contentType: 'application/pdf' });

    expect(await screen.findByText(/ТЗ загружено/)).toBeInTheDocument();
  });

  it('пока файл грузится, «Создать заказ» недоступна', async () => {
    setup();
    fillRequired();

    // Заказ без ТЗ не создаётся — гейт заказчика остаётся
    expect(submitBtn()).toBeDisabled();

    let release;
    uploadResult = new Promise((resolve) => { release = resolve; });
    pickItemPdf(pdf('tz.pdf'));

    expect(await screen.findByText('Загружается…')).toBeInTheDocument();
    expect(submitBtn()).toBeDisabled();
    expect(screen.getByText('ТЗ загружается — дождитесь окончания')).toBeInTheDocument();

    release({ data: { path: 'ok' }, error: null });
    await waitFor(() => expect(submitBtn()).toBeEnabled());
  });

  it('сбой загрузки не рушит форму — перезаливается только файл', async () => {
    setup();
    fillRequired();
    uploadResult = { data: null, error: { message: 'Invalid key' } };
    pickItemPdf(pdf('tz.pdf'));

    expect(await screen.findByText(/не загрузилось: Invalid key/)).toBeInTheDocument();
    expect(submitBtn()).toBeDisabled();
    // Введённые данные на месте: заново заполнять заказ не нужно
    expect(screen.getByPlaceholderText('напр. BOX39 свитшоты')).toHaveValue('BOX39 футболки');

    uploadResult = { data: { path: 'ok' }, error: null };
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить заново' }));

    expect(await screen.findByText(/ТЗ загружено/)).toBeInTheDocument();
    expect(uploadCalls).toHaveLength(2);
    // Повтор пишет ТОТ ЖЕ путь — иначе в бакете копится мусор на каждую попытку
    expect(uploadCalls[1].path).toBe(uploadCalls[0].path);
    await waitFor(() => expect(submitBtn()).toBeEnabled());
  });

  it('payload RPC несёт секцию tz с реальным путём и без назначений цехам', async () => {
    const { createOrder } = setup();
    fillRequired();
    pickItemPdf(pdf('Задание.pdf'));
    expect(await screen.findByText(/ТЗ загружено/)).toBeInTheDocument();

    fireEvent.click(submitBtn());

    await waitFor(() => expect(createOrder).toHaveBeenCalled());
    const payload = createOrder.mock.calls[0][0];
    expect(payload.tz_required).toBe(true);
    expect(payload.tz.documents).toHaveLength(1);
    expect(payload.tz.documents[0]).toMatchObject({
      item_index: 0,
      file_name: 'Задание.pdf',
      mime_type: 'application/pdf',
    });
    expect(payload.tz.documents[0].file_path).toBe(uploadCalls[0].path);
    // Поцеховое назначение отменено: один файл виден всему маршруту позиции
    expect(payload.tz.assignments).toEqual([]);
  });

  it('общее ТЗ заказа закрывает позицию без своего файла', async () => {
    setup();
    fillRequired();
    const btn = screen.getByRole('button', { name: '+ Общее ТЗ заказа (PDF)' });
    fireEvent.change(btn.parentElement.querySelector('input[type="file"]'), {
      target: { files: [pdf('Общее ТЗ.pdf')] },
    });

    expect(await screen.findByText(/ТЗ загружено/)).toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
  });

  /**
   * ФОРМАТ БОЛЬШЕ НЕ ОГРАНИЧЕН (правка 12.09, п. 4). Прежде тест назывался
   * «не-PDF в бакет не уходит» и закреплял снятый запрет; теперь он сторожит
   * обратное — файл любого формата обязан доехать до бакета.
   */
  it('файл любого формата уходит в бакет', async () => {
    setup();
    fillRequired();
    const btn = screen.getByRole('button', { name: '+ ТЗ позиции (PDF)' });
    fireEvent.change(btn.parentElement.querySelector('input[type="file"]'), {
      target: { files: [new File(['x'], 'скан.jpg', { type: 'image/jpeg' })] },
    });
    await waitFor(() => expect(uploadCalls).toHaveLength(1));
  });
});

/**
 * «Подряд» перестал быть типом производства (правки заказчика 20.08).
 *
 * Документ требует прямо: «убрать "Подряд" как отдельный тип производства».
 * Подряд — признак ЭТАПА: исполнитель «Подрядчик» у любого шага маршрута,
 * сколько угодно раз. Оставленная плитка означала бы два способа задать одно
 * и то же, причём второй считал бы маршрут по частному правилу
 * `material_source` — то есть заказ уезжал бы не по тому маршруту.
 */
describe('CreateOrderModal — тип производства', () => {
  it('плитки «Подряд» в форме нет, а остальные типы на месте', async () => {
    setup();
    const group = await screen.findByRole('radiogroup', { name: 'Тип производства' });
    const names = within(group).getAllByRole('radio').map((b) => b.textContent);
    expect(names).not.toContain('Подряд');
    // Сторож не должен быть зелёным на пустом списке
    expect(names).toEqual(
      expect.arrayContaining(['Пошив', 'Образцы', 'Крой', 'Готовое изделие']),
    );
  });

  /**
   * ПОРЯДОК — часть требования (правки 07.09, п. 3): «Перенести „Образцы“,
   * „Подряд“ и „Пошив“ в начало блока». Проверяется ПОЛНЫЙ список, а не
   * «Образцы раньше Кроя»: частичное утверждение осталось бы зелёным, если
   * плитка потеряется совсем.
   */
  it('порядок плиток — Образцы, Пошив, затем остальные', async () => {
    setup();
    const group = await screen.findByRole('radiogroup', { name: 'Тип производства' });
    const names = within(group).getAllByRole('radio').map((b) => b.textContent);
    expect(names).toEqual(['Образцы', 'Пошив', 'Готовое изделие', 'Крой', 'Без изделий']);
  });

  /**
   * П. 8: у готового изделия кроя нет вовсе, и «на крое» было выбором без
   * последствий — `buildRoute` всё равно ставил ветку нанесения в конец.
   */
  it('у готового изделия «Нанесение на» предлагает только «на готовом»', async () => {
    setup();
    const group = await screen.findByRole('radiogroup', { name: 'Тип производства' });
    fireEvent.click(within(group).getByRole('radio', { name: 'Готовое изделие' }));
    const select = screen.getByLabelText('Нанесение на');
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['на готовом']);
  });
});

/**
 * ДВА СЦЕНАРИЯ ГОТОВОГО ИЗДЕЛИЯ (правки 07.09, п. 4).
 *
 * Правило разбора значения покрыто `utils/garmentSource.test.ts`, маршрутные
 * следствия — `utils/routes.test.ts`. Здесь сторожится СВЯЗКА, которой ни один
 * из них не видит: выбор появляется только у готового изделия, и он снимает
 * обязательность листа закупки — то есть кнопка «Создать заказ» перестаёт
 * требовать файла, которого по такому заказу не бывает.
 */
describe('CreateOrderModal — чьё готовое изделие (п. 4)', () => {
  const chooseReadyGarment = async () => {
    const group = await screen.findByRole('radiogroup', { name: 'Тип производства' });
    fireEvent.click(within(group).getByRole('radio', { name: 'Готовое изделие' }));
  };

  it('у пошива вопроса «Чьё изделие» нет', async () => {
    setup();
    await screen.findByRole('radiogroup', { name: 'Тип производства' });
    expect(screen.queryByRole('radiogroup', { name: 'Чьё изделие' })).toBeNull();
  });

  it('у готового изделия предлагаются все сценарии, по умолчанию — «Закупаем мы»', async () => {
    // Третий вариант — правка 14.09, п. 1: изделие со склада готовой
    // продукции. Плитки читаются из GARMENT_SOURCE_ORDER, и здесь проверяется
    // именно ФОРМА: значение, объявленное в словаре, но забытое в порядке,
    // существует в базе и в маршруте, а выбрать его человек не может.
    setup();
    await chooseReadyGarment();
    const group = screen.getByRole('radiogroup', { name: 'Чьё изделие' });
    const tiles = within(group).getAllByRole('radio');
    expect(tiles.map((b) => b.textContent))
      .toEqual(['Закупаем мы', 'Давальческое — изделие клиента', 'Склад готовой продукции']);
    expect(tiles[0]).toHaveAttribute('aria-checked', 'true');
  });

  it('давальческое снимает требование листа закупки', async () => {
    setup();
    /**
     * Заполняем РУКАМИ, без `fillRequired`: та ставит отметку «Закупка
     * не требуется», то есть уже снимает проверку листа — и сторож был бы
     * зелен независимо от сценария изделия.
     */
    fireEvent.change(screen.getByPlaceholderText('напр. BOX39 свитшоты'), {
      target: { value: 'BOX39 футболки' },
    });
    fireEvent.change(screen.getByPlaceholderText('футболка'), {
      target: { value: 'Футболка' },
    });
    fireEvent.change(screen.getByLabelText(/Кол-во/), { target: { value: '100' } });

    // Наше изделие: лист закупки обязателен, и попытка отправки его требует
    await chooseReadyGarment();
    fireEvent.click(submitBtn());
    expect(await screen.findByText(/Осталось заполнить.*Лист закупки/)).toBeInTheDocument();

    const group = screen.getByRole('radiogroup', { name: 'Чьё изделие' });
    fireEvent.click(within(group).getByRole('radio', { name: /Давальческое/ }));
    await waitFor(() => expect(screen.queryByText(/Осталось заполнить/)).toBeNull());
    // И форма ГОВОРИТ, почему лист больше не нужен, а не молчит
    expect(screen.getByText(/покупать нечего/)).toBeInTheDocument();
    expect(submitBtn()).toBeEnabled();
  });

  it('склад готовой продукции тоже снимает требование листа закупки', async () => {
    /**
     * Отдельный сценарий, а не параметр к предыдущему: правило читает
     * `itemNeedsPurchase`, и написанное отрицанием давальческого («всё, что
     * не customer, закупаем») оставило бы «Склад ГП» с обязательным листом —
     * то есть новая плитка не делала бы ничего.
     */
    setup();
    fireEvent.change(screen.getByPlaceholderText('напр. BOX39 свитшоты'), {
      target: { value: 'BOX39 футболки' },
    });
    fireEvent.change(screen.getByPlaceholderText('футболка'), {
      target: { value: 'Футболка' },
    });
    fireEvent.change(screen.getByLabelText(/Кол-во/), { target: { value: '100' } });

    await chooseReadyGarment();
    fireEvent.click(submitBtn());
    expect(await screen.findByText(/Осталось заполнить.*Лист закупки/)).toBeInTheDocument();

    const group = screen.getByRole('radiogroup', { name: 'Чьё изделие' });
    fireEvent.click(within(group).getByRole('radio', { name: /Склад готовой продукции/ }));
    await waitFor(() => expect(screen.queryByText(/Осталось заполнить/)).toBeNull());
    expect(screen.getByText(/покупать нечего/)).toBeInTheDocument();
    expect(submitBtn()).toBeEnabled();
  });
});

/**
 * РЕЖИМ ПРАВКИ (правка 12.09, п. 7).
 *
 * Проверяется ровно то, что просит документ и что легко сломать незаметно:
 * форма открывается ЗАПОЛНЕННОЙ, сохранение ОБНОВЛЯЕТ тот же заказ, нового
 * не создаётся, и маршрут в payload не едет — иначе правка срока стёрла бы
 * факт цеха.
 */
/**
 * ДАТЫ ФИКСТУРЫ СЧИТАЮТСЯ ОТ СЕГОДНЯ, а не написаны числом.
 *
 * Спека была зелёной до 21.09 и покраснела сама по себе: срок `2026-09-20`
 * стал прошлым, `validateOrderForm` вернула «Срок клиента в прошлом», и submit
 * выходил ДО вызова `saveOrderEdits`. Отказ при этом выглядел как поломка
 * сохранения — три теста разом, без единой правки кода. Календарь как скрытый
 * вход теста запрещён: фикстура обязана жить дольше одной недели.
 */
const DAYS_FROM_TODAY = (days) => addDays(factoryToday(), days);

describe('CreateOrderModal — правка созданного заказа', () => {
  const ORDER = {
    id: 'o-1',
    bitrix_id: '4821',
    title: 'BOX39 футболки',
    customer: 'ООО Ромашка',
    manager: 'Иванов',
    launch_date: DAYS_FROM_TODAY(-20),
    due_date: DAYS_FROM_TODAY(30),
    purchase_required: false,
    items: [{
      id: 'it-1',
      product_type: 'Футболка',
      qty: 100,
      production_type: 'sewing',
      branding_on: 'cut',
      main_fabric: 'футер 320',
      prints: [],
      labels: [],
    }],
  };

  function setupEdit(patch = {}) {
    const order = { ...ORDER, ...patch };
    const saveOrderEdits = vi.fn().mockResolvedValue(true);
    const createOrder = vi.fn();
    const findOrdersByBitrixId = vi.fn().mockResolvedValue([]);
    useErpStore.setState({
      departments: DEPARTMENTS,
      orders: [order],
      loaded: true,
      createOrder,
      saveOrderEdits,
      findOrdersByBitrixId,
      saveOrderDraft: vi.fn(),
      deleteOrderDraft: vi.fn(),
      employees: [],
      profilesList: [],
      employeesLoaded: true,
      loadEmployees: vi.fn().mockResolvedValue(undefined),
    });
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <CreateOrderModal order={order} onClose={onClose} />
      </MemoryRouter>,
    );
    return { saveOrderEdits, createOrder, findOrdersByBitrixId, onClose };
  }

  it('открывается заполненной текущими значениями', () => {
    setupEdit();
    expect(screen.getByPlaceholderText('напр. BOX39 свитшоты')).toHaveValue('BOX39 футболки');
    expect(screen.getByPlaceholderText('футболка')).toHaveValue('Футболка');
    expect(screen.getByLabelText(/Кол-во/)).toHaveValue(100);
    // Заголовок и кнопка называют режим: «Создать заказ» на существующем
    // заказе читается как «сейчас появится второй»
    expect(screen.getByText(/Правка заказа/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Сохранить изменения/ })).toBeInTheDocument();
  });

  it('сохранение обновляет ТОТ ЖЕ заказ и не создаёт новый', async () => {
    const { saveOrderEdits, createOrder, onClose } = setupEdit();
    fireEvent.change(screen.getByLabelText('Клиент'), { target: { value: 'ООО Новый' } });
    fireEvent.click(screen.getByRole('button', { name: /Сохранить изменения/ }));

    await waitFor(() => expect(saveOrderEdits).toHaveBeenCalled());
    expect(createOrder).not.toHaveBeenCalled();
    const [orderId, payload] = saveOrderEdits.mock.calls[0];
    expect(orderId).toBe('o-1');
    expect(payload.order.customer).toBe('ООО Новый');
    // Позиция адресуется по id: индекс сдвинулся бы при удалении соседней,
    // и техблок уехал бы к чужому изделию
    expect(payload.items[0].id).toBe('it-1');
    expect(onClose).toHaveBeenCalled();
  });

  /**
   * МАРШРУТ И ТЗ В PAYLOAD ПРАВКИ НЕ ЕДУТ. Этапы правятся конструктором
   * в карточке позиции: тронь их здесь — и правка срока стёрла бы `qty_done`,
   * журнал и плановые даты, то есть работу цеха.
   */
  it('этапы и ТЗ в payload правки не попадают', async () => {
    const { saveOrderEdits } = setupEdit();
    fireEvent.click(screen.getByRole('button', { name: /Сохранить изменения/ }));
    await waitFor(() => expect(saveOrderEdits).toHaveBeenCalled());
    const [, payload] = saveOrderEdits.mock.calls[0];
    expect(payload.items[0].stages).toBeUndefined();
    expect(payload.tz).toBeUndefined();
    expect(payload.attachments).toBeUndefined();
  });

  /**
   * ЧЕРНОВИК В РЕЖИМЕ ПРАВКИ НЕ ПИШЕТСЯ: `erp_order_drafts` — про НЕсозданный
   * заказ, и «+ Новый заказ» открывает самый свежий черновик. Запиши мы туда
   * правку существующего — следующее создание открылось бы чужими данными.
   */
  it('черновик существующего заказа не сохраняется', async () => {
    setupEdit();
    fireEvent.change(screen.getByLabelText('Клиент'), { target: { value: 'Кто-то' } });
    await new Promise((r) => { setTimeout(r, 700); });
    expect(useErpStore.getState().saveOrderDraft).not.toHaveBeenCalled();
  });

  /**
   * САМ СЕБЕ НЕ ДУБЛЬ (правка 12.09, баг 03).
   *
   * Проверка уникальности № сделки — та же, что при создании, и до правки она
   * находила РЕДАКТИРУЕМЫЙ заказ: человек открывал заказ и сразу читал «Заказ
   * с этим № сделки уже есть». Сторож смотрит на АРГУМЕНТ запроса, а не на
   * отсутствие текста: пустой ответ мока дал бы зелёный тест и на старом коде.
   */
  it('№ сделки самого заказа дублем не считается', async () => {
    const { findOrdersByBitrixId } = setupEdit();
    await waitFor(() => expect(findOrdersByBitrixId).toHaveBeenCalled());
    expect(findOrdersByBitrixId).toHaveBeenCalledWith('4821', 'o-1');
  });

  /**
   * ЛИСТ ЗАКУПКИ НЕ ТРЕБУЮТ ЗАНОВО (правка 12.09, баг 03).
   *
   * Заказ с настоящей закупкой: `purchase_required: true` и приложенный файл.
   * Нынешний тест правки намеренно берёт `false` и гейт обходит — то есть
   * ровно тот случай, на который жаловался заказчик, покрыт не был.
   * Состояние загрузки принадлежит форме и в правке пусто, поэтому без
   * второго слагаемого `hasPurchaseList` кнопка блокировалась.
   */
  it('приложенный лист закупки не требуется прикладывать заново', async () => {
    const { saveOrderEdits } = setupEdit({
      purchase_required: true,
      attachments: [{
        id: 'att-1', kind: 'purchase_list',
        file_path: 'orders/o-1/list.pdf', file_name: 'Лист закупки.pdf',
      }],
    });
    expect(screen.getByText('Лист закупки.pdf')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Сохранить изменения/ }));
    await waitFor(() => expect(saveOrderEdits).toHaveBeenCalled());
  });

  /**
   * ТЗ ПОКАЗАНО ПРИЛОЖЕННЫМ (правка 12.09, баг 03). Секция рисовалась
   * компонентом создания и показывала пустоту у заказа, где ТЗ есть.
   */
  it('приложенное ТЗ видно в форме правки', () => {
    setupEdit({
      tz_documents: [{
        id: 'tz-1', group_id: 'g-1', version: 1, item_id: 'it-1',
        file_path: 'tz/o-1/g-1/v1.pdf', file_name: 'ТЗ футболка.pdf',
      }],
    });
    expect(screen.getByText('ТЗ футболка.pdf')).toBeInTheDocument();
  });
});

/**
 * ЧЕРНОВИКИ ЗАКАЗА (правка заказчика 20.09, п. 6).
 *
 * «Раньше заказ можно было сохранить в черновики, открыть позже и продолжить
 * заполнение. Сейчас эта возможность пропала». Механизм при этом работал —
 * автосохранение писало снимок каждые 500 мс, — но СКАЗАТЬ ему «сохрани»
 * было нечем, увидеть результат негде, а файлы в снимок не попадали вовсе.
 */
describe('сохранение в черновики', () => {
  const draftBtn = () => screen.getByRole('button', { name: /Сохранить в черновики|Сохранение…/ });

  it('кнопка есть рядом с созданием заказа', () => {
    setup();
    expect(draftBtn()).toBeInTheDocument();
  });

  it('сохраняет ЧАСТИЧНО заполненную форму — обязательные поля не требуются', async () => {
    const saveOrderDraft = vi.fn().mockResolvedValue({ id: 'draft-1' });
    useErpStore.setState({ saveOrderDraft });
    setup();
    useErpStore.setState({ saveOrderDraft });

    // Только название: ни изделия, ни тиража, ни решения по закупке
    fireEvent.change(screen.getByPlaceholderText('напр. BOX39 свитшоты'), {
      target: { value: 'Недописанный заказ' },
    });
    fireEvent.click(draftBtn());

    await waitFor(() => expect(saveOrderDraft).toHaveBeenCalled());
    const [, title, payload] = saveOrderDraft.mock.calls.at(-1);
    expect(title).toBe('Недописанный заказ');
    expect(payload.form.title).toBe('Недописанный заказ');
  });

  it('пустую форму черновиком не сохраняет — иначе список зарастёт мусором', async () => {
    const saveOrderDraft = vi.fn().mockResolvedValue({ id: 'draft-1' });
    setup();
    useErpStore.setState({ saveOrderDraft });

    fireEvent.click(draftBtn());
    await waitFor(() => expect(saveOrderDraft).not.toHaveBeenCalled());
  });

  /**
   * ГЛАВНОЕ, ЧЕГО НЕ ХВАТАЛО. Форма честно предупреждала: «файлы в черновик
   * не попадают: их придётся приложить заново». Документ требует обратного —
   * «сохранять… загруженные файлы».
   *
   * Это стало возможно потому, что файл уходит в бакет ПРИ ВЫБОРЕ: в снимок
   * кладётся путь уже загруженного объекта, а не `File`, который в JSON
   * превратился бы в `{}`.
   */
  it('приложенный файл ТЗ уезжает в черновик путём, а не File-объектом', async () => {
    const saveOrderDraft = vi.fn().mockResolvedValue({ id: 'draft-1' });
    setup();
    useErpStore.setState({ saveOrderDraft });

    fillRequired();
    pickItemPdf(pdf('tz.pdf'));
    await waitFor(() => expect(uploadCalls.length).toBe(1));

    fireEvent.click(draftBtn());
    await waitFor(() => expect(saveOrderDraft).toHaveBeenCalled());

    const payload = saveOrderDraft.mock.calls.at(-1)[2];
    expect(payload.tzDocs).toHaveLength(1);
    expect(payload.tzDocs[0].path).toBe(uploadCalls[0].path);
    // `File` не сериализуем — в снимке его быть не должно
    expect(payload.tzDocs[0].file).toBeUndefined();
    // Снимок обязан пережить JSON: именно в таком виде он и ляжет в базу
    expect(JSON.parse(JSON.stringify(payload)).tzDocs[0].path)
      .toBe(uploadCalls[0].path);
  });

  it('незагруженный файл сохранять не даёт — путь указывал бы в пустоту', async () => {
    // Загрузка «зависает»: состояние `uploading`, пути ещё нет
    let release;
    uploadResult = new Promise((resolve) => { release = resolve; });
    setup();
    fillRequired();
    pickItemPdf(pdf('slow.pdf'));

    await waitFor(() => expect(draftBtn()).toBeDisabled());
    release({ data: { path: 'ok' }, error: null });
  });
});

/**
 * ВЫБОР ЧЕРНОВИКА В ФОРМЕ И ТИХИЙ ВЫХОД (правка заказчика 21.09, п. 6).
 *
 * «В форме создания заказа добавить отдельное раскрывающееся действие
 * „Черновики"… При нажатии „Отмена", закрытии формы или выходе из создания
 * заказа не показывать дополнительное окно „Сохранить черновик?"…
 * Сохранение в черновики должно происходить только по явному действию».
 */
describe('черновики внутри формы', () => {
  const DRAFTS = [
    {
      id: 'd-1',
      title: 'ВЦ',
      updated_at: '2026-09-21T10:00:00Z',
      payload: {
        form: { title: 'ВЦ', customer: 'ООО Вектор', manager: 'Иванов' },
        items: [{ ...{}, product_type: 'Худи', qty: '40', prints: [], labels: [] }],
      },
    },
    {
      id: 'd-2',
      title: '',
      updated_at: '2026-09-20T10:00:00Z',
      payload: { form: { customer: 'ИП Петров' }, items: [{ product_type: '', prints: [], labels: [] }] },
    },
  ];

  function setupWithDrafts() {
    const saveOrderDraft = vi.fn().mockResolvedValue({ id: 'd-new' });
    const deleteOrderDraft = vi.fn().mockResolvedValue(true);
    setup();
    useErpStore.setState({ orderDrafts: DRAFTS, saveOrderDraft, deleteOrderDraft });
    return { saveOrderDraft, deleteOrderDraft };
  }

  it('список открывается из формы и показывает клиента, менеджера и дату', () => {
    setupWithDrafts();
    fireEvent.click(screen.getByRole('button', { name: /Черновики/ }));

    expect(screen.getByText('ВЦ')).toBeInTheDocument();
    expect(screen.getByText(/ООО Вектор · Иванов/)).toBeInTheDocument();
    // Без названия — так и подписан, а не пустой строкой
    expect(screen.getByText('Без названия')).toBeInTheDocument();
  });

  it('свежие сверху — порядок считает форма, а не запрос', () => {
    setupWithDrafts();
    fireEvent.click(screen.getByRole('button', { name: /Черновики/ }));
    const titles = screen.getAllByRole('listitem')
      .map((li) => li.querySelector('span')?.textContent);
    expect(titles[0]).toContain('ВЦ');
  });

  it('выбранный черновик ЗАМЕНЯЕТ форму, а не дополняет её', async () => {
    setupWithDrafts();
    fireEvent.click(screen.getByRole('button', { name: /Черновики/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Открыть' })[0]);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('напр. BOX39 свитшоты')).toHaveValue('ВЦ');
    });
    expect(screen.getByPlaceholderText('футболка')).toHaveValue('Худи');
    // И форма прямо говорит, что именно открыто
    expect(screen.getByText(/Открыт черновик:/)).toBeInTheDocument();
  });

  /**
   * Пока черновик не открыт, форма НЕ ПИШЕТ в базу сама: «сохранение
   * в черновики должно происходить только по явному действию пользователя».
   */
  it('новая форма не заводит черновик фоном', async () => {
    const saveOrderDraft = vi.fn().mockResolvedValue({ id: 'd-new' });
    setup();
    useErpStore.setState({ saveOrderDraft, orderDrafts: [] });

    fireEvent.change(screen.getByPlaceholderText('напр. BOX39 свитшоты'), {
      target: { value: 'Черновик сам собой' },
    });
    await new Promise((r) => { setTimeout(r, 700); });
    expect(saveOrderDraft).not.toHaveBeenCalled();
  });

  it('выход из формы не спрашивает про черновик', async () => {
    const onClose = vi.fn();
    useErpStore.setState({
      departments: DEPARTMENTS, orders: [], loaded: true,
      createOrder: vi.fn(), saveOrderDraft: vi.fn(), deleteOrderDraft: vi.fn(),
      employees: [], profilesList: [], employeesLoaded: true,
      loadEmployees: vi.fn().mockResolvedValue(undefined),
    });
    render(
      <MemoryRouter>
        <CreateOrderModal onClose={onClose} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByPlaceholderText('напр. BOX39 свитшоты'), {
      target: { value: 'Заполнено, но не сохранено' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Отмена$/ }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText(/Сохранить черновик\?/)).not.toBeInTheDocument();
  });
});
