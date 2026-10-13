import { describe, it, expect, beforeEach } from 'vitest';
import { configErrorHtml, renderConfigError } from './configError';

describe('configErrorHtml', () => {
  it('сообщает и что случилось, и что делать', () => {
    const html = configErrorHtml('Приложение не настроено', 'Нет VITE_SUPABASE_URL', 'Создайте .env');
    expect(html).toContain('Приложение не настроено');
    expect(html).toContain('Нет VITE_SUPABASE_URL');
    expect(html).toContain('Создайте .env');
  });

  it('размечен как сообщение об ошибке — иначе скринридер его пропустит', () => {
    expect(configErrorHtml('t', 'd', 'h')).toContain('role="alert"');
  });

  it('не полагается на CSS проекта', () => {
    // Экран рисуется до React и может показаться при незагруженных стилях,
    // поэтому оформление инлайновое, а не классами.
    const html = configErrorHtml('t', 'd', 'h');
    expect(html).toContain('style="');
    expect(html).not.toContain('class=');
  });

  it('экранирует подставляемый текст', () => {
    // В detail попадают имена переменных окружения. Они наши, но экран
    // рисуется в обход React, то есть без его защиты по умолчанию.
    const html = configErrorHtml('<img src=x onerror=alert(1)>', '"&"', 'ok');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&quot;&amp;&quot;');
  });
});

describe('renderConfigError', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('рисует сообщение в #root', () => {
    document.body.innerHTML = '<div id="root"></div>';
    renderConfigError('Заголовок', 'Подробности', 'Подсказка');
    const root = document.getElementById('root');
    expect(root?.textContent).toContain('Заголовок');
    expect(root?.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('без #root не падает — иначе вторичная ошибка спрячет исходную', () => {
    expect(() => renderConfigError('t', 'd', 'h')).not.toThrow();
  });
});
