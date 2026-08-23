import { useRef, useState } from 'react';
import { AttachmentList } from '../../components/AttachmentList';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { confirm } from '../../../store/useConfirmStore';
import { toast } from '../../../store/useToastStore';
import {
  DEV_ATTACHMENT_KINDS, finalPackageProgress, missingFinalPackage,
} from '../../utils/finalPackage';
import styles from '../../styles';

/**
 * Финальный технический пакет разработки (правки заказчика 20.08).
 *
 * «На этом этапе собирается вся техническая информация, необходимая для
 * дальнейшего повторного производства изделия… Разработку нельзя перевести
 * в "Готово к серии", пока обязательные данные не заполнены… Если чего-то
 * не хватает, система должна показать, какие поля ещё не заполнены».
 *
 * ПЕРЕЧЕНЬ НЕДОСТАЮЩЕГО СЧИТАЕТ УТИЛИТА (`missingFinalPackage`), и ровно то же
 * проверяет серверный страж `erp_dev_package_guard`. Здесь только разметка:
 * третья реализация правила разошлась бы с обеими.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Переноса пакета в каталог SKU раздела «ТЗ» — это другой
 * раздел и отдельное решение заказчика; названо вслух и вынесено ему.
 */

/** Список из текста: строка на значение. Пустые строки отбрасываются */
const toList = (text) => text.split('\n').map((s) => s.trim()).filter(Boolean);
const fromList = (list) => (Array.isArray(list) ? list : []).join('\n');

function FileBlock({ label, kind, files, hint, accept, canManage, onUpload, onRemove }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const pick = async (e) => {
    const chosen = [...(e.target.files ?? [])];
    e.target.value = '';
    if (chosen.length === 0) return;
    setBusy(true);
    for (const file of chosen) await onUpload(kind, file);
    setBusy(false);
  };

  const remove = async (att) => {
    const ok = await confirm({
      title: 'Снять файл?',
      message: `«${att.file_name || 'файл'}» будет удалён вместе с самим файлом.`,
      confirmLabel: 'Снять',
      variant: 'danger',
    });
    if (ok) await onRemove(att.id);
  };

  return (
    <div className={styles.attachBlock}>
      <div className={styles.checkRow}>
        <span className={styles.fieldLabel}>{label}</span>
        {files.length === 0 && (
          <span className={`${styles.chip} ${styles.chipWaiting}`}>не приложен</span>
        )}
        {canManage && (
          <Button
            variant="ghost"
            size="sm"
            icon="paperclip"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? 'Загрузка…' : 'Приложить'}
          </Button>
        )}
      </div>
      {hint && <span className={styles.subText}>{hint}</span>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={kind === DEV_ATTACHMENT_KINDS.photo}
        onChange={pick}
        aria-label={label}
        style={{ display: 'none' }}
      />
      <AttachmentList files={files} />
      {canManage && files.length > 0 && (
        <div className={styles.checkRow}>
          {files.map((f) => (
            <Button key={f.id} variant="ghost" size="sm" onClick={() => remove(f)}>
              ✕ {f.file_name || 'файл'}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DevFinalPackage({
  dev, attachments, canManage, onUpdate, onUpload, onRemoveFile, onReady,
}) {
  const pkg = dev.final_package ?? {};
  const missing = missingFinalPackage(dev, attachments);
  const progress = finalPackageProgress(dev, attachments);
  const filesOf = (kind) => attachments.filter((a) => a.kind === kind);

  /** Правка поля внутри JSON: объект пишется ЦЕЛИКОМ, точечных апдейтов нет */
  const setPkg = (key, value) => {
    const next = { ...pkg, [key]: value };
    if (JSON.stringify(next) === JSON.stringify(pkg)) return;
    onUpdate(dev.id, { final_package: next });
  };

  const text = (key, label, { wide = false, rows = 0, placeholder = '' } = {}) => (
    <label className={`${styles.field} ${wide ? styles.fieldWide : ''}`}>
      <span className={styles.fieldLabel}>{label}</span>
      {rows > 0 ? (
        <textarea
          className={styles.input}
          rows={rows}
          defaultValue={pkg[key] ?? ''}
          placeholder={placeholder}
          onBlur={(e) => setPkg(key, e.target.value.trim() || null)}
          aria-label={label}
        />
      ) : (
        <input
          className={styles.input}
          defaultValue={pkg[key] ?? ''}
          placeholder={placeholder}
          onBlur={(e) => setPkg(key, e.target.value.trim() || null)}
          aria-label={label}
        />
      )}
    </label>
  );

  const list = (key, label, placeholder) => (
    <label className={`${styles.field} ${styles.fieldWide}`}>
      <span className={styles.fieldLabel}>{label}</span>
      <textarea
        className={styles.input}
        rows={3}
        defaultValue={fromList(pkg[key])}
        placeholder={placeholder}
        onBlur={(e) => setPkg(key, toList(e.target.value))}
        aria-label={label}
      />
      <span className={styles.subText}>по одному в строке</span>
    </label>
  );

  const ready = async () => {
    if (missing.length > 0) {
      toast.error(`Не заполнено: ${missing.join(', ')}`);
      return;
    }
    await onReady();
  };

  return (
    /**
     * ИТОГ РАЗРАБОТКИ, А НЕ ЕЩЁ ОДИН ОПЕРАЦИОННЫЙ БЛОК (правка 22.08, п. 4.17):
     * «сам финальный пакет нужно визуально отделить от текущих задач
     * и текущего этапа». Поэтому он в собственной рамке, а не идёт сплошным
     * потоком следом за формой добавления задачи.
     */
    <section className={styles.tzBlock} style={{ marginTop: 16 }}>
      <h3 className={styles.queueGroupTitle}>
        Финальный технический пакет
        {' '}
        <span className={`${styles.chip} ${missing.length === 0 ? styles.chipReady : styles.chipNeutral}`}>
          {progress.done} / {progress.total}
        </span>
      </h3>
      <p className={styles.subText}>
        Собирается для повторного производства: при следующем заказе этой модели
        экспериментальный цех уже не потребуется.
      </p>

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Техническое название лекал</span>
          <input
            className={styles.input}
            defaultValue={dev.pattern_tech_name ?? ''}
            onBlur={(e) => {
              const v = e.target.value.trim() || null;
              if (v !== (dev.pattern_tech_name || null)) {
                onUpdate(dev.id, { pattern_tech_name: v });
              }
            }}
            aria-label="Техническое название лекал"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Версия лекал</span>
          <input
            className={styles.input}
            defaultValue={dev.pattern_version ?? ''}
            placeholder="v1.2"
            onBlur={(e) => {
              const v = e.target.value.trim() || null;
              if (v !== (dev.pattern_version || null)) onUpdate(dev.id, { pattern_version: v });
            }}
            aria-label="Версия лекал"
          />
        </label>
        {text('pattern_link', 'Ссылка на лекала', {
          placeholder: 'если файл лежит вне ERP',
        })}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Цена от</span>
          <input
            className={styles.input}
            type="number"
            min="0"
            defaultValue={dev.price_min ?? ''}
            onBlur={(e) => {
              const v = e.target.value === '' ? null : Number(e.target.value);
              if (v !== (dev.price_min ?? null)) onUpdate(dev.id, { price_min: v });
            }}
            aria-label="Ценовая вилка от"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Цена до</span>
          <input
            className={styles.input}
            type="number"
            min="0"
            defaultValue={dev.price_max ?? ''}
            onBlur={(e) => {
              const v = e.target.value === '' ? null : Number(e.target.value);
              if (v !== (dev.price_max ?? null)) onUpdate(dev.id, { price_max: v });
            }}
            aria-label="Ценовая вилка до"
          />
        </label>
      </div>

      <FileBlock
        label="Файл лекал"
        kind={DEV_ATTACHMENT_KINDS.pattern}
        files={filesOf(DEV_ATTACHMENT_KINDS.pattern)}
        hint="Файл или ссылка — достаточно одного из двух"
        accept="*/*"
        canManage={canManage}
        onUpload={onUpload}
        onRemove={onRemoveFile}
      />
      <FileBlock
        label="Технический паспорт"
        kind={DEV_ATTACHMENT_KINDS.passport}
        files={filesOf(DEV_ATTACHMENT_KINDS.passport)}
        accept="application/pdf,image/*"
        canManage={canManage}
        onUpload={onUpload}
        onRemove={onRemoveFile}
      />
      <FileBlock
        label="Фото образца"
        kind={DEV_ATTACHMENT_KINDS.photo}
        files={filesOf(DEV_ATTACHMENT_KINDS.photo)}
        hint="Минимум одно; можно несколько"
        accept="image/*"
        canManage={canManage}
        onUpload={onUpload}
        onRemove={onRemoveFile}
      />

      <h3 className={styles.queueGroupTitle} style={{ marginTop: 16 }}>Карточка SKU</h3>
      <div className={styles.formGrid}>
        {text('description', 'Описание', { wide: true, rows: 2 })}
        {text('fit', 'Крой / посадка')}
        {text('size_row', 'Размерный ряд', { placeholder: 'XS–3XL' })}
        {text('features', 'Конструктивные особенности', { wide: true, rows: 2 })}
        {text('finishes', 'Обработки', { wide: true, rows: 2 })}
        {text('limits', 'Ограничения', { wide: true, rows: 2 })}
        {list('fabrics', 'Доступные ткани', 'Футер 320\nКулирка 180')}
        {list('branding', 'Доступные нанесения', 'DTF\nВышивка')}
        {list('modifications', 'Возможные модификации', 'Длина рукава\nКарманы\nМолния')}
      </div>

      {/* Документ требует НАЗВАТЬ недостающее, а не просто закрыть кнопку */}
      {missing.length > 0 ? (
        <div className={styles.tzBlock}>
          <div className={styles.fieldLabel}>
            <Icon name="alert" size={13} /> Не хватает для «Готово к серии»
          </div>
          <ul className={styles.subText}>
            {missing.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </div>
      ) : (
        <p className={styles.subText}>Пакет заполнен — разработку можно закрывать.</p>
      )}

      {canManage && !dev.outcome && (
        <div className={styles.queueActions}>
          <Button variant="primary" disabled={missing.length > 0} onClick={ready}>
            Готово к серии
          </Button>
          <span className={styles.subText}>
            Производственный заказ на серию заводит менеджер — автоматически
            он не создаётся.
          </span>
        </div>
      )}
    </section>
  );
}
