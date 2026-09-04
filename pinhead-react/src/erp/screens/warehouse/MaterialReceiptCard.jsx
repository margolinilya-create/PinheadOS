import { useRef, useState } from 'react';
import { formatDateShort } from '../../utils/time';
import { MATERIAL_ACCEPT_LABELS, MATERIAL_STATUS_LABELS } from '../../types';
import { confirm } from '../../../store/useConfirmStore';
import styles from '../../styles';
import { ScrollHintBox } from '../../components/ScrollHintBox';
import { Button } from '../../components/Button';
import { createAttemptKeeper } from '../../utils/attemptKey';
import { STATUS_VARIANT, statusChipClass } from '../../utils/statusUi';

/**
 * Задача склада «Приёмка материалов» (правка 4.1.3): сравнение План↔Факт по каждому материалу.
 * План (материал/цвет/артикул/кол-во) заводит закупка и он read-only для склада; кладовщик вносит
 * только факт (что фактически поступило + кол-во) и статус приёмки. Приёмка разблокирует закрой
 * (гейт в routes.ts) и закрывает задачу в warehouseSlice.acceptMaterial.
 */

const KIND_LABELS = {
  fabric: 'Ткань', hardware: 'Фурнитура', labels: 'Бирки/этикетки', packaging: 'Упаковка', other: 'Прочее',
};

/** Цвет итога приёмки — из словаря раздела */
/* Ключи берутся у СЛОВАРЯ, а не у подписей: сторож `materialReceipts.test.ts`
   считает обращения к `MATERIAL_ACCEPT_LABELS` — их ровно одно, единственный
   селект статуса приёмки, и вторая ссылка выглядела бы вторым селектом. */
const ACCEPT_CHIP = Object.fromEntries(
  Object.keys(STATUS_VARIANT.materialAccept).map((a) => [a, statusChipClass('materialAccept', a)]),
);

/** Материал ждёт приёмки: пришёл, но склад ещё не провёл (или отклонил) приёмку */
function awaitsAcceptance(m) {
  if (m.status !== 'received') return false;
  return m.accept_status !== 'accepted_full' && m.accept_status !== 'accepted_partial';
}

/**
 * Приёмка одного материала: план read-only слева, факт (заполняет кладовщик) справа.
 *
 * Форм здесь было ДВЕ — «Записать приход» и «Принять», каждая со своим селектом
 * статуса приёмки, и вторая работала без первой. На боевой базе за полтора
 * месяца это дало девять принятых материалов при пустом журнале приходов:
 * заполняли ту форму, которая закрывает задачу, а не ту, которая пишет
 * количество. Теперь действие одно, и уходит оно одной транзакцией.
 */
function AcceptBlock({ material: m, onAccept }) {
  const done = !awaitsAcceptance(m) && m.accept_status;
  // Факт-атрибуты преднаполняются планом — кладовщик правит только при пересорте/расхождении
  const [factName, setFactName] = useState(m.fact_name ?? m.name ?? '');
  const [factColor, setFactColor] = useState(m.fact_color ?? m.color ?? '');
  const [factArticle, setFactArticle] = useState(m.fact_article ?? m.article ?? '');
  // Сумма журнала приходов: считает сервер, карточка её только показывает
  const received = m.qty_received ?? '';
  const [qty, setQty] = useState('');
  const [invoice, setInvoice] = useState('');
  /**
   * СТАТУС ВЫВОДИТСЯ ИЗ ЧИСЕЛ, ПОКА ЧЕЛОВЕК НЕ СКАЗАЛ ИНАЧЕ (§3.4 обхода 04.09).
   *
   * Селект стоял со значением «Принято полностью» ПО УМОЛЧАНИЮ, то есть
   * приёмка 60 из 120 уезжала полной, если про него забыли. Проект от таких
   * статусов уже ушёл дважды — в подряде и в закупке («статус ставится
   * ПО ФАКТУ, а не выбирается рядом с ним»), а здесь он остался.
   *
   * Арифметика различает только «план закрыт» и «не закрыт». «Пересорт»
   * и «Не принято» из чисел не выводятся вовсе — это суждение кладовщика,
   * поэтому селект остаётся, но перестаёт предлагать неправду: тронул —
   * ведёт человек, не тронул — ведут числа.
   */
  const [statusTouched, setStatusTouched] = useState(false);
  const [manualStatus, setManualStatus] = useState(m.accept_status ?? 'accepted_full');
  const [comment, setComment] = useState(m.accept_comment ?? '');
  const [saving, setSaving] = useState(false);
  /**
   * Ключ идемпотентности попытки. Обрыв ответа при закоммиченной приёмке —
   * обычное дело на цеховом Wi-Fi, и второе нажатие не должно записать приход
   * дважды: сумма журнала это количество материала на фабрике.
   */
  const attempt = useRef(null);
  if (attempt.current == null) { attempt.current = createAttemptKeeper(); }

  const already = Number(m.qty_received ?? 0);
  const expected = Number(m.qty_expected);
  const arriving = qty === '' ? 0 : Number(qty);
  /** Сколько будет принято после этого действия — на нём и считается расхождение */
  const totalAfter = Math.round((already + (Number.isFinite(arriving) ? arriving : 0)) * 100) / 100;
  const left = Number.isFinite(expected) && expected > 0
    ? Math.round((expected - already) * 100) / 100
    : null;

  /**
   * Расхождение план↔факт. Статус по умолчанию — «Принято полностью», и недостача
   * уезжала в систему как полная приёмка: гейт закроя открывался, а несоответствие
   * всплывало уже в цехе. Сравнение — только когда обе величины есть.
   */
  const shortfall = Number.isFinite(expected) && expected > 0 && totalAfter < expected
    ? Math.round((expected - totalAfter) * 100) / 100
    : 0;
  /**
   * Что говорят числа. План неизвестен — судить не о чем, и тогда предложение
   * остаётся прежним («Принято полностью»): выдумывать частичность там, где
   * нет знаменателя, значит врать в другую сторону.
   */
  const derivedStatus = Number.isFinite(expected) && expected > 0 && shortfall > 0
    ? 'accepted_partial'
    : 'accepted_full';
  const status = statusTouched ? manualStatus : derivedStatus;
  const claimsFull = status === 'accepted_full';
  const needsComment = status !== 'accepted_full' && status !== 'accepted_partial';
  /**
   * Сервер не даст объявить приёмку без записанного прихода (гейт
   * `erp_material_accept`). Кнопка гасится по тому же правилу: гейт, о котором
   * человек узнаёт только из ошибки, — это «кнопка есть, действие падает».
   */
  const needsQty = !claimsFull && status !== 'accepted_partial'
    ? false
    : already <= 0 && !(arriving > 0);

  const accept = async () => {
    if (shortfall > 0 && claimsFull) {
      const ok = await confirm({
        title: 'Принять как полную приёмку?',
        message: `План ${expected}, принято ${totalAfter} — не хватает ${shortfall}. `
          + 'Полная приёмка откроет закрой на весь план, и расхождение всплывёт уже в цехе. '
          + 'Обычно здесь нужен статус «Недостача» или «Принято частично».',
        confirmLabel: 'Всё равно принять полностью',
        variant: 'danger',
      });
      if (!ok) return;
    }
    setSaving(true);
    // Подпись ввода: не менял — та же попытка, тот же ключ
    const signature = JSON.stringify([
      m.id, arriving, status, comment.trim(), invoice.trim(),
      factName.trim(), factColor.trim(), factArticle.trim(),
    ]);
    const ok = await onAccept(m.id, {
      clientKey: attempt.current.keyFor(signature),
      // Пусто — значит нового прихода нет: правят статус или комментарий
      qty: arriving > 0 ? arriving : null,
      accept_status: status,
      accept_comment: comment.trim() || null,
      invoice: invoice.trim() || null,
      fact_name: factName.trim() || null,
      fact_color: factColor.trim() || null,
      fact_article: factArticle.trim() || null,
    });
    setSaving(false);
    if (ok) {
      attempt.current.reset(); setQty(''); setInvoice('');
      // Следующий приход — новые числа: предложение считается заново
      setStatusTouched(false);
    }
  };

  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div className={styles.matSectionHead}>
        <div>
          <strong>{m.name}</strong>
          <div className={styles.subText}>{KIND_LABELS[m.kind]} · {MATERIAL_STATUS_LABELS[m.status]}</div>
        </div>
        {done && (
          <span className={`${styles.chip} ${styles[ACCEPT_CHIP[m.accept_status]]}`}>
            {MATERIAL_ACCEPT_LABELS[m.accept_status]}
            {m.accepted_at ? ` · ${formatDateShort(m.accepted_at)}` : ''}
          </span>
        )}
      </div>
      <ScrollHintBox className={styles.tableWrap} label="Приёмка материалов">
        <table className={styles.table}>
          <thead>
            <tr><th>Поле</th><th>План (закупка)</th><th>Факт (склад)</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Материал</td>
              <td>{m.name || '—'}</td>
              <td>
                <input className={styles.input} value={factName}
                  onChange={(e) => setFactName(e.target.value)} aria-label={`Факт материал ${m.name}`} />
              </td>
            </tr>
            <tr>
              <td>Цвет</td>
              <td>{m.color || '—'}</td>
              <td>
                <input className={styles.input} value={factColor}
                  onChange={(e) => setFactColor(e.target.value)} aria-label={`Факт цвет ${m.name}`} />
              </td>
            </tr>
            <tr>
              <td>Артикул</td>
              <td>{m.article || '—'}</td>
              <td>
                <input className={styles.input} value={factArticle}
                  onChange={(e) => setFactArticle(e.target.value)} aria-label={`Факт артикул ${m.name}`} />
              </td>
            </tr>
            {/* Поставщик — только план (правка 10): выбран закупкой, склад его не меняет;
                расхождение фиксируется комментарием приёмки */}
            <tr>
              <td>Поставщик</td>
              <td>{m.supplier || '—'}</td>
              <td className={styles.subText}>
                расхождение — в комментарий
              </td>
            </tr>
            {/*
              Количество — ЧТЕНИЕ: это сумма журнала приходов, её ведёт триггер
              `erp_material_receipts_rollup`. Поле ввода здесь означало бы
              второго писателя одной колонки — первый же следующий приход
              пересчитал бы сумму и затёр набранное, молча, потому что оба пути
              «работают». Вводится ниже «сколько пришло сейчас», а не итог:
              итог система складывает сама.
            */}
            <tr>
              <td>Количество{m.unit ? `, ${m.unit}` : ''}</td>
              <td>{m.qty_expected ?? '—'}</td>
              <td>
                {received === '' || received === null ? '—' : received}
                {shortfall > 0 && (
                  <div className={styles.overdue}>не хватает {shortfall}</div>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </ScrollHintBox>
      <div className={styles.queueBlockForm}>
        <span className={styles.queueReason}>
          Принято всего: <b>{already || 0}</b>
          {m.unit ? ` ${m.unit}` : ''}
          {left !== null && left > 0 && <span className={styles.dueSoon}> · осталось {left}</span>}
          {left !== null && left <= 0 && already > 0 && (
            <span className={styles.subText}> · план закрыт</span>
          )}
        </span>
        {/*
          СЛЕДСТВИЕ ВВЕДЁННОГО ЧИСЛА — ОДНОЙ ФРАЗОЙ (вайрфрейм §6.5). Кладовщик
          вводит «сколько пришло сейчас», а решение принимает по ИТОГУ: строка
          показывает итог и то, к чему он приводит, до нажатия кнопки. Раньше
          итог приходилось складывать в уме — план в таблице выше, принятое
          в другой строке, а статус выбирался рядом ни с чем.
        */}
        {Number.isFinite(expected) && expected > 0 && (
          <span className={styles.queueReason}>
            ⇒ будет принято {totalAfter} из {expected}{m.unit ? ` ${m.unit}` : ''}
            {shortfall > 0
              ? <span className={styles.overdue}> — не хватает {shortfall}</span>
              : ' — план закрыт'}
            {!statusTouched && ` → ${MATERIAL_ACCEPT_LABELS[derivedStatus]}`}
          </span>
        )}
        <div className={styles.planFormRow}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Пришло сейчас{m.unit ? `, ${m.unit}` : ''}{needsQty ? ' *' : ''}
            </span>
            <input
              type="number" min="0" step="0.01" className={styles.input}
              value={qty} onChange={(e) => setQty(e.target.value)}
              aria-label={`Сколько пришло сейчас, ${m.name}`}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Что приехало</span>
            <select className={styles.select} value={status}
              onChange={(e) => { setStatusTouched(true); setManualStatus(e.target.value); }}
              aria-label={`Статус приёмки ${m.name}`}>
              {Object.entries(MATERIAL_ACCEPT_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Накладная</span>
            <input className={styles.input} value={invoice}
              onChange={(e) => setInvoice(e.target.value)}
              aria-label={`Накладная прихода ${m.name}`} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Комментарий{needsComment ? ' * (объясните отклонение)' : ''}
            </span>
            <input className={styles.input} value={comment}
              onChange={(e) => setComment(e.target.value)}
              aria-label={`Комментарий приёмки ${m.name}`} />
          </label>
        </div>
        {/* Причина, по которой кнопка погашена, называется рядом с кнопкой */}
        {needsQty && (
          <span className={styles.subText}>
            Укажите, сколько пришло: приёмка без записанного прихода не сохранится.
          </span>
        )}
        <Button
          variant="primary"
          disabled={saving || needsQty || (needsComment && !comment.trim())}
          onClick={accept}
        >
          {done ? 'Обновить приёмку' : 'Принять'}
        </Button>
      </div>
    </div>
  );
}

export function MaterialReceiptCard({ order, task, onAccept }) {
  const accepted = task.status === 'accepted';
  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}>
        <div>
          <span className={styles.subText}>Приёмка материалов</span>
          <div><strong>№{order.bitrix_id || '—'} · {order.title}</strong></div>
        </div>
        {accepted && <span className={`${styles.chip} ${styles.chipDone}`}>Материалы приняты</span>}
      </div>
      {/*
        ПУСТОЙ СПИСОК ОБЯЗАН НАЗЫВАТЬ СЕБЯ (обход 04.09, Б5). С этого дня
        задача приёмки появляется, когда закупка ВЗЯТА В РАБОТУ, а не когда
        закрыта: материалы приходят по частям, и записывать первую поставку
        было некуда. Оборотная сторона — карточка открывается раньше, чем
        закупщик завёл строки, и без этой подписи она читалась бы как
        поломка: заголовок есть, под ним пусто.
      */}
      {order.materials.length === 0 ? (
        <p className={styles.subText}>
          Закупка ещё не завела ни одной позиции — принимать пока нечего.
          Строки появятся здесь, как только закупщик их заполнит.
        </p>
      ) : order.materials.map((m) => (
        <AcceptBlock key={m.id} material={m} onAccept={onAccept} />
      ))}
    </section>
  );
}
