import { useMemo } from 'react';
import { AttachmentList } from '../../components/AttachmentList';
import { taskLabel } from '../../utils/experimentalTasks';
import { formatDateTimeShort } from '../../utils/format';
import styles from '../../styles';

/**
 * Вкладка «Файлы» карточки разработки (референс заказчика 24.08).
 *
 * ЭТО РЕЕСТР, А НЕ ВТОРАЯ ТОЧКА ЗАГРУЗКИ. Файл разработки всегда принадлежит
 * чему-то конкретному: макет — задаче (`task_id`), лекала и техпаспорт —
 * финальному пакету. Общего «файла разработки» не существует, и заводить его
 * ради вкладки значит завести кучу, из которой не видно, к чему что относится
 * (ровно от этого 24.08 файл задачи и привязали к задаче).
 *
 * Поэтому здесь ответ на вопрос «какие файлы вообще есть и где ими управлять»,
 * а прикладывают и снимают их там же, где работают: в раскрытой строке задачи
 * и в блоке финального пакета. Второй загрузчик рядом означал бы две
 * реализации привязки и уборки сироты — они разошлись бы молча.
 */

/** Группы реестра. Порядок — от рабочих файлов к итоговым */
const GROUPS = [
  { kind: 'dev_task', title: 'Файлы задач', where: 'прикладываются в раскрытой строке задачи' },
  { kind: 'dev_pattern', title: 'Лекала', where: 'приложены ранее; ввод снят правкой 24.08' },
  { kind: 'dev_passport', title: 'Технический паспорт', where: 'вкладка «Финальный пакет»' },
  { kind: 'dev_photo', title: 'Фото утверждённого образца', where: 'вкладка «Финальный пакет»' },
];

export function DevFilesTab({ files, tasks, typeNames }) {
  const byId = useMemo(
    () => new Map((tasks ?? []).map((t) => [t.id, t])), [tasks]);
  const list = files ?? [];

  if (list.length === 0) {
    return (
      <p className={styles.subText}>
        Файлов пока нет. Макет прикладывается в строке задачи, техпаспорт
        и фото образца — во вкладке «Финальный пакет».
      </p>
    );
  }

  return (
    <>
      {GROUPS.map(({ kind, title, where }) => {
        const group = list.filter((f) => f.kind === kind);
        if (group.length === 0) return null;
        return (
          <section key={kind} className={styles.matSection}>
            <div className={styles.matSectionHead}>
              <h3 className={styles.queueGroupTitle}>{title} ({group.length})</h3>
              <span className={styles.subText}>{where}</span>
            </div>
            {/*
              У файла задачи подписываем ЗАДАЧУ: без неё «photo_1.jpg» в общем
              списке снова становится файлом непонятно к чему — тем самым,
              от чего уходили. Задачу могли отменить, но файл остаётся:
              тогда честнее сказать «задача не найдена», чем промолчать.
            */}
            {kind === 'dev_task'
              ? group.map((f) => {
                const task = byId.get(f.task_id);
                return (
                  <div key={f.id} className={styles.tzBlock}>
                    <span className={styles.fieldLabel}>
                      {task ? taskLabel(task, typeNames) : 'Задача не найдена'}
                    </span>
                    <AttachmentList files={[f]} />
                    <span className={styles.subText}>
                      {formatDateTimeShort(f.created_at)}
                    </span>
                  </div>
                );
              })
              : <AttachmentList files={group} />}
          </section>
        );
      })}
    </>
  );
}
