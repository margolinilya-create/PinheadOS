import OptionGroup from './OptionGroup';
import { SCREEN_FX } from '../../../utils/pricing';
import { SCREEN_FORMATS, SCREEN_MAX_COLORS, TEXTILES, asOptions, countOptions } from './expressModel';

const FORMATS = asOptions(SCREEN_FORMATS);
const COLORS = countOptions(SCREEN_MAX_COLORS);
const EFFECTS = SCREEN_FX.map((f) => ({ value: f.key, label: f.label }));

/** Параметры шелкографии: формат, цвета, текстиль, эффект */
export default function ExpressSilk({ entry, onParam }) {
  return (
    <>
      <OptionGroup label="Формат" options={FORMATS} value={entry.fmt} onChange={(v) => onParam('fmt', v)} />
      <OptionGroup label="Цвета" options={COLORS} value={entry.col} onChange={(v) => onParam('col', v)} />
      <OptionGroup label="Текстиль" options={TEXTILES} value={entry.textile || 'white'} onChange={(v) => onParam('textile', v)} />
      <OptionGroup label="Эффект" options={EFFECTS} value={entry.fx || 'none'} onChange={(v) => onParam('fx', v)} />
    </>
  );
}
