/**
 * Input validation and sanitization utilities.
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Trim, collapse whitespace, truncate to maxLen.
 */
export function sanitizeText(str: unknown, maxLen: number = 200): string {
  if (typeof str !== 'string') return '';
  return str.trim().replace(/\s+/g, ' ').slice(0, maxLen);
}

/**
 * Validate phone number — allow +7/8 format, 10-11 digits.
 * Returns { valid: boolean, error?: string }
 */
export function validatePhone(phone: string | null | undefined): ValidationResult {
  if (!phone || !phone.trim()) return { valid: true }; // optional field
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 11) {
    return { valid: false, error: 'Телефон должен содержать 10-11 цифр' };
  }
  // Must start with 7 or 8 (for Russian numbers)
  if (digits.length === 11 && !/^[78]/.test(digits)) {
    return { valid: false, error: 'Телефон должен начинаться с +7 или 8' };
  }
  return { valid: true };
}

/**
 * Validate email — basic format check.
 * Returns { valid: boolean, error?: string }
 */
export function validateEmail(email: string | null | undefined): ValidationResult {
  if (!email || !email.trim()) return { valid: true }; // optional field
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!pattern.test(email.trim())) {
    return { valid: false, error: 'Некорректный email' };
  }
  return { valid: true };
}

/**
 * Validate that a value is non-empty.
 * Returns { valid: boolean, error?: string }
 */
export function validateRequired(value: unknown, fieldName: string): ValidationResult {
  if (!value || (typeof value === 'string' && !value.trim())) {
    return { valid: false, error: `${fieldName} — обязательное поле` };
  }
  return { valid: true };
}
