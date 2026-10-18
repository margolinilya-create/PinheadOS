/**
 * Типы `pdfjs-dist/build/pdf.mjs` (веха 5а, `loadPdf`). У сборки 4.x рядом
 * с `build/pdf.mjs` нет своего `.d.mts`: типы пакета лежат в
 * `types/src/pdf.d.ts` и подключаются корнем пакета — это тот же модуль
 * (`main` = `build/pdf.mjs`). Импорт по явному пути — решение спайка T0:
 * не legacy-сборка.
 */
declare module 'pdfjs-dist/build/pdf.mjs' {
  export * from 'pdfjs-dist';
}
