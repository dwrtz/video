/** Splits a file of `size` bytes into multipart parts of `partBytes` (the last may be smaller). */
export function planParts(size: number, partBytes: number): { partNumber: number; start: number; end: number }[] {
  if (size <= 0) return [];
  const n = Math.ceil(size / partBytes);
  return Array.from({ length: n }, (_, i) => ({ partNumber: i + 1, start: i * partBytes, end: Math.min(size, (i + 1) * partBytes) }));
}
