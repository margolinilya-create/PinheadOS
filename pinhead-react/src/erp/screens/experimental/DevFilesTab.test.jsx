import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DevFilesTab } from './DevFilesTab';
import { useErpStore } from '../../store/useErpStore';

/**
 * Права мокаются: иначе их не проверить нигде — e2e идут против dev-автологина,
 * а он по построению обходит матрицу. Тот же приём, что в `OrderCard.test.jsx`.
 */
let canFiles = true;
vi.mock('../../store/useErpAccess', () => ({
  useErpAccess: () => ({
    can: (p) => (p === 'files.manage' ? canFiles : true),
    canActIn: () => true,
    isPrivileged: true,
  }),
}));

/**
 * ФАЙЛЫ ЭКСПЕРИМЕНТАЛЬНОГО ЦЕХА (правка заказчика 21.09, п. 7).
 *
 * «Сейчас во вкладке „Файлы" экспериментального цеха нет полноценного
 * управления файлами. Нужно применить здесь ту же логику работы с файлами,
 * которая уже используется в заказе и других цехах».
 *
 * Прежде вкладка была РЕЕСТРОМ НА ЧТЕНИЕ, и это было записанным решением
 * (24.08). Решение заказчика его отменяет — но не целиком: у файла ЗАДАЧИ
 * есть адресат, которого вкладка не знает, поэтому загрузка там по-прежнему
 * не предлагается, а удаление есть (оно адресата не требует).
 */

const DEV = { id: 'e1', order_id: 'o1' };
const TASKS = [{ id: 't1', kind: 'sample', type_id: null, title: 'Отшив образца' }];

const file = (id, kind, extra = {}) => ({
  id, kind, file_path: `att/o1/${kind}/${id}.png`, file_name: `${id}.png`,
  created_at: '2026-09-21T10:00:00Z', ...extra,
});

function setup({ files = [], canManage = true } = {}) {
  canFiles = canManage;
  const uploadDevFile = vi.fn().mockResolvedValue(true);
  const deleteDevFile = vi.fn().mockResolvedValue(true);
  useErpStore.setState({ uploadDevFile, deleteDevFile });
  render(<DevFilesTab dev={DEV} files={files} tasks={TASKS} typeNames={{}} />);
  return { uploadDevFile, deleteDevFile };
}

describe('вкладка «Файлы» разработки', () => {
  it('папки видны даже пустыми — видно, куда что кладут', () => {
    setup();
    expect(screen.getByText('Лекала')).toBeInTheDocument();
    expect(screen.getByText('Технический паспорт')).toBeInTheDocument();
    expect(screen.getByText('Фото утверждённого образца')).toBeInTheDocument();
    expect(screen.getByText('Файлы задач')).toBeInTheDocument();
  });

  it('в папки разработки можно загрузить — это и есть «как в заказе»', async () => {
    const { uploadDevFile } = setup();
    const input = screen.getByLabelText('Загрузить в «Лекала»');
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'lekala.pdf', { type: 'application/pdf' })] },
    });

    await waitFor(() => expect(uploadDevFile).toHaveBeenCalled());
    expect(uploadDevFile).toHaveBeenCalledWith(expect.objectContaining({
      devId: 'e1', orderId: 'o1', kind: 'dev_pattern',
    }));
  });

  /**
   * У файла задачи есть адресат (`task_id`), и вкладка его не знает:
   * загрузка «вообще в разработку» оторвала бы файл от строки задачи.
   */
  it('в «Файлы задач» загрузки нет — у такого файла есть адресат', () => {
    setup();
    expect(screen.queryByLabelText('Загрузить в «Файлы задач»')).not.toBeInTheDocument();
  });

  it('удалить можно любой файл, в том числе файл задачи', () => {
    setup({ files: [file('a1', 'dev_task', { task_id: 't1' })] });
    // Кнопка есть; само удаление идёт через общий confirm и проверяется
    // там же, где живёт это правило, — в карточке заказа
    expect(screen.getByRole('button', { name: /Удалить файл/ })).toBeInTheDocument();
  });

  it('файл задачи подписан задачей: «photo_1.jpg» без неё — файл непонятно к чему', () => {
    setup({ files: [file('a1', 'dev_task', { task_id: 't1' })] });
    expect(screen.getByText(/Отшив образца/)).toBeInTheDocument();
  });

  it('файл отменённой задачи не молчит, а говорит «задача не найдена»', () => {
    setup({ files: [file('a1', 'dev_task', { task_id: 'gone' })] });
    expect(screen.getByText(/Задача не найдена/)).toBeInTheDocument();
  });

  it('без права files.manage ни загрузки, ни удаления', () => {
    setup({ files: [file('a1', 'dev_pattern')], canManage: false });
    expect(screen.queryByLabelText('Загрузить в «Лекала»')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Удалить файл/ })).not.toBeInTheDocument();
  });
});
