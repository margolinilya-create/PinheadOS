import { storageGet, storageSet, storageRemove, sessionGet, sessionSet, sessionRemove, deleteSkuPhotoByUrl } from './storage';

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
