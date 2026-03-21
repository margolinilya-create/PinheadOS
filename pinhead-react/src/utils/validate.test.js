import { describe, it, expect } from 'vitest';
import { sanitizeText, validatePhone, validateEmail, validateRequired } from './validate';

describe('sanitizeText', () => {
  it('trims whitespace', () => {
    expect(sanitizeText('  hello  ')).toBe('hello');
  });

  it('collapses inner whitespace', () => {
    expect(sanitizeText('hello   world')).toBe('hello world');
  });

  it('truncates to maxLen', () => {
    expect(sanitizeText('abcdef', 3)).toBe('abc');
  });

  it('uses default maxLen of 200', () => {
    const long = 'a'.repeat(300);
    expect(sanitizeText(long)).toHaveLength(200);
  });

  it('handles non-string input', () => {
    expect(sanitizeText(null)).toBe('');
    expect(sanitizeText(undefined)).toBe('');
    expect(sanitizeText(123)).toBe('');
  });

  it('handles empty string', () => {
    expect(sanitizeText('')).toBe('');
  });

  it('trims tabs and newlines', () => {
    expect(sanitizeText('\thello\nworld\t')).toBe('hello world');
  });
});

describe('validatePhone', () => {
  it('accepts empty/null phone (optional)', () => {
    expect(validatePhone('')).toEqual({ valid: true });
    expect(validatePhone(null)).toEqual({ valid: true });
    expect(validatePhone(undefined)).toEqual({ valid: true });
    expect(validatePhone('   ')).toEqual({ valid: true });
  });

  it('accepts valid 11-digit +7 phone', () => {
    expect(validatePhone('+7 (999) 123-45-67')).toEqual({ valid: true });
  });

  it('accepts valid 11-digit 8 phone', () => {
    expect(validatePhone('89991234567')).toEqual({ valid: true });
  });

  it('accepts valid 10-digit phone', () => {
    expect(validatePhone('9991234567')).toEqual({ valid: true });
  });

  it('rejects phone with too few digits', () => {
    const result = validatePhone('12345');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects phone with too many digits', () => {
    const result = validatePhone('123456789012');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects 11-digit phone not starting with 7 or 8', () => {
    const result = validatePhone('59991234567');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('+7');
  });

  it('accepts phone with formatting characters', () => {
    expect(validatePhone('+7-999-123-45-67')).toEqual({ valid: true });
  });
});

describe('validateEmail', () => {
  it('accepts empty/null email (optional)', () => {
    expect(validateEmail('')).toEqual({ valid: true });
    expect(validateEmail(null)).toEqual({ valid: true });
    expect(validateEmail(undefined)).toEqual({ valid: true });
    expect(validateEmail('   ')).toEqual({ valid: true });
  });

  it('accepts valid email', () => {
    expect(validateEmail('user@example.com')).toEqual({ valid: true });
  });

  it('accepts email with subdomain', () => {
    expect(validateEmail('user@mail.example.com')).toEqual({ valid: true });
  });

  it('rejects email without @', () => {
    const result = validateEmail('userexample.com');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects email without domain', () => {
    const result = validateEmail('user@');
    expect(result.valid).toBe(false);
  });

  it('rejects email without TLD', () => {
    const result = validateEmail('user@example');
    expect(result.valid).toBe(false);
  });

  it('rejects email with spaces', () => {
    const result = validateEmail('user @example.com');
    expect(result.valid).toBe(false);
  });

  it('accepts email with dots and hyphens in local part', () => {
    expect(validateEmail('user.name-tag@example.com')).toEqual({ valid: true });
  });
});

describe('validateRequired', () => {
  it('fails on empty string', () => {
    const result = validateRequired('', 'Имя');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Имя');
  });

  it('fails on whitespace-only string', () => {
    const result = validateRequired('   ', 'Имя');
    expect(result.valid).toBe(false);
  });

  it('fails on null/undefined', () => {
    expect(validateRequired(null, 'Поле').valid).toBe(false);
    expect(validateRequired(undefined, 'Поле').valid).toBe(false);
  });

  it('passes on non-empty string', () => {
    expect(validateRequired('hello', 'Имя')).toEqual({ valid: true });
  });

  it('includes field name in error message', () => {
    const result = validateRequired('', 'Телефон');
    expect(result.error).toContain('Телефон');
  });
});
