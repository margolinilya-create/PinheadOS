import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import LabelRow from './LabelRow';
import { useStore } from '../../store/useStore';
import { LABEL_LIBRARY_SEED } from '../catalog/seeds';
import { newSalesLabel } from '../model/factory';

/** Сид с правкой вида `brand`: снятый вариант `custom`, снятый материал `canvas`, схема `inseam` снята */
const RETIRED = {
  kinds: LABEL_LIBRARY_SEED.kinds.map((k) => (k.type !== 'brand' ? k : {
    ...k,
    variants: k.variants.map((v) => (v.id === 'custom' ? { ...v, active: false } : v)),
    materials: k.materials.map((m) => (m.key === 'canvas' ? { ...m, active: false } : m)),
  })),
  schemes: LABEL_LIBRARY_SEED.schemes.map((s) => (s.id === 'inseam' ? { ...s, active: false } : s)),
};

function row(label, lib = LABEL_LIBRARY_SEED) {
  useStore.setState({ labelLibrary: lib });
  const onChange = vi.fn();
  render(<LabelRow label={newSalesLabel(label)} index={0} onChange={onChange} onRemove={vi.fn()} />);
  return onChange;
}

const select = (name) => screen.getByRole('combobox', { name });
const optionTexts = (name) => within(select(name)).getAllByRole('option').map((o) => o.textContent);

beforeEach(() => useStore.setState({ labelLibrary: LABEL_LIBRARY_SEED }));

describe('LabelRow — по библиотеке бирок', () => {
  it('вид, вариант и материал — из библиотеки; цена в шапке — по ней', () => {
    row({ label_type: 'brand', variant_id: 'custom:canvas' });
    expect(optionTexts('Тип')).toContain('Брендовая бирка');
    expect(select('Вариант')).toHaveValue('custom');
    expect(select('Материал')).toHaveValue('canvas');
    expect(screen.getByText(/Бирка 1 · 55/)).toBeInTheDocument();
  });

  it('цена из правленной библиотеки', () => {
    const lib = {
      ...LABEL_LIBRARY_SEED,
      kinds: LABEL_LIBRARY_SEED.kinds.map((k) => (k.type !== 'brand' ? k : {
        ...k, variants: k.variants.map((v) => (v.id === 'custom' ? { ...v, price: 70 } : v)),
      })),
    };
    row({ label_type: 'brand', variant_id: 'custom' }, lib);
    expect(screen.getByText(/Бирка 1 · 70/)).toBeInTheDocument();
  });

  it('без варианта показан «Стандартный», материал — без надбавки; показ ничего не пишет', () => {
    const onChange = row({ label_type: 'brand' });
    expect(select('Вариант')).toHaveValue('standard');
    expect(select('Материал')).toHaveValue('woven');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('вариант без материала (бирка клиента) — поля материала нет, материал не пишется', () => {
    const onChange = row({ label_type: 'brand', variant_id: 'custom:canvas' });
    fireEvent.change(select('Вариант'), { target: { value: 'send-own' } });
    expect(onChange).toHaveBeenCalledWith({ variant_id: 'send-own' });
  });

  it('смена материала пишет `вариант:материал`', () => {
    const onChange = row({ label_type: 'brand', variant_id: 'custom' });
    fireEvent.change(select('Материал'), { target: { value: 'polyester' } });
    expect(onChange).toHaveBeenCalledWith({ variant_id: 'custom:polyester' });
  });
});

describe('LabelRow — снятое с продажи', () => {
  it('снятый вариант и материал, уже стоящие в бирке, — на месте с пометкой', () => {
    const onChange = row({ label_type: 'brand', variant_id: 'custom:canvas', attach_scheme: 'inseam' }, RETIRED);
    expect(select('Вариант')).toHaveValue('custom');
    expect(optionTexts('Вариант')).toContain('Своя (дизайн клиента) (снят с продажи)');
    expect(select('Материал')).toHaveValue('canvas');
    expect(optionTexts('Материал')).toContain('Хлопковый канвас (снят с продажи)');
    expect(select('Схема притачивания')).toHaveValue('inseam');
    expect(optionTexts('Схема притачивания')).toContain('Петля вшивная (шов) (снят с продажи)');
    expect(screen.getByText(/Бирка 1 · 55/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('новой бирке снятое не предлагается', () => {
    row({ label_type: 'brand', variant_id: 'standard' }, RETIRED);
    expect(optionTexts('Вариант')).toEqual(['Стандартная', 'Бирка клиента — пришлёт сам']);
    expect(optionTexts('Материал')).toEqual(['Тканая', 'Полиэстер']);
    expect(optionTexts('Схема притачивания')).toEqual(['—', 'На воротнике (спина)']);
  });

  it('прежний свободный текст схемы показан как есть', () => {
    row({ label_type: 'size', attach_scheme: 'Под ярлыком' });
    expect(select('Схема притачивания')).toHaveValue('Под ярлыком');
    expect(optionTexts('Схема притачивания')).toContain('Под ярлыком (нет в справочнике)');
  });
});

describe('LabelRow — бланк и схема пишутся в позицию', () => {
  it('«Бланк»', () => {
    const onChange = row({ label_type: 'composition' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Бланк — без печати' }));
    expect(onChange).toHaveBeenCalledWith({ blank: true });
  });

  it('«Бланк» снимается', () => {
    const onChange = row({ label_type: 'composition', blank: true });
    expect(screen.getByRole('checkbox', { name: 'Бланк — без печати' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Бланк — без печати' }));
    expect(onChange).toHaveBeenCalledWith({ blank: false });
  });

  it('схема притачивания — id схемы библиотеки', () => {
    const onChange = row({ label_type: 'brand' });
    fireEvent.change(select('Схема притачивания'), { target: { value: 'neck' } });
    expect(onChange).toHaveBeenCalledWith({ attach_scheme: 'neck' });
  });

  it('смена вида сбрасывает вариант', () => {
    const onChange = row({ label_type: 'brand', variant_id: 'custom:canvas' });
    fireEvent.change(select('Тип'), { target: { value: 'hangtag' } });
    expect(onChange).toHaveBeenCalledWith({ label_type: 'hangtag', variant_id: '' });
  });
});
