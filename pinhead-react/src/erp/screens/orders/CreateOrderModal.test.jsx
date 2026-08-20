import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CreateOrderModal } from './CreateOrderModal';
import { useErpStore } from '../../store/useErpStore';
import { supabase } from '../../../lib/supabase';

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
    uploadOrderPreview: vi.fn().mockResolvedValue(null),
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

  it('не-PDF в бакет не уходит', () => {
    setup();
    fillRequired();
    const btn = screen.getByRole('button', { name: '+ ТЗ позиции (PDF)' });
    fireEvent.change(btn.parentElement.querySelector('input[type="file"]'), {
      target: { files: [new File(['x'], 'скан.jpg', { type: 'image/jpeg' })] },
    });
    expect(uploadCalls).toHaveLength(0);
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
});
