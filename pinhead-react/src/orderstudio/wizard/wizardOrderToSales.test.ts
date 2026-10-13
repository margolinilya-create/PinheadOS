import { describe, it, expect } from 'vitest';
import { wizardOrderToSalesOrder } from './wizardOrderToSales';
import type { WizardCatalogs, WizardItem } from './wizardAdapter';
import { defaultItemFields } from '../../store/slices/helpers';
import { SKU_CATALOG_DEFAULT } from '../../data/skuCatalog';
import { FABRICS_CATALOG_DEFAULT } from '../../data/fabricsCatalog';
import { ZONES_CATALOG_DEFAULT } from '../../data/constants';
import type { SkuItem, Fabric, ZoneDefinition } from '../../types/catalog';

const CAT: WizardCatalogs = {
  skuCatalog: SKU_CATALOG_DEFAULT as unknown as SkuItem[],
  fabricsCatalog: FABRICS_CATALOG_DEFAULT as unknown as Fabric[],
  zonesCatalog: ZONES_CATALOG_DEFAULT as unknown as ZoneDefinition[],
};

const item = (skuIdx: number, over: WizardItem = {}): WizardItem => ({
  ...JSON.parse(JSON.stringify(defaultItemFields)),
  sku: CAT.skuCatalog[skuIdx],
  fabric: 'medas-kulirnaya-100-180',
  color: '01-01',
  sizes: { ...defaultItemFields.sizes, M: 30 },
  zones: ['front'],
  zoneTechs: { front: 'screen' },
  zonePrints: { front: { colors: 2, size: 'A4', textile: 'white', fx: 'none' } },
  ...over,
});

const state = (over: WizardItem = {}): WizardItem => ({
  items: [item(2), item(0, { color: '15-01' })],
  name: 'ООО Ромашка', contact: 'Анна', phone: '+7 900 000-00-00', email: '', messenger: '@anna',
  bitrixDeal: '[12345]', deadline: '2026-10-15', address: 'Москва, Тверская 1', notes: '',
  packOption: false, packType: 'none', urgentOption: true,
  ...over,
});

describe('заказ визарда главной → заказ v4', () => {
  it('каждая позиция визарда — позиция v4', () => {
    const { order } = wizardOrderToSalesOrder(state(), CAT);
    expect(order.items?.map((i) => i.sku_code)).toEqual([CAT.skuCatalog[2].code, CAT.skuCatalog[0].code]);
    expect(order.items?.[0].prints[0]).toMatchObject({ method: 'silkscreen', colors: 2 });
    expect(order.items?.[1].size_grid.rows[0].color).toMatch(/\(15-01\)$/);
  });

  it('позиция без модели не переносится', () => {
    const { order } = wizardOrderToSalesOrder(state({ items: [item(2), { ...item(0), sku: null }] }), CAT);
    expect(order.items).toHaveLength(1);
  });

  it('шапка: клиент, контакт, сделка, срок, адрес, срочность, менеджер, название', () => {
    const { order } = wizardOrderToSalesOrder(state(), CAT, ' Илья ');
    expect(order).toMatchObject({
      customer: 'ООО Ромашка',
      contact: 'Анна, +7 900 000-00-00, @anna',
      bitrix_id: '[12345]',
      due_date: '2026-10-15',
      delivery_address: 'Москва, Тверская 1',
      urgent: true,
      manager: 'Илья',
      title: `ООО Ромашка · ${CAT.skuCatalog[2].name}`,
    });
  });

  it('упаковка: БОПП и ЗИП — индивидуальная с пометкой, без упаковки — none', () => {
    const pack = (packType: string) => {
      const { order } = wizardOrderToSalesOrder(state({ packType, packOption: packType !== 'none' }), CAT);
      return [order.packaging, order.packaging_note];
    };
    expect(pack('bopp')).toEqual(['individual', 'БОПП пакет']);
    expect(pack('zip')).toEqual(['individual', 'ЗИП пакет']);
    expect(pack('none')).toEqual(['none', '']);
  });

  it('старый черновик без packType: packOption читается как БОПП (как в orderSlice)', () => {
    const { order } = wizardOrderToSalesOrder(state({ packType: undefined, packOption: true }), CAT);
    expect(order.packaging_note).toBe('БОПП пакет');
  });

  it('общий комментарий возвращается отдельно — в шапке v4 ему нет поля', () => {
    const r = wizardOrderToSalesOrder(state({ notes: '  позвонить перед отгрузкой ' }), CAT);
    expect(r.notes).toBe('позвонить перед отгрузкой');
    expect(JSON.stringify(r.order)).not.toContain('позвонить');
  });

  it('пустой визард — пустой заказ без падения', () => {
    const { order } = wizardOrderToSalesOrder({}, CAT);
    expect(order).toMatchObject({ items: [], customer: '', title: '', packaging: 'none', urgent: false });
  });
});
