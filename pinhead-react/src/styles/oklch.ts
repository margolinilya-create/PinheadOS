import { hexToRgb, rgbToHex, linearize, delinearize, relativeLuminance } from './contrast';

/**
 * OKLCH — ПЕРЕКРАСИТЬ, НЕ СДВИНУВ СВЕТЛОТУ.
 *
 * Приём взят у блока `Palette` с bencho.dev: он подбирает цвета в OKLCH,
 * а не в HSL, потому что в OKLCH светлота — это светлота, а не «яркость
 * по формуле, к восприятию отношения не имеющей».
 *
 * ЗАЧЕМ ЭТО ПРОЕКТУ. Записанное правило: «перекрашивая нейтрали, СОХРАНЯЙТЕ
 * СВЕТЛОТУ — отношения WCAG считаются по ней, и тогда ни одна пара
 * „текст × поверхность“ не сдвигается вовсе». Ему уже есть цена: подбор
 * на глаз под ту же цель увёл `--text-dim` на `--bg3` с 4.56 до 4.28,
 * то есть ниже AA, и выяснилось это ЧИСЛАМИ, а не тестом после.
 *
 * Инструмент решает обратную задачу: дай тон под целевую светлоту. Пока
 * её решали в голове, правило оставалось благим пожеланием.
 *
 * ─── ЦЕЛЕВАЯ ВЕЛИЧИНА — ЯРКОСТЬ WCAG, А НЕ L ИЗ OKLCH ─────────────────────
 * Это разные числа, и подменять одно другим нельзя: контраст считается
 * по `relativeLuminance`, и «сохранил L» не означает «сохранил отношение».
 * Поэтому ищется тон, у которого совпадает ЯРКОСТЬ, а OKLCH — лишь удобная
 * система координат, в которой оттенок и насыщенность можно менять, не
 * задевая третью ось.
 */

/**
 * Расхождение яркости, которое считаем совпадением.
 *
 * Число из правила проекта (0.0012), и стоит оно там по делу: это примерно
 * ПОЛ-ШАГА 8-битного квантования по яркости. Точнее подобрать тон нельзя
 * в принципе — цвет в `#rrggbb` дискретен, и любая цель между соседними
 * значениями канала недостижима. То есть порог описывает предел инструмента,
 * а не выбранную точность.
 *
 * ⚠️ НО ЭТО НЕ «ОТКЛОНЕНИЕ В ТРЕТЬЕМ ЗНАКЕ» У ОТНОШЕНИЯ КОНТРАСТА. Отношение
 * чувствительно к яркости нелинейно (`contrast.ratioSensitivity`): против
 * белого на среднем сером множитель около 15, и 0.0012 яркости превращаются
 * в 0.018 отношения. Пара, стоящая на 4.505, от такого уходит под порог AA.
 * Первая редакция теста утверждала обратное и на этом же упала — поэтому
 * допуски там теперь считаются производной, а не угадываются.
 *
 * Практический вывод для правки палитры: подобрали тон — ПРОГОНИТЕ
 * `contrast.test.ts`. Инструмент снимает с подбора произвол, но не заменяет
 * сторожа.
 */
export const LUMA_EPS = 0.0012;

export type Oklch = { l: number; c: number; h: number };

/* ── sRGB ↔ OKLab ──────────────────────────────────────────────────────────
   Матрицы Бьёрна Оттоссона (oklab), в линейном sRGB. Приведены как есть:
   «упростить» их нельзя, а переписать по памяти — верный способ получить
   цвета, похожие на правильные. */

function linSrgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

function oklabToLinSrgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

/** `#rrggbb` → OKLCH. `h` в градусах 0…360, `c` — хрома (0 ≈ серый). */
export function hexToOklch(hex: string): Oklch {
  const [r8, g8, b8] = hexToRgb(hex);
  const [L, a, b] = linSrgbToOklab(linearize(r8), linearize(g8), linearize(b8));
  const c = Math.hypot(a, b);
  // Хрома ниже этого порога — это серый, и угол у него случайный шум
  const h = c < 1e-6 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

/** OKLCH → `#rrggbb`. Значения вне охвата sRGB зажимаются. */
export function oklchToHex({ l, c, h }: Oklch): string {
  const rad = (h * Math.PI) / 180;
  const [lr, lg, lb] = oklabToLinSrgb(l, c * Math.cos(rad), c * Math.sin(rad));
  return rgbToHex(delinearize(lr), delinearize(lg), delinearize(lb));
}

/** Вышел ли цвет за охват sRGB — то есть пришлось ли зажимать каналы. */
export function outOfGamut({ l, c, h }: Oklch): boolean {
  const rad = (h * Math.PI) / 180;
  const ch = oklabToLinSrgb(l, c * Math.cos(rad), c * Math.sin(rad));
  return ch.some((v) => v < -1e-4 || v > 1 + 1e-4);
}

/**
 * ОБРАТНАЯ ЗАДАЧА: тон с заданным оттенком и хромой, у которого ЯРКОСТЬ WCAG
 * совпадает с эталонной.
 *
 * Считается двоичным поиском по `l` в OKLCH. Аналитически это не решается:
 * между `l` и яркостью WCAG стоят кубический корень, матрица и гамма —
 * но функция монотонна по `l`, а значит половинное деление сходится быстро
 * и надёжно. Тридцати шагов хватает, чтобы упереться в точность double,
 * то есть далеко за `LUMA_EPS`.
 *
 * Возвращает `null`, когда цель недостижима: при большой хроме и крайних
 * яркостях нужного тона в охвате sRGB может не быть вовсе, и подсунуть
 * «ближайший похожий» здесь нельзя — это молча вернуло бы цвет, который
 * правило как раз и нарушает.
 */
export function solveForLuminance(
  targetLuma: number,
  hue: number,
  chroma: number,
  eps = LUMA_EPS,
): { hex: string; oklch: Oklch; lumaError: number } | null {
  let lo = 0;
  let hi = 1;
  let best: { hex: string; oklch: Oklch; lumaError: number } | null = null;

  for (let i = 0; i < 30; i += 1) {
    const l = (lo + hi) / 2;
    const oklch = { l, c: chroma, h: hue };
    const hex = oklchToHex(oklch);
    const luma = relativeLuminance(hex);
    const err = Math.abs(luma - targetLuma);
    if (!best || err < best.lumaError) best = { hex, oklch, lumaError: err };
    if (luma < targetLuma) lo = l; else hi = l;
  }

  if (!best || best.lumaError > eps) return null;
  // Зажатый за охват цвет яркость «выполняет» подменой канала, а не тоном
  if (outOfGamut(best.oklch)) return null;
  return best;
}

/**
 * Перекрасить цвет в другой оттенок, СОХРАНИВ яркость WCAG.
 *
 * Это и есть операция из правила: меняется только тон, отношения контраста
 * не двигаются, и ни один сторож не краснеет. `null` — значит в этом
 * оттенке такой яркости в sRGB нет; уменьшите хрому.
 */
export function recolorKeepingLuminance(
  hex: string,
  hue: number,
  chroma?: number,
): { hex: string; oklch: Oklch; lumaError: number } | null {
  const src = hexToOklch(hex);
  return solveForLuminance(relativeLuminance(hex), hue, chroma ?? src.c);
}
