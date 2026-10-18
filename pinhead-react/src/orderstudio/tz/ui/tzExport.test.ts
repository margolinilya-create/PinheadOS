import { afterEach, describe, it, expect, vi } from 'vitest';
import { toast } from '../../../store/useToastStore';
import { loadTzEngine, loadTzEngineOrNull, MSG_TZ_ENGINE, tzEngine } from './tzExport';

// svg2pdf: в Vitest — ES-модуль, как в сборке (см. exportPdf.test.ts)
vi.mock('svg2pdf.js', () => import('svg2pdf.js/dist/svg2pdf.es.js'));

describe('tzExport — загрузчик движка PDF ТЗ', () => {
  afterEach(() => vi.restoreAllMocks());

  it('грузит движок по требованию', async () => {
    const engine = await loadTzEngine();
    expect(typeof engine.buildTzPdf).toBe('function');
    expect(typeof engine.buildAllTzPdf).toBe('function');
  }, 30_000);

  it('сбой чанка — тост и null (не исключение)', async () => {
    vi.spyOn(tzEngine, 'load').mockRejectedValue(new Error('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    expect(await loadTzEngineOrNull()).toBeNull();
    expect(err).toHaveBeenCalledWith(MSG_TZ_ENGINE);
  });
});
