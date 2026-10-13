import { useEffect, useMemo, useState } from 'react';
import { useErpStore } from '../store/useErpStore';
import { stageAncestors } from '../utils/stageSizes';

/**
 * Отчёты, нужные форме сдачи результата (вынос из `StageReportForm` 27.09).
 *
 * ОТЧЁТЫ ВСЕХ ПРЕДКОВ, а не только прямых предшественников (правка 27.09,
 * п. 6): при нанесении на крое между закроем и швейкой стоит вышивка без
 * размерного отчёта — с одними `depends_on` столбец «Покроено» оставался
 * прочерками при «Принято в работу: 472». Грузятся точечно при открытии
 * формы: журнал результатов растёт быстрее всего, и возить его в выборке
 * заказа ради одной формы нельзя.
 *
 * СОБСТВЕННЫЕ прежние отчёты этапа — для плюсов (правка 21.09, п. 3: плюс
 * считается накопительно, 30 сегодня и 25 завтра при плане 50 — это плюс 5)
 * и для остатка (правка 27.09, п. 7): «Осталось сдать» и потолок каждой
 * строки считаются от ПРИНЯТОГО минус уже сданное и списанное в брак —
 * без прежних отчётов вторая сдача видела бы 472 вместо 104.
 */
export function useStageReports(stage, itemStages, bySizes) {
  const loadStageReports = useErpStore((st) => st.loadStageReports);
  const [prevReports, setPrevReports] = useState([]);
  const [ownReports, setOwnReports] = useState([]);

  const ancestorIds = useMemo(() => stageAncestors(stage, itemStages), [stage, itemStages]);
  useEffect(() => {
    if (!bySizes || ancestorIds.length === 0) return undefined;
    let alive = true;
    loadStageReports(ancestorIds).then((rows) => { if (alive) setPrevReports(rows); });
    return () => { alive = false; };
  }, [bySizes, ancestorIds, loadStageReports]);

  useEffect(() => {
    let alive = true;
    loadStageReports([stage.id]).then((rows) => { if (alive) setOwnReports(rows); });
    return () => { alive = false; };
  }, [stage.id, loadStageReports]);

  return { prevReports, ownReports };
}
