import { useCallback, useEffect, useState } from 'react';
import { fetchCatalogKey } from '../../../lib/catalogs';
/*
 * Только то, что вход уже отдаёт другим чанкам (`ErpStates`): новый импорт из
 * `lib/appUpdate` (например, `handlePossibleUpdate`) добавил бы входу экспорт —
 * вход не растёт (бюджет вехи 5а)
 */
import { isChunkLoadError, UPDATE_MESSAGE, UPDATE_TITLE } from '../../../lib/appUpdate';
import { useAuthStore } from '../../../store/useAuthStore';
import { toast } from '../../../store/useToastStore';
import { networkFailureMessage, pluralize } from '../../../utils/i18n';
import { parseFlatsCatalog } from '../../design/catalog/flatsSchema';
import { SEED_FLATS_COUNT } from '../../design/seed/seedInfo';
import CatalogNotice from '../CatalogNotice';
import { FLAT_WRITER_ROLES, flatRow, seedStatusText, zonesCount } from './flatsView';
import base from '../../screens/Sales.module.css';
import notices from '../OrderSettings.module.css';
import styles from './FlatsTab.module.css';

const NAME = 'Флэты и зоны';
const LOADING = { state: 'loading', flats: [], issues: [], dropped: 0 };

/** Справочник из ответа: битые флэты отброшены, замечания — по-русски */
function loadedFrom(res) {
  if (!res.exists) return { state: 'ready', flats: [], issues: [], dropped: 0 };
  const parsed = parseFlatsCatalog(res.value);
  const raw = Array.isArray(res.value?.flats) ? res.value.flats.length : 0;
  return { state: 'ready', flats: parsed.catalog.flats, issues: parsed.issues, dropped: raw - parsed.catalog.flats.length };
}

function issuesTitle(dropped) {
  if (dropped === 0) return 'Справочник флэтов в базе неверной формы — флэты не показаны';
  return `${dropped} ${pluralize(dropped, 'запись', 'записи', 'записей')} справочника с ошибками не ${pluralize(dropped, 'показана', 'показаны', 'показаны')}`;
}

function emptyText(canSeed, isWriter) {
  if (canSeed) return `Типовых силуэтов пока нет. Загрузите ${SEED_FLATS_COUNT} моделей одной кнопкой`;
  if (isWriter) return 'Типовых силуэтов пока нет. Загрузить их можно с компьютера';
  return 'Типовых силуэтов пока нет. Их загружает администратор или директор';
}

/**
 * Вкладка «Флэты и зоны» (веха 5а, задача 4): справочник силуэтов изделий
 * `app_config.garmentFlats` для вкладки «Дизайн» — название, тип, подбор,
 * виды и печатные зоны.
 *
 * Правка флэтов — веха 5б. Здесь — только кнопка «Загрузить типовые флэты»
 * (admin и director, не на телефоне): сид дизайн-мейкера грузится `import()`
 * по нажатию, дописывает недостающие флэты, справочник пишет последним
 * (`design/seed/seedFlats.ts`). Конфликт записи — плашка вкладок вехи 4.
 * Справочник читается свежим запросом мимо кэша каталогов.
 */
export default function FlatsTab({ readOnly }) {
  const role = useAuthStore((s) => s.user?.role);
  const isWriter = FLAT_WRITER_ROLES.includes(role);
  const canSeed = isWriter && !readOnly;
  const [data, setData] = useState(LOADING);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchCatalogKey('app_config', 'garmentFlats').then((res) => {
      if (alive) setData(res ? loadedFrom(res) : { ...LOADING, state: 'error' });
    });
    return () => { alive = false; };
  }, [attempt]);

  const reload = useCallback(() => {
    setConflict(false);
    setData(LOADING);
    setAttempt((n) => n + 1);
  }, []);

  const runSeed = async () => {
    if (busy) return;
    setBusy(true);
    setProgress(null);
    try {
      const { seedFlats } = await import('../../design/seed/seedFlats');
      const res = await seedFlats({ onProgress: setProgress });
      if (res.catalog === 'saved') {
        toast.success(`Типовые флэты загружены: ${res.added} ${pluralize(res.added, 'модель', 'модели', 'моделей')}`);
        reload();
      } else if (res.catalog === 'unchanged') {
        toast.success('Все типовые флэты уже в справочнике');
      } else if (res.catalog === 'conflict') {
        setConflict(true);
      }
    } catch (e) {
      console.error('FlatsTab: seedFlats', e);
      toast.error(isChunkLoadError(e)
        ? `${UPDATE_TITLE}. ${UPDATE_MESSAGE}`
        : `Типовые флэты не загружены: ${networkFailureMessage(e)}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const rows = data.flats.map(flatRow);
  const status = seedStatusText(progress, busy);

  return (
    <section className={base.panel} aria-labelledby="flats-head" data-readonly={readOnly ? 'true' : undefined}>
      <h2 id="flats-head" className={base.panelTitle}>{NAME}</h2>
      <p className={styles.intro}>
        Силуэты изделий для вкладки «Дизайн»: виды, печатные зоны и подбор по модели.
        Типовой силуэт подходит многим моделям одной категории, это не лекало модели.
      </p>

      {conflict && <CatalogNotice editor={{ state: 'conflict', reload }} name={NAME} />}
      {data.state === 'loading' && <CatalogNotice editor={{ state: 'loading', reload }} name={NAME} />}
      {data.state === 'error' && (
        <div className={notices.notice} role="status">
          <p>Справочник флэтов не загрузился.</p>
          <button type="button" className="btn" onClick={reload}>Загрузить снова</button>
        </div>
      )}

      {data.state === 'ready' && rows.length === 0 && data.issues.length === 0 && (
        <div className={base.empty}><p>{emptyText(canSeed, isWriter)}</p></div>
      )}

      {data.issues.length > 0 && (
        <div className={styles.issues} role="note">
          <p>{issuesTitle(data.dropped)}</p>
          <details>
            <summary>Что не так</summary>
            <ul>{data.issues.slice(0, 20).map((text, i) => <li key={`${i}-${text}`}>{text}</li>)}</ul>
          </details>
        </div>
      )}

      {rows.length > 0 && (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <caption className={styles.caption}>{`Флэтов в справочнике: ${rows.length}`}</caption>
            <thead>
              <tr>
                <th scope="col">Название</th>
                <th scope="col">Тип</th>
                <th scope="col">Подбор</th>
                <th scope="col">Виды</th>
                <th scope="col">Зоны</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.active ? undefined : styles.off}>
                  <th scope="row">
                    {r.name}
                    <span className={styles.code}>{r.id}</span>
                    {!r.active && <span className={styles.badge}>Снят</span>}
                  </th>
                  <td>{r.type}</td>
                  <td>
                    {r.kind}
                    {r.models && <span className={styles.code}>{`Модели: ${r.models}`}</span>}
                  </td>
                  <td>{r.views}</td>
                  <td>
                    {zonesCount(r.zoneCount)}
                    <span className={styles.code}>{r.zones.join(', ')}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isWriter && <p className={styles.hint}>Флэты меняет администратор или директор</p>}

      {canSeed && (
        <div className={styles.seed}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={runSeed}
            disabled={data.state !== 'ready' || conflict}
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
            aria-describedby="flats-seed-hint"
          >
            Загрузить типовые флэты
          </button>
          <p id="flats-seed-hint" className={styles.hint}>
            {`Дописывает недостающие типовые силуэты дизайн-мейкера (${SEED_FLATS_COUNT} моделей). Уже загруженные не меняет.`}
          </p>
          {progress && <progress className={styles.progress} max={progress.total || 1} value={progress.done} aria-label="Загрузка типовых флэтов" />}
        </div>
      )}
      <p className={styles.status} role="status" aria-live="polite">{status}</p>
    </section>
  );
}
