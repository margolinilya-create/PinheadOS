import { describe, it, expect } from 'vitest';
import { matchesOrderQuery } from './orderSearch';

const order = {
  bitrix_id: '12345',
  title: 'Худи Осень',
  manager: 'Иванов',
  items: [
    { product_type: 'Худи', variant: 'оверсайз' },
    { product_type: 'Футболка', variant: null },
  ],
  materials: [{ name: 'Футер 3-нитка' }],
};

describe('matchesOrderQuery — единый поиск (правка 5)', () => {
  it('пустой запрос совпадает со всем', () => {
    expect(matchesOrderQuery(order, '')).toBe(true);
    expect(matchesOrderQuery(order, '   ')).toBe(true);
  });

  it('ищет по № сделки, названию, менеджеру', () => {
    expect(matchesOrderQuery(order, '123')).toBe(true);
    expect(matchesOrderQuery(order, 'худи')).toBe(true);
    expect(matchesOrderQuery(order, 'иванов')).toBe(true);
  });

  it('ищет по изделию и варианту', () => {
    expect(matchesOrderQuery(order, 'футболка')).toBe(true);
    expect(matchesOrderQuery(order, 'оверсайз')).toBe(true);
  });

  it('ищет по материалу', () => {
    expect(matchesOrderQuery(order, 'футер')).toBe(true);
  });

  it('не совпадает с посторонним запросом', () => {
    expect(matchesOrderQuery(order, 'кепка')).toBe(false);
  });

  it('устойчив к пустым полям', () => {
    expect(matchesOrderQuery({ title: 'X' }, 'x')).toBe(true);
    expect(matchesOrderQuery({ title: 'X' }, 'y')).toBe(false);
  });
});
