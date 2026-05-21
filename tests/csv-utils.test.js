import { describe, it, expect } from 'vitest';
import { escapeCSV } from '../lib/csv-utils.js';

describe('escapeCSV', () => {
  it('returns empty string for null', () => {
    expect(escapeCSV(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(escapeCSV(undefined)).toBe('');
  });

  it('passes through simple strings unchanged', () => {
    expect(escapeCSV('hello')).toBe('hello');
  });

  it('doubles embedded double-quotes per RFC 4180', () => {
    expect(escapeCSV('Acme "Co"')).toBe('Acme ""Co""');
  });

  it('stringifies non-string values', () => {
    expect(escapeCSV(42)).toBe('42');
  });

  it('handles strings with multiple internal quotes', () => {
    expect(escapeCSV('a"b"c"d')).toBe('a""b""c""d');
  });
});
