import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // {projectName} обязателен: desktop и mobile снимают разные вьюпорты,
  // общий файл эталона делал mobile-прогон вечно красным.
  snapshotPathTemplate: '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}-{projectName}{ext}',
  webServer: {
    /**
     * Флаги прогона живут в `.env.e2e`, а НЕ в этой команде.
     *
     * Переменные окружения процесса в `import.meta.env` не попадают — этот Vite
     * наполняет его только из `.env`-файлов. Прежняя строка
     * `VITE_FEATURE_ORDER_STUDIO=1 VITE_DEV_AUTOLOGIN=1 npm run dev` выглядела
     * рабочей и не делала ничего: автологин не включался, приложение показывало
     * форму входа, и падал ВЕСЬ прогон — 187 сценариев с одинаковым снимком.
     * Проверяется одним запросом к живому серверу:
     * `curl localhost:5173/src/config/features.ts` печатает подставленный env.
     *
     * Почему не дописать флаги в `.env`: его читает и Vitest, а там есть тесты,
     * проверяющие ровно обратное («orderStudio выключен по умолчанию», «без
     * автологина показывается форма входа»). Режим разводит два прогона.
     */
    command: 'npm run dev -- --mode e2e',
    url: 'http://localhost:5173',
    /**
     * Чужой dev-сервер на 5173 (например, поднятый для ручной проверки) будет
     * принят за свой — со своим `.env` и без флагов e2e. Симптом тот же:
     * массовые падения на экране входа. Порт перед прогоном должен быть свободен.
     */
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'on',
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      args: ['--no-proxy-server'],
    },
  },
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 800 } },
      // Мобильная разметка на 1280px не рендерится — спек проверял бы пустоту
      testIgnore: [/erp-mobile\.spec\.ts/, /erp-tablet\.spec\.ts/],
    },
    {
      // Планшет цеха — основное рабочее устройство, и до 29.07.2026 он не был
      // покрыт ничем: гонялись только 1280 и 375. Именно в этой дыре жил баг,
      // из-за которого при брейкпоинте 760px планшет в портрете (768–800px)
      // получал десктопную строку очереди с колонкой действий за краем экрана.
      // hasTouch обязателен: без него `pointer: coarse` не срабатывает.
      name: 'tablet',
      use: { viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: false },
      testMatch: [/erp-tablet\.spec\.ts/],
    },
    {
      name: 'mobile',
      use: { viewport: { width: 375, height: 812 } },
      // На узком экране это другой интерфейс, а не тот же в меньшем масштабе:
      // в ERP прячется сайдбар и очередь рисуется карточками (QueueCard) вместо строк
      // (QueueRow), в визарде — свой мобильный поток шагов. Гонять desktop-сценарии
      // на 375px бессмысленно: они проверяют разметку, которой там нет.
      // Мобильная разметка ERP покрыта своим спеком — erp-mobile.spec.ts.
      // erp-plan: сайдбар ниже 760px — выезжающий оверлей, и недельная доска
      // из пяти колонок на 375px не разметка «в меньшем масштабе», а другой экран.
      // Сам мобильный вид плана БЕЗ покрытия не остаётся: колонка дня на 88vw,
      // прокрутка внутри доски и проход из выезжающего меню проверяются
      // в erp-mobile.spec.ts — своим сценарием, а не desktop-разметкой
      testIgnore: [
        /erp-queue\.spec\.ts/, /wizard-flow\.spec\.ts/, /routes-smoke\.spec\.ts/,
        /erp-tablet\.spec\.ts/, /erp-plan\.spec\.ts/,
        // erp-audit проверяет десктопную таблицу заказов, сортируемые
        // заголовки и вкладки карточки — на 375px этой разметки нет
        /erp-audit\.spec\.ts/,
        // erp-a11y проверяет десктопные ориентиры и таб-паттерн карточки
        /erp-a11y\.spec\.ts/,
      ],
    },
  ],
});
