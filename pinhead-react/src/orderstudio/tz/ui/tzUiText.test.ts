import { describe, it, expect } from 'vitest';
import { newSalesItem, newSalesOrder } from '../../model/factory';
import { fixtureCatalogs } from '../../fixtures/loadFixture.testutil';
import { tzGroups } from '../model/tzGroups';
import { fileSizeText, groupTitle, isFreshReturn } from './tzUiText';

const catalogs = fixtureCatalogs();
const item = (color: string, qty: number, key: string) => newSalesItem({
  key, sku_code: 'TEE', product_type: 'Футболка FreeFit', fabric_code: 'medas-kulirnaya-100-180',
  size_grid: { sizes: ['M'], rows: [{ color, sizes: { M: qty } }] },
});

describe('тексты «ТЗ и цена»', () => {
  it('подпись группы: модель, ткань из справочника, цвета и штуки всех позиций группы', () => {
    const order = newSalesOrder({ items: [item('Чёрный', 50, 'a'), item('Белый', 100, 'b')] });
    const [g] = tzGroups(order);
    expect(groupTitle(g, catalogs)).toBe('ТЗ 1 из 1: Футболка FreeFit, Кулирная гладь 100% хлопок, 180 г/м² — 2 цвета, 150 шт.');
  });

  it('ткань клиента — текстом; без справочников — текст позиции', () => {
    const order = newSalesOrder({ items: [newSalesItem({ ...item('Чёрный', 5, 'a'), client_fabric: true, main_fabric: 'Своя ткань' })] });
    expect(groupTitle(tzGroups(order)[0], null)).toBe('ТЗ 1 из 1: Футболка FreeFit, Своя ткань — 1 цвет, 5 шт.');
  });

  it('размер файла: МБ с запятой, мелкий — в КБ', () => {
    expect(fileSizeText(1.2 * 1024 * 1024)).toBe('1,2 МБ');
    expect(fileSizeText(1024 * 1024)).toBe('1,0 МБ');
    expect(fileSizeText(320 * 1024)).toBe('320 КБ');
    expect(fileSizeText(10)).toBe('1 КБ');
  });

  it('возврат свежий, только если он новее отправки', () => {
    expect(isFreshReturn(null, '2026-10-18T09:00:00Z')).toBe(false);
    expect(isFreshReturn({ at: '2026-10-19T08:00:00Z' }, '2026-10-18T09:00:00Z')).toBe(true);
    expect(isFreshReturn({ at: '2026-10-18T08:00:00Z' }, '2026-10-18T09:00:00Z')).toBe(false);
    expect(isFreshReturn({ at: '2026-10-18T08:00:00Z' }, null)).toBe(true);
  });
});
