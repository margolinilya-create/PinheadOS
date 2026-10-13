import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { erpError, erpRead } from '../../store/shared';
import { EmptyState, LoadFailed } from '../../components/ErpStates';
import { TableSkeleton } from '../../components/ErpSkeletons';
import { Button } from '../../components/Button';
import { formatDateTimeShort } from '../../utils/format';
import styles from '../../styles';

/** Сколько последних отчётов показывать: вкладка — сигнал, а не архив */
export const CLIENT_ERRORS_LIMIT = 100;

/** Подписи источника отчёта (`lib/errorReport`) */
const SOURCE_LABELS = {
  render: 'Экран упал',
  window: 'Ошибка скрипта',
  promise: 'Необработанный запрос',
  'erp-supabase': 'Отказ базы',
};

/**
 * «Ошибки» — встроенный приёмник отчётов интерфейса (обзор 24.09, сессия 67).
 *
 * Отчёты пишет `lib/errorReport` в `erp_client_errors`, когда внешний адрес
 * `VITE_ERROR_REPORT_URL` не задан. До этой вкладки о белом экране в цеху
 * узнавали по телефону: консоль браузера на чужом планшете не прочитать.
 *
 * Гейт — `staff.invite`, тот же, что у политики чтения таблицы: вкладка
 * есть ровно у тех, кому сервер отдаст строки. Только чтение: отчёт — факт,
 * у таблицы нет ни UPDATE-, ни DELETE-политики.
 */
/** Последние отчёты. Ошибку называет тостом сам: вкладке остаётся «Повторить» */
async function fetchClientErrors() {
  const { data, error } = await erpRead(() => supabase
    .from('erp_client_errors')
    .select('id, created_at, source, message, stack, url, release, user_agent, profile:profiles(name)')
    .order('created_at', { ascending: false })
    .limit(CLIENT_ERRORS_LIMIT));
  if (error) {
    erpError('Не удалось загрузить отчёты об ошибках', error);
    return null;
  }
  return data ?? [];
}

export function ClientErrorsTab() {
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);

  /** Состояние меняется в колбэке промиса, а не в теле эффекта */
  const apply = useCallback((result) => {
    setFailed(result === null);
    if (result !== null) setRows(result);
  }, []);
  const load = useCallback(() => fetchClientErrors().then(apply), [apply]);

  useEffect(() => {
    let alive = true;
    fetchClientErrors().then((result) => { if (alive) apply(result); });
    return () => { alive = false; };
  }, [apply]);

  if (failed) return <LoadFailed onRetry={load} what="отчёты об ошибках" />;
  if (rows === null) return <TableSkeleton rows={5} label="Загрузка отчётов" />;
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="check"
        title="Ошибок интерфейса нет"
        text="Сюда попадают падения экранов и отказы базы у вошедших сотрудников."
      />
    );
  }

  return (
    <>
      <p className={styles.subText}>
        Последние {rows.length} отчётов. Одинаковая ошибка у одного человека
        записывается один раз за сессию, всего не больше 20 за сессию.
        {' '}
        <Button variant="ghost" size="sm" onClick={load}>Обновить</Button>
      </p>
      <ul className={styles.stackTight}>
        {rows.map((r) => (
          <li key={r.id}>
            <details>
              <summary className={styles.subText}>
                {formatDateTimeShort(r.created_at)}
                {' · '}{SOURCE_LABELS[r.source] ?? r.source}
                {' · '}{r.profile?.name || 'без профиля'}
                {' · '}{r.message}
              </summary>
              {r.url && <p className={styles.subText}>Экран: {r.url}</p>}
              {r.release && <p className={styles.subText}>Сборка: {r.release}</p>}
              {r.stack && <pre className={styles.subText}>{r.stack}</pre>}
              {r.user_agent && <p className={styles.subText}>Браузер: {r.user_agent}</p>}
            </details>
          </li>
        ))}
      </ul>
    </>
  );
}
