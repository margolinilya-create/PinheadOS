import OptionGroup from './OptionGroup';
import { DTF_FORMATS, asOptions } from './expressModel';

const FORMATS = asOptions(DTF_FORMATS);

/** Параметры DTF: формат листа */
export default function ExpressDtf({ entry, onParam }) {
  return <OptionGroup label="Формат" options={FORMATS} value={entry.fmt} onChange={(v) => onParam('fmt', v)} />;
}
