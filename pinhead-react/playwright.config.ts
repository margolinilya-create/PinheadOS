import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // {projectName} обязателен: desktop и mobile снимают разные вьюпорты,
  // общий файл эталона делал mobile-прогон вечно красным.
  snapshotPathTemplate: '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}-{projectName}{ext}',
  webServer: {
    // Order Studio заархивирован за флагом; e2e-спеки визарда гоняем с включённым флагом.
    command: 'VITE_FEATURE_ORDER_STUDIO=1 npm run dev',
    url: 'http://localhost:5173',
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
      testIgnore: [/erp-queue\.spec\.ts/, /wizard-flow\.spec\.ts/, /routes-smoke\.spec\.ts/, /erp-tablet\.spec\.ts/],
    },
  ],
});
