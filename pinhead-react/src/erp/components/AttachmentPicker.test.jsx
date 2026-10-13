import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AttachmentPicker } from './AttachmentPicker';
import { useAttachmentUploads } from '../hooks/useAttachmentUploads';

/**
 * Загрузка вложений: состояния файла и то, что уезжает в payload.
 *
 * ЧТО ЗДЕСЬ ВАЖНО ПРОВЕРИТЬ. Правило проекта «файл уходит в бакет ПРИ ВЫБОРЕ,
 * а не в сабмите» существует не ради удобства: пока ТЗ грузилось в сабмите,
 * форма показывала приложенным то, чего в Storage нет, и обнаруживал это цех,
 * открывая пустое вложение. Значит проверять надо не «компонент отрисовался»,
 * а что незавершённая и упавшая загрузки ВИДНЫ и поднимают флаги, по которым
 * форма блокирует submit.
 */

const upload = vi.fn();
const remove = vi.fn();

vi.mock('../../lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: (...args) => upload(...args),
        remove: (...args) => { remove(...args); return Promise.resolve({ error: null }); },
      }),
    },
  },
}));

/** Тестовый хост: хук и компонент работают только вместе */
function Host({ kind = 'tech', itemIndex = null, ownerKey = null, onState }) {
  const attach = useAttachmentUploads('new');
  onState?.(attach);
  return (
    <>
      <AttachmentPicker
        label="+ Файлы"
        files={attach.files}
        kind={kind}
        itemIndex={itemIndex}
        ownerKey={ownerKey}
        onAdd={attach.add}
        onRetry={attach.retry}
        onRemove={attach.remove}
      />
      <span data-testid="flags">
        {attach.uploading ? 'uploading' : ''}{attach.failed ? 'failed' : ''}
      </span>
    </>
  );
}

const file = (name = 'Схема узла.jpg') => new File(['x'], name, { type: 'image/jpeg' });

function pick(name) {
  const input = screen.getByLabelText('+ Файлы');
  fireEvent.change(input, { target: { files: [file(name)] } });
}

describe('AttachmentPicker', () => {
  beforeEach(() => {
    upload.mockReset();
    remove.mockReset();
  });

  it('файл уходит в бакет сразу при выборе, а не в сабмите', async () => {
    upload.mockResolvedValue({ error: null });
    render(<Host />);
    pick();
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    // Ключ строго ASCII: кириллица в нём даёт InvalidKey от Storage
    const [path] = upload.mock.calls[0];
    expect(path).toMatch(/^att\/new\/tech\/[\w-]+-Shema_uzla\.jpg$/);
  });

  /**
   * Пока загрузка идёт, форма обязана знать об этом: на `uploading` завязана
   * блокировка «Создать заказ». Без неё заказ уедет с файлом, которого нет.
   */
  it('незавершённая загрузка видна и поднимает флаг', async () => {
    let resolveUpload;
    upload.mockReturnValue(new Promise((r) => { resolveUpload = r; }));
    render(<Host />);
    pick();
    await screen.findByText('загружается…');
    expect(screen.getByTestId('flags')).toHaveTextContent('uploading');
    resolveUpload({ error: null });
    await waitFor(() => expect(screen.queryByText('загружается…')).toBeNull());
  });

  it('сбой показывает причину и кнопку повтора, а не молчит', async () => {
    upload.mockResolvedValue({ error: { message: 'InvalidKey' } });
    render(<Host />);
    pick();
    await screen.findByRole('button', { name: 'Загрузить заново' });
    expect(screen.getByTestId('flags')).toHaveTextContent('failed');

    upload.mockResolvedValue({ error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить заново' }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
  });

  /**
   * Файл, загруженный и никуда не привязанный, останется в бакете навсегда —
   * платный и, пока бакет публичный, доступный по ссылке.
   */
  it('снятый файл убирается и из состояния, и из бакета', async () => {
    upload.mockResolvedValue({ error: null });
    render(<Host />);
    pick();
    await waitFor(() => expect(upload).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Убрать файл/ }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: /Убрать файл/ })).toBeNull();
  });

  /**
   * Пикер показывает ТОЛЬКО свои файлы. Состояние одно на всю форму, и без
   * этого отбора превью упаковки первой позиции появилось бы во всех блоках
   * сразу — включая техблок соседней позиции.
   */
  it('пикер показывает только файлы своего блока', async () => {
    upload.mockResolvedValue({ error: null });
    let api;
    render(<Host kind="tech" itemIndex={0} onState={(a) => { api = a; }} />);
    api.add(file('a.jpg'), 'tech', 0);
    api.add(file('b.jpg'), 'packaging', 0);
    api.add(file('c.jpg'), 'tech', 1);
    await waitFor(() => expect(screen.getByTitle('a.jpg')).toBeInTheDocument());
    expect(screen.queryByTitle('b.jpg')).toBeNull();
    expect(screen.queryByTitle('c.jpg')).toBeNull();
  });
});

/**
 * Payload — самое хрупкое место: индекс строки закупки считается по ключам
 * В ТОМ ЖЕ ПОРЯДКЕ, в каком строки уедут в секцию `materials`. Пустые строки
 * формы отбрасываются, и счёт по положению в состоянии сдвинул бы привязку
 * у всех, кто ниже, — молча и на каждом заказе.
 */
describe('payload вложений', () => {
  beforeEach(() => { upload.mockReset(); upload.mockResolvedValue({ error: null }); });

  it('индекс материала считается по ключам отправляемых строк', async () => {
    let api;
    render(<Host onState={(a) => { api = a; }} />);
    api.add(file('ref.jpg'), 'purchase', null, 'row-B');
    await waitFor(() => expect(api.files[0].state).toBe('uploaded'));
    // Строка row-A пустая и в заказ не уедет — row-B становится нулевой
    expect(api.payload(['row-B'])[0]).toMatchObject({ material_index: 0, kind: 'purchase' });
    expect(api.payload(['row-A', 'row-B'])[0]).toMatchObject({ material_index: 1 });
  });

  it('файл удалённой строки закупки в заказ не едет', async () => {
    let api;
    render(<Host onState={(a) => { api = a; }} />);
    api.add(file('ref.jpg'), 'purchase', null, 'row-X');
    await waitFor(() => expect(api.files[0].state).toBe('uploaded'));
    expect(api.payload([])).toEqual([]);
  });

  it('незагруженный файл в payload не попадает', async () => {
    upload.mockReturnValue(new Promise(() => {}));
    let api;
    render(<Host onState={(a) => { api = a; }} />);
    api.add(file('slow.jpg'), 'tech', 0);
    await waitFor(() => expect(api.files).toHaveLength(1));
    expect(api.payload([])).toEqual([]);
  });
});
