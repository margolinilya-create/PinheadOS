import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { qaSupabaseBridge } from './scripts/qa-supabase-bridge.mjs'
import { makeBuildId } from './scripts/build-id.mjs'

/**
 * Маркер сборки — для проверки «вышло обновление» ДО того, как человек
 * нажмёт на сломанную кнопку (`lib/appVersion`).
 *
 * Выкатка меняет имена чанков, а вкладка, открытая до неё, узнаёт об этом
 * только первым неудачным ленивым импортом — то есть ошибкой на ровном
 * месте (снимки владельца 27.09). Чтобы узнавать раньше, приложение
 * периодически читает `/version.json` и сравнивает с маркером, зашитым
 * в свой код. Оба берутся из ОДНОГО значения здесь: коммит на Vercel,
 * иначе — момент сборки, плюс значение выключателя `VITE_FEATURE_ORDER_STUDIO`
 * (веха 8: redeploy того же коммита с `=0` обязан дать новый маркер —
 * `scripts/build-id.mjs`). Флаг читается из окружения процесса, как на Vercel;
 * значение из файла `.env*` в маркер не попадает — выключатель ставится
 * переменной Vercel. Маркер не проходит через `/assets/`, поэтому
 * service worker его не кеширует (он кеширует только `/assets/` и `/fonts/`).
 */
const buildId = makeBuildId(process.env);

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

/**
 * konva без ссылки на `global` Node (веха 5а, задача 8; бюджет «вход и оболочка ERP не растут»).
 *
 * `konva/lib/Global.js` (CommonJS) выбирает глобальный объект так: `typeof global !== 'undefined'
 * ? global : window …`. Плагин commonjs Rollup подменяет `global` своим помощником
 * `commonjsGlobal`, а помощники CommonJS живут в чанке, который затребовал их первым, —
 * `vendor-react`. Тогда КАЖДЫЙ человек, открывший «Производство», скачивал бы определение
 * помощника и его экспорт для холста, которого не увидит (замер 18.10: +64 Б gzip входа
 * и оболочки ERP вместе с привязкой `scheduler`). В браузере ветка `global` не нужна —
 * konva и так берёт `window`, поэтому ветка вырезается ещё до разбора модуля. Счётчик
 * замен строгий, как у jsPDF ниже: обновление konva, сменившее текст, роняет сборку,
 * а не возвращает помощник в `vendor-react` молча. В dev и vitest konva идёт через
 * предсборку esbuild — замены там нет, и она там не нужна (`global` в браузере не определён).
 */
const KONVA_NODE_GLOBAL = "exports.glob = typeof global !== 'undefined'\n    ? global\n    : typeof window";
function konvaWithoutNodeGlobal() {
  return {
    name: 'pinhead-konva-without-node-global',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!/node_modules\/konva\/lib\/Global\.js$/.test(id)) return null;
      const hits = code.split(KONVA_NODE_GLOBAL).length - 1;
      if (hits !== 1) this.error(`konva: ожидалась одна ветка \`typeof global\` в Global.js, найдено ${hits} — сверьте vite.config.js`);
      return { code: code.replace(KONVA_NODE_GLOBAL, 'exports.glob = typeof window'), map: null };
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), buildVersionFile(), jspdfWithoutOptional(), konvaWithoutNodeGlobal(), ...(process.env.QA_SB_BRIDGE ? [qaSupabaseBridge()] : [])],
  base: '/',
  resolve: {
    // Ядро konva без Tween/Animation/FastLayer (≈ 3 кБ gzip холста «Дизайн»):
    // react-konva берёт `konva/lib/Core`, подменяем его своим составом.
    // Почему и как сверять при обновлении — шапка src/orderstudio/design/ui/konvaCore.ts.
    alias: [{ find: /^konva\/lib\/Core(\.js)?$/, replacement: fileURLToPath(new URL('./src/orderstudio/design/ui/konvaCore.ts', import.meta.url)) }],
  },
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
