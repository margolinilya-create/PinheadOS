import OptionGroup from './OptionGroup';
import { EMB_AREAS, EMB_MAX_THREADS, countOptions } from './expressModel';

const THREADS = countOptions(EMB_MAX_THREADS);

/** Параметры вышивки: область и число нитей */
export default function ExpressEmbroidery({ entry, onParam }) {
  return (
    <>
      <OptionGroup label="Область" options={EMB_AREAS} value={entry.fmt} onChange={(v) => onParam('fmt', v)} />
      <OptionGroup label="Нити" options={THREADS} value={entry.col} onChange={(v) => onParam('col', v)} />
    </>
  );
}
