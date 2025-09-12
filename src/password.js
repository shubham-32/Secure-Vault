// password.js - Generator and strength scoring

const CHARSETS = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  number: "0123456789",
  symbol: "!@#$%^&*()-_=+[]{};:,.?/|~"
};

export function generatePassword(options) {
  const {
    length = 16,
    lower = true,
    upper = true,
    number = true,
    symbol = true
  } = options || {};

  let source = "";
  if (lower) source += CHARSETS.lower;
  if (upper) source += CHARSETS.upper;
  if (number) source += CHARSETS.number;
  if (symbol) source += CHARSETS.symbol;
  if (!source) source = CHARSETS.lower;

  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += source[bytes[i] % source.length];
  }
  return out;
}

export function scorePassword(pwd) {
  let score = 0;
  if (!pwd) return 0;
  const len = Math.min(32, pwd.length);
  score += len * 2;
  if (/[a-z]/.test(pwd)) score += 10;
  if (/[A-Z]/.test(pwd)) score += 10;
  if (/[0-9]/.test(pwd)) score += 10;
  if (/[^A-Za-z0-9]/.test(pwd)) score += 15;
  if (/(.).*\\1{2,}/.test(pwd)) score -= 10; // repeats
  return Math.max(0, Math.min(100, score));
}