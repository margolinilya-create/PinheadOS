// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withoutJsComments } from './utils/migrations.testutil';

/**
 * ГРАНИЦА ЭКРАНА ERP ОТЛИЧАЕТ УСТАРЕВШУЮ ВКЛАДКУ ОТ ПОЛОМКИ.
 *
 * 27.09 нажатие «Новый заказ» на вкладке, открытой до выкатки, показало
 * «Не удалось загрузить экран (Failed to fetch dynamically imported module:
 * …/CreateOrderModal-….js)» с кнопкой «Повторить», которая при отказе
 * `React.lazy` не делает ничего. Распознавание такого отказа в проекте
 * было (`lib/appUpdate`, полноэкранная граница, `unhandledrejection`), но
 * локальный фолбэк оболочки ERP собирал текст сам и мимо него.
 *
 * Компонент `ScreenCrashed` покрыт своим тестом; этот сторож — про ПРОВОДКУ:
 * тест компонента остался бы зелёным, верни кто-нибудь в `ErpApp` рукописный
 * `LoadFailed` с `error?.message`.
 */
const ERP_APP = withoutJsComments(
  readFileSync(join(process.cwd(), 'src', 'erp', 'ErpApp.jsx'), 'utf8'),
);

describe('фолбэк границы экрана ERP', () => {
  it('идёт через ScreenCrashed', () => {
    expect(ERP_APP).toMatch(/fallback=\{\(error, reset\) => <ScreenCrashed error=\{error\} onRetry=\{reset\} \/>\}/);
  });

  it('не собирает текст ошибки вручную мимо распознавания обновления', () => {
    expect(ERP_APP).not.toMatch(/error\?\.message/);
    expect(ERP_APP).not.toMatch(/<LoadFailed\b/);
  });
});
