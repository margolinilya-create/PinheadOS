import { useMemo, useState } from 'react';
import { useErpStore } from '../../store/useErpStore';
import { useErpAccess } from '../../store/useErpAccess';
import { confirm } from '../../../store/useConfirmStore';
import { FileFolder } from '../../components/FilesBoard';
import { taskLabel } from '../../utils/experimentalTasks';
import { formatDateTimeShort } from '../../utils/format';

/**
 * Вкладка «Файлы» карточки разработки (референс 24.08; правка 21.09, п. 7).
 *
 * ЧТО БЫЛО. Реестр на чтение: «файл разработки всегда принадлежит чему-то
 * конкретному… поэтому здесь ответ на вопрос „какие файлы вообще есть",
 * а прикладывают и снимают их там же, где работают». Довод был верным
 * для файла ЗАДАЧИ — у него есть адресат, и загрузка «вообще в разработку»
 * оторвала бы его от строки задачи.
 *
 * ЧТО ИЗМЕНИЛОСЬ. Документ 21.09: «сейчас во вкладке „Файлы" нет полноценного
 * управления файлами. Нужно применить здесь ту же логику работы с файлами,
 * которая уже используется в заказе и других цехах». Решение заказчика
 * ОТМЕНЯЕТ прежнее: вкладка получает загрузку и удаление.
 *
 * Прежний довод при этом не выброшен, а сужен до того, где он верен:
 * ЗАГРУЖАТЬ в «Файлы задач» по-прежнему нельзя — у такого файла есть
 * адресат, и вкладка его не знает. Удалять можно: удаление адресата
 * не требует. Остальные три папки (лекала, техпаспорт, фото образца)
 * принадлежат самой разработке, и у них загрузка есть.
 *
 * Показ целиком общий (`components/FilesBoard`) — тот же, что в карточке
 * заказа. Вторая реализация превью, загрузки и уборки сироты разошлась бы
 * с первой молча.
 */

const GROUPS = [
  {
    key: 'dev_task',
    title: 'Файлы задач',
    hint: 'Прикладываются в раскрытой строке задачи — у файла есть адресат',
    upload: false,
  },
  { key: 'dev_pattern', title: 'Лекала', hint: 'Выкройки и раскладки', upload: true },
  { key: 'dev_passport', title: 'Технический паспорт', hint: '', upload: true },
  { key: 'dev_photo', title: 'Фото утверждённого образца', hint: '', upload: true },
];

export function DevFilesTab({ dev, files, tasks, typeNames }) {
  const { uploadDevFile, deleteDevFile } = useErpStore();
  const canManage = useErpAccess().can('files.manage');
  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => new Map((tasks ?? []).map((t) => [t.id, t])), [tasks]);
  const list = files ?? [];

  /**
   * У файла задачи подписываем ЗАДАЧУ: без неё «photo_1.jpg» в общем списке
   * снова становится файлом непонятно к чему — тем самым, от чего уходили.
   * Задачу могли отменить, но файл остаётся: тогда честнее сказать «задача
   * не найдена», чем промолчать.
   */
  const withSubtitle = (f) => (f.kind === 'dev_task'
    ? {
      ...f,
      subtitle: `${f.task_id ? (byId.get(f.task_id)
        ? taskLabel(byId.get(f.task_id), typeNames)
        : 'Задача не найдена') : 'Без задачи'} · ${formatDateTimeShort(f.created_at)}`,
    }
    : f);

  const upload = async (kind, picked) => {
    setBusy(true);
    try {
      for (const file of picked) {
        // Последовательно: при отказе на середине человек должен видеть,
        // что именно загрузилось, а не гадать по общему сообщению
        await uploadDevFile({ devId: dev.id, orderId: dev.order_id, kind, file });
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (att) => {
    const ok = await confirm({
      title: 'Удалить файл?',
      message: `${att.file_name || 'файл'} — удаление необратимо: файл уйдёт и из хранилища.`,
      confirmLabel: 'Удалить',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteDevFile(dev.id, att.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {GROUPS.map((g) => (
        <FileFolder
          key={g.key}
          folder={g}
          files={list.filter((f) => f.kind === g.key).map(withSubtitle)}
          canManage={canManage}
          busy={busy}
          onUpload={g.upload ? (_key, picked) => upload(g.key, picked) : null}
          onRemove={remove}
          emptyText={g.upload
            ? 'Файлов нет — приложите их кнопкой выше.'
            : 'Файлов нет. Макет прикладывается в раскрытой строке задачи.'}
        />
      ))}
    </>
  );
}
