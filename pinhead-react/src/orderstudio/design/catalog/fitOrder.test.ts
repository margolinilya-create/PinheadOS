import { describe, it, expect } from 'vitest';
import { fitRank, sortByFit } from './fitOrder';

describe('fitOrder — посадки от меньшей к большей', () => {
  it('Classic → Regular → FreeFit → Oversize → OversizeCrop', () => {
    const names = [
      'Футболка OversizeCrop', 'Футболка Regular', 'Футболка Oversize',
      'Футболка Classic', 'Футболка FreeFit (oversized)',
    ];
    expect(sortByFit(names.map((name) => ({ name }))).map((s) => s.name)).toEqual([
      'Футболка Classic', 'Футболка Regular', 'Футболка FreeFit (oversized)',
      'Футболка Oversize', 'Футболка OversizeCrop',
    ]);
  });

  it('«FreeFit (oversized)» — это фри, не оверсайз', () => {
    expect(fitRank('Футболка FreeFit (oversized)')).toBe(2);
  });

  it('неизвестные посадки — в конец по алфавиту (Reglan ≠ Regular)', () => {
    const sorted = sortByFit(['Худи Reglan', 'Худи Oversize', 'Худи Classic'].map((name) => ({ name })));
    expect(sorted.map((s) => s.name)).toEqual(['Худи Classic', 'Худи Oversize', 'Худи Reglan']);
  });

  it('не меняет исходный массив', () => {
    const list = [{ name: 'Б Oversize' }, { name: 'А Classic' }];
    sortByFit(list);
    expect(list[0].name).toBe('Б Oversize');
  });
});
