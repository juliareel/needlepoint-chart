export const SYMBOLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*+=?/<>[]{}()~;:"
  .split("")
  .filter((char) => char.trim().length > 0);

export function symbolForColorId(id: number) {
  if (SYMBOLS.length === 0) return "";
  return SYMBOLS[Math.abs(id) % SYMBOLS.length];
}
