import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import FlatEditor from './FlatEditor';

/**
 * Обвязка тестов редактора флэта: флэт и вид — из адреса (`flat`, `view`),
 * смена вида пишет `view`; текущий адрес отдаётся в `onLocation`
 */
export default function FlatEditorHarness({ readOnly, onBack, onMakeExact, copyFrom, onLocation }) {
  const [params, setParams] = useSearchParams();
  const { search } = useLocation();
  useEffect(() => onLocation(search), [search, onLocation]);
  const onView = (k) => setParams((p) => {
    const n = new URLSearchParams(p);
    n.set('view', k);
    return n;
  }, { replace: true });
  return (
    <FlatEditor flatId={params.get('flat')} view={params.get('view')} onView={onView} onBack={onBack}
      readOnly={readOnly} copyFrom={copyFrom} onMakeExact={onMakeExact} />
  );
}
