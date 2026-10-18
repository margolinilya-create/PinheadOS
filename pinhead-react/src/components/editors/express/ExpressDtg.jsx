import OptionGroup from './OptionGroup';
import { DTG_FORMATS, asOptions } from './expressModel';

const FORMATS = asOptions(DTG_FORMATS);

/** Параметры DTG: формат печати */
export default function ExpressDtg({ entry, onParam }) {
  return <OptionGroup label="Формат" options={FORMATS} value={entry.fmt} onChange={(v) => onParam('fmt', v)} />;
}
