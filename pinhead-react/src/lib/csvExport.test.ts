import { describe, it, expect } from 'vitest';
import { buildCsv } from './csvExport';

const BOM = '\uFEFF';

describe('buildCsv', () => {
  it('renders header + simple rows', () => {
    const csv = buildCsv(['a', 'b'], [[1, 2], [3, 4]]);
    expect(csv).toBe(`${BOM}a,b\r\n1,2\r\n3,4`);
  });

  it('quotes cells containing commas', () => {
    const csv = buildCsv(['name'], [['Иванов, Анна']]);
    expect(csv).toBe(`${BOM}name\r\n"Иванов, Анна"`);
  });

  it('escapes embedded double quotes by doubling them', () => {
    const csv = buildCsv(['note'], [['He said "hi"']]);
    expect(csv).toBe(`${BOM}note\r\n"He said ""hi"""`);
  });

  it('quotes cells containing newlines', () => {
    const csv = buildCsv(['x'], [['line1\nline2']]);
    expect(csv).toBe(`${BOM}x\r\n"line1\nline2"`);
  });

  it('renders null and undefined as empty', () => {
    const csv = buildCsv(['a', 'b', 'c'], [[null, undefined, 0]]);
    expect(csv).toBe(`${BOM}a,b,c\r\n,,0`);
  });

  it('starts with UTF-8 BOM for Excel compat', () => {
    const csv = buildCsv(['x'], [['y']]);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
  });
});
