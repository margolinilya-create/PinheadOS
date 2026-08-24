import { useMemo, useState } from 'react';
import { Badge } from '../../components/Badge';
import { Button, ButtonLink } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { ScrollHintBox } from '../../components/ScrollHintBox';
import { OrderLink } from '../../components/OrderLink';
import { confirm, confirmWithInput } from '../../../store/useConfirmStore';
import { supabase } from '../../../lib/supabase';
import { pluralize } from '../../../utils/i18n';
import { purchaseListFile } from '../../utils/attachments';
import { defaultPlannedEnd } from '../../utils/stagePlan';
import {
  SUPPLY_STATE_BADGE,
  openSupplyStages,
  supplyMaterialSummary,
  supplyState,
} from '../../utils/supply';
import styles from '../../styles';

/**
 * КАРТОЧКА ЗАКУПКИ ОДНОГО ЗАКАЗА (правка заказчика 23.08, п. 1).
 *
 * ЧТО БЫЛО НЕ ТАК. Раздел «Закупка» ощущался как две параллельные рабочие
 * зоны: список заказов с россыпью действий в каждой строке и отдельная
 * таблица материалов ВСЕХ заказов сразу. Было неочевидно, где закупщик должен
 * работать постоянно; сводка статусов лежала ниже по экрану, за прокруткой.
 *
 * КАК СТАЛО. Список сверху — только навигация («Открыть»), вся работа здесь:
 * действия в шапке карточки, сводка статусов сразу под ней (без прокрутки),
 * ниже — таблица материалов ТОЛЬКО этого заказа.
 *
 * ДЕЙСТВИЯ ПЕРЕЕХАЛИ СЮДА ЦЕЛИКОМ, вместе со своими подтверждениями: копия
 * рядом со списком означала бы два места, где «Завершить закупку» спрашивает
 * разное. Список о них больше не знает вовсе.
 */

/** Плитки сводки: перечень и порядок — из п. 1.3 документа */
const TILES = [
  { key: 'total', label: 'Всего материалов', icon: 'box', cls: '' },
  { key: 'notOrdered', label: 'Не заказано', icon: 'alert', cls: '' },
  { key: 'ordered', label: 'Заказано', icon: 'check', cls: '' },
  { key: 'inTransit', label: 'В пути', icon: 'truck', cls: '' },
  { key: 'arrived', label: 'Пришло', icon: 'checkCircle', cls: 'kpiIconOk' },
  { key: 'problems', label: 'Проблемы', icon: 'alert', cls: 'kpiIconDanger' },
];

export function PurchaseCard({
  order, supplyDept, perms, today,
  onTake, onClose, onAddMaterial, children,
}) {
  const [busy, setBusy] = useState(false);
  const stages = useMemo(
    () => openSupplyStages(order, supplyDept?.id ?? null), [order, supplyDept]);
  const summary = useMemo(
    () => supplyMaterialSummary(order.materials, today), [order.materials, today]);
  const listFile = purchaseListFile(order);
  const state = supplyState(stages);
  const values = { ...summary, problems: summary.problems.length };

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  /**
   * Взять закупку в работу — СО СРОКОМ. Этап без `planned_end` выпадает
   * из контроля сроков целиком: просрочка считается по нему же, и «Загрузка
   * цехов» строится из него. Спрашивается общим диалогом проекта, а не своей
   * формой рядом с кнопкой; подстановка общая с формой цеха.
   */
  const take = () => run(async () => {
    const { ok, value } = await confirmWithInput({
      title: 'Взять закупку в работу?',
      message: stages.length === 1
        ? 'Этап закупки перейдёт в работу.'
        : `Все ${stages.length} этапов закупки перейдут в работу.`,
      confirmLabel: 'Взять в работу',
      prompt: {
        label: 'План завершения закупки',
        type: 'date',
        required: true,
        initialValue: defaultPlannedEnd({
          plannedEnd: stages[0]?.planned_end,
          normDays: supplyDept?.norm_days ?? null,
          dueDate: order.due_date,
        }),
      },
    });
    if (ok) await onTake(order.id, value);
  });

  /**
   * Закрытие закупки. Материалы на месте — обычное подтверждение; всё
   * остальное (материалов нет, часть не пришла) требует объяснения: этап
   * закрывается досрочно, и через неделю «почему» должно отвечать
   * не расследование, а история этапа.
   */
  const close = () => run(async () => {
    if (summary.allSettled) {
      const ok = await confirm({
        title: 'Завершить закупку по заказу?',
        message: `Все материалы на месте (${summary.settled} из ${summary.total}). `
          + `${stages.length === 1 ? 'Этап закупки закроется' : `Закроются все ${stages.length} этапов закупки`}, `
          + 'и заказ пойдёт на следующий этап маршрута.',
        confirmLabel: 'Завершить',
      });
      if (ok) await onClose(order.id, 'Материалы получены — закупка завершена');
      return;
    }
    const { ok, value } = await confirmWithInput({
      title: 'Завершить закупку досрочно?',
      message: summary.total === 0
        ? 'По заказу не заведено ни одного материала. Закупка закроется, и заказ пойдёт дальше по маршруту.'
        : `На месте ${summary.settled} из ${summary.total}. Закупка закроется, и заказ пойдёт дальше по маршруту.`,
      confirmLabel: 'Завершить',
      variant: 'danger',
      prompt: {
        label: 'Почему закупка завершена',
        placeholder: summary.total === 0
          ? 'Материалы давальческие / закупка не требуется'
          : 'Остаток придёт позже, производство не ждёт',
        required: true,
      },
    });
    if (ok) await onClose(order.id, value);
  });

  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}>
        <div>
          <span className={styles.subText}>Карточка закупки</span>
          <div>
            <strong>
              Материалы по заказу{' '}
              <OrderLink orderId={order.id}>№{order.bitrix_id || '—'}</OrderLink>
            </strong>
            {' · '}{order.title}
          </div>
          <div className={styles.subText}>
            {state === 'done'
              ? 'закупка завершена, открытых этапов нет'
              : `${stages.length} ${pluralize(stages.length, 'позиция', 'позиции', 'позиций')} в закупке`}
            {order.manager ? ` · менеджер: ${order.manager}` : ''}
          </div>
        </div>
        <Badge variant={SUPPLY_STATE_BADGE[state].variant}>
          {SUPPLY_STATE_BADGE[state].label}
        </Badge>
      </div>

      <div className={styles.queueActions}>
        {/*
          Исходный лист менеджера — рядом с работой закупщика (п. 6 документа
          20.08): искать его в карточке заказа не должно быть нужно. Печатная
          форма — другое: она собирается по ФАКТИЧЕСКИМ строкам закупщика.
        */}
        {listFile ? (
          <a
            className={styles.cellWithIcon}
            href={supabase.storage.from('erp-attachments').getPublicUrl(listFile.file_path).data.publicUrl}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="file" size={14} />
            {listFile.file_name || 'Открыть лист закупки'}
          </a>
        ) : (
          <span className={`${styles.subText} ${styles.cellWithIcon}`}>
            <Icon name="alert" size={13} /> лист не приложен
          </span>
        )}
        <ButtonLink to={`/orders/${order.id}/purchase-list`} variant="ghost">
          Печать
        </ButtonLink>
        <Button variant="ghost" disabled={busy} onClick={() => onAddMaterial(order.id)}>
          + Материал
        </Button>
        {perms.take && state === 'open' && (
          <Button variant="secondary" disabled={busy} onClick={take}>
            Взять в работу
          </Button>
        )}
        {/*
          У ЗАВЕРШЁННОЙ ЗАКУПКИ ЗАВЕРШАТЬ НЕЧЕГО (правка 24.08, п. 2). Карточка
          открывается и из архива, а открытых этапов там ноль: кнопка звала бы
          закрыть пустой список — «действие есть, а работы нет».
        */}
        {perms.complete && state !== 'done' && (
          <Button variant="primary" disabled={busy} onClick={close}>
            Завершить закупку
          </Button>
        )}
      </div>

      {state === 'blocked' && (
        <div className={styles.queueReason}>
          <span className={styles.cellWithIcon}>
            <Icon name="ban" size={14} />
            {stages.find((st) => st.status === 'blocked')?.block_reason || 'Заблокирован цехом'}
          </span>
        </div>
      )}

      {/*
        Сводка стоит СРАЗУ под шапкой и видна без прокрутки (п. 1.3). Раньше
        общий статус материалов лежал ниже по экрану, за таблицей всех заказов.
      */}
      <div className={styles.dashKpis}>
        {TILES.map((t) => (
          <div key={t.key} className={styles.kpiCard}>
            <span className={`${styles.kpiIcon} ${t.cls ? styles[t.cls] : ''}`}>
              <Icon name={t.icon} size={20} />
            </span>
            <span className={styles.kpiBody}>
              <span className={styles.kpiCardLabel}>{t.label}</span>
              <span className={styles.kpiCardValue}>{values[t.key]}</span>
            </span>
          </div>
        ))}
      </div>

      {summary.problems.length > 0 && (
        <div className={styles.subText}>
          Проблемные позиции: {summary.problems.map((m) => m.name || 'без названия').join(', ')}
        </div>
      )}

      {/*
        Детальная таблица — «нижняя таблица остаётся детализацией и историей
        по каждой позиции» (п. 1.4). Содержимое передаётся сверху: ячейки
        живут в `PurchaseFields`, одном модуле на таблицу и карточку планшета.
      */}
      {children}
    </section>
  );
}

/** Пустая карточка: заказ не выбран — говорим, что делать */
export function PurchaseCardEmpty() {
  return (
    <section className={styles.matSection}>
      <ScrollHintBox className={styles.toolbar} label="Подсказка">
        <span className={`${styles.subText} ${styles.cellWithIcon}`}>
          <Icon name="box" size={14} />
          Выберите заказ в списке выше — откроется его карточка закупки
          со сводкой и материалами.
        </span>
      </ScrollHintBox>
    </section>
  );
}
