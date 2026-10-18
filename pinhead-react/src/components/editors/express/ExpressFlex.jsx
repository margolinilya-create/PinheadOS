import OptionGroup from './OptionGroup';
import { FLEX_FORMATS, FLEX_MAX_COLORS } from '../../../utils/pricing';
import { asOptions, countOptions } from './expressModel';

const FORMATS = asOptions(FLEX_FORMATS);
const COLORS = countOptions(FLEX_MAX_COLORS);

/** Параметры flex: формат и цвета */
export default function ExpressFlex({ entry, onParam }) {
  return (
    <>
      <OptionGroup label="Формат" options={FORMATS} value={entry.fmt} onChange={(v) => onParam('fmt', v)} />
      <OptionGroup label="Цвета" options={COLORS} value={entry.col} onChange={(v) => onParam('col', v)} />
    </>
  );
}
