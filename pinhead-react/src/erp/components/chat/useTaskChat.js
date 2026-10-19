import { useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { currentUserId } from '../../store/shared';
import {
  bizTaskParticipants, canMarkAsResult, canWriteBizTaskChat,
} from '../../utils/bizTaskChat';

/**
 * ДИАЛОГ БИЗНЕС-ЗАДАЧИ ПОВЕРХ ОБЩЕЙ ЛЕНТЫ (правки 19.10, п. 7).
 *
 * Лента остаётся одной реализацией переписки (`ChatPanel`); здесь — только
 * то, чем тред задачи отличается от сделки: кто пишет, кого можно позвать
 * и чьё сообщение становится результатом. Без `taskId` хук молчит —
 * переписка сделки работает, как работала.
 *
 * `canManage` — `canManageBizTasks(...)` вызывающего (карточка задачи его
 * уже считает для своих кнопок): писать и не будучи участником может только
 * руководитель с `biz_task.manage` и карточкой сотрудника.
 */
export function useTaskChat(taskId, canManage, directory) {
  const { task, setResult } = useErpStore(useShallow((s) => ({
    task: taskId ? (s.bizTasks[taskId] ?? null) : null,
    setResult: s.setBizTaskResult,
  })));
  const meId = currentUserId();
  /** Текст для читалки: «Сообщение отмечено результатом» после ответа сервера */
  const [announce, setAnnounce] = useState('');

  /**
   * Подсказка упоминаний — ТОЛЬКО участники задачи: сервер отбросит
   * остальных молча, и выбранный из списка «Глеб» не получил бы ничего.
   * Подключить другого — добавить его в наблюдатели (документ).
   */
  const people = useMemo(() => {
    if (!taskId) return directory;
    if (!task) return [];
    const ids = bizTaskParticipants(task);
    return directory.filter((p) => ids.includes(p.user_id));
  }, [taskId, task, directory]);

  /** Задача ещё не загружена — поля нет: ни обещания, ни отказа раньше времени */
  const canWrite = !taskId || (task !== null && canWriteBizTaskChat(task, meId, canManage));

  const canMark = useCallback(
    (message) => Boolean(task) && canMarkAsResult(task, message, meId),
    [task, meId],
  );

  /** Без оптимистики: «результат» появляется ответом писателя, отказ тостит стор */
  const onMarkResult = async (message) => {
    const row = await setResult(taskId, null, message.id);
    if (row) setAnnounce('Сообщение отмечено результатом');
  };

  return {
    task, people, canWrite, canMark, onMarkResult, announce,
    orderId: task?.order_id ?? null,
  };
}
