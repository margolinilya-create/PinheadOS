import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import LibraryTab from './LibraryTab';

/**
 * Главный риск вкладки — НЕ вёрстка, а затирание боевых каталогов.
 *
 * Редактор правит то, что лежит в сторе Order Studio, а слайс каталогов
 * инициализирован дефолтами из `src/data`. Открытый на незагруженном сторе,
 * он по «Сохранить» записал бы эти дефолты поверх `app_config` — молча
 * и целиком. Пока редактор жил только в Order Studio, каталоги грузились
 * до него; в админке ERP их не грузит никто.
 *
 * Поэтому проверяется ровно одно: без успешно загруженных каталогов редактор
 * не монтируется вообще.
 */

const loadAllCatalogs = vi.fn();
const loadCatalogs = vi.fn(() => Promise.resolve());

vi.mock('../../../lib/catalogs', () => ({
  loadAllCatalogs: (...args) => loadAllCatalogs(...args),
}));

vi.mock('../../../store/useStore', () => ({
  useStore: { getState: () => ({ loadCatalogs }) },
}));

// Сам редактор подменён меткой: здесь проверяется допуск к нему, а не он сам
vi.mock('../../../components/editors/SkuEditor', () => ({
  default: () => <div>РЕДАКТОР КАТАЛОГОВ</div>,
}));

beforeEach(() => {
  loadAllCatalogs.mockReset();
  loadCatalogs.mockClear();
});

describe('LibraryTab — допуск к редактору каталогов', () => {
  it('каталоги приехали — редактор открывается, стор наполнен из базы', async () => {
    loadAllCatalogs.mockResolvedValue({ skuCatalog: [{ code: 'T-001', name: 'Футболка' }] });
    render(<LibraryTab />);
    expect(await screen.findByText('РЕДАКТОР КАТАЛОГОВ')).toBeInTheDocument();
    expect(loadCatalogs).toHaveBeenCalled();
  });

  it('сеть не ответила — редактора нет, есть ошибка с повтором', async () => {
    loadAllCatalogs.mockRejectedValue(new Error('нет связи'));
    render(<LibraryTab />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Не удалось загрузить каталоги/);
    expect(screen.queryByText('РЕДАКТОР КАТАЛОГОВ')).not.toBeInTheDocument();
    expect(loadCatalogs).not.toHaveBeenCalled();
  });

  it('ответ без каталога изделий — тоже отказ, а не редактор на дефолтах', async () => {
    // Именно этот случай и затирает боевые данные: запрос «прошёл»,
    // но каталога в нём нет, и стор остаётся на константах из src/data
    loadAllCatalogs.mockResolvedValue({ prices: {} });
    render(<LibraryTab />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByText('РЕДАКТОР КАТАЛОГОВ')).not.toBeInTheDocument();
    expect(loadCatalogs).not.toHaveBeenCalled();
  });
});
