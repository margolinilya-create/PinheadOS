import { describe, it, expect, vi } from 'vitest';
import { inAppLink, openNoticeLink, setNoticeNavigate } from './noticeNav';

/** Ссылка уведомления — строка из базы: переход только внутри приложения (правки 19.10, п. 7) */
describe('noticeNav', () => {
  it('ведёт только по ссылке, начинающейся с одного «/»', () => {
    expect(inAppLink('/biz-tasks/t1?event=3')).toBe('/biz-tasks/t1?event=3');
    expect(inAppLink('https://evil.example')).toBeNull();
    expect(inAppLink('//evil.example')).toBeNull();
    expect(inAppLink('javascript:alert(1)')).toBeNull();
    expect(inAppLink(null)).toBeNull();
  });

  it('окно браузера с чужой ссылкой никуда не переходит', () => {
    const go = vi.fn();
    const off = setNoticeNavigate(go);
    try {
      openNoticeLink('javascript:alert(1)');
      expect(go).not.toHaveBeenCalled();
      openNoticeLink('/biz-tasks/t1');
      expect(go).toHaveBeenCalledWith('/biz-tasks/t1');
    } finally {
      off();
    }
  });
});
