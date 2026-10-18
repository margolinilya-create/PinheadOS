/**
 * Типы ES-сборки svg2pdf.js — её подставляет тест движка PDF (`exportPdf.test.ts`):
 * поле `main` пакета — UMD, а он в jsdom ищет глобальный `jspdf`. Тот же модуль,
 * что Vite берёт для браузера (`module`/`browser`), — те же типы пакета.
 */
declare module 'svg2pdf.js/dist/svg2pdf.es.js' {
  export * from 'svg2pdf.js';
}
