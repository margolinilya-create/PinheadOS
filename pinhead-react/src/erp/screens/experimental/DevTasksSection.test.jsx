import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DevTasksSection } from './DevTasksSection';

/**
 * Задачи внутри карточки разработки (правка заказчика 24.08, п. 4.4).
 *
 * «Для задачи достаточно следующих полей: название, уточнение или комментарий,
 * ответственный, срок, статус и файл при необходимости… ОТДЕЛЬНО показывать
 * активные и завершённые задачи».
 *
 * Оба требования проверяются здесь, потому что оба легко откатить незаметно:
 * разделение — одной перестановкой в разметке, файл — забытым пропом.
 */

const task = (over = {}) => ({
  id: 't1', experimental_id: 'e1', task_type: 'patterns', title: null,
  responsible: null, due_date: null, status: 'in_progress', blocked_reason: null,
  depends_on: [], cycle: 0, sort_order: 10, qty: null, comment: null, result: null,
  department_id: null, stage_id: null, done_on: null,
  created_at: '', updated_at: '', ...over,
});

function setup(tasks, extra = {}) {
  const onUploadFile = vi.fn(async () => true);
  render(
    <MemoryRouter>
      <DevTasksSection
        tasks={tasks}
        allTasks={tasks}
        typeNames={new Map([['patterns', 'Лекала'], ['sample', 'Образец']])}
        deptNames={new Map()}
        onUpdate={vi.fn()}
        onSend={vi.fn()}
        onBlock={vi.fn()}
        canManage
        onUploadFile={onUploadFile}
        onRemoveFile={vi.fn()}
        {...extra}
      />
    </MemoryRouter>,
  );
  return { onUploadFile };
}

describe('активные и завершённые задачи показаны отдельно', () => {
  it('активные — в основном списке, завершённые — в своём свёрнутом блоке', () => {
    setup([
      task({ id: 'a', task_type: 'patterns', status: 'in_progress' }),
      task({ id: 'b', task_type: 'sample', status: 'done', sort_order: 20 }),
    ]);
    const active = screen.getByRole('region', { name: 'Активные задачи' });
    expect(within(active).getByText('Лекала')).toBeInTheDocument();
    expect(within(active).queryByText('Образец')).toBeNull();
    expect(screen.getByText(/Завершённые задачи \(1\)/)).toBeInTheDocument();
  });

  it('отменённая задача считается завершённой', () => {
    // «Отменено» — тоже закрытая работа: в активных ей делать нечего
    setup([task({ id: 'a', status: 'cancelled' })]);
    expect(screen.getByText(/Завершённые задачи \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Активных задач нет/)).toBeInTheDocument();
  });

  /**
   * Завершённые СВЁРНУТЫ, но видны и посчитаны: спрятанные насовсем, они стали
   * бы недостижимой историей — той самой, которую документ просит хранить
   * внутри карточки.
   */
  it('завершённые не спрятаны насовсем — блок раскрывается', () => {
    setup([task({ id: 'b', task_type: 'sample', status: 'done' })]);
    const details = screen.getByText(/Завершённые задачи/).closest('details');
    expect(details).toBeTruthy();
    expect(within(details).getByRole('region', { name: 'Завершённые задачи' }))
      .toBeInTheDocument();
  });

  it('пустой список говорит своими словами, а не показывает пустую таблицу', () => {
    setup([]);
    expect(screen.getByText(/Задач пока нет/)).toBeInTheDocument();
  });
});

describe('файл у задачи (п. 4.4)', () => {
  it('в раскрытой задаче есть, куда приложить файл', () => {
    setup([task({ id: 'a' })]);
    // Строка раскрывается кликом; блок файлов живёт внутри неё.
    // `fireEvent`, а не нативный `.click()`: React слушает свой синтетический
    // обработчик, и нативный вызов до него не доходит
    fireEvent.click(screen.getByText('Лекала'));
    expect(screen.getByLabelText('Файл к задаче «Лекала»')).toBeInTheDocument();
  });

  it('показаны файлы ЭТОЙ задачи, а не всей разработки', () => {
    // Иначе десяток картинок разработки свалился бы в каждую задачу
    setup([task({ id: 'a' })], {
      files: [
        { id: 'f1', task_id: 'a', file_name: 'рукав.jpg', file_path: 'x/1' },
        { id: 'f2', task_id: 'other', file_name: 'чужой.jpg', file_path: 'x/2' },
        { id: 'f3', task_id: null, file_name: 'пакет.pdf', file_path: 'x/3' },
      ],
    });
    fireEvent.click(screen.getByText('Лекала'));
    expect(screen.getByText(/рукав\.jpg/)).toBeInTheDocument();
    expect(screen.queryByText(/чужой\.jpg/)).toBeNull();
    expect(screen.queryByText(/пакет\.pdf/)).toBeNull();
  });

  it('без обработчика загрузки блок файлов не рисуется вовсе', () => {
    // Пустой блок «Файлы» без возможности приложить — обещание, которого нет
    setup([task({ id: 'a' })], { onUploadFile: undefined });
    fireEvent.click(screen.getByText('Лекала'));
    expect(screen.queryByText('Файлы')).toBeNull();
  });
});
