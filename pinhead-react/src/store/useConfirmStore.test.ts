import { describe, it, expect, beforeEach } from 'vitest';
import { useConfirmStore, confirm, confirmWithInput } from './useConfirmStore';

/**
 * Диалог подтверждения с полем ввода — замена `window.prompt()` в переносе
 * задания между цехами. Ключевое: старый `confirm()` обязан по-прежнему
 * возвращать boolean, иначе все прежние `if (await confirm(...))` начали бы
 * получать всегда истинный объект и подтверждать сами себя.
 */

const close = (ok: boolean, value?: string) => useConfirmStore.getState()._close(ok, value);

beforeEach(() => {
  useConfirmStore.setState({
    open: false, title: '', message: '', prompt: null, nonce: 0, _resolver: null,
  });
});

describe('confirm — прежний контракт', () => {
  it('возвращает true/false, а не объект', async () => {
    const p = confirm('Удалить?');
    close(true);
    await expect(p).resolves.toBe(true);

    const p2 = confirm('Удалить?');
    close(false);
    await expect(p2).resolves.toBe(false);
  });

  it('строку принимает как заголовок', async () => {
    const p = confirm('Перенести?');
    expect(useConfirmStore.getState().title).toBe('Перенести?');
    close(false);
    await p;
  });

  it('поля ввода без запроса нет', async () => {
    const p = confirm({ title: 'Ок?' });
    expect(useConfirmStore.getState().prompt).toBeNull();
    close(true);
    await p;
  });
});

describe('confirmWithInput — подтверждение с комментарием', () => {
  it('отдаёт решение и текст', async () => {
    const p = confirmWithInput({
      title: 'Перенести в «Швейный цех»?',
      prompt: { label: 'Причина переноса', required: true },
    });
    expect(useConfirmStore.getState().prompt?.label).toBe('Причина переноса');
    close(true, 'брак на предыдущем этапе');
    await expect(p).resolves.toEqual({ ok: true, value: 'брак на предыдущем этапе' });
  });

  it('отмена возвращает ok:false и пустой текст', async () => {
    const p = confirmWithInput({ title: 'Перенести?', prompt: { label: 'Причина' } });
    close(false);
    await expect(p).resolves.toEqual({ ok: false, value: '' });
  });

  it('закрытие снимает поле и резолвер — следующий вызов начинается чистым', async () => {
    const p = confirmWithInput({ title: 'Перенести?', prompt: { label: 'Причина' } });
    close(true, 'текст');
    await p;
    const s = useConfirmStore.getState();
    expect(s.open).toBe(false);
    expect(s.prompt).toBeNull();
    expect(s._resolver).toBeNull();
  });

  it('nonce растёт на каждый вызов — диалог перемонтируется и поле чистое', async () => {
    const before = useConfirmStore.getState().nonce;
    const p1 = confirmWithInput({ title: 'Раз', prompt: { label: 'Причина' } });
    expect(useConfirmStore.getState().nonce).toBe(before + 1);
    close(true, 'первая');
    await p1;

    const p2 = confirmWithInput({ title: 'Два', prompt: { label: 'Причина' } });
    expect(useConfirmStore.getState().nonce).toBe(before + 2);
    close(true, 'вторая');
    await expect(p2).resolves.toEqual({ ok: true, value: 'вторая' });
  });
});
