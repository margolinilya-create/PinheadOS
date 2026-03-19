import '@testing-library/jest-dom';

// Mock SVG imports (Vite ?raw)
vi.mock('../assets/garments/tshirt.svg?raw', () => ({ default: '<svg>tshirt</svg>' }));
vi.mock('../assets/garments/longsleeve.svg?raw', () => ({ default: '<svg>longsleeve</svg>' }));
vi.mock('../assets/garments/polo.svg?raw', () => ({ default: '<svg>polo</svg>' }));
vi.mock('../assets/garments/sweatshirt.svg?raw', () => ({ default: '<svg>sweatshirt</svg>' }));
vi.mock('../assets/garments/hoodie.svg?raw', () => ({ default: '<svg>hoodie</svg>' }));
vi.mock('../assets/garments/shopper.svg?raw', () => ({ default: '<svg>shopper</svg>' }));

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
