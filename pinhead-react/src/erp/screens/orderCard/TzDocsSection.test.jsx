import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TzDocsSection } from './TzDocsSection';
import { useErpStore } from '../../store/useErpStore';

/**
 * ТЗ В КАРТОЧКЕ ЗАКАЗА ПАЧКОЙ (правка 19.10, пп. 3–4).
 *
 * «Разрешить при одном открытии окна выбора выделить несколько файлов…
 * Применить это к загрузке общего ТЗ заказа и ТЗ позиций при создании
 * и редактировании заказа. Каждый выбранный файл показывать отдельной
 * строкой со своим состоянием загрузки… Сохранить возможность удалить или
 * заменить отдельный файл».
 *
 * Раньше карточка держала один флаг `busy` на всю секцию: пока грузился
 * один файл, обе кнопки выбора и «Заменить файл» были выключены — пачка
 * при таком устройстве шла бы строго по одному.
 */

vi.mock('../../../store/useToastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const ITEM = { id: 'i1', product_type: 'Футболка', qty: 100, stages: [] };

function pdf(name, size) {
  const f = new File(['%PDF-1.4'], name, { type: 'application/pdf' });
  if (size) Object.defineProperty(f, 'size', { value: size });
  return f;
}

/** Управляемые ответы стора: тест решает, когда завершится каждая загрузка */
let pending;

function setup(order = { id: 'o1', items: [ITEM], tz_documents: [] }) {
  pending = new Map();
  const uploadTzDocument = vi.fn(({ file }) => new Promise((resolve) => {
    pending.set(file.name, resolve);
  }));
  const replaceTzDocument = vi.fn().mockResolvedValue({ id: 'v2' });
  useErpStore.setState({ myRole: 'manager', uploadTzDocument, replaceTzDocument });
  render(<TzDocsSection order={order} item={ITEM} deptById={new Map()} />);
  return { uploadTzDocument, replaceTzDocument };
}

function inputNear(buttonName) {
  const btn = screen.getByRole('button', { name: buttonName });
  return btn.parentElement.querySelector('input[type="file"]');
}

beforeEach(() => {
  useErpStore.setState({ myRole: null });
});

describe('TzDocsSection — ТЗ пачкой', () => {
  it('пачка в карточке — строка на файл, соседи не блокируются', async () => {
    const { uploadTzDocument } = setup();
    fireEvent.change(inputNear('+ ТЗ этой позиции (PDF)'), {
      target: { files: [pdf('tz-1.pdf'), pdf('tz-2.pdf')] },
    });

    await waitFor(() => expect(uploadTzDocument).toHaveBeenCalledTimes(2));
    expect(uploadTzDocument.mock.calls.map((c) => c[0].itemId)).toEqual(['i1', 'i1']);
    expect(screen.getByText('tz-1.pdf')).toBeInTheDocument();
    expect(screen.getByText('tz-2.pdf')).toBeInTheDocument();
    expect(screen.getAllByText('загружается…')).toHaveLength(2);
    // Пока пачка грузится, выбрать ещё можно — общий `busy` больше не держит секцию
    expect(screen.getByRole('button', { name: '+ ТЗ этой позиции (PDF)' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '+ Общее ТЗ заказа (PDF)' })).toBeEnabled();

    // Первый загрузился — второй живёт своей строкой
    pending.get('tz-1.pdf')({ id: 'v1' });
    await waitFor(() => expect(screen.getAllByText('загружается…')).toHaveLength(1));

    // Сбой второго — повтор только у него
    pending.get('tz-2.pdf')(null);
    expect(await screen.findByRole('button', { name: 'Загрузить заново: tz-2.pdf' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Загрузить заново: tz-1.pdf' })).toBeNull();
  });

  it('файл больше 30 МБ называется с причиной и в бакет не идёт', async () => {
    const { uploadTzDocument } = setup();
    fireEvent.change(inputNear('+ Общее ТЗ заказа (PDF)'), {
      target: { files: [pdf('big.pdf', 31 * 1024 * 1024), pdf('ok.pdf')] },
    });

    expect(await screen.findByText(
      'не загрузилось: файл больше 30 МБ — уменьшите или разбейте PDF',
    )).toBeInTheDocument();
    expect(screen.getByText('big.pdf')).toBeInTheDocument();
    expect(uploadTzDocument).toHaveBeenCalledTimes(1);
    expect(uploadTzDocument.mock.calls[0][0]).toMatchObject({ itemId: null });
    expect(screen.queryByRole('button', { name: 'Загрузить заново: big.pdf' })).toBeNull();
  });

  it('подпись — «До 30 МБ на один файл»', () => {
    setup();
    expect(screen.getByText('До 30 МБ на один файл')).toBeInTheDocument();
    expect(screen.queryByText(/до 15 МБ/)).toBeNull();
  });

  it('замена одиночная', async () => {
    const { replaceTzDocument } = setup({
      id: 'o1',
      items: [ITEM],
      tz_documents: [{
        id: 'tz-1', group_id: 'g-1', version: 1, item_id: 'i1', is_current: true,
        file_path: 'tz/o1/g-1/v1.pdf', file_name: 'ТЗ футболка.pdf',
        created_at: '2026-10-19T10:00:00Z',
      }],
    });
    const input = inputNear('Заменить файл');
    // Замена — один файл взамен одного: выбрать пачку окно не даст
    expect(input.multiple).toBe(false);

    const next = pdf('ТЗ v2.pdf');
    fireEvent.change(input, { target: { files: [next] } });
    await waitFor(() => expect(replaceTzDocument).toHaveBeenCalledTimes(1));
    expect(replaceTzDocument).toHaveBeenCalledWith('g-1', next);
  });
});
