import { afterEach, describe, it, expect, vi } from 'vitest';
import { saveBlob, SAVE_REVOKE_MS } from './saveBlob';

describe('saveBlob — скачать файл', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ссылка с download и именем, клик, ссылка убрана, URL освобождён позже', () => {
    vi.useFakeTimers();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test/1');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const blob = new Blob(['%PDF-'], { type: 'application/pdf' });
    saveBlob(blob, 'PH-1-maket.pdf');
    const clicked = click.mock.contexts[0] as HTMLAnchorElement;

    expect(create).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledTimes(1);
    expect(clicked.download).toBe('PH-1-maket.pdf');
    expect(clicked.getAttribute('href')).toBe('blob:test/1');
    expect(clicked.isConnected).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SAVE_REVOKE_MS);
    expect(revoke).toHaveBeenCalledWith('blob:test/1');
  });

  it('клик бросил — ссылка всё равно убрана и URL освобождается', () => {
    vi.useFakeTimers();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test/2');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('нет'); });
    expect(() => saveBlob(new Blob(['x']), 'a.pdf')).toThrow('нет');
    expect(document.querySelector('a[download]')).toBeNull();
    vi.advanceTimersByTime(SAVE_REVOKE_MS);
    expect(revoke).toHaveBeenCalledWith('blob:test/2');
  });
});
