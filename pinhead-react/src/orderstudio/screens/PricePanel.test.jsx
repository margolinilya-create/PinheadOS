import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PricePanel from './PricePanel';
import { priceOrder } from '../pricing/priceOrder';
import { rulesFromPrices } from './useOrderPrice';
import { newSalesItem, newSalesOrder } from '../model/factory';
import { PRICES } from '../../data/prices';
import { SKU_CATALOG_DEFAULT } from '../../data/skuCatalog';
import { FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT } from '../../data/fabricsCatalog';
import { EXTRAS_CATALOG_DEFAULT } from '../../data/extras';

const CAT = {
  skuCatalog: SKU_CATALOG_DEFAULT,
  fabricsCatalog: FABRICS_CATALOG_DEFAULT,
  trimCatalog: TRIM_CATALOG_DEFAULT,
  extrasCatalog: EXTRAS_CATALOG_DEFAULT,
  usdRate: 92,
};

const order = newSalesOrder({
  items: [newSalesItem({
    kind: 'sku',
    sku_code: SKU_CATALOG_DEFAULT[2].code,
    fabric_code: 'medas-kulirnaya-100-160',
    size_grid: { sizes: ['S', 'M'], rows: [{ color: 'Чёрный', sizes: { S: 20, M: 20 } }] },
  })],
});

/** Цена так же, как в рабочем месте: правила — из прайса (`rulesFromPrices`) */
const priced = (extra) => {
  const P = { ...PRICES, ...extra };
  return priceOrder(order, P, CAT, rulesFromPrices(P));
};

const WARNING = /Маржа ниже порога/;

describe('PricePanel — предупреждение о марже (порог из «Правил цены»)', () => {
  it('порог в процентах выше маржи — предупреждение', () => {
    const price = priced({ minMarginPct: 99 });
    expect(price.total).toBeGreaterThan(0);
    expect(price.margin_pct).toBeLessThan(0.99);
    render(<PricePanel order={order} price={price} />);
    expect(screen.getByText(WARNING)).toBeInTheDocument();
  });

  it('маржа выше порога — предупреждения нет (процент не принят за долю)', () => {
    const price = priced({ minMarginPct: 1 });
    expect(price.margin_pct).toBeGreaterThan(0.01);
    render(<PricePanel order={order} price={price} />);
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  it('порог пуст — «не предупреждать»', () => {
    render(<PricePanel order={order} price={priced({ minMarginPct: null })} />);
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });
});
