import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { formatDateTimeShort } from '../../../utils/format';
import styles from '../../../styles';

/**
 * ВЫБОР ЧЕРНОВИКА ПРЯМО В ФОРМЕ ЗАКАЗА (правка заказчика 21.09, п. 6).
 *
 * ЧТО ПРОСИТ ДОКУМЕНТ. «В форме создания заказа добавить отдельное
 * раскрывающееся действие „Черновики" / „Выбрать черновик". Оно должно быть
 * доступно прямо в интерфейсе нового заказа и не зависеть от того, был ли
 * автоматически восстановлен последний черновик… Для каждого черновика
 * показывать минимум: название, клиента, менеджера и дату/время последнего
 * изменения. Если название не заполнено, показывать „Без названия"…
 * После выбора в интерфейсе явно показывать, какой черновик сейчас открыт,
 * например: „Открыт черновик: ВЦ"».
 *
 * ПОРЯДОК СЧИТАЕТСЯ ЗДЕСЬ, а не берётся у запроса. Слайс сортирует по
 * `updated_at`, но опираться на порядок чужого запроса нельзя — он однажды
 * поменяется молча (то же рассуждение уже записано у `latestDraftId`
 * в `OrdersScreen`).
 *
 * ЭТО НЕ ТАБ-ПАТТЕРН, а раскрывающийся список: панелей нет, навигации
 * стрелками нет — значит `aria-expanded` у кнопки и обычный список внутри,
 * а не `role="tab"` (правило раздела после разбора чата).
 */
export function DraftPicker({ drafts, openId, dirty, onPick, onFresh, onDelete }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const rows = useMemo(
    () => [...(drafts ?? [])].sort(
      (a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')),
    ),
    [drafts],
  );
  const current = rows.find((d) => d.id === openId) ?? null;

  /**
   * Клик мимо закрывает список. Обработчик висит на документе, а не на
   * оверлее: своя подложка перехватила бы клики по самой форме — список
   * стоит В НЕЙ, и человек продолжает заполнять поля рядом.
   */
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc, true);
    };
  }, [open]);

  const who = (d) => [d.payload?.form?.customer, d.payload?.form?.manager]
    .filter(Boolean).join(' · ') || 'клиент и менеджер не указаны';

  return (
    <div className={styles.draftBanner} ref={boxRef}>
      {/*
        Открытый черновик назван ПРЯМО, а не «черновик восстановлен»: человек
        должен видеть, какой именно он сейчас правит, — «Открыт черновик: ВЦ».
      */}
      <span>
        {current
          ? <>Открыт черновик: <b>{current.title || 'Без названия'}</b></>
          : 'Черновик не открыт — форма новая'}
        {current && dirty && (
          <span className={styles.subText}> · есть несохранённые правки</span>
        )}
      </span>

      <div className={styles.queueActions}>
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name="chevronDown" size={14} /> Черновики
          {rows.length > 0 && <> <b>{rows.length}</b></>}
        </Button>
      </div>

      {open && (
        <div className={styles.dataCardList} role="list" aria-label="Сохранённые черновики">
          {rows.length === 0 && (
            <span className={styles.subText}>
              Сохранённых черновиков нет. Кнопка «Сохранить в черновики» внизу формы
              заведёт первый.
            </span>
          )}
          {rows.map((d) => (
            <div key={d.id} className={styles.dataCard} role="listitem">
              <div className={styles.dataCardHead}>
                <span className={styles.dataCardTitle}>
                  {d.title || 'Без названия'}
                  {d.id === openId && <span className={styles.subText}> · открыт</span>}
                </span>
                <span className={styles.subText}>{formatDateTimeShort(d.updated_at)}</span>
              </div>
              <div className={styles.subText}>{who(d)}</div>
              <div className={styles.queueActions}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={d.id === openId}
                  onClick={async () => { await onPick(d); setOpen(false); }}
                >
                  {d.id === openId ? 'Уже открыт' : 'Открыть'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onDelete(d)}>
                  Удалить
                </Button>
              </div>
            </div>
          ))}

          {/* «Создать новый черновик» — рядом со списком, как просит документ:
              «чтобы быстро перейти от существующего черновика к новому заказу» */}
          <div className={styles.queueActions}>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => { await onFresh(); setOpen(false); }}
            >
              <Icon name="plus" size={14} /> Создать новый черновик
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
