import '@testing-library/jest-dom';

// Mock SVG imports (Vite ?raw)
vi.mock('../assets/garments/tshirt.svg?raw', () => ({ default: '<svg>tshirt</svg>' }));
vi.mock('../assets/garments/longsleeve.svg?raw', () => ({ default: '<svg>longsleeve</svg>' }));
vi.mock('../assets/garments/polo.svg?raw', () => ({ default: '<svg>polo</svg>' }));
vi.mock('../assets/garments/sweatshirt.svg?raw', () => ({ default: '<svg>sweatshirt</svg>' }));
vi.mock('../assets/garments/hoodie.svg?raw', () => ({ default: '<svg>hoodie</svg>' }));
vi.mock('../assets/garments/shopper.svg?raw', () => ({ default: '<svg>shopper</svg>' }));

// Mock Supabase client (no credentials needed in test env)
const mockChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: null, error: null }),
  upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
  insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  update: vi.fn().mockResolvedValue({ data: null, error: null }),
  delete: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  match: vi.fn().mockReturnThis(),
  then: vi.fn((cb) => cb({ data: [], error: null })),
};
vi.mock('./lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => mockChain),
    channel: vi.fn(() => {
      const ch = { on: vi.fn(() => ch), subscribe: vi.fn(() => ch) };
      return ch;
    }),
    removeChannel: vi.fn(),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ data: { path: 'test.jpg' }, error: null }),
        remove: vi.fn().mockResolvedValue({ data: null, error: null }),
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://test.com/test.jpg' } })),
        list: vi.fn().mockResolvedValue({ data: [], error: null }),
      })),
    },
  },
}));

// Mock window.print
window.print = vi.fn();

// Mock navigator.clipboard
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  writable: true,
});

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn((key) => store[key] || null),
    setItem: vi.fn((key, value) => { store[key] = String(value); }),
    removeItem: vi.fn((key) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
