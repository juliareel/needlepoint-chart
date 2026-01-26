export type Color = { id: number; name: string; hex: string; family?: string; code?: string };

export function makeGrid(width: number, height: number, fillId = 0): Uint16Array {
  const arr = new Uint16Array(width * height);
  if (fillId !== 0) arr.fill(fillId);
  return arr;
}

export function idx(x: number, y: number, width: number) {
  return y * width + x;
}
