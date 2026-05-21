// Escapes a value for inclusion inside a CSV field per RFC 4180:
// internal double-quotes are doubled. Returns '' for null/undefined.
// Caller is responsible for wrapping the result in surrounding double-quotes.
export function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/"/g, '""');
}
