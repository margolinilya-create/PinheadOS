import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchCatalogKey } from '../../../lib/catalogs';
/*
 * Только то, что вход уже отдаёт другим чанкам (`ErpStates`): новый импорт из
 * `lib/appUpdate` (например, `handlePossibleUpdate`) добавил бы входу экспорт —
 * вход не растёт (бюджет вехи 5а)
 */
import { isChunkLoadError, UPDATE_MESSAGE, UPDATE_TITLE } from '../../../lib/appUpdate';
import { useAuthStore } from '../../../store/useAuthStore';
import { confirm } from '../../../store/useConfirmStore';
import { toast } from '../../../store/useToastStore';
import { networkFailureMessage, pluralize } from '../../../utils/i18n';
import { parseFlatsCatalog } from '../../design/catalog/flatsSchema';
import { SEED_FLATS_COUNT } from '../../design/seed/seedInfo';
import { catalogHasUnsaved, CATALOG_LEAVE_TEXT } from '../../leaveGuard';
import CatalogNotice from '../CatalogNotice';
import FlatsList from '../flats/FlatsList';
import ZonesCatalogEditor from '../flats/ZonesCatalogEditor';
import { EMPTY_LIST_TEXT } from '../flats/flatsListView';
import { FLAT_WRITER_ROLES, flatRow, SEED_CONFLICT_TEXT, seedStatusText, spokenProgress } from './flatsView';
import base from '../../screens/Sales.module.css';
import notices from '../OrderSettings.module.css';
import styles from './FlatsTab.module.css';

/**
 * Редактор флэта (холст konva) и превью для телефона — только `import()`:
 * konva не в графе списка флэтов и телефона (страж `bundle-budget`, задача 0)
 */
const FlatEditor = lazy(() => import('../flats/FlatEditor'));
const FlatPreview = lazy(() => import('../flats/FlatPreview'));

const NAME = 'Флэты и зоны';
const PARTS = [['flats', 'Флэты'], ['zones', 'Зоны нанесения']];
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

/** Уйти с несохранённым — переспросить (правило вехи 4) */
async function mayLeave() {
  if (!catalogHasUnsaved()) return true;
  return confirm({
    title: 'Правки справочника не сохранены',
    message: CATALOG_LEAVE_TEXT,
    confirmLabel: 'Перейти без сохранения',
    cancelLabel: 'Остаться',
    variant: 'danger',
  });
}

function emptyText(canSeed, isWriter) {
  if (canSeed) return EMPTY_LIST_TEXT;
  if (isWriter) return 'Типовых силуэтов пока нет. Загрузить их можно с компьютера';
  return 'Типовых силуэтов пока нет. Их загружает администратор или директор';
}

/**
 * Вкладка «Флэты и зоны» (веха 5а, задача 4): справочник силуэтов изделий
 * `app_config.garmentFlats` для вкладки «Дизайн» — название, тип, подбор,
 * виды и печатные зоны.
 *
 * Веха 5б, задача 6б — режимы по адресу: над содержимым переключатель
 * «Флэты | Зоны нанесения» (`part`); `flat=<id>` — редактор флэта (лениво,
 * с холстом konva), на ≤ 760 px — превью картинкой; `flat=new` — новый флэт;
 * `part=zones` — справочник зон (`ZonesCatalogEditor`). Уход с несохранённым
 * переспрашивает (`CATALOG_LEAVE_TEXT`); «← Все флэты» возвращает фокус на
 * строку флэта. В списке — колонка «Версия» и «Новый флэт»; вся строка — ссылка.
 *
 * Сид — кнопка «Загрузить типовые флэты»
 * (admin и director, не на телефоне): сид дизайн-мейкера грузится `import()`
 * по нажатию, дописывает недостающие флэты, справочник пишет последним
 * (`design/seed/seedFlats.ts`). Конфликт записи — плашка вида вкладок вехи 4
 * со своим текстом («нажмите ещё раз»). Повторное нажатие после возврата на
 * вкладку присоединяется к летящему сиду; итог (тост) называет первый вызов.
 * Справочник читается свежим запросом мимо кэша каталогов.
 *
 * Прогресс: `<progress>` и видимая строка — на каждый файл; диктору —
 * отдельная скрытая визуально область `aria-live`, всегда в дереве доступности,
 * со сменой фазы и четвертями загрузки (`spokenProgress`), а не 67 объявлений.
 */
export default function FlatsTab({ readOnly }) {
  const role = useAuthStore((s) => s.user?.role);
  const isWriter = FLAT_WRITER_ROLES.includes(role);
  const canSeed = isWriter && !readOnly;
  const [data, setData] = useState(LOADING);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [spoken, setSpoken] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [params, setParams] = useSearchParams();
  const flatId = params.get('flat');
  const part = params.get('part') === 'zones' ? 'zones' : 'flats';
  const [copyFrom, setCopyFrom] = useState(null);
  const [returnTo, setReturnTo] = useState(null);

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

  const onProgress = useCallback((p) => {
    setProgress(p);
    setSpoken((prev) => spokenProgress(prev, p));
  }, []);

  const runSeed = async () => {
    if (busy) return;
    setBusy(true);
    setProgress(null);
    setSpoken(null);
    try {
      const { seedFlats } = await import('../../design/seed/seedFlats');
      const res = await seedFlats({ onProgress });
      if (res.catalog === 'saved') {
        if (!res.joined) toast.success(`Типовые флэты загружены: ${res.added} ${pluralize(res.added, 'модель', 'модели', 'моделей')}`);
        reload();
      } else if (res.catalog === 'unchanged') {
        if (!res.joined) toast.success('Все типовые флэты уже в справочнике');
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
      setSpoken(null);
    }
  };

  const nav = useCallback((patch) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      return next;
    }, { replace: true });
  }, [setParams]);

  const switchPart = async (p) => {
    if (p === part && !flatId) return;
    if (!(await mayLeave())) return;
    nav({ part: p === 'zones' ? 'zones' : null, flat: null, view: null });
  };

  const back = async () => {
    if (!(await mayLeave())) return;
    setReturnTo(flatId);
    reload();
    nav({ flat: null, view: null });
  };

  const openNew = (source) => {
    setCopyFrom(source);
    nav({ flat: 'new', view: null });
  };

  const makeExact = async (source) => {
    if (await mayLeave()) openNew(source);
  };

  const focused = useCallback(() => setReturnTo(null), []);
  const rows = data.flats.map(flatRow);

  const previewOf = () => {
    if (data.state === 'loading') return <CatalogNotice editor={{ state: 'loading', reload }} name={NAME} />;
    return <FlatPreview flat={data.flats.find((f) => f.id === flatId) ?? null} flatId={flatId} onBack={back} />;
  };

  const flatPane = (
    <Suspense fallback={<p className={styles.hint} role="status">Загрузка редактора флэта…</p>}>
      {readOnly ? previewOf() : (
        <FlatEditor
          flatId={flatId}
          view={params.get('view')}
          onView={(k) => nav({ view: k })}
          onBack={back}
          readOnly={!isWriter}
          copyFrom={flatId === 'new' ? copyFrom : null}
          onMakeExact={makeExact}
        />
      )}
    </Suspense>
  );

  const list = (
    <>
      <p className={styles.intro}>
        Силуэты изделий для вкладки «Дизайн»: виды, печатные зоны и подбор по модели.
        Типовой силуэт подходит многим моделям одной категории, это не лекало модели.
      </p>

      {conflict && (
        <div className={notices.notice} role="alert">
          <p>{SEED_CONFLICT_TEXT}</p>
          <button type="button" className="btn" onClick={reload}>Загрузить свежую версию</button>
        </div>
      )}
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

      {rows.length > 0 && <FlatsList rows={rows} compact={readOnly} focusId={returnTo} onFocused={focused} />}

      {!isWriter && <p className={styles.hint}>Флэты меняет администратор или директор</p>}

      {canSeed && (
        <div className={styles.seed}>
          <button type="button" className="btn btn-primary" onClick={() => openNew(null)} disabled={data.state !== 'ready'}>
            Новый флэт
          </button>
          <button
            type="button"
            className="btn"
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
          {/* Видимая строка на каждый файл; диктору то же — прорежённо, в области ниже */}
          {busy && <p className={styles.status} aria-hidden="true">{seedStatusText(progress, busy)}</p>}
        </div>
      )}
      <p className={styles.srOnly} role="status" aria-live="polite">{seedStatusText(spoken, busy)}</p>
    </>
  );

  let content = list;
  if (part === 'zones') content = <ZonesCatalogEditor readOnly={readOnly} />;
  else if (flatId) content = flatPane;

  return (
    <section className={base.panel} aria-labelledby="flats-head" data-readonly={readOnly ? 'true' : undefined}>
      <h2 id="flats-head" className={base.panelTitle}>{NAME}</h2>
      <div className={styles.parts} role="tablist" aria-label="Флэты или зоны нанесения">
        {PARTS.map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`flats-part-${id}`} className={styles.part}
            aria-selected={part === id} onClick={() => switchPart(id)}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-labelledby={`flats-part-${part}`}>{content}</div>
    </section>
  );
}
