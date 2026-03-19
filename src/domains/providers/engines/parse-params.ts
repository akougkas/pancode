/**
 * Parse model parameter count strings like "7B", "35B", "1.5T".
 * B = Billion (1e9), M = Million (1e6), K = Thousand (1e3),
 * G = Giga (1e9), T = Trillion (1e12).
 */
export function parseParamCount(raw: string): number | null {
  const match = raw.match(/^([\d.]+)\s*([BKMGT])/i);
  if (!match) return null;

  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;

  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = {
    K: 1e3,
    M: 1e6,
    B: 1e9,
    G: 1e9,
    T: 1e12,
  };

  return value * (multipliers[unit] ?? 1);
}
