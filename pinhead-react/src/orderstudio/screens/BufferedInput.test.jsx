import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import BufferedInput from './BufferedInput';
import { formatMoney, formatPantone, parseIntIn, parseMoney, parsePantone } from './fieldParse';

/** Набор по символу: каждое нажатие — отдельный change, как в браузере */
function typeChars(input, text) {
  let acc = input.value;
  for (const ch of text) {
    acc += ch;
    fireEvent.change(input, { target: { value: acc } });
    acc = input.value;
  }
}

function Harness({ initial, parse, format, onCommit = () => {} }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <BufferedInput
        aria-label="поле"
        value={value}
        parse={parse}
        format={format}
        onCommit={(v) => { setValue(v); onCommit(v); }}
      />
      <output data-testid="model">{JSON.stringify(value)}</output>
    </>
  );
}

describe('BufferedInput', () => {
  it('деньги с запятой набираются по символу и не теряют дробную часть', () => {
    render(<Harness initial={null} parse={parseMoney} format={formatMoney} />);
    const input = screen.getByLabelText('поле');
    fireEvent.focus(input);
    typeChars(input, '2500,5');
    expect(input).toHaveValue('2500,5');
    expect(screen.getByTestId('model')).toHaveTextContent('2500.5');
  });

  it('Pantone с пробелами и запятыми набирается с клавиатуры', () => {
    render(<Harness initial={[]} parse={parsePantone} format={formatPantone} />);
    const input = screen.getByLabelText('поле');
    fireEvent.focus(input);
    typeChars(input, '186 C, Black C');
    expect(input).toHaveValue('186 C, Black C');
    expect(screen.getByTestId('model')).toHaveTextContent('["186 C","Black C"]');
  });

  it('процент вне границ не зажимается на лету: «60» набирается как 60', () => {
    render(<Harness initial={100} parse={parseIntIn(10, 100)} format={String} />);
    const input = screen.getByLabelText('поле');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    typeChars(input, '60');
    expect(screen.getByTestId('model')).toHaveTextContent('60');
  });

  it('на потере фокуса текст выравнивается по модели', () => {
    const onCommit = vi.fn();
    render(<Harness initial={5} parse={parseIntIn(1, 8)} format={String} onCommit={onCommit} />);
    const input = screen.getByLabelText('поле');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '12' } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(input).toHaveValue('5');
  });

  it('parseMoney: пусто — null, мусор и минус — не значение', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('-5')).toBeUndefined();
    expect(parseMoney('12,')).toBe(12);
    expect(parseMoney('1 250,50')).toBe(1250.5);
    expect(parseMoney('abc')).toBeUndefined();
  });
});
