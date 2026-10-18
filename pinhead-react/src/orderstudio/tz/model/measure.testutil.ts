import { PT_MM, type Measure } from './fitText';

/** Моноширинная заглушка ширины для тестов модели: знак = половина кегля */
export const mono: Measure = (s, pt) => s.length * pt * PT_MM * 0.5;
