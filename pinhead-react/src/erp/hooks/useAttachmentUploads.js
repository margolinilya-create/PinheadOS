import { useCallback, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { erpQuery, removeOrphanUpload } from '../store/shared';
import { toast } from '../../store/useToastStore';
import { translateSupabaseError } from '../../utils/i18n';
import { attachmentFilePath } from '../utils/storageKey';

/**
 * Загрузка вложений заказа: файлы упаковки, техблока и листа закупки
 * (правки заказчика 16.08 — документ требует их в шести местах).
 *
 * ФАЙЛ УХОДИТ В БАКЕТ ПРИ ВЫБОРЕ, А НЕ В САБМИТЕ. Это правило проекта, и оно
 * записано кровью: пока ТЗ грузилось в сабмите, форма показывала приложенным
 * то, чего в Storage нет. Поэтому у каждого файла своё состояние
 * (`uploading` / `uploaded` / `error`), а submit блокируется, пока есть
 * незавершённые — за это отвечает вызывающий, читая `uploading`/`failed`.
 *
 * КЛЮЧ ОБЪЕКТА СТРОГО ASCII (`attachmentFilePath`). Supabase проверяет ключ
 * регуляркой S3-safe символов, где `\w` без флага `u`, и на русское имя файла
 * отвечает `InvalidKey`. На этом ломалось создание ЛЮБОГО заказа с ТЗ —
 * повторять ту же историю на вложениях незачем.
 *
 * ЗАГРУЗКА ИДЁТ ЧЕРЕЗ `erpQuery`, а не голым `await`: без ответа сервера
 * supabase-js БРОСАЕТ, и тогда `setFiles` ниже не выполнился бы вовсе — файл
 * остался бы в состоянии «загружается» навсегда, а вместе с ним заблокированной
 * оказалась бы кнопка создания заказа. Кнопки «Загрузить заново» человек при
 * этом не видит: она показывается только в состоянии ошибки.
 */

const BUCKET = 'erp-attachments';
/** 15 МБ: фото материала с телефона, схема узла, скрин позиции поставщика */
export const ATTACH_MAX_BYTES = 15 * 1024 * 1024;

export function useAttachmentUploads(scope = 'new') {
  const [files, setFiles] = useState([]);

  const upload = useCallback(async (uid, kind, file) => {
    const path = attachmentFilePath(scope, kind, uid, file.name);
    const { error } = await erpQuery(() => supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type || 'application/octet-stream' }));
    setFiles((arr) => arr.map((f) => {
      if (f.uid !== uid) return f;
      if (!error) return { ...f, state: 'uploaded', error: null, path };
      return {
        ...f,
        state: 'error',
        error: navigator.onLine === false ? 'нет сети' : translateSupabaseError(error.message),
      };
    }));
  }, [scope]);

  /**
   * `itemIndex === null` — файл всего заказа, а не позиции.
   * `ownerKey` — локальный ключ строки листа закупки: материалов на момент
   * выбора файла ещё не существует (их создаёт та же транзакция, что заказ),
   * поэтому привязка идёт по ключу строки формы, а в payload превращается
   * в `material_index` — тем же приёмом, что `item_index` у позиций.
   */
  const add = useCallback((file, kind, itemIndex = null, ownerKey = null) => {
    if (!file) return;
    if (file.size > ATTACH_MAX_BYTES) {
      toast.error(`Файл больше ${Math.round(ATTACH_MAX_BYTES / 1024 / 1024)} МБ`);
      return;
    }
    const uid = crypto.randomUUID();
    setFiles((arr) => [...arr, {
      uid, kind, itemIndex, ownerKey, name: file.name, file,
      state: 'uploading', error: null, path: null,
    }]);
    upload(uid, kind, file);
  }, [upload]);

  const retry = useCallback((uid) => {
    setFiles((arr) => {
      const f = arr.find((x) => x.uid === uid);
      if (f) upload(uid, f.kind, f.file);
      return arr.map((x) => (x.uid === uid ? { ...x, state: 'uploading', error: null } : x));
    });
  }, [upload]);

  /**
   * Убираем и строку, и сам объект: файл, загруженный и никуда не привязанный,
   * иначе останется в бакете навсегда — платный и, пока бакет публичный,
   * доступный по ссылке. Политика `erp_att_delete_own` разрешает автору
   * удалить СВОЙ объект, поэтому уборка работает без прав администратора.
   */
  const remove = useCallback((uid) => {
    setFiles((arr) => {
      const f = arr.find((x) => x.uid === uid);
      if (f?.path) removeOrphanUpload(BUCKET, f.path);
      return arr.filter((x) => x.uid !== uid);
    });
  }, []);

  /**
   * Позиции сдвигаются при удалении: файл, привязанный к позиции 2, обязан
   * уехать вместе с ней, а файлы позиций ниже — сдвинуться. Иначе следующая
   * позиция унаследует чужие превью упаковки — ровно так же, как это уже
   * решено для ТЗ.
   */
  const dropItem = useCallback((index) => {
    setFiles((arr) => arr
      .filter((f) => {
        if (f.itemIndex !== index) return true;
        if (f.path) removeOrphanUpload(BUCKET, f.path);
        return false;
      })
      .map((f) => (
        f.itemIndex !== null && f.itemIndex > index
          ? { ...f, itemIndex: f.itemIndex - 1 }
          : f)));
  }, []);

  /**
   * Секция `attachments` payload-а создания заказа — только успешно загруженные.
   * `rowKeys` — ключи строк листа закупки В ТОМ ЖЕ ПОРЯДКЕ, в каком они уедут
   * в секцию `materials`: индекс материала считается по нему, а не по позиции
   * ключа в состоянии, иначе удалённая средняя строка сдвинула бы привязку.
   */
  const payload = useCallback((rowKeys = []) => files
    .filter((f) => f.state === 'uploaded')
    .map((f) => {
      const at = f.ownerKey === null ? -1 : rowKeys.indexOf(f.ownerKey);
      /**
       * Файл подрядного ШАГА уезжает с КЛЮЧОМ шага, а не с номером этапа:
       * этапа на момент выбора ещё нет, а номер знает только тот код, который
       * строит секцию `stages` (`createOrder`). Считать его здесь значило бы
       * завести второй порядок этапов рядом с настоящим.
       */
      return {
        item_index: f.itemIndex,
        material_index: at >= 0 ? at : null,
        ...(f.kind === 'subcontract' && f.ownerKey ? { stage_key: f.ownerKey } : {}),
        file_path: f.path,
        file_name: f.name,
        kind: f.kind,
      };
    })
    // Файл строки закупки, которую человек удалил, в заказ не едет
    .filter((a) => !(a.material_index === null && a.kind === 'purchase'))
    // Файл подрядного шага без ключа привязать не к чему — он не едет
    .filter((a) => !(a.kind === 'subcontract' && !a.stage_key)),
  [files]);

  /** Убрать файлы удалённой строки листа закупки вместе с объектами в бакете */
  const dropOwner = useCallback((ownerKey) => {
    setFiles((arr) => arr.filter((f) => {
      if (f.ownerKey !== ownerKey) return true;
      if (f.path) removeOrphanUpload(BUCKET, f.path);
      return false;
    }));
  }, []);

  const uploading = useMemo(() => files.some((f) => f.state === 'uploading'), [files]);
  const failed = useMemo(() => files.some((f) => f.state === 'error'), [files]);

  return { files, add, retry, remove, dropItem, dropOwner, payload, uploading, failed };
}
