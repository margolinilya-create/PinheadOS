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

/**
 * jsPDF без необязательных зависимостей (веха 5а, задача 0; проверка безопасности L6).
 *
 * jsPDF лениво зовёт `import("html2canvas")`, `import("dompurify")` и `import("canvg")` —
 * это `pdf.html()` и `addSvgAsImage`, которые нам запрещены: сцену макета рисует svg2pdf.
 * Если их оставить, Rollup собрал бы ещё три чанка (≈110 кБ gzip, canvg тянет core-js),
 * а хуже того, ради их предзагрузки положил бы помощник `__vitePreload` в `vendor-pdf`,
 * и ВХОД стал бы статически импортировать весь jsPDF (замер спайка 17.10: вход 151 → 303 кБ).
 * Поэтому вызовы заменяются отказом ещё до разбора модуля (jsPDF ловит отказ и сам
 * сообщает «Could not load …»). В dev и vitest зависимость идёт другим путём
 * (предсборка esbuild, node-сборка jsPDF) — замены там нет, и она там не нужна. Счётчик замен строгий:
 * обновление jsPDF, сменившее текст вызова, роняет сборку, а не возвращает чанки молча.
 */
const JSPDF_OPTIONAL = ['html2canvas', 'dompurify', 'canvg'];
function jspdfWithoutOptional() {
  return {
    name: 'pinhead-jspdf-without-optional',
    enforce: 'pre',
    transform(code, id) {
      if (!/node_modules\/jspdf\/dist\/jspdf\.es(\.min)?\.js$/.test(id)) return null;
      let out = code;
      for (const dep of JSPDF_OPTIONAL) {
        const call = `import("${dep}")`;
        const hits = out.split(call).length - 1;
        if (hits !== 1) this.error(`jsPDF: ожидался один вызов ${call}, найдено ${hits} — сверьте vite.config.js`);
        out = out.replace(call, `Promise.reject(new Error("${dep} отключён в сборке Pinhead"))`);
      }
      return { code: out, map: null };
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), buildVersionFile(), jspdfWithoutOptional(), ...(process.env.QA_SB_BRIDGE ? [qaSupabaseBridge()] : [])],
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
          // Вкладка «Дизайн» (веха 5а): три ленивые группы, каждая — своим чанком, чтобы
          // ни одна не приклеилась к общему графу (как vendor-charts выше). Зависимости
          // группы, никем больше не затребованные (pako и iobuffer у fast-png), Rollup
          // кладёт в неё сам. Что эти чанки не попадают во вход и в оболочки ERP и Order,
          // сторожит scripts/bundle-budget.mjs (DESIGN_VENDORS).
          if (/node_modules\/(konva|react-konva|react-reconciler|its-fine)\//.test(id)) return 'vendor-konva';
          if (/node_modules\/(jspdf|svg2pdf\.js|fflate|fast-png)\//.test(id)) return 'vendor-pdf';
          if (id.includes('node_modules/pdfjs-dist/')) return 'vendor-pdfjs';
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
