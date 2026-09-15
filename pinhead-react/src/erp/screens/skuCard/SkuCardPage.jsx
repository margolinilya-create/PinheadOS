import { useEffect, useMemo, useState } from 'react';
import { useParams, useLocation, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../../components/PageHead';
import { Badge } from '../../components/Badge';
import { Button, ButtonLink } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Field } from '../../components/Field';
import { Tabs, TabPanel } from '../../components/Tabs';
import { LoadFailed, EmptyState } from '../../components/ErpStates';
import { TableSkeleton } from '../../components/ErpSkeletons';
import { ReadOnlyFieldset } from '../../components/ReadOnlyFieldset';
import { useErpStore } from '../../store/useErpStore';
import { useErpAccess } from '../../store/useErpAccess';
import { confirm } from '../../../store/useConfirmStore';
import { SKU_CARD_STATUS_LABELS, SKU_CARD_FILE_ROLE_LABELS } from '../../utils/skuCardLabels';
import { formatDateShort } from '../../utils/time';
import { skuCardFieldLabel } from '../../utils/skuCardFields';
import styles from '../../styles';

/**
 * КАРТОЧКА МОДЕЛИ (правка 14.09, п. 6).
 *
 * ЛЕЖИТ В `screens/skuCard`, А НЕ ВНУТРИ АДМИНКИ. Документ требует «одна и та
 * же карточка»: её открывает и вкладка «Каталог SKU», и вкладка SKU карточки
 * разработки. Карточка, живущая внутри админской вкладки, второму вызывающему
 * недоступна — и рядом завелась бы вторая поверхность с тем же содержимым,
 * то есть ровно то, от чего проект уходил в подряде и закупке.
 *
 * ТРИ ДЕЙСТВИЯ — ТРИ ПРАВА, и это не педантизм:
 *   · правка описания и техпакета — `sku.edit`;
 *   · «Выпустить в работу» — `sku.publish`: после этого по модели начинают
 *     заводить заказы, и цена ошибки другая;
 *   · «В архив» — `sku.archive`.
 * Каждое зеркалит `erp_sku_card_guard`: страж строже интерфейса даёт «кнопка
 * есть, действие падает», мягче — дыру.
 *
 * ПРАЙС-КАТАЛОГ ВИЗАРДА ОТСЮДА НЕ ПОПОЛНЯЕТСЯ, и это сказано вслух. Выпуск
 * артикула — форма сверки `DevToSku` в карточке разработки: код, категория,
 * цена пошива и расход ткани из техпакета НЕ выводятся, а артикул с нулевой
 * ценой ломает визард молча. Вторая такая форма здесь стала бы вторым местом
 * для одного решения. Карточка лишь ГОВОРИТ, что артикула в прайсе нет.
 */

const STATUS_VARIANT = { draft: 'waiting', active: 'ready', archived: 'neutral' };

/** Поля описания: подпись, ключ и тип контрола — один список на показ и правку */
const FIELDS = [
  { key: 'name', label: 'Название модели' },
  { key: 'category', label: 'Категория' },
  { key: 'fit', label: 'Крой' },
  { key: 'pattern_tech_name', label: 'Техническое название лекал' },
  { key: 'pattern_version', label: 'Версия лекал' },
  { key: 'price_min', label: 'Цена от, ₽', type: 'number' },
  { key: 'price_max', label: 'Цена до, ₽', type: 'number' },
];

export default function SkuCardPage() {
  const { cardId } = useParams();
  const location = useLocation();
  const [params, setParams] = useSearchParams();

  const {
    cards, loaded, error, priceCodes, load, save, loadDetail, loadStats,
  } = useErpStore(useShallow((s) => ({
    cards: s.skuCards,
    loaded: s.skuCardsLoaded,
    error: s.skuCardsError,
    priceCodes: s.skuPriceCodes,
    load: s.loadSkuCards,
    save: s.saveSkuCard,
    loadDetail: s.loadSkuCardDetail,
    loadStats: s.loadSkuCardStats,
  })));
  const { can } = useErpAccess();
  const canEdit = can('sku.edit');
  const canPublish = can('sku.publish');
  const canArchive = can('sku.archive');

  const [detail, setDetail] = useState(null);
  const [stats, setStats] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!loaded) void load(); }, [loaded, load]);
  useEffect(() => {
    let alive = true;
    void loadDetail(cardId).then((d) => { if (alive) setDetail(d); });
    void loadStats(cardId).then((s) => { if (alive) setStats(s); });
    return () => { alive = false; };
  }, [cardId, loadDetail, loadStats]);

  const card = useMemo(() => cards.find((c) => c.id === cardId) ?? null, [cards, cardId]);

  if (error && !loaded) return <LoadFailed onRetry={load} what="каталог моделей" />;
  if (!loaded) return <TableSkeleton rows={6} label="Загрузка карточки модели" />;
  if (!card) {
    return (
      <EmptyState
        icon="shirt"
        title="Модель не найдена"
        text="Возможно, карточку удалили или ссылка устарела."
        action={<ButtonLink to="/admin?tab=sku">К каталогу моделей</ButtonLink>}
      />
    );
  }

  const back = location.state?.from || '/admin?tab=sku';
  const tab = params.get('tab') || 'about';
  const setTab = (id) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    next.set('tab', id);
    return next;
  }, { replace: true });

  const inPrice = priceCodes.includes(card.code);
  const values = draft ?? card;

  const patchOf = () => {
    const out = {};
    for (const f of FIELDS) {
      const raw = values[f.key];
      const next = f.type === 'number'
        ? (raw === '' || raw === null || raw === undefined ? null : Number(raw))
        : (raw === '' ? null : raw);
      if (next !== card[f.key]) out[f.key] = next;
    }
    if ((values.description ?? '') !== (card.description ?? '')) {
      out.description = values.description === '' ? null : values.description;
    }
    return out;
  };

  const onSave = async () => {
    const patch = patchOf();
    // Правка, не изменившая ничего, версии не получает и на сервере — не шлём
    // её вовсе, иначе кнопка «Сохранить» делала бы вид, что что-то произошло
    if (Object.keys(patch).length === 0) { setDraft(null); return; }
    setSaving(true);
    const ok = await save(card.id, patch);
    setSaving(false);
    if (ok) setDraft(null);
  };

  /**
   * ВЫПУСК В РАБОТУ. Название кнопки называет ПОСЛЕДСТВИЕ («по модели начнут
   * заводить заказы»), а не переход состояния: «сделать активной» ничего
   * не говорит тому, кто нажимает.
   */
  const onPublish = async () => {
    const ok = await confirm({
      title: 'Выпустить модель в работу?',
      text: `«${card.name}» станет доступна для выбора в заказах. Вернуть в черновик`
        + ' можно, но заказы, заведённые по ней, останутся.',
      confirmText: 'Выпустить',
    });
    if (ok) await save(card.id, { status: 'active' });
  };

  const onArchive = async () => {
    const ok = await confirm({
      title: 'Убрать модель в архив?',
      text: 'Из выбора в заказах она исчезнет, история заказов по ней останется.',
      confirmText: 'В архив',
      variant: 'danger',
    });
    if (ok) await save(card.id, { status: 'archived' });
  };

  const files = (detail?.files ?? []).filter((f) => !f.superseded_at);
  const versions = detail?.versions ?? [];

  return (
    <>
      <PageHead
        title={card.name}
        sub={`Артикул ${card.code} · версия карточки ${card.card_version}`}
      />
      <ButtonLink to={back} variant="secondary" className={styles.cellWithIcon}>
        <Icon name="chevronLeft" size={14} />К каталогу
      </ButtonLink>

      <div className={styles.checkRow}>
        <Badge variant={STATUS_VARIANT[card.status]}>
          {SKU_CARD_STATUS_LABELS[card.status]}
        </Badge>
        {/*
          «Выпущен ли артикул в прайс» спрашивается у САМОГО прайса: второй
          флаг в карточке разошёлся бы с ним в первую же публикацию. Молчим,
          когда выпущен, — требует действия обратное
        */}
        {!inPrice && (
          <span className={styles.subText}>
            Нет в прайсе визарда: заказ по этой модели не посчитать.
            Артикул выпускается формой сверки в карточке разработки.
          </span>
        )}
        {card.status !== 'active' && canPublish && (
          <Button variant="secondary" onClick={onPublish}>Выпустить в работу</Button>
        )}
        {card.status !== 'archived' && canArchive && (
          <Button variant="ghost" onClick={onArchive}>В архив</Button>
        )}
      </div>

      <Tabs
        idPrefix="sku-card"
        label="Разделы карточки модели"
        active={tab}
        onSelect={setTab}
        tabs={[
          { id: 'about', label: 'Описание' },
          { id: 'tech', label: 'Технический пакет', count: files.length },
          { id: 'orders', label: 'Заказы', count: stats?.orders },
          { id: 'history', label: 'История', count: versions.length },
        ]}
      />

      <TabPanel idPrefix="sku-card" active={tab}>
        {tab === 'about' && (
          <ReadOnlyFieldset
            canManage={canEdit}
            note="Карточка открыта на чтение: правка требует права «Править карточку модели»."
          >
            <div className={styles.formGrid}>
              {FIELDS.map((f) => (
                <Field
                  key={f.key}
                  label={f.label}
                  type={f.type}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setDraft({ ...values, [f.key]: e.target.value })}
                />
              ))}
              <Field
                as="textarea"
                rows={4}
                label="Описание модели"
                fieldClassName={styles.skuFullRow}
                value={values.description ?? ''}
                onChange={(e) => setDraft({ ...values, description: e.target.value })}
              />
            </div>
            {draft && (
              <div className={styles.modalActions}>
                <Button variant="ghost" onClick={() => setDraft(null)}>Отменить</Button>
                <Button onClick={onSave} disabled={saving}>
                  {saving ? 'Сохраняем…' : 'Сохранить'}
                </Button>
              </div>
            )}
          </ReadOnlyFieldset>
        )}

        {tab === 'tech' && (
          files.length === 0 ? (
            <EmptyState
              icon="file"
              title="Файлов пока нет"
              text="Лекала, техпаспорт и фото образца приезжают из финального пакета разработки."
            />
          ) : (
            <ul className={styles.skuList}>
              {files.map((f) => (
                <li key={f.id} className={styles.skuListRow}>
                  <span className={styles.subText}>
                    {SKU_CARD_FILE_ROLE_LABELS[f.role] ?? f.role}
                  </span>
                  <span>{f.file_name || f.file_path}</span>
                  <span className={styles.subText}>версия {f.version}</span>
                </li>
              ))}
            </ul>
          )
        )}

        {tab === 'orders' && (
          /*
            Статистику считает СЕРВЕР и только по `sku_card_id`: сравнение
            по названию отдало бы заказы одноимённых моделей. Отменённые
            не считаются — решение владельца 14.09.
          */
          stats === null ? (
            <TableSkeleton rows={2} label="Загрузка статистики" />
          ) : stats.orders === 0 ? (
            <EmptyState
              icon="inbox"
              title="Заказов по модели ещё не было"
              text="Позиция заказа связывается с моделью действием «Использовать в заказе»."
            />
          ) : (
            <dl className={`${styles.checkRow} ${styles.orderFacts}`}>
              <div><dt className={styles.subText}>Заказов</dt><dd>{stats.orders}</dd></div>
              <div><dt className={styles.subText}>Изделий</dt><dd>{stats.qty}</dd></div>
              <div>
                <dt className={styles.subText}>Последний заказ</dt>
                <dd>{stats.lastOrderAt ? formatDateShort(stats.lastOrderAt) : '—'}</dd>
              </div>
            </dl>
          )
        )}

        {tab === 'history' && (
          versions.length === 0 ? (
            <EmptyState
              icon="clock"
              title="Правок ещё не было"
              text="Каждая значимая правка карточки поднимает её версию и попадает сюда."
            />
          ) : (
            <ul className={styles.skuList}>
              {versions.map((v) => (
                <li key={v.id} className={styles.skuListRow}>
                  <strong>Версия {v.version}</strong>
                  <span className={styles.subText}>{formatDateShort(v.created_at)}</span>
                  {/* Что именно изменилось — иначе историю пришлось бы читать
                      сравнением снимков, то есть не читать вовсе */}
                  <span>{v.changed_fields.map(skuCardFieldLabel).join(', ')}</span>
                </li>
              ))}
            </ul>
          )
        )}
      </TabPanel>
    </>
  );
}
