/**
 * Маркер сборки, подставляемый `define` в `vite.config.js` (коммит на Vercel
 * или момент сборки). Тот же маркер лежит в `dist/version.json` — по паре
 * «зашитый ↔ выложенный» `lib/appVersion` узнаёт, что вышло обновление.
 */
declare const __BUILD_ID__: string;
