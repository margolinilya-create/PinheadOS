/**
 * ГРУППЫ ТОКЕНОВ — ОДИН СПИСОК НА СТОРОЖА И ВИТРИНУ.
 *
 * До 12.09 перечни жили в двух местах и в двух написаниях: `contrast.test.ts`
 * держал `SURFACES = ['bg', 'bg1', …]` без префикса, а `screens/StyleGuide`
 * — `SURFACE_TOKENS = ['--bg', '--bg1', …]` с префиксом. Пять значений
 * совпадали, но это совпадение, а не связь: шестая поверхность, добавленная
 * в палитру, попала бы в один список и не попала во второй, и тогда либо
 * сторож не проверил бы её контраст, либо витрина не показала бы её вовсе.
 *
 * Ровно тот же класс, от которого в проекте уже ушли дважды: список вариантов
 * `Badge` на витрине отстал от словаря (показывал 6 из 11) и был переведён
 * на `Object.keys(VARIANT_CHIP_CLASS)`; парсер `columnsOf` переехал
 * в `types/schema.testutil.ts`, чтобы второй сторож не копировал его рядом.
 *
 * ⚠️ ИМЕНА ЗДЕСЬ БЕЗ `--`, и это не каприз. Сторож контраста подставляет их
 * в `it.each('--%s проходит AA')` — с префиксом заголовок теста стал бы
 * `----text`. Префикс добавляет `cssVar()` там, где нужен CSS.
 *
 * Почему пятого уровня серого в списке нет: его нет в палитре вовсе. Иерархия
 * ниже `--text-dim` выражается размером и положением, не контрастом —
 * см. шапку `contrast.test.ts`.
 */

/** Поверхности, на которых может оказаться текст раздела. */
export const SURFACE_TOKENS = ['bg', 'bg1', 'bg3', 'card', 'surface'] as const;

/** Цвета текста. Каждый обязан проходить AA на КАЖДОЙ поверхности выше. */
export const TEXT_TOKENS = ['text', 'text-secondary', 'text-mid', 'text-dim', 'text-muted'] as const;

/** Шкала отступов. */
export const SPACE_TOKENS = ['space-xs', 'space-sm', 'space-md', 'space-lg', 'space-xl', 'space-2xl', 'space-3xl'] as const;

/** Скругления. */
export const RADIUS_TOKENS = ['radius-sm', 'radius-md', 'radius-lg'] as const;

/** Шкала длительностей. Кривые (`--ease-*`) сюда не идут: они не шкала. */
export const DURATION_TOKENS = ['dur-fast', 'dur', 'dur-slow', 'dur-slower'] as const;

/** `'text-dim'` → `'--text-dim'`. Для `style`/`var()`, где нужен префикс. */
export function cssVar(token: string): string {
  return `--${token}`;
}
