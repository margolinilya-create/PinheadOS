// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { withoutJsComments } from '../utils/migrations.testutil';
import { sourceFiles } from '../../testutil/sourceFiles';

/**
 * ЗОНА СБРОСА БЕЗ ТАЧ-ПОЛИФИЛЛА — МЁРТВЫЙ ЖЕСТ НА ПЛАНШЕТЕ ЦЕХА.
 *
 * HTML5 drag-and-drop на тач-экране не работает вовсе. В проекте это знают
 * и лечат: `useTouchDndPolyfill` лениво подключает `mobile-drag-drop` при
 * `pointer: coarse`. Но подключён он был ровно в двух местах — `ErpKanban`
 * и `DepartmentQueue`, — а объявляют `draggable` и зоны сброса ещё и другие
 * экраны. У производственного плана из-за этого перетаскивание не работало
 * на планшете НИ РАЗУ, при том что подсказка прямо предлагала «перетащите
 * в день недели».
 *
 * Дефект тихий по построению: разметка та же, поведение на десктопе то же,
 * ни один функциональный тест его не видит.
 *
 * ЧТО ЭТОТ СТОРОЖ НЕ ПРОВЕРЯЕТ, и это надо сказать вслух: он не отвечает,
 * РАБОТАЕТ ли жест. Полифилл может быть подключён, а перетащить всё равно
 * нельзя — так у плана: зоны сброса это колонки по 300px в горизонтально
 * прокручиваемой доске, автопрокрутки при перетаскивании там нет, и дальше
 * соседней колонки карточка не уедет. Поэтому обещание интерфейса держат
 * КНОПКИ (`PlanMoveModal`), а сторож ловит ровно одно: забытый полифилл.
 */

const ROOT = join(process.cwd(), 'src', 'erp');

/**
 * Файлы, которым полифилл не нужен, — с причиной у каждого.
 *
 * Список ИМЕНОВАННЫЙ: «похоже, там не нужно» — это не причина, а догадка,
 * и через месяц её никто не отличит от забытого подключения.
 */
const EXEMPT: Record<string, string> = {
  'components/kanban/KanbanCard.jsx':
    'карточка канбана — источник перетаскивания, полифилл поднимает её носитель ErpKanban',
  'screens/plan/PlanTaskCard.jsx':
    'карточка плана — источник, полифилл поднимает PlanScreen',
  'screens/queue/QueueRow.jsx':
    'строка очереди — источник, полифилл поднимает DepartmentQueue',
  'screens/queue/QueueCard.jsx':
    'карточка очереди — источник, полифилл поднимает DepartmentQueue',
  'components/chat/ChatComposer.jsx':
    'сюда тащат ФАЙЛ ИЗ СИСТЕМЫ, а не элемент страницы: `mobile-drag-drop` '
    + 'эмулирует перетаскивание узлов DOM и файловому drop не помогает ничем. '
    + 'На планшете тот же файл прикладывают кнопкой — она рядом и работает '
    + '(правка 20.09, п. 4)',
};


describe('тач-перетаскивание в разделе', () => {
  it('файл с зоной сброса подключает useTouchDndPolyfill', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(ROOT, { ext: /\.jsx$/, tests: true })) {
      const rel = relative(ROOT, file).split('\\').join('/');
      // Комментарии снимаем ДО поиска: объяснение, почему полифилл здесь
      // не нужен, содержит и слово `onDrop`, и имя самого хука
      const src = withoutJsComments(readFileSync(file, 'utf8'));

      // Зона сброса — это ПАРА: без `onDragOver` с `preventDefault` браузер
      // сброс не разрешает вовсе, поэтому одного `onDrop` мало
      const isDropZone = src.includes('onDrop=') && src.includes('onDragOver=');
      if (!isDropZone) continue;
      if (rel in EXEMPT) continue;
      /*
        Ищется ВЫЗОВ, а не упоминание. Первая редакция сторожа принимала
        подстроку `useTouchDndPolyfill` и прошла мутацию: снятый вызов
        оставляет импорт, то есть имя в файле есть, а хук не работает.
        Тот же класс, что «право проверяется вызовом `can(`, а не строкой
        в комментарии», — и ловится он только мутацией, не вычиткой.
      */
      if (/useTouchDndPolyfill\s*\(/.test(src)) continue;

      offenders.push(rel);
    }

    expect(
      offenders,
      `зона сброса без тач-полифилла (жест мёртв на планшете):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('каждый файл из списка исключений существует и несёт причину', () => {
    // Исключение, переживающее свой файл, — это обещание, которое некому
    // выполнить: следующий автор прочтёт его как «здесь уже разобрались»
    const missing = Object.keys(EXEMPT).filter((rel) => {
      try {
        statSync(join(ROOT, rel));
        return false;
      } catch {
        return true;
      }
    });
    expect(missing, `в списке исключений файлы, которых нет:\n${missing.join('\n')}`).toEqual([]);
    for (const [rel, why] of Object.entries(EXEMPT)) {
      expect(why.length, `${rel}: причина не названа`).toBeGreaterThan(20);
    }
  });
});
