import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useErpStore } from '../../store/useErpStore';
import { useAttachmentUploads } from '../../hooks/useAttachmentUploads';
import { AttachmentPicker } from '../../components/AttachmentPicker';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { BIZ_TASK_KINDS, BIZ_TASK_KIND_LABELS, kindHints } from '../../utils/bizTasks';
import { factoryDateTimeToIso } from '../../../utils/date';
import { toast } from '../../../store/useToastStore';
import { PersonPicker } from './PersonPicker';
import styles from './BizTaskCreateForm.module.css';

/** Лимиты писателя `erp_biz_task_create` (Р8) — форма не даёт завести больше */
const MAX_WATCHERS = 20;
const MAX_CHECKLIST = 100;
const TITLE_MAX = 200;
const ITEM_MAX = 500;

/** Вид вложения задачи — `erp_order_attachments.kind`, папка `att/<заказ>/biz_task/` */
const FILE_KIND = 'biz_task';

/**
 * Что не заполнено — словами перечня «Заполните: …». Порядок — порядок полей
 * формы: человек читает перечень и идёт по нему сверху вниз.
 */
function missingOf({ order, title, kind, assignee, due }) {
  const out = [];
  if (!title.trim()) out.push('название');
  if (!order) out.push('заказ');
  if (!kind) out.push('тип');
  if (!assignee) out.push('ответственный');
  if (!due) out.push('срок');
  return out;
}

/**
 * ФОРМА СОЗДАНИЯ БИЗНЕС-ЗАДАЧИ (правки 19.10, п. 7).
 *
 * Обязательное — название, заказ, тип, один ответственный и срок с датой и
 * временем; остальное (описание, наблюдатели, файлы, чек-лист, «Проверка
 * постановщиком») — под «Дополнительно», чтобы не загромождать форму.
 *
 * ЗАКАЗ ПОДСТАВЛЕН (`order`) и во вкладке заказа не меняется: поля выбора
 * нет вовсе. Общий раздел вместо `order` передаёт `orders` — заказ выбирается
 * в форме (обязательное поле). Пока заказ не выбран, файлы не прикладываются —
 * папка объекта в бакете называется заказом (`att/<заказ>/biz_task/`), и
 * писатель `erp_biz_task_attach` чужую папку отвергает; по той же причине
 * с приложенными файлами заказ уже не меняется.
 *
 * БЛОК КНОПКИ — `aria-disabled` с причиной: перечень ТОЛЬКО незаполненного
 * (правило вехи 6+7); `disabled` — только на время запроса.
 *
 * ДВОЙНОЙ КЛИК — ОДИН ВЫЗОВ: ключ попытки живёт всё время формы (`clientKey`),
 * повтор с ним стор отдаёт тем же промисом, а сервер — той же строкой; плюс
 * свой флаг полёта, чтобы второй клик не дошёл даже до стора.
 *
 * Срок в прошлом — предупреждение, а не блок: поручение «вчера до шести»
 * бывает заведено задним числом, и сразу просроченным оно и должно быть.
 */
export function BizTaskCreateForm({ order = null, orders = null, onCreated, onCancel }) {
  const createBizTask = useErpStore((s) => s.createBizTask);
  const attachBizTaskFiles = useErpStore((s) => s.attachBizTaskFiles);
  const directory = useErpStore((s) => s.chatDirectory);
  const loadChatDirectory = useErpStore((s) => s.loadChatDirectory);
  useEffect(() => { void loadChatDirectory(); }, [loadChatDirectory]);

  /** Ответственный и наблюдатель — только сотрудник ERP (активная карточка) */
  const staff = useMemo(() => (directory ?? []).filter((p) => p.role !== null), [directory]);

  const [pickedId, setPickedId] = useState('');
  const target = order ?? (orders ?? []).find((o) => o.id === pickedId) ?? null;
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState(null);
  const [assignee, setAssignee] = useState([]);
  const [due, setDue] = useState('');
  /** «Срок уже прошёл» — сверяется при вводе: «сейчас» в рендере нечисто */
  const [duePast, setDuePast] = useState(false);
  const [more, setMore] = useState(false);
  const [description, setDescription] = useState('');
  const [watchers, setWatchers] = useState([]);
  const [checklist, setChecklist] = useState([]);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const clientKey = useRef(crypto.randomUUID());
  const uploads = useAttachmentUploads(target?.id ?? 'new');
  const ids = useId();

  const dueIso = factoryDateTimeToIso(due);
  const missing = missingOf({ order: target, title, kind, assignee: assignee[0], due: dueIso });
  const hints = kind ? kindHints(kind) : [];
  const blockReason = missing.length > 0
    ? `Заполните: ${missing.join(', ')}`
    : uploads.uploading ? 'Дождитесь загрузки файлов'
      : uploads.failed ? 'Загрузите заново или уберите файл с ошибкой' : '';

  const submit = async () => {
    if (blockReason || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const items = checklist.map((c) => c.text.trim()).filter(Boolean);
    const input = {
      order_id: target.id,
      title: title.trim(),
      kind,
      assignee_id: assignee[0],
      due_at: dueIso,
      review_required: review,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(watchers.length ? { watchers } : {}),
      ...(items.length ? { checklist: items } : {}),
    };
    const row = await createBizTask(input, clientKey.current);
    if (!row) {
      // Отказ уже объявлен тостом стора; форма с введённым остаётся на экране
      inFlight.current = false;
      setBusy(false);
      return;
    }
    const files = uploads.payload().map((f) => ({ file_path: f.file_path, file_name: f.file_name }));
    // Файлы — уже в бакете (загрузка при выборе); здесь только привязка к задаче.
    // Сбой привязки тостит стор, а задача остаётся созданной — её не повторяем
    if (files.length) await attachBizTaskFiles(row.id, files);
    uploads.clear();
    toast.success('Задача создана');
    onCreated(row);
  };

  return (
    <form
      className={styles.form}
      aria-label="Новая задача"
      noValidate
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
    >
      <Field
        label="Название"
        required
        autoFocus
        maxLength={TITLE_MAX}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      {order ? (
        <div className={styles.field}>
          <span className={styles.label}>Заказ</span>
          <span className={styles.fixed}>{order.label}</span>
        </div>
      ) : (
        <Field
          as="select"
          label="Заказ"
          required
          value={pickedId}
          disabled={uploads.files.length > 0}
          hint={uploads.files.length > 0 ? 'Файлы приложены к этому заказу — уберите их, чтобы сменить заказ' : undefined}
          onChange={(e) => setPickedId(e.target.value)}
        >
          <option value="">Выберите заказ</option>
          {(orders ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </Field>
      )}

      <fieldset className={styles.kinds}>
        <legend className={styles.label}>
          Тип задачи<span className={styles.required} aria-hidden="true">*</span>
        </legend>
        <div className={styles.kindRow}>
          {BIZ_TASK_KINDS.map((k) => (
            <label key={k} className={styles.kind}>
              <input
                type="radio"
                name={`${ids}-kind`}
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
              />
              {BIZ_TASK_KIND_LABELS[k]}
            </label>
          ))}
        </div>
        {hints.length > 0 && (
          <span className={styles.hint}>В описании укажите: {hints.join(', ')}</span>
        )}
      </fieldset>

      <PersonPicker label="Ответственный" people={staff} value={assignee} onChange={setAssignee} />

      <div className={styles.field}>
        <Field
          label="Срок, МСК"
          required
          type="datetime-local"
          value={due}
          onChange={(e) => {
            const iso = factoryDateTimeToIso(e.target.value);
            setDue(e.target.value);
            setDuePast(iso !== '' && Date.parse(iso) < Date.now());
          }}
        />
        {duePast && (
          <span className={styles.warn} role="status">
            <Icon name="alert" size={14} />Срок уже прошёл
          </span>
        )}
      </div>

      <button
        type="button"
        className={styles.more}
        aria-expanded={more}
        aria-controls={`${ids}-more`}
        onClick={() => setMore((v) => !v)}
      >
        <Icon name={more ? 'chevronUp' : 'chevronDown'} size={14} />
        Дополнительно: описание, наблюдатели, файлы, чек-лист
      </button>

      {more && (
        <div id={`${ids}-more`} className={styles.moreBody}>
          <Field
            as="textarea"
            label="Описание"
            rows={4}
            placeholder={hints.length ? `${hints.join(': …\n')}: …` : undefined}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <PersonPicker
            label="Наблюдатели"
            multiple
            max={MAX_WATCHERS}
            people={staff.filter((p) => p.user_id !== assignee[0])}
            value={watchers}
            onChange={setWatchers}
          />
          {target ? (
            <AttachmentPicker
              label="Приложить файлы"
              files={uploads.files}
              kind={FILE_KIND}
              onAdd={uploads.add}
              onRetry={uploads.retry}
              onRemove={uploads.remove}
              hint="До 30 МБ на один файл"
            />
          ) : (
            <span className={styles.hint}>Файлы можно приложить, когда выбран заказ</span>
          )}
          <div className={styles.field}>
            <span className={styles.label}>Чек-лист</span>
            {checklist.length > 0 && (
              <ol className={styles.checklist}>
                {checklist.map((c, i) => (
                  <li key={c.key} className={styles.checkItem}>
                    <input
                      className={styles.control}
                      aria-label={`Пункт ${i + 1}`}
                      maxLength={ITEM_MAX}
                      value={c.text}
                      onChange={(e) => setChecklist((arr) => arr.map((x) => (
                        x.key === c.key ? { ...x, text: e.target.value } : x)))}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="x"
                      iconOnly
                      aria-label={`Убрать пункт ${i + 1}`}
                      onClick={() => setChecklist((arr) => arr.filter((x) => x.key !== c.key))}
                    />
                  </li>
                ))}
              </ol>
            )}
            {checklist.length < MAX_CHECKLIST && (
              <Button
                variant="ghost"
                size="sm"
                icon="plus"
                onClick={() => setChecklist((arr) => [...arr, { key: crypto.randomUUID(), text: '' }])}
              >
                Добавить пункт
              </Button>
            )}
          </div>
          <label className={styles.kind}>
            <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} />
            Проверка постановщиком
          </label>
        </div>
      )}

      <div className={styles.actions}>
        <Button type="submit" variant="primary" icon="plus" loading={busy} ariaDisabledReason={blockReason}>
          Создать задачу
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Отмена</Button>
      </div>
    </form>
  );
}
