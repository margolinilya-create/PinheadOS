import process from 'node:process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { qaSupabaseBridge } from './scripts/qa-supabase-bridge.mjs'

/**
 * Маркер сборки — для проверки «вышло обновление» ДО того, как человек
 * нажмёт на сломанную кнопку (`lib/appVersion`).
 *
 * Выкатка меняет имена чанков, а вкладка, открытая до неё, узнаёт об этом
 * только первым неудачным ленивым импортом — то есть ошибкой на ровном
 * месте (снимки владельца 27.09). Чтобы узнавать раньше, приложение
 * периодически читает `/version.json` и сравнивает с маркером, зашитым
 * в свой код. Оба берутся из ОДНОГО значения здесь: коммит на Vercel,
 * иначе — момент сборки. Маркер не проходит через `/assets/`, поэтому
 * service worker его не кеширует (он кеширует только `/assets/` и `/fonts/`).
 */
const buildId = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || new Date().toISOString();

function buildVersionFile() {
  return {
    name: 'pinhead-build-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: buildId }) });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), buildVersionFile(), ...(process.env.QA_SB_BRIDGE ? [qaSupabaseBridge()] : [])],
  base: '/',
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  build: {
    // Манифест нужен бюджету критического пути (scripts/bundle-budget.mjs):
    // из index.html виден только вход и его modulepreload, а оболочка ERP
    // (ErpApp + общие примитивы + их CSS) — динамический импорт, и в HTML её нет.
    // Страж, считавший один index.html, показывал 207 кБ при реальных 280.
    manifest: true,
    rollupOptions: {
      output: {
        // Крупные вендоры — в отдельные чанки: меньше главный бандл, лучше кеширование.
        //
        // Форма именно функциональная, а не объектная. Объектная перечисляет ТОЧКИ ВХОДА
        // пакетов, а не всё их дерево: `react/jsx-runtime` — отдельный вход, в списке
        // 'vendor-react' его не было, и Rollup отдал его первой группе, которая его
        // затребовала, — vendor-charts. В результате КАЖДЫЙ чанк с JSX статически тянул
        // chart.js (180 кБ / 63 кБ gzip) и Vite ставил его в modulepreload — на дефолтной
        // ERP-оболочке, где нет ни одного графика. Дописать 'react/jsx-runtime' в массив
        // не помогает: хеши чанков не меняются. Регрессию сторожит e2e bundle-budget.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(id)) {
            return 'vendor-react';
          }
          if (id.includes('@supabase')) return 'vendor-supabase';
          if (id.includes('chart.js') || id.includes('react-chartjs-2') || id.includes('@kurkle')) {
            return 'vendor-charts';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/setupTests.js',
    globals: true,
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
