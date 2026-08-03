/**
 * Feature flags.
 *
 * Позволяют «убрать в ящик» большие блоки без удаления кода.
 * Приоритет источников: URL-параметр → localStorage → env → дефолт.
 *
 * Как включить старый Order Studio (визард/цены) вручную:
 *   - URL:          ?studio=1
 *   - консоль:      setFeature('orderStudio', true)  (затем перезагрузить)
 *   - localStorage: pinhead_feature_orderStudio = '1'
 *   - env (билд):   VITE_FEATURE_ORDER_STUDIO=1
 *
 * Витрина дизайн-системы (/styleguide) — тем же механизмом:
 *   - URL:          ?styleguide=1
 *   - env (билд):   VITE_FEATURE_STYLEGUIDE=1
 * По умолчанию выключена: это инструмент разработки, а не раздел ERP.
 */

export type FeatureName = 'orderStudio' | 'styleguide';

const DEFAULTS: Record<FeatureName, boolean> = {
  orderStudio: false,
  styleguide: false,
};

const ENV_KEYS: Record<FeatureName, string> = {
  orderStudio: 'VITE_FEATURE_ORDER_STUDIO',
  styleguide: 'VITE_FEATURE_STYLEGUIDE',
};

/** Короткие URL-параметры для быстрого включения */
const URL_KEYS: Record<FeatureName, string> = {
  orderStudio: 'studio',
  styleguide: 'styleguide',
};

const LS_PREFIX = 'pinhead_feature_';

function truthy(v: string | null | undefined): boolean | null {
  if (v === null || v === undefined || v === '') return null;
  return v === '1' || v === 'true';
}

function fromUrl(name: FeatureName): boolean | null {
  try {
    const params = new URLSearchParams(window.location.search);
    return truthy(params.get(URL_KEYS[name]));
  } catch {
    return null;
  }
}

function fromLocalStorage(name: FeatureName): boolean | null {
  try {
    return truthy(localStorage.getItem(LS_PREFIX + name));
  } catch {
    return null;
  }
}

function fromEnv(name: FeatureName): boolean | null {
  try {
    return truthy(import.meta.env?.[ENV_KEYS[name]] as string | undefined);
  } catch {
    return null;
  }
}

export function isFeatureEnabled(name: FeatureName): boolean {
  const url = fromUrl(name);
  if (url !== null) return url;
  const ls = fromLocalStorage(name);
  if (ls !== null) return ls;
  const env = fromEnv(name);
  if (env !== null) return env;
  return DEFAULTS[name];
}

export function setFeature(name: FeatureName, enabled: boolean): void {
  try {
    localStorage.setItem(LS_PREFIX + name, enabled ? '1' : '0');
  } catch {
    /* localStorage недоступен — игнорируем */
  }
}

export function clearFeature(name: FeatureName): void {
  try {
    localStorage.removeItem(LS_PREFIX + name);
  } catch {
    /* localStorage недоступен — игнорируем */
  }
}

/** Удобный геттер: FEATURES.orderStudio */
export const FEATURES = {
  get orderStudio(): boolean {
    return isFeatureEnabled('orderStudio');
  },
  get styleguide(): boolean {
    return isFeatureEnabled('styleguide');
  },
};

// Доступ из консоли для ручного переключения в dev
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).setFeature = setFeature;
}
