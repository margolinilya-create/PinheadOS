/**
 * Маркер сборки (`/version.json` и `__BUILD_ID__`, см. `vite.config.js` и `lib/appVersion`).
 *
 * Коммит на Vercel (12 знаков), иначе — момент сборки; плюс значение аварийного
 * выключателя раздела «Оформление заказа» `VITE_FEATURE_ORDER_STUDIO` (веха 8, К1).
 * Без флага в маркере redeploy того же коммита с `=0` давал бы тот же маркер:
 * открытая вкладка не узнала бы о выключении (`isNewerBuild` → false) до первого
 * упавшего ленивого импорта — или не узнала бы вовсе.
 *
 * @param {Record<string, string | undefined>} env переменные окружения сборки
 * @param {() => string} now момент сборки, если коммита нет
 * @returns {string}
 */
export function makeBuildId(env, now = () => new Date().toISOString()) {
  const base = env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || now();
  return `${base}-${env.VITE_FEATURE_ORDER_STUDIO ?? ''}`;
}
