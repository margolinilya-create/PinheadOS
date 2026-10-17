import { describe, it, expect } from 'vitest';
import {
  shouldBlockSalesLeave, salesHasUnsaved, salesLeaveDialogText,
  setCatalogUnsaved, catalogHasUnsaved, shouldBlockCatalogLeave,
} from './leaveGuard';

describe('shouldBlockSalesLeave — уход с карточки v4 после сбоя сохранения', () => {
  it('сбой сохранения и уход в список — спросить', () => {
    expect(shouldBlockSalesLeave({ saveState: 'error', from: '/sales/o-1', to: '/sales' })).toBe(true);
    expect(shouldBlockSalesLeave({ saveState: 'error', from: '/sales/o-1', to: '/sales/o-2' })).toBe(true);
  });
  it('вложенный адрес того же заказа — не уход', () => {
    expect(shouldBlockSalesLeave({ saveState: 'error', from: '/sales/o-1', to: '/sales/o-1/item/new' })).toBe(false);
  });
  it('outdated и conflict — запись остановлена, правки только в карточке: спросить', () => {
    for (const saveState of ['outdated', 'conflict']) {
      expect(shouldBlockSalesLeave({ saveState, from: '/sales/o-1', to: '/sales' })).toBe(true);
      expect(shouldBlockSalesLeave({ saveState, from: '/sales/o-1', to: '/sales/o-1/item/new' })).toBe(false);
      expect(shouldBlockSalesLeave({ saveState, from: '/sales', to: '/' })).toBe(false);
    }
  });
  it('locked — правка закрыта, терять нечего: не спрашиваем', () => {
    expect(shouldBlockSalesLeave({ saveState: 'locked', from: '/sales/o-1', to: '/sales' })).toBe(false);
  });
  it('без сбоя не спрашиваем: несохранённое догоняет flush при уходе', () => {
    expect(shouldBlockSalesLeave({ saveState: 'dirty', from: '/sales/o-1', to: '/sales' })).toBe(false);
    expect(shouldBlockSalesLeave({ saveState: 'clean', from: '/sales/o-1', to: '/sales' })).toBe(false);
  });
  it('уход не с карточки — не наше дело', () => {
    expect(shouldBlockSalesLeave({ saveState: 'error', from: '/sales', to: '/' })).toBe(false);
  });
});

describe('salesLeaveDialogText — текст диалога ухода', () => {
  it('outdated и conflict — скопировать и обновить страницу', () => {
    const text = 'Правка не сохранена — скопируйте изменения и обновите страницу. Уйти без сохранения?';
    expect(salesLeaveDialogText('outdated')).toBe(text);
    expect(salesLeaveDialogText('conflict')).toBe(text);
  });
  it('error — прежний текст про повтор после восстановления связи', () => {
    expect(salesLeaveDialogText('error')).toBe(
      'Последнее сохранение не удалось. Если уйти сейчас, правки потеряются — останьтесь и повторите после восстановления связи.',
    );
  });
});

describe('salesHasUnsaved — предупреждение при закрытии вкладки', () => {
  it('правка не ушла или ушла с ошибкой', () => {
    expect(['dirty', 'saving', 'error'].every(salesHasUnsaved)).toBe(true);
    expect(salesHasUnsaved('clean')).toBe(false);
  });
  it('outdated и conflict — правки в карточке так и не ушли: предупредить', () => {
    expect(['outdated', 'conflict'].every(salesHasUnsaved)).toBe(true);
  });
  it('locked — правка закрыта, терять нечего', () => {
    expect(salesHasUnsaved('locked')).toBe(false);
  });
});

describe('справочники заказа — уход с несохранёнными правками', () => {
  it('нет правок — не спрашиваем', () => {
    expect(catalogHasUnsaved()).toBe(false);
    expect(shouldBlockCatalogLeave({ from: '/order-settings', to: '/sales' })).toBe(false);
  });

  it('есть правки: уход со страницы — спросить, смена ?tab= (тот же путь) — нет', () => {
    setCatalogUnsaved('a', true);
    expect(catalogHasUnsaved()).toBe(true);
    expect(shouldBlockCatalogLeave({ from: '/order-settings', to: '/sales' })).toBe(true);
    expect(shouldBlockCatalogLeave({ from: '/order-settings', to: '/order-settings' })).toBe(false);
    setCatalogUnsaved('a', false);
    expect(catalogHasUnsaved()).toBe(false);
  });

  it('два редактора: снятие отметки одного не снимает другого', () => {
    setCatalogUnsaved('a', true);
    setCatalogUnsaved('b', true);
    setCatalogUnsaved('a', false);
    expect(catalogHasUnsaved()).toBe(true);
    setCatalogUnsaved('b', false);
    expect(catalogHasUnsaved()).toBe(false);
  });
});
