import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PackagingTab from './PackagingTab';
import PricingRulesTab from './PricingRulesTab';
import TzTab from './TzTab';
import { fetchCatalogKey } from '../../../lib/catalogs';
import { putCatalog, patchPrices } from '../../api/catalogAdmin';
import { useStore } from '../../../store/useStore';
import { useToastStore } from '../../../store/useToastStore';
import { PRICES } from '../../../data/prices';
import { PACK_OPTIONS_SEED, TZ_SETTINGS_SEED } from '../../catalog/seeds';
import { usePackagingOptions } from '../../screens/labels';

vi.mock('../../../lib/catalogs', () => ({
  fetchCatalogKey: vi.fn(),
  clearCatalogsCache: vi.fn(),
  loadAllCatalogs: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../api/catalogAdmin', () => ({
  putCatalog: vi.fn(),
  patchPrices: vi.fn(),
}));

const fetchMock = vi.mocked(fetchCatalogKey);
const putMock = vi.mocked(putCatalog);
const patchMock = vi.mocked(patchPrices);

/** Прайс в базе после миграции G: прежние ключи + три ключа правил */
const DB_PRICES = { label: 30, usdRate: 90, packOptions: PACK_OPTIONS_SEED, prepFees: {}, minMarginPct: null };

beforeEach(() => {
  vi.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  useStore.setState({ prices: PRICES, tzSettings: TZ_SETTINGS_SEED });
  fetchMock.mockImplementation(async (_t, key) => (key === 'prices'
    ? { exists: true, value: DB_PRICES }
    : { exists: true, value: { footerText: 'Подвал из базы' } }));
  putMock.mockResolvedValue({ ok: true });
  patchMock.mockResolvedValue({ ok: true });
});

const button = (name) => screen.getByRole('button', { name });

describe('«Упаковка»', () => {
  it('4 вида; правка подписи и цены пишет только packOptions прайса', async () => {
    render(<PackagingTab readOnly={false} />);
    const zipName = await screen.findByLabelText('Подпись: ЗИП пакет');
    expect(screen.getAllByRole('row')).toHaveLength(5);
    fireEvent.change(zipName, { target: { value: 'ЗИП-лок с бегунком' } });
    fireEvent.change(screen.getByLabelText('Цена: ЗИП пакет, ₽ за штуку'), { target: { value: '45' } });
    fireEvent.click(button('Сохранить упаковку'));
    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    const [patch, base] = patchMock.mock.calls[0];
    expect(Object.keys(patch)).toEqual(['packOptions']);
    expect(patch.packOptions.find((o) => o.key === 'zip')).toEqual({ key: 'zip', name: 'ЗИП-лок с бегунком', price: 45 });
    expect(patch.packOptions.map((o) => o.key)).toEqual(['none', 'bopp', 'zip', 'other']);
    expect(base).toEqual({ packOptions: PACK_OPTIONS_SEED });
    // Стор обновлён — подпись видна в заказе
    await waitFor(() => expect(useStore.getState().prices.packOptions[2].name).toBe('ЗИП-лок с бегунком'));
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain('Упаковка сохранена');
  });

  it('пустая подпись или отрицательная цена — сохранение закрыто, причина у поля', async () => {
    render(<PackagingTab readOnly={false} />);
    const bopp = await screen.findByLabelText('Подпись: БОПП пакет');
    fireEvent.change(bopp, { target: { value: '  ' } });
    expect(screen.getByText(/Впишите подпись/)).toBeInTheDocument();
    expect(button('Сохранить упаковку')).toBeDisabled();
    fireEvent.change(bopp, { target: { value: 'БОПП' } });
    fireEvent.change(screen.getByLabelText('Цена: БОПП пакет, ₽ за штуку'), { target: { value: '-3' } });
    expect(screen.getByText('Цена — число не меньше 0')).toBeInTheDocument();
    expect(button('Сохранить упаковку')).toBeDisabled();
  });

  it('на телефоне — только просмотр', async () => {
    render(<PackagingTab readOnly />);
    expect(await screen.findByLabelText('Подпись: ЗИП пакет')).toBeDisabled();
    expect(button('Сохранить упаковку')).toBeDisabled();
  });

  it('прайс не загрузился — встроенные значения видны, сохранить нельзя', async () => {
    fetchMock.mockResolvedValue(null);
    render(<PackagingTab readOnly={false} />);
    expect(await screen.findByText(/Справочник не загрузился/)).toBeInTheDocument();
    expect(screen.getByLabelText('Подпись: БОПП пакет')).toHaveValue('БОПП пакет');
    expect(button('Сохранить упаковку')).toBeDisabled();
  });
});

describe('«Правила цены»', () => {
  it('порог маржи: число — процент, пусто — null («не предупреждать»)', async () => {
    render(<PricingRulesTab readOnly={false} />);
    const field = await screen.findByLabelText('Предупреждать, если маржа ниже, %');
    expect(field).toHaveValue(null);
    fireEvent.change(field, { target: { value: '25' } });
    fireEvent.click(button('Сохранить правила цены'));
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith({ minMarginPct: 25 }, { minMarginPct: null }));
  });

  it('порог вне 0–100 — сохранение закрыто', async () => {
    render(<PricingRulesTab readOnly={false} />);
    fireEvent.change(await screen.findByLabelText('Предупреждать, если маржа ниже, %'), { target: { value: '150' } });
    expect(screen.getByText('Процент от 0 до 100 или пусто')).toBeInTheDocument();
    expect(button('Сохранить правила цены')).toBeDisabled();
  });

  it('подготовка по всем методам нанесения; пусто — ключа нет', async () => {
    render(<PricingRulesTab readOnly={false} />);
    await screen.findByLabelText('Шелкография');
    for (const name of ['Шелкография', 'Вышивка', 'DTF', 'Флекс / термоперенос', 'DTG', 'Сублимация', 'Шевроны / нашивки', 'Прочее / подряд']) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    fireEvent.change(screen.getByLabelText('Шелкография'), { target: { value: '1500' } });
    fireEvent.change(screen.getByLabelText('Вышивка'), { target: { value: '800' } });
    fireEvent.change(screen.getByLabelText('Вышивка'), { target: { value: '' } });
    fireEvent.click(button('Сохранить правила цены'));
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith({ prepFees: { silkscreen: 1500 } }, { prepFees: {} }));
  });

  it('конфликт: правки на экране, текст конфликта, сохранение закрыто до свежей версии', async () => {
    patchMock.mockResolvedValueOnce({ ok: false, kind: 'conflict', message: 'x' });
    render(<PricingRulesTab readOnly={false} />);
    const field = await screen.findByLabelText('Предупреждать, если маржа ниже, %');
    fireEvent.change(field, { target: { value: '20' } });
    fireEvent.click(button('Сохранить правила цены'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Справочник «Правила цены» уже изменили');
    expect(field).toHaveValue(20);
    expect(button('Сохранить правила цены')).toBeDisabled();
  });
});

describe('«Подвал ТЗ»', () => {
  it('правка подвала — catalog_put tzSettings с базой из загрузки', async () => {
    render(<TzTab readOnly={false} />);
    const area = await screen.findByLabelText('Текст подвала');
    expect(area).toHaveValue('Подвал из базы');
    fireEvent.change(area, { target: { value: 'Допуск — до 1 см' } });
    fireEvent.click(button('Сохранить подвал ТЗ'));
    await waitFor(() => expect(putMock).toHaveBeenCalledWith(
      'app_config', 'tzSettings', { footerText: 'Допуск — до 1 см' }, { footerText: 'Подвал из базы' },
    ));
  });

  it('строки ещё нет — подвал по умолчанию из сида, сохранить нельзя', async () => {
    fetchMock.mockResolvedValue({ exists: false, value: null });
    render(<TzTab readOnly={false} />);
    expect(await screen.findByLabelText('Текст подвала')).toHaveValue(TZ_SETTINGS_SEED.footerText);
    expect(TZ_SETTINGS_SEED.footerText).toBe('Допуск по размещению нанесения — до 2 см');
    expect(button('Сохранить подвал ТЗ')).toBeDisabled();
  });
});

describe('подпись упаковки — один источник', () => {
  it('сохранённая в админке подпись приходит в выбор упаковки заказа', async () => {
    function Picker() {
      const opts = usePackagingOptions();
      return <ul>{opts.map((o) => <li key={o.key}>{o.label}</li>)}</ul>;
    }
    render(<><PackagingTab readOnly={false} /><Picker /></>);
    fireEvent.change(await screen.findByLabelText('Подпись: БОПП пакет'), { target: { value: 'Пакет БОПП 30 мкм' } });
    fireEvent.click(button('Сохранить упаковку'));
    await waitFor(() => expect(screen.getByText('Пакет БОПП 30 мкм', { selector: 'li' })).toBeInTheDocument());
  });
});
