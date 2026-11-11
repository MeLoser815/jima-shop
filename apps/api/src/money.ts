/** 金额以整数分（fen）运算，避免 JS 浮点误差。对外仍使用元的字符串（如 69.90）。 */

const YUAN_RE = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

export function yuanToFen(yuan: string | number): number {
  const raw =
    typeof yuan === 'number' && Number.isFinite(yuan)
      ? yuan.toFixed(2)
      : String(yuan).trim();
  const m = raw.match(YUAN_RE);
  if (!m) {
    throw new Error(`无效金额: ${raw}`);
  }
  const sign = m[1] === '-' ? -1 : 1;
  const whole = Number(m[2]);
  const frac = (m[3] ?? '').padEnd(2, '0');
  return sign * (whole * 100 + Number(frac));
}

export function fenToYuan(fen: number): string {
  if (!Number.isInteger(fen)) {
    throw new Error('分必须为整数');
  }
  const sign = fen < 0 ? '-' : '';
  const n = Math.abs(fen);
  const y = Math.floor(n / 100);
  const f = n % 100;
  return `${sign}${y}.${String(f).padStart(2, '0')}`;
}

export function addFen(...parts: number[]): number {
  return parts.reduce((s, n) => s + n, 0);
}
