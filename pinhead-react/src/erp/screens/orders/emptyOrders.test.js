import { describe, it, expect } from 'vitest';
import { emptyOrders } from './emptyOrders';
import { ICON_NAMES } from '../../components/icons';

/**
 * Сторож пустого состояния списка заказов.
 *
 * Прежде выбор текста был вложенной тернарной лесенкой прямо в разметке —
 * шесть исходов, которые нельзя было проверить иначе как глазами. Здесь
 * проверяются ВСЕ ветки, включая ту, ради которой правило UX-2 и написано:
 * «работы нет» и «подбор ничего не нашёл» обязаны различаться.
 */
describe('emptyOrders', () => {
  describe('во вкладке есть строки — значит пусто из-за подбора', () => {
    it('поиск: отдаёт результат подбора и возвращает сам запрос', () => {
      const out = emptyOrders({
        tab: 'active', filter: null, inTabCount: 12, query: '  худи  ',
      });
      expect(out).toEqual({ kind: 'result', query: 'худи', byDate: false });
    });

    it('даты: запроса нет, но подбор сузили — это всё равно результат', () => {
      const out = emptyOrders({
        tab: 'active', filter: null, inTabCount: 12, dateFrom: '2026-09-01',
      });
      expect(out).toEqual({ kind: 'result', query: '', byDate: true });
    });

    it('верхняя граница дат считается так же, как нижняя', () => {
      const out = emptyOrders({
        tab: 'active', filter: null, inTabCount: 3, dateTo: '2026-09-30',
      });
      expect(out.kind).toBe('result');
      expect(out.byDate).toBe(true);
    });

    it('подбор главнее вкладки: архив с наличием строк тоже даёт результат', () => {
      const out = emptyOrders({
        tab: 'archive', filter: null, inTabCount: 7, query: 'zzz',
      });
      expect(out).toEqual({ kind: 'result', query: 'zzz', byDate: false });
    });

    it('строка из одних пробелов запросом не считается', () => {
      const out = emptyOrders({
        tab: 'active', filter: null, inTabCount: 5, query: '   ',
      });
      expect(out).toEqual({ kind: 'result', query: '', byDate: false });
    });
  });

  describe('во вкладке нет ничего по существу', () => {
    it('архив пуст', () => {
      const out = emptyOrders({ tab: 'archive', filter: null, inTabCount: 0 });
      expect(out.kind).toBe('empty');
      expect(out.title).toBe('Архив пуст');
      expect(out.text).toMatch(/сданные и отменённые/i);
    });

    it('вкладка «Активные» без фильтра зовёт создать первый заказ', () => {
      const out = emptyOrders({ tab: 'active', filter: null, inTabCount: 0 });
      expect(out.kind).toBe('empty');
      expect(out.title).toBe('Активных заказов нет');
      expect(out.text).toMatch(/Новый заказ/);
    });

    it('фильтр «Готовы к отгрузке»', () => {
      const out = emptyOrders({ tab: 'active', filter: 'ready', inTabCount: 0 });
      expect(out.title).toBe('Готовых к отгрузке заказов пока нет');
      expect(out.text).toMatch(/Готовы к отгрузке/);
    });

    it('фильтр «Срок ≤ 3 дней»', () => {
      const out = emptyOrders({ tab: 'active', filter: 'urgent', inTabCount: 0 });
      expect(out.title).toBe('Заказов со сроком ≤ 3 дней нет');
      expect(out.text).toMatch(/Срок ≤ 3 дней/);
    });

    it('фильтр «Просрочено»', () => {
      const out = emptyOrders({ tab: 'active', filter: 'overdue', inTabCount: 0 });
      expect(out.title).toBe('Просроченных заказов нет');
      expect(out.text).toMatch(/Просрочено/);
    });

    it('архив главнее фильтра: чипы сроков там не показываются вовсе', () => {
      const out = emptyOrders({ tab: 'archive', filter: 'overdue', inTabCount: 0 });
      expect(out.title).toBe('Архив пуст');
    });

    it('неизвестный фильтр разбирается как «без фильтра», а не падает', () => {
      const out = emptyOrders({ tab: 'active', filter: 'stopped', inTabCount: 0 });
      expect(out.title).toBe('Активных заказов нет');
    });

    it('у каждой ветки есть заголовок, пояснение и СУЩЕСТВУЮЩАЯ иконка', () => {
      const cases = [
        { tab: 'archive', filter: null, inTabCount: 0 },
        { tab: 'active', filter: null, inTabCount: 0 },
        { tab: 'active', filter: 'ready', inTabCount: 0 },
        { tab: 'active', filter: 'urgent', inTabCount: 0 },
        { tab: 'active', filter: 'overdue', inTabCount: 0 },
      ];
      for (const c of cases) {
        const out = emptyOrders(c);
        expect(out.title, JSON.stringify(c)).toBeTruthy();
        expect(out.text, JSON.stringify(c)).toBeTruthy();
        // Имя иконки, которого нет в наборе, рисуется пустотой и молча:
        // ровно тот отказ, из-за которого набор заведён справочником
        expect(ICON_NAMES, JSON.stringify(c)).toContain(out.icon);
      }
    });
  });
});
