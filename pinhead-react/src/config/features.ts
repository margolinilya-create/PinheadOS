/**
 * Feature flags.
 *
 * Позволяют «убрать в ящик» большие блоки без удаления кода.
 * Приоритет источников: URL-параметр → localStorage → env → дефолт.
 *
 * Раздел «Оформление заказа» (`orderStudio`) с вехи 8 выбирается НЕ здесь,
 * а чистой функцией `config/shellChoice.ts` (по профилю, адресу и выбору
 * устройства, один раз за загрузку — `ShellGate` в `App.jsx`). Здесь — только
 * хранение выбора устройства (`setFeature`/`clearFeature`) и сырое значение
 * переменной сборки. `VITE_FEATURE_ORDER_STUDIO` — тройка:
 *   - '0' / 'false' — аварийный выключатель: раздел гаснет у всех, `?studio=1`
 *                     его не обходит (права на сервере остаются — снимаются отметки);
 *   - '1' / 'true'  — dev и e2e: раздел по умолчанию;
 *   - не задано     — по профилю (продавец, МС, rop — в раздел; прочие — в «Производство»).
 * Ручной выбор: `?studio=1|0` (один заход), консоль `setFeature('orderStudio', true)`.
 *
 * Витрина дизайн-системы (/styleguide) — тем же механизмом:
 *   - URL:          ?styleguide=1
 *   - env (билд):   VITE_FEATURE_STYLEGUIDE=1
 * По умолчанию выключена: это инструмент разработки, а не раздел ERP.
 *
 * Флага `devFinalPackageRequired` здесь БОЛЬШЕ НЕТ (правка 12.09, вторая
 * порция, п. 5). Он гасил разом две вещи — блок «Проверка образца»
 * и обязательность финального техпакета, — а заказчик просил убрать только
 * первую: «„Финальный технический пакет" оставить обязательным условием
 * завершения разработки». Требование вернулось насовсем, поэтому и
 * переключателя у него нет: флаг означал бы, что правило можно выключить,
 * а его нельзя.
 */

export type FeatureName = 'orderStudio' | 'styleguide';

/** Все флаги — для сторожа хранилища: каждый ключ классифицирован при выходе */
export const FEATURE_NAMES: readonly FeatureName[] = ['orderStudio', 'styleguide'];

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

/**
 * Ключи `localStorage` флагов. Собираются динамически, поэтому сторож полноты
 * `lib/storage` их в исходниках не видит — `storage.ts` классифицирует их отсюда:
 * выбор раздела стирается при выходе, витрина остаётся настройкой устройства.
 */
export const FEATURE_STORAGE_KEYS = Object.fromEntries(
  FEATURE_NAMES.map((n) => [n, LS_PREFIX + n]),
) as Record<FeatureName, string>;

/** Сырой выбор устройства (`'1'`, `'0'` или `null`) — вход `chooseShell` */
export function readStoredFeature(name: FeatureName): string | null {
  try {
    return localStorage.getItem(FEATURE_STORAGE_KEYS[name]);
  } catch {
    return null;
  }
}

/** Сырое значение переменной сборки флага (тройка у `orderStudio`, см. шапку) */
export function featureEnv(name: FeatureName): string | undefined {
  try {
    return import.meta.env?.[ENV_KEYS[name]] as string | undefined;
  } catch {
    return undefined;
  }
}

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
  return truthy(featureEnv(name));
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

/**
 * Удобный геттер: FEATURES.styleguide. Оболочку раздела заказа по нему
 * НЕ выбирают — только `chooseShell` (у него выключатель и профиль)
 */
export const FEATURES = {
  get styleguide(): boolean {
    return isFeatureEnabled('styleguide');
  },
};

// Доступ из консоли для ручного переключения в dev
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).setFeature = setFeature;
}
