import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { storageGet, storageSet, storageRemove, sessionGet, sessionSet, sessionRemove, deleteSkuPhotoByUrl, storageClearAll, APP_KEYS, KEEP_ON_LOGOUT } from './storage';

// Mock supabase for deleteSkuPhotoByUrl tests
const mockRemove = vi.fn();
vi.mock('./supabase', () => ({
  supabase: {
    storage: {
      from: vi.fn(() => ({
        remove: mockRemove,
      })),
    },
  },
}));

// Mock localStorage and sessionStorage
function createMockStorage() {
  const store = {};
  return {
    getItem: vi.fn((key) => (key in store ? store[key] : null)),
    setItem: vi.fn((key, val) => { store[key] = String(val); }),
    removeItem: vi.fn((key) => { delete store[key]; }),
    _store: store,
  };
}

describe('localStorage utilities', () => {
  let mockStorage;

  beforeEach(() => {
    mockStorage = createMockStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: mockStorage, writable: true });
  });

  describe('storageGet', () => {
    it('returns parsed JSON value', () => {
      mockStorage._store['key1'] = JSON.stringify({ a: 1 });
      expect(storageGet('key1')).toEqual({ a: 1 });
    });

    it('returns defaultValue when key is missing', () => {
      expect(storageGet('missing')).toBeNull();
      expect(storageGet('missing', 42)).toBe(42);
    });

    it('returns defaultValue on invalid JSON', () => {
      mockStorage._store['bad'] = 'not-json{';
      expect(storageGet('bad', 'fallback')).toBe('fallback');
    });
  });

  describe('storageSet', () => {
    it('stores JSON stringified value', () => {
      storageSet('k', { x: 2 });
      expect(mockStorage.setItem).toHaveBeenCalledWith('k', JSON.stringify({ x: 2 }));
    });

    it('does not throw on quota error', () => {
      mockStorage.setItem.mockImplementation(() => { throw new Error('QuotaExceeded'); });
      expect(() => storageSet('k', 'v')).not.toThrow();
    });
  });

  describe('storageRemove', () => {
    it('removes the key', () => {
      storageRemove('k');
      expect(mockStorage.removeItem).toHaveBeenCalledWith('k');
    });
  });
});

describe('sessionStorage utilities', () => {
  let mockStorage;

  beforeEach(() => {
    mockStorage = createMockStorage();
    Object.defineProperty(globalThis, 'sessionStorage', { value: mockStorage, writable: true });
  });

  describe('sessionGet', () => {
    it('returns value from TTL envelope when not expired', () => {
      const envelope = { value: 'hello', expires: Date.now() + 60000 };
      mockStorage._store['k'] = JSON.stringify(envelope);
      expect(sessionGet('k')).toBe('hello');
    });

    it('returns defaultValue when TTL expired', () => {
      const envelope = { value: 'old', expires: Date.now() - 1000 };
      mockStorage._store['k'] = JSON.stringify(envelope);
      expect(sessionGet('k', 'def')).toBe('def');
      expect(mockStorage.removeItem).toHaveBeenCalledWith('k');
    });

    it('returns value when expires is null (no TTL)', () => {
      const envelope = { value: [1, 2], expires: null };
      mockStorage._store['k'] = JSON.stringify(envelope);
      expect(sessionGet('k')).toEqual([1, 2]);
    });

    it('returns plain parsed value if not a TTL envelope', () => {
      mockStorage._store['plain'] = JSON.stringify('just a string');
      expect(sessionGet('plain')).toBe('just a string');
    });

    it('returns defaultValue when key is missing', () => {
      expect(sessionGet('nope', 99)).toBe(99);
    });

    it('returns defaultValue on invalid JSON', () => {
      mockStorage._store['bad'] = '{broken';
      expect(sessionGet('bad', 'fb')).toBe('fb');
    });
  });

  describe('sessionSet', () => {
    it('stores value with TTL', () => {
      const before = Date.now();
      sessionSet('k', 'v', 5000);
      const call = mockStorage.setItem.mock.calls[0];
      expect(call[0]).toBe('k');
      const stored = JSON.parse(call[1]);
      expect(stored.value).toBe('v');
      expect(stored.expires).toBeGreaterThanOrEqual(before + 5000);
    });

    it('stores value without TTL (expires null)', () => {
      sessionSet('k', 'v');
      const stored = JSON.parse(mockStorage.setItem.mock.calls[0][1]);
      expect(stored.expires).toBeNull();
    });

    it('does not throw on quota error', () => {
      mockStorage.setItem.mockImplementation(() => { throw new Error('QuotaExceeded'); });
      expect(() => sessionSet('k', 'v')).not.toThrow();
    });
  });

  describe('sessionRemove', () => {
    it('removes the key', () => {
      sessionRemove('k');
      expect(mockStorage.removeItem).toHaveBeenCalledWith('k');
    });
  });
});

describe('deleteSkuPhotoByUrl', () => {
  beforeEach(() => {
    mockRemove.mockReset();
  });

  it('returns true on successful deletion', async () => {
    mockRemove.mockResolvedValue({ error: null });
    const result = await deleteSkuPhotoByUrl('https://example.com/storage/v1/object/public/sku-photos/T001_0.jpg');
    expect(result).toBe(true);
    expect(mockRemove).toHaveBeenCalledWith(['T001_0.jpg']);
  });

  it('returns false on storage error', async () => {
    mockRemove.mockResolvedValue({ error: { message: 'not found' } });
    const result = await deleteSkuPhotoByUrl('https://example.com/storage/v1/object/public/sku-photos/T001_0.jpg');
    expect(result).toBe(false);
  });

  it('returns false for malformed URL', async () => {
    const result = await deleteSkuPhotoByUrl('https://example.com/no-match');
    expect(result).toBe(false);
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

/**
 * Полнота APP_KEYS.
 *
 * Список ключей, которые чистит выход, ведётся руками — и разошёлся: `erp_order_draft`
 * (черновик формы создания заказа с заказчиком, тиражом и параметрами нанесения)
 * в него не попал, и на общем цеховом планшете следующий работник открывал
 * «Новый заказ» с данными предыдущего. Тот же класс регресса уже чинили для
 * `erp_my_dept`, поэтому здесь не «ещё один ключ», а страж от повторения.
 *
 * Тест читает исходники и падает, когда появился ключ, не вписанный ни в APP_KEYS,
 * ни в KEEP_ON_LOGOUT (настройки устройства, которые выход трогать не должен).
 */
describe('storageClearAll — полнота списка ключей', () => {
  /** Ключи, которые код реально пишет: литералы в вызовах хелперов + константы *_KEY */
  function keysUsedInSources() {
    const found = new Set();
    const HELPER_LITERAL = /(?:storageGet|storageSet|storageRemove|sessionGet|sessionSet|sessionRemove)\s*(?:<[^>]*>)?\(\s*'([^']+)'/g;
    const KEY_CONST = /\b[A-Z][A-Z0-9_]*_KEY\s*(?::\s*string)?\s*=\s*'([^']+)'/g;
    // Прямые обращения мимо хелперов: так пишутся ph_sku, ph_cb_rate, erp_my_dept,
    // ph_onboarding_done — половина ключей приложения. Без этой строки страж
    // охранял бы только те ключи, что идут через lib/storage.
    const DIRECT = /(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*'([^']+)'/g;

    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx|js|jsx)$/.test(name) || /\.test\./.test(name)) continue;
        const src = readFileSync(full, 'utf8');
        for (const re of [HELPER_LITERAL, KEY_CONST, DIRECT]) {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(src)) !== null) found.add(m[1]);
        }
      }
    };
    // globalThis.process, а не голый process: конфиг ESLint здесь браузерный.
    // import.meta.url не годится — Vite переписывает его, и это не file:-URL.
    walk(join(globalThis.process.cwd(), 'src'));
    return [...found];
  }

  it('каждый ключ из кода либо чистится, либо явно оставлен', () => {
    const known = new Set([...APP_KEYS, ...KEEP_ON_LOGOUT, 'pinhead_catalogs_v1']);
    const unknown = keysUsedInSources().filter((k) => !known.has(k));
    expect(unknown, `Ключи хранилища без решения: ${unknown.join(', ')}. `
      + 'Впишите в APP_KEYS (данные пользователя) или KEEP_ON_LOGOUT (настройка устройства).')
      .toEqual([]);
  });

  it('черновики заказов чистятся: в них данные заказчика', () => {
    expect(APP_KEYS).toContain('pinhead_draft');
    expect(APP_KEYS).toContain('erp_order_draft');
  });

  it('настройки устройства выход не трогает', () => {
    for (const key of KEEP_ON_LOGOUT) expect(APP_KEYS).not.toContain(key);
  });

  it('storageClearAll удаляет каждый ключ из APP_KEYS', () => {
    for (const key of APP_KEYS) localStorage.setItem(key, 'x');
    for (const key of KEEP_ON_LOGOUT) localStorage.setItem(key, 'x');
    storageClearAll();
    for (const key of APP_KEYS) expect(localStorage.getItem(key)).toBeNull();
    for (const key of KEEP_ON_LOGOUT) expect(localStorage.getItem(key)).toBe('x');
  });
});
