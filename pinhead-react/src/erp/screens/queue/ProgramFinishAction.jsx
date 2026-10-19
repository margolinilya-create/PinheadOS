import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { deptShortName } from '../../data/departments';
import { Button } from '../../components/Button';
import { isProgramPhase } from '../../utils/embroideryPhase';
import { stageHeadingId } from '../../utils/embroideryPhaseText';
import { stageResultFiles } from '../../utils/stageResult';
import { confirm, confirmWithInput } from '../../../store/useConfirmStore';
import { toast } from '../../../store/useToastStore';
import styles from '../../styles';

/**
 * «ПРОГРАММА ГОТОВА» — ПЕРЕХОД ФАЗЫ СТРОКИ ВЫШИВКИ (правки 19.10, п. 1).
 *
 * «После завершения разработки программы эта же задача превращается в задачу
 * „Вышивка“… Если программа готова, а предшествующий этап ещё не завершён,
 * задача ожидает этот этап».
 *
 * В фазе программы на месте «Завершить этап» — эта кнопка: строка не
 * закрывается, а становится «Вышивкой» (`finishEmbroideryProgram`, RPC
 * `erp_embroidery_program_finish`). Без файла программы кнопка остаётся
 * в порядке Tab, но `aria-disabled` с видимой причиной: блок по условию,
 * а не по времени запроса. «Без программы» — аварийный выход менеджера
 * заказа (`order.manage`), с причиной.
 *
 * После перехода панель меняется целиком — нажатая кнопка исчезает, — поэтому
 * фокус уходит на заголовок задачи, а итог объявляется живой областью: она
 * переживает смену фазы, потому что компонент смонтирован в панели всегда.
 *
 * Вынесено из `StageActionsPanel` (ратчет размера).
 */
export function ProgramFinishAction({ entry, perms, busy, run }) {
  const { order, item, stage, group } = entry;
  const { finishEmbroideryProgram, skipEmbroideryProgram, departments } = useErpStore(useShallow((s) => ({
    finishEmbroideryProgram: s.finishEmbroideryProgram,
    skipEmbroideryProgram: s.skipEmbroideryProgram,
    departments: s.departments,
  })));
  const [note, setNote] = useState('');
  const phase = isProgramPhase(stage, item.stages ?? []);
  if (!phase && !note) return null;

  const files = stageResultFiles(order, stage.id);
  const canFinish = phase && perms.progress && group === 'in_progress';
  const canSkip = phase && perms.skip && (group === 'ready' || group === 'in_progress');

  /** Чего ждёт «Вышивка» после перехода: незакрытые `depends_on` строки */
  const waitText = () => {
    const pending = (item.stages ?? []).filter((s) => (stage.depends_on ?? []).includes(s.id)
      && s.status !== 'done' && s.status !== 'skipped');
    if (pending.length === 0) return '';
    const dept = departments.find((d) => d.id === pending[0].department_id);
    if (dept?.code === 'cutting') return 'Вышивка ждёт сдачи кроя';
    return `Вышивка ждёт этапа «${dept ? deptShortName(dept.code, dept.name) : 'предыдущий этап'}»`;
  };

  const announce = (head) => {
    const wait = waitText();
    const text = wait ? `${head}. ${wait}` : head;
    setNote(text);
    toast.success(text);
    document.getElementById(stageHeadingId(stage.id))?.focus();
  };

  const finish = () => run(async () => {
    const ok = await confirm({
      title: 'Программа готова?',
      message: 'Этап станет «Вышивка». Файлы программы закроются для правки.',
      confirmLabel: 'Программа готова',
    });
    if (!ok) return false;
    const row = await finishEmbroideryProgram(stage.id);
    if (row) announce('Программа готова — этап «Вышивка»');
    return Boolean(row);
  });

  const skip = () => run(async () => {
    const { ok, value } = await confirmWithInput({
      title: 'Вышивка без программы?',
      message: 'Этап станет «Вышивка» без файла программы. Причина попадёт в историю этапа.',
      confirmLabel: 'Без программы',
      variant: 'danger',
      prompt: {
        label: 'Почему вышивка идёт без программы',
        placeholder: 'напр. программа клиента, повтор прошлого заказа',
        required: true,
      },
    });
    if (!ok) return false;
    const row = await skipEmbroideryProgram(stage.id, value);
    if (row) announce('Без программы — этап «Вышивка»');
    return Boolean(row);
  });

  return (
    <>
      {canFinish && (
        <Button
          variant="primary"
          icon="check"
          loading={busy}
          ariaDisabledReason={files.length > 0 ? '' : 'Приложите файл программы'}
          onClick={finish}
        >
          Программа готова
        </Button>
      )}
      {canSkip && (
        <Button variant="ghost" loading={busy} onClick={skip}>
          Без программы
        </Button>
      )}
      <p role="status" className={styles.subText}>{note}</p>
    </>
  );
}
