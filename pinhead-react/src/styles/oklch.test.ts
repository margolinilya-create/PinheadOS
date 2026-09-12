import { describe, it, expect } from 'vitest';
import {
  hexToOklch, oklchToHex, outOfGamut, solveForLuminance, recolorKeepingLuminance, LUMA_EPS,
} from './oklch';
import {
  contrastRatio, relativeLuminance, hexToRgb, ratioSensitivity,
} from './contrast';

/**
 * Инструмент подбора тона: проверяется ЗНАЧЕНИЯМИ — он для этого и написан.
 *
 * Главное утверждение последнего блока — то самое правило проекта, ради
 * которого всё это заведено: перекраска, сохраняющая яркость, НЕ ДВИГАЕТ
 * ни одного отношения контраста. Подбор на глаз под ту же цель однажды увёл
 * `--text-dim` на `--bg3` с 4.56 до 4.28, то есть ниже AA.
 */

/** Максимальное расхождение канала при round-trip — один шаг квантования. */
const CHANNEL_EPS = 1;

const SAMPLES = [
  '#ffffff', '#000000', '#808080',
  // Настоящие токены проекта: фирменный акцент, чернила, бумага
  '#17181a', '#eceae5', '#2563eb', '#06a77d', '#c0392b', '#6B7280',
];

describe('sRGB ↔ OKLCH — round-trip', () => {
  it.each(SAMPLES)('%s возвращается собой', (hex) => {
    const back = oklchToHex(hexToOklch(hex));
    const a = hexToRgb(hex);
    const b = hexToRgb(back);
    a.forEach((v, i) => {
      expect(Math.abs(v - b[i]), `${hex} → ${back}, канал ${i}`).toBeLessThanOrEqual(CHANNEL_EPS);
    });
  });

  it('у серого хрома нулевая, а угол не шумит', () => {
    const { c, h } = hexToOklch('#808080');
    expect(c).toBeLessThan(0.002);
    // У серого оттенка нет вовсе; случайный угол из atan2 шума здесь был бы
    // источником «почти одинаковых» тонов с разными числами
    expect(h).toBe(0);
  });

  it('светлота растёт от чёрного к белому', () => {
    expect(hexToOklch('#000000').l).toBeLessThan(hexToOklch('#808080').l);
    expect(hexToOklch('#808080').l).toBeLessThan(hexToOklch('#ffffff').l);
  });
});

describe('solveForLuminance — обратная задача', () => {
  it('находит тон с заданной яркостью', () => {
    const target = relativeLuminance('#6B7280');
    const got = solveForLuminance(target, 250, 0.02);
    expect(got).toBeTruthy();
    expect(got!.lumaError).toBeLessThanOrEqual(LUMA_EPS);
    expect(Math.abs(relativeLuminance(got!.hex) - target)).toBeLessThanOrEqual(LUMA_EPS);
  });

  /**
   * НЕДОСТИЖИМАЯ ЦЕЛЬ ОТДАЁТ `null`, А НЕ «ближайшее похожее». Подсунуть
   * похожий тон здесь нельзя: он нарушал бы ровно то правило, ради которого
   * инструмент и написан, — и молча.
   */
  it('возвращает null, когда в этом оттенке такой яркости нет', () => {
    // Яркость белого при большой хроме недостижима: такого цвета в sRGB нет
    expect(solveForLuminance(relativeLuminance('#ffffff'), 150, 0.3)).toBeNull();
  });

  it('не отдаёт цвет, зажатый за охват sRGB', () => {
    // Зажатый цвет «выполняет» яркость подменой канала, а не тоном
    const got = solveForLuminance(relativeLuminance('#2563eb'), 140, 0.25);
    if (got) expect(outOfGamut(got.oklch)).toBe(false);
  });
});

describe('recolorKeepingLuminance — правило проекта, проверенное числами', () => {
  /** Поверхности и текст из палитры, на которых считаются отношения. */
  const SURFACES = ['#ffffff', '#eceae5', '#f5f4f1', '#17181a'];

  it.each([
    ['#6B7280', 250],
    ['#6B7280', 30],
    ['#6B7280', 140],
  ])('перекраска %s в оттенок %i не двигает НИ ОДНО отношение контраста', (hex, hue) => {
    const got = recolorKeepingLuminance(hex, hue);
    expect(got, `оттенок ${hue} недостижим для ${hex}`).toBeTruthy();

    // Цвет ДРУГОЙ — иначе проверка ниже вырождается в «сравнили с собой»
    expect(got!.hex).not.toBe(hex);

    const srcLuma = relativeLuminance(hex);
    for (const bg of SURFACES) {
      const bgLuma = relativeLuminance(bg);
      const before = contrastRatio(hex, bg);
      const after = contrastRatio(got!.hex, bg);
      /*
       * ДОПУСК СЧИТАЕТСЯ ПРОИЗВОДНОЙ, А НЕ УГАДЫВАЕТСЯ.
       *
       * Здесь стояло «< 0.01» с объяснением «расхождение яркости ≤0.0012
       * даёт отклонение в третьем знаке». Это неправда: отношение
       * чувствительно к яркости нелинейно, против белого на среднем сером
       * множитель ≈15, и тест упал на дрейфе 0.0169. Поймано прогоном,
       * а не вычиткой, — и утверждение в комментарии было таким же ложным,
       * как и число.
       *
       * Теперь граница выводится из достигнутой ошибки яркости и настоящей
       * чувствительности пары; запас ×2 — на нелинейность на самом интервале.
       */
      const bound = got!.lumaError * ratioSensitivity(srcLuma, bgLuma) * 2 + 1e-9;
      expect(
        Math.abs(after - before),
        `${hex} → ${got!.hex} на ${bg}: ${before.toFixed(4)} → ${after.toFixed(4)}, граница ${bound.toFixed(4)}`,
      ).toBeLessThanOrEqual(bound);
    }
  });

  /**
   * НАСЫЩЕННЫЙ ЦВЕТ ПЕРЕКРАШИВАЕТСЯ НЕ В ЛЮБОЙ ОТТЕНОК — и это свойство
   * охвата sRGB, а не дефект.
   *
   * Фирменный ультрамарин `#2563eb` несёт хрому ≈0.19. Зелёного такой же
   * яркости И такой же насыщенности в sRGB просто нет, поэтому ответ —
   * `null`. Выяснилось прогоном: этот случай стоял в таблице выше как
   * ожидаемо успешный.
   */
  it('насыщенный цвет в чужой оттенок не лезет, а с меньшей хромой лезет', () => {
    expect(recolorKeepingLuminance('#2563eb', 150)).toBeNull();

    const softer = recolorKeepingLuminance('#2563eb', 150, 0.06);
    expect(softer, 'с уменьшенной хромой оттенок обязан находиться').toBeTruthy();
    expect(Math.abs(relativeLuminance(softer!.hex) - relativeLuminance('#2563eb')))
      .toBeLessThanOrEqual(LUMA_EPS);
  });

  /**
   * У ЧИСТО СЕРОГО ОТТЕНКА НЕТ, и перекраска его не выдумывает.
   *
   * Выяснилось при написании теста: случай `#808080` → оттенок 120 падал
   * на «цвет обязан стать другим». Это не дефект — при нулевой хроме угол
   * не значит ничего, и молча подкрашивать нейтраль было бы хуже: правило
   * проекта говорит перекрашивать нейтрали СОХРАНЯЯ светлоту, а не добавлять
   * им цвет без спроса. Нужна подкраска — её просят хромой явно.
   */
  it('чисто серый без явной хромы остаётся серым', () => {
    expect(recolorKeepingLuminance('#808080', 120)!.hex).toBe('#808080');
    // А с явной хромой — подкрашивается, и яркость по-прежнему та же
    const tinted = recolorKeepingLuminance('#808080', 120, 0.03);
    expect(tinted!.hex).not.toBe('#808080');
    const grey = relativeLuminance('#808080');
    const white = relativeLuminance('#ffffff');
    const bound = tinted!.lumaError * ratioSensitivity(grey, white) * 2 + 1e-9;
    expect(Math.abs(contrastRatio(tinted!.hex, '#ffffff') - contrastRatio('#808080', '#ffffff')))
      .toBeLessThanOrEqual(bound);
  });

  it('меняется ИМЕННО оттенок, а не яркость', () => {
    const got = recolorKeepingLuminance('#6B7280', 250);
    expect(got).toBeTruthy();
    expect(Math.round(got!.oklch.h)).toBe(250);
  });

  /**
   * ПОДБОР «НА ГЛАЗ» ПРОВАЛИВАЕТ ЭТУ ЖЕ ПРОВЕРКУ — и это не риторика,
   * а зафиксированный случай: тон, подобранный под ту же цель вручную,
   * увёл пару `--text-dim` × `--bg3` с 4.56 до 4.28.
   */
  it('цвет с той же хромой, но другой светлотой, отношение ЛОМАЕТ', () => {
    const src = hexToOklch('#6B7280');
    const byEye = oklchToHex({ l: src.l - 0.02, c: src.c, h: 250 });
    const drift = Math.abs(contrastRatio(byEye, '#ffffff') - contrastRatio('#6B7280', '#ffffff'));
    expect(drift, 'сдвиг светлоты обязан двигать отношение — иначе проверка выше ничего не значит')
      .toBeGreaterThan(0.1);
  });
});
