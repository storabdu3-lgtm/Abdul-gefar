export function fmt(n: number | undefined | null): string {
  return `ETB ${(n ?? 0).toFixed(2)}`;
}
