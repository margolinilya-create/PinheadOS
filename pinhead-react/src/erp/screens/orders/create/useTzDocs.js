import { useCallback, useState } from 'react';
import { supabase } from '../../../../lib/supabase';
import { erpQuery } from '../../../store/shared';
import { toast } from '../../../../store/useToastStore';
import { translateSupabaseError } from '../../../../utils/i18n';
import { tzFilePath } from '../../../utils/tz';
import { TZ_BUCKET, TZ_MAX_BYTES } from '../../../types';

/**
 * ТЗ в PDF формы создания заказа: выбор, загрузка, повтор, удаление, снимок
 * для черновика.
 *
 * Вынесено из `CreateOrderModal` 27.09 (правка 12): модалка стоит на потолке
 * ратчета размера, а ТЗ — самостоятельная подсистема формы, как вложения
 * блоков в `useAttachmentUploads`. Устройство то же:
 *
 * ФАЙЛ УХОДИТ В БАКЕТ СРАЗУ ПРИ ВЫБОРЕ, а не в сабмите. Раньше загрузка шла
 * только по «Создать заказ»: интерфейс показывал приложенный файл, которого
 * в Storage ещё не было, и первую же ошибку человек видел вместо созданного
 * заказа. Поэтому у каждого документа своё состояние —
 * `uploading` → `uploaded` либо `error` с повтором.
 *
 * Документ: `{ groupId, itemIndex (null = общее ТЗ заказа), file, name, type,
 * size, state, error, path }`. `name`/`type`/`size` дублируют поля `File`
 * НАРОЧНО: `File` в JSON превращается в `{}`, а черновик пишется через
 * `JSON.stringify` — и восстановленный из черновика документ `File` не несёт
 * вовсе. Сабмит и показ читают эти три поля, а не `file.*`.
 *
 * `initial` — документы, восстановленные ИЗ ЧЕРНОВИКА: только загруженные,
 * с путём, без `File`. Повторять загрузку не нужно — объект уже в бакете.
 */

/** Только то, что можно восстановить: путь есть и загрузка завершилась */
function restorable(docs) {
  return (docs ?? [])
    .filter((d) => d?.path && d.state === 'uploaded')
    .map((d) => ({ ...d, file: null, error: null }));
}

export function useTzDocs(initial = []) {
  const [tzDocs, setTzDocs] = useState(() => restorable(initial));

  /**
   * Путь детерминированный (`group_id` живёт в стейте формы), поэтому
   * `upsert: true`: повторная попытка перезаписывает свой же файл. Чужой
   * затереть нельзя — group_id генерирует клиент. Ключ строго ASCII
   * (`tzFilePath`): Storage отвечает InvalidKey на кириллицу, и именно на этом
   * ломалось создание любого заказа с русским ТЗ.
   */
  const uploadTzFile = useCallback(async (groupId, file) => {
    const path = tzFilePath('new', groupId, 1, file.name);
    /**
     * `erpQuery`, а не голый `await`: без ответа сервера supabase-js БРОСАЕТ,
     * и тогда `setTzDocs` ниже не выполнялся вовсе — файл оставался
     * в состоянии «загружается» навсегда, а «Создать заказ» блокировалась
     * незавершённой загрузкой, которая никогда не завершится. Кнопки
     * «Загрузить заново» человек при этом не видел: она только у ошибки.
     */
    const { error } = await erpQuery(() => supabase.storage
      .from(TZ_BUCKET)
      // Тип берётся у файла (правка 12.09, п. 4): жёсткий `application/pdf`
      // клал .xlsx в бакет под чужим типом, и браузер отказывался его открывать
      .upload(path, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: true,
      }));
    setTzDocs((arr) => arr.map((d) => {
      if (d.groupId !== groupId) return d;
      if (!error) return { ...d, state: 'uploaded', error: null, path };
      return {
        ...d,
        state: 'error',
        error: navigator.onLine === false
          ? 'нет сети'
          : translateSupabaseError(error.message),
      };
    }));
  }, []);

  const addTzDoc = useCallback((file, itemIndex) => {
    if (!file) return;
    // Формат больше не проверяется (правка 12.09, п. 4) — только размер,
    // и он повторяет лимит бакета, чтобы причина называлась СРАЗУ
    if (file.size > TZ_MAX_BYTES) {
      toast.error(`ТЗ: файл больше ${Math.round(TZ_MAX_BYTES / 1024 / 1024)} МБ`);
      return;
    }
    const groupId = crypto.randomUUID();
    setTzDocs((arr) => [...arr, {
      groupId,
      itemIndex,
      file,
      name: file.name,
      type: file.type || '',
      size: file.size,
      state: 'uploading',
      error: null,
      path: null,
    }]);
    uploadTzFile(groupId, file);
  }, [uploadTzFile]);

  /** Повторная загрузка после сбоя: перезаливается только файл, форма не трогается */
  const retryTzDoc = useCallback((groupId) => {
    setTzDocs((arr) => {
      const doc = arr.find((d) => d.groupId === groupId);
      // Без `File` перезаливать нечего — такое бывает только у восстановленного
      // из черновика, а он в состоянии ошибки не восстанавливается
      if (doc?.file) uploadTzFile(groupId, doc.file);
      return arr.map((d) => (
        d.groupId === groupId ? { ...d, state: 'uploading', error: null } : d));
    });
  }, [uploadTzFile]);

  const removeTzDoc = useCallback((groupId) => {
    setTzDocs((arr) => arr.filter((d) => d.groupId !== groupId));
  }, []);

  /**
   * Удаление позиции сдвигает индексы — пересобираем привязку файлов ТЗ,
   * иначе следующая позиция унаследовала бы чужой документ.
   */
  const dropItem = useCallback((i) => {
    const shift = (idx) => (idx > i ? idx - 1 : idx);
    setTzDocs((arr) => arr
      .filter((d) => d.itemIndex !== i)
      .map((d) => (d.itemIndex === null ? d : { ...d, itemIndex: shift(d.itemIndex) })));
  }, []);

  /**
   * Снимок для ЧЕРНОВИКА: только загруженные, без `File` и текста ошибки
   * (первый в JSON превращается в `{}`, второй относится к прошлой попытке).
   * Имя, тип и размер едут — из них сабмит соберёт секцию `tz` после
   * восстановления (правка 27.09, п. 12).
   */
  const draftSnapshot = useCallback(() => tzDocs
    .filter((d) => d.state === 'uploaded' && d.path)
    .map(({ file: _file, error: _error, ...rest }) => rest), [tzDocs]);

  /** Заменить список целиком — выбор другого черновика (правка 21.09, п. 6) */
  const replaceAll = useCallback((next) => setTzDocs(restorable(next)), []);

  const clear = useCallback(() => setTzDocs([]), []);

  return {
    tzDocs,
    addTzDoc,
    retryTzDoc,
    removeTzDoc,
    dropItem,
    draftSnapshot,
    replaceAll,
    clear,
    uploading: tzDocs.some((d) => d.state === 'uploading'),
    failed: tzDocs.some((d) => d.state === 'error'),
  };
}
