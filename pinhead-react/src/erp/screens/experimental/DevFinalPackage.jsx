import { useRef, useState } from 'react';
import { AttachmentList } from '../../components/AttachmentList';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { confirm } from '../../../store/useConfirmStore';
import { toast } from '../../../store/useToastStore';
import {
  DEV_ATTACHMENT_KINDS, finalPackageProgress, missingFinalPackage, wantsSkuCard,
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
 *
 * ПРАВКА 24.08 (пп. 4.5, 4.6). Блок разделён на две части: обязательная
 * техдокументация — и карточка SKU за переключателем «Добавить модель
 * в каталог SKU». Пока переключатель выключен, полей карточки нет ни на
 * экране, ни в перечне недостающего: документ прямо разрешает «заполнить
 * только обязательную техническую документацию и завершить разработку».
 * Ввод лекал снят целиком («поле „Файл лекал или ссылка" не нужно»);
 * уже приложенное показывается на чтение — на проде такие файлы есть.
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
  const wantsSku = wantsSkuCard(dev);
  /**
   * Лекала, приложенные до правки 24.08. Ввода больше нет, но и молча прятать
   * их нельзя: файл, который человек видел приложенным, обязан остаться
   * на экране, иначе это читается как потеря данных.
   */
  const legacyPatterns = filesOf(DEV_ATTACHMENT_KINDS.pattern);

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
        <span className={`${styles.chip} ${missing.length === 0 ? styles.chipDone : styles.chipNeutral}`}>
          {progress.done} / {progress.total}
        </span>
      </h3>
      <p className={styles.subText}>
        Собирается для повторного производства: при следующем заказе этой модели
        экспериментальный цех уже не потребуется.
      </p>

      <div className={styles.formGrid}>
        {/**
          * ОТКУДА ВЗЯЛОСЬ ЗНАЧЕНИЕ — ВИДНО (правки заказчика 02.09, п. 4):
          * «Поле не заполняется повторно. Значение автоматически подтягивается
          * из этапа „Построение лекал“».
          *
          * Подстановка тут была всегда — колонка одна на оба места. Не хватало
          * ПОДПИСИ: заполненное поле среди пустых читается как «кто-то уже
          * ввёл, надо проверить», а пустое — как «поле новое, вводите». Разницу
          * между «не спросили» и «нечего показывать» человек различать
          * не обязан, и строка ниже отвечает на это прямо.
          *
          * Поле остаётся редактируемым (решение владельца): это путь
          * исправления опечатки, а не второй ввод.
          */}
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
          <span className={styles.subText}>
            {dev.pattern_tech_name
              ? 'Подтянуто с этапа «Построение лекал» — вводить второй раз не нужно'
              : 'На этапе «Построение лекал» не записано — заполните здесь'}
          </span>
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
        {text('production_notes', 'Комментарии и особенности производства', {
          wide: true,
          rows: 2,
          placeholder: 'при необходимости',
        })}
      </div>

      <FileBlock
        label="Технический паспорт"
        kind={DEV_ATTACHMENT_KINDS.passport}
        files={filesOf(DEV_ATTACHMENT_KINDS.passport)}
        hint="Техпаспорт или техописание"
        accept="application/pdf,image/*"
        canManage={canManage}
        onUpload={onUpload}
        onRemove={onRemoveFile}
      />
      <FileBlock
        label="Фото утверждённого образца"
        kind={DEV_ATTACHMENT_KINDS.photo}
        files={filesOf(DEV_ATTACHMENT_KINDS.photo)}
        hint="Минимум одно; можно несколько"
        accept="image/*"
        canManage={canManage}
        onUpload={onUpload}
        onRemove={onRemoveFile}
      />

      {/*
        ЛЕКАЛА — ТОЛЬКО ПОКАЗ (п. 4.5: «поле „Файл лекал или ссылка" не нужно»).
        Блок рисуется, лишь пока такие данные есть; у новых разработок его
        не будет вовсе, и он исчезнет сам, когда старые закроются.
      */}
      {(legacyPatterns.length > 0 || pkg.pattern_link) && (
        <div className={styles.attachBlock}>
          <span className={styles.fieldLabel}>Лекала (приложены ранее)</span>
          <span className={styles.subText}>
            Поле снято из обязательных — показано то, что уже вложено.
          </span>
          {pkg.pattern_link && <div className={styles.subText}>{pkg.pattern_link}</div>}
          <AttachmentList files={legacyPatterns} />
        </div>
      )}

      {/*
        КАРТОЧКА SKU — ПО ЖЕЛАНИЮ (п. 4.6). Выключенный переключатель означает
        не «поля спрятаны», а «их не спрашивают»: `missingFinalPackage` в этом
        режиме их не перечисляет, и разработка закрывается техдокументацией.
      */}
      <label className={styles.checkRow} style={{ marginTop: 16 }}>
        <input
          type="checkbox"
          checked={wantsSku}
          disabled={!canManage}
          onChange={(e) => setPkg('add_to_sku', e.target.checked)}
        />
        <span className={styles.fieldLabel}>Добавить модель в каталог SKU</span>
      </label>
      <p className={styles.subText}>
        {wantsSku
          ? 'Заполните карточку — после завершения модель можно перенести в каталог.'
          : 'Выключено: достаточно обязательной технической документации.'}
      </p>

      {wantsSku && (
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
      )}

      {/* Документ требует НАЗВАТЬ недостающее, а не просто закрыть кнопку */}
      {missing.length > 0 ? (
        <div className={styles.tzBlock}>
          <div className={styles.fieldLabel}>
            <Icon name="alert" size={13} /> Не хватает, чтобы завершить разработку
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
          {/*
            «ЗАВЕРШИТЬ РАЗРАБОТКУ» — слово документа (п. 4.5). Исход при этом
            остаётся `ready_for_serial`, и подпись рядом его называет: рядом
            стоят кнопки прочих исходов, тоже завершающих разработку, и одна
            только «Завершить» была бы от них неотличима.
          */}
          <Button variant="primary" disabled={missing.length > 0} onClick={ready}>
            Завершить разработку
          </Button>
          <span className={styles.subText}>
            Разработка закроется как «Готово к серии» и уйдёт из активного
            канбана. Производственный заказ на серию заводит менеджер —
            автоматически он не создаётся.
          </span>
        </div>
      )}
    </section>
  );
}
