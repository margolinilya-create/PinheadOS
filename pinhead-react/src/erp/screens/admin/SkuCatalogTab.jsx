import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { useErpAccess } from '../../store/useErpAccess';
import { Badge } from '../../components/Badge';
import { Button, ButtonLink } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { FilterChip } from '../../components/FilterChip';
import { LoadFailed, EmptyResult, EmptyState } from '../../components/ErpStates';
import { TableSkeleton } from '../../components/ErpSkeletons';
import { SKU_CARD_STATUS_LABELS } from '../../utils/skuCardLabels';
import styles from '../../styles';

/**
 * КАТАЛОГ МОДЕЛЕЙ (правка 14.09, п. 6): «добавить в црм каталог SKU
 * с карточкой модели».
 *
 * СОДЕРЖИМОЕ У НЕГО ЕСТЬ С ПЕРВОГО ДНЯ: карточки засеяны из прайс-каталога
 * визарда (52 модели). Пустая вкладка при полном прайсе читалась бы как
 * поломка, а не как пустой каталог — правило «посмотрите, чем механизм
 * будет питаться».
 *
 * ПОИСК И ФИЛЬТР — В АДРЕСЕ. Ссылку на отфильтрованный каталог шлют коллегам,
 * и `useScrollRestore` ключуется по `pathname + search`: состояние экрана,
 * живущее только в памяти, теряется при переходе в карточку и обратно.
 */

const STATUS_VARIANT = {
  draft: 'waiting',
  active: 'ready',
  archived: 'neutral',
};

/** Что ищем: название, код и техническое название лекал — как просит документ */
function matches(card, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return [card.name, card.code, card.pattern_tech_name, card.category]
    .some((v) => (v || '').toLowerCase().includes(q));
}

export function SkuCatalogTab() {
  const { cards, loaded, error, priceCodes, load, create } = useErpStore(useShallow((s) => ({
    cards: s.skuCards,
    loaded: s.skuCardsLoaded,
    error: s.skuCardsError,
    priceCodes: s.skuPriceCodes,
    load: s.loadSkuCards,
    create: s.createSkuCard,
  })));
  const canEdit = useErpAccess().can('sku.edit');
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const query = params.get('q') ?? '';
  const status = params.get('status') ?? '';

  const setParam = (key, value) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });

  const inPrice = useMemo(() => new Set(priceCodes), [priceCodes]);
  const shown = useMemo(
    () => cards.filter((c) => matches(c, query) && (!status || c.status === status)),
    [cards, query, status],
  );

  if (error && !loaded) return <LoadFailed onRetry={load} what="каталог моделей" />;
  if (!loaded) return <TableSkeleton rows={6} label="Загрузка каталога" />;
  if (cards.length === 0) {
    return (
      <EmptyState
        icon="shirt"
        title="Каталог пуст"
        text="Карточки появляются при завершении разработки образца либо заводятся вручную."
      />
    );
  }

  return (
    <section>
      <div className={styles.toolbar}>
        <input
          type="search"
          className={`${styles.input} ${styles.searchInput}`}
          value={query}
          placeholder="Название, код или лекала"
          aria-label="Поиск модели"
          onChange={(e) => setParam('q', e.target.value)}
        />
        <div className={styles.spacer} />
        {/*
          ЗАВЕСТИ МОДЕЛЬ РУКАМИ — для изделий, которые в прайсе визарда есть,
          а техпакета в ERP не имеют. Карточка рождается ЧЕРНОВИКОМ: «В работе»
          её делает отдельное действие с отдельным правом, потому что после
          этого по модели начинают заводить заказы.
        */}
        {canEdit && (
          <Button variant="secondary" onClick={() => setAdding({ code: '', name: '' })}>
            Завести модель
          </Button>
        )}
        {Object.entries(SKU_CARD_STATUS_LABELS).map(([key, label]) => (
          <FilterChip
            key={key}
            active={status === key}
            onClick={() => setParam('status', status === key ? '' : key)}
          >
            {label} · {cards.filter((c) => c.status === key).length}
          </FilterChip>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyResult query={query} onReset={() => setParams({}, { replace: true })} />
      ) : (
        <ul className={styles.skuGrid}>
          {shown.map((card) => (
            <li key={card.id} className={styles.skuCardTile}>
              <div className={styles.skuCardHead}>
                <ButtonLink to={`/sku-card/${card.id}`} variant="ghost" size="sm">
                  {card.name}
                </ButtonLink>
                <Badge variant={STATUS_VARIANT[card.status]}>
                  {SKU_CARD_STATUS_LABELS[card.status]}
                </Badge>
              </div>
              <div className={styles.skuCardCode}>{card.code}</div>
              {card.pattern_tech_name && (
                <div className={styles.subText}>Лекала: {card.pattern_tech_name}</div>
              )}
              {/*
                «Выпущен в прайс» спрашивается у САМОГО прайса, а не у флага
                в карточке: два источника одного факта разошлись бы в первую
                же публикацию. Молчим, когда выпущен, и говорим, когда нет, —
                это и есть то, что требует действия
              */}
              {!inPrice.has(card.code) && (
                <div className={styles.subText}>Нет в прайсе визарда — заказ по ней не посчитать</div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!canEdit && (
        <p className={styles.subText}>
          Карточки доступны на чтение: правка требует права «Править карточку модели».
        </p>
      )}

      {adding && (
        <Modal title="Новая модель" onClose={() => setAdding(null)}>
          <div className={styles.formGrid}>
            <Field
              label="Артикул"
              required
              autoFocus
              value={adding.code}
              hint="Тот же код, что в прайс-каталоге визарда, — по нему они и связаны"
              onChange={(e) => setAdding({ ...adding, code: e.target.value })}
            />
            <Field
              label="Название модели"
              required
              value={adding.name}
              onChange={(e) => setAdding({ ...adding, name: e.target.value })}
            />
          </div>
          <div className={styles.modalActions}>
            <Button variant="ghost" onClick={() => setAdding(null)}>Отмена</Button>
            <Button
              disabled={saving || !adding.code.trim() || !adding.name.trim()}
              onClick={async () => {
                setSaving(true);
                /*
                  Повтор кода отвечает 23505 — уникальность держит БАЗА,
                  а не проверка на клиенте: между ней и вставкой помещается
                  второй человек.
                */
                const row = await create({
                  code: adding.code.trim(),
                  name: adding.name.trim(),
                });
                setSaving(false);
                if (row) setAdding(null);
              }}
            >
              {saving ? 'Заводим…' : 'Завести'}
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
