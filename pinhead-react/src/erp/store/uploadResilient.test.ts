import { describe, it, expect, beforeEach, vi } from 'vitest';

const upload = vi.fn();
const list = vi.fn();

vi.mock('../../lib/supabase', () => ({
  supabase: { storage: { from: () => ({ upload, list }) } },
}));

const { uploadResilient } = await import('./shared');

const BUCKET = 'erp-attachments';
const PATH = 'tz/new/a0b16770-b72d-4aa5-beda-0b797aaba868/v1-TZ_Kontrkult.pdf';
const NAME = 'v1-TZ_Kontrkult.pdf';
const DIR = 'tz/new/a0b16770-b72d-4aa5-beda-0b797aaba868';

/** Обрыв связи: supabase-js БРОСАЕТ, ответа сервера не было вовсе */
const dropped = () => { throw new TypeError('Failed to fetch'); };

beforeEach(() => {
  upload.mockReset();
  list.mockReset();
  list.mockResolvedValue({ data: [], error: null });
});

/**
 * Загрузка, которая не теряет уже загруженное.
 *
 * Проверено на проде 20.08: два ТЗ показаны как «не загрузилось: Ошибка
 * соединения», кнопка «Создать заказ» заблокирована — а оба файла лежат
 * в Storage. Ответ на загрузку пришёл через шестнадцать минут после запроса;
 * браузер столько не ждёт, а сервер файлы принял и записал.
 */
describe('uploadResilient — успешную загрузку не теряем', () => {
  it('обычная загрузка идёт одним заходом и бакет не опрашивает', async () => {
    upload.mockResolvedValue({ data: { path: PATH }, error: null });

    const res = await uploadResilient(BUCKET, PATH, new Blob(['x']), { contentType: 'application/pdf' });

    expect(res.error).toBeNull();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(list).not.toHaveBeenCalled();
  });

  /**
   * Ключ содержит `uuid`, выданный этой же формой, поэтому занять его мог
   * только наш предыдущий заход — перезапись своего файла безопасна, а без
   * `upsert` повтор отвечал бы «уже существует» на файл, который сам и положил.
   */
  it('всегда просит перезапись своего же ключа', async () => {
    upload.mockResolvedValue({ data: { path: PATH }, error: null });

    await uploadResilient(BUCKET, PATH, new Blob(['x']), { contentType: 'application/pdf' });

    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: 'application/pdf', upsert: true });
  });

  it('связь оборвалась, но файл в бакете — это успех, и второй раз он не грузится', async () => {
    upload.mockImplementation(dropped);
    list.mockResolvedValue({ data: [{ name: NAME }], error: null });

    const res = await uploadResilient(BUCKET, PATH, new Blob(['x']));

    expect(res.error).toBeNull();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith(DIR, expect.objectContaining({ search: NAME }));
  });

  it('связь оборвалась и файла нет — один повтор, и он спасает', async () => {
    upload
      .mockImplementationOnce(dropped)
      .mockResolvedValueOnce({ data: { path: PATH }, error: null });

    const res = await uploadResilient(BUCKET, PATH, new Blob(['x']));

    expect(res.error).toBeNull();
    expect(upload).toHaveBeenCalledTimes(2);
  });

  /** Ответ мог не дойти дважды подряд — а файл при этом записаться */
  it('оба захода оборвались, но файл появился — засчитываем', async () => {
    upload.mockImplementation(dropped);
    list
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [{ name: NAME }], error: null });

    const res = await uploadResilient(BUCKET, PATH, new Blob(['x']));

    expect(res.error).toBeNull();
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('файла нет ни после повтора — ошибка остаётся ошибкой', async () => {
    upload.mockImplementation(dropped);

    const res = await uploadResilient(BUCKET, PATH, new Blob(['x']));

    expect(res.error?.message).toBe('нет связи с сервером');
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('«уже существует» — это наш предыдущий заход, а не сбой', async () => {
    upload.mockResolvedValue({ data: null, error: { message: 'The resource already exists' } });

    const res = await uploadResilient(BUCKET, PATH, new Blob(['x']));

    expect(res.error).toBeNull();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  /**
   * Отказ прав и `InvalidKey` — это РЕШЕНИЕ сервера: повтор их не исправит,
   * а причину спрячет. Такие ответы уходят наверх как есть, первым же заходом.
   */
  it.each([
    'new row violates row-level security policy',
    'Invalid key: tz/new/ТЗ.pdf',
  ])('ответ сервера не повторяется: %s', async (message) => {
    upload.mockResolvedValue({ data: null, error: { message } });

    const res = await uploadResilient(BUCKET, PATH, new Blob(['x']));

    expect(res.error?.message).toBe(message);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(list).not.toHaveBeenCalled();
  });

  /** `search` в Storage — подстрока, поэтому имя сверяется точно */
  it('чужой файл с похожим именем за наш не считается', async () => {
    upload.mockImplementation(dropped);
    list.mockResolvedValue({ data: [{ name: `${NAME}.bak` }], error: null });

    const res = await uploadResilient(BUCKET, PATH, new Blob(['x']));

    expect(res.error).not.toBeNull();
  });
});
