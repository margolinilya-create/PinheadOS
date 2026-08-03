import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { useErpAccess } from '../../store/useErpAccess';
import { Icon } from '../../components/Icon';
import { confirm } from '../../../store/useConfirmStore';
import { formatDateShort } from '../../utils/time';
import { MATERIAL_STATUS_LABELS } from '../../types';
import styles from '../../erp.module.css';

/**
 * Чего именно ждёт задание из группы «Ожидают материалы» (правка менеджера
 * 2026-08-03). Раньше вся информация сводилась к одной строке причины
 * «Ждём материалы: Кулирка (план 14 авг.)» — по ней нельзя было понять,
 * с кого спрашивать и когда обновляли сведения.
 *
 * Показываем ровно то, что требовал заказчик: какой материал, комментарий
 * ответственного, ожидаемую дату, ответственного за получение, дату последнего
 * обновления и возможность отметить поступление.
 *
 * Отметка поступления ведёт в ТОТ ЖЕ путь, что экран склада (`acceptMaterial`
 * для закупки, `confirmStockMaterial` для наличия): проставить `status='received'`
 * в обход приёмки нельзя — гейт ждёт `accept_status`, и кнопка стала бы
 * декоративной. Право своё — `material.receive`: приёмка это сверка количества
 * и качества, а не отметка «вроде привезли».
 */
export function MaterialWait({ materials, compact = false }) {
  const { acceptMaterial, confirmStockMaterial } = useErpStore(
    useShallow((s) => ({
      acceptMaterial: s.acceptMaterial,
      confirmStockMaterial: s.confirmStockMaterial,
    })),
  );
  const access = useErpAccess();
  const canReceive = access.can('material.receive');
  const [busy, setBusy] = useState(null);

  if (!materials || materials.length === 0) return null;

  const receive = async (m) => {
    const fromStock = m.source === 'stock';
    const ok = await confirm({
      title: `Материал поступил: ${m.name || 'без названия'}?`,
      message: fromStock
        ? 'Материал будет помечен доступным со склада, и этап станет «Готов к работе».'
        : [
            `Будет оформлена приёмка полного количества${m.qty_expected ? ` (${m.qty_expected})` : ''}.`,
            'Если пришло не всё или есть расхождения — принимайте на экране «Склад»:',
            'там можно указать фактическое количество, пересорт и комментарий.',
          ].join(' '),
      confirmLabel: 'Материал поступил',
    });
    if (!ok) return;
    setBusy(m.id);
    if (fromStock) {
      await confirmStockMaterial(m.id);
    } else {
      await acceptMaterial(m.id, {
        qty_received: Number(m.qty_expected) || 0,
        accept_status: 'accepted_full',
        accept_comment: null,
      });
    }
    setBusy(null);
  };

  return (
    <ul className={`${styles.matWaitList} ${compact ? styles.matWaitCompact : ''}`}>
      {materials.map((m) => {
        const facts = [
          m.color ? `цвет ${m.color}` : null,
          m.qty ? `нужно ${m.qty}` : null,
          m.supplier ? `поставщик ${m.supplier}` : null,
        ].filter(Boolean);
        return (
          <li key={m.id} className={styles.matWaitRow}>
            <span className={styles.matWaitName}>
              <Icon name="box" size={14} /> {m.name || 'Без названия'}
              <span className={`${styles.chip} ${styles.chipWaiting}`}>
                {MATERIAL_STATUS_LABELS[m.status] || m.status}
              </span>
            </span>

            <span className={styles.matWaitFacts}>
              <span className={m.eta_date ? undefined : styles.subText}>
                {m.eta_date ? `ждём ${formatDateShort(m.eta_date)}` : 'дата поступления не указана'}
              </span>
              <span className={m.responsible ? undefined : styles.subText}>
                {m.responsible ? `ответственный: ${m.responsible}` : 'ответственный не назначен'}
              </span>
              {facts.length > 0 && <span className={styles.subText}>{facts.join(' · ')}</span>}
              {m.updated_at && (
                <span className={styles.subText}>обновлено {formatDateShort(m.updated_at)}</span>
              )}
            </span>

            {(m.notes || m.accept_comment) && (
              <span className={styles.matWaitNote}>
                <Icon name="tag" size={13} /> {m.notes || m.accept_comment}
              </span>
            )}

            {canReceive && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy === m.id}
                onClick={() => receive(m)}
              >
                {busy === m.id ? 'Отмечаем…' : 'Материал поступил'}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
