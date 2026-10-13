import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import StepGarment from '../../components/steps/StepGarment';
import { useSalesStore } from '../store/useSalesStore';
import { beginItemSession, endItemSession, isItemSessionActive } from '../wizard/itemSession';
import { salesItemToWizard, wizardToSalesItem } from '../wizard/wizardAdapter';
import styles from './Sales.module.css';

const StepDesign = lazy(() => import('../../components/steps/StepDesign'));

/**
 * Визард позиции внутри карточки «Заказы v4»: шаги «Изделие» и «Дизайн»
 * главного визарда, как есть. Их собственное «Далее» с шага «Дизайн» кладёт
 * снимок позиции в `items` и ставит шаг 2 — здесь это сигнал «позиция готова».
 * Адрес: `/sales/:id/item/:key`, `key` — `new` или ключ позиции;
 * `?row=` — строка сетки (цвет), которую правит визард.
 */
export default function ItemWizard() {
  const { id, key } = useParams();
  const [params] = useSearchParams();
  const rowColor = params.get('row') ?? undefined;
  const navigate = useNavigate();
  const { order, open, edit } = useSalesStore(useShallow((s) => ({
    order: s.current,
    open: s.open,
    edit: s.edit,
  })));
  const step = useStore((s) => s.step);
  const [ready, setReady] = useState(false);
  const finished = useRef(false);

  const isNew = key === 'new';
  const base = !isNew ? order?.items.find((it) => it.key === key) : undefined;
  // Позиция на момент входа: правки заказа во время сессии её не подменяют
  const baseRef = useRef(base);
  const canStart = !!order && order.id === id && (isNew || !!base);

  useEffect(() => {
    if (id && order?.id !== id) open(id);
  }, [id, order?.id, open]);

  // Сессией владеет ОДИН эффект: он начинает её и он же завершает при уходе
  // любым путём (отмена, «Назад» браузера, другой раздел). Зависимости
  // стабильны — иначе правка заказа перезапускала бы сессию с нуля.
  useEffect(() => {
    if (!canStart) return undefined;
    baseRef.current = base;
    const cat = useStore.getState();
    beginItemSession(base ? salesItemToWizard(base, cat, rowColor) : undefined);
    setReady(true);
    return () => {
      endItemSession();
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- старт только по готовности заказа
  }, [canStart, key, rowColor]);

  // Шаг 2 — «Дизайн» отдал позицию. Только внутри живой сессии: возврат главного
  // визарда, стоявшего на шаге 2+, тоже даёт `step >= 2`, и без этой проверки
  // отмена положила бы в заказ позицию главного визарда (поймано тестом)
  useEffect(() => {
    if (!ready || finished.current || step < 2 || !isItemSessionActive()) return;
    finished.current = true;
    const s = useStore.getState();
    const snap = s.items[s.activeItemIdx] ?? s.items[s.items.length - 1];
    const was = baseRef.current;
    if (snap) {
      const item = wizardToSalesItem(snap, s, was, rowColor);
      edit((o) => ({
        ...o,
        items: was ? o.items.map((it) => (it.key === was.key ? item : it)) : [...o.items, item],
      }));
    }
    endItemSession();
    navigate(`/sales/${id}`);
  }, [ready, step, rowColor, edit, id, navigate]);

  const cancel = () => {
    finished.current = true;
    endItemSession();
    navigate(`/sales/${id}`);
  };

  const { number } = useSalesStore(useShallow((s) => ({ number: s.current?.number ?? '' })));

  if (!order || !ready) {
    const missing = order && !isNew && !base;
    return (
      <div className={styles.page}>
        <div className={styles.empty}>{missing ? 'Позиция не найдена' : 'Загрузка…'}</div>
      </div>
    );
  }

  return (
    <>
      <div className={styles.page}>
        <div className={styles.head}>
          <div>
            <button type="button" className={styles.back} onClick={cancel}>← К заказу{number ? ` ${number}` : ''}</button>
            <h1 className={styles.title}>{base ? 'Позиция в визарде' : 'Новая позиция'}</h1>
            <div className={styles.sub}>Шаг {Math.min(step, 1) + 1} из 2 · {step === 0 ? 'изделие, цвет, размеры' : 'нанесения и бирки'}</div>
          </div>
          <button type="button" className="btn" onClick={cancel}>Отмена</button>
        </div>
      </div>
      <div className="container">
        {step === 0 && <StepGarment />}
        {step === 1 && (
          <Suspense fallback={<div className="panel-loading">Загрузка...</div>}>
            <StepDesign />
          </Suspense>
        )}
      </div>
    </>
  );
}
