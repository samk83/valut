/**
 * Makes the store's price string say which currency it is.
 *
 * The App Store and Google Play format the price for the phone's language, so a Canadian
 * phone shows CAD as a bare "$12.99", which reads like US dollars. When the symbol could
 * mean more than one currency ("$", "kr", "¥" outside Japan/China, ...) and the string does
 * not already name the currency, the ISO code is added: "$12.99 CAD". Clear strings such as
 * "₩14,000", "€9,99", "CA$12.99" or "US$9.99" are left as the store wrote them.
 */
const SHARED_SYMBOLS = ['$', 'kr', '¥', '￥', 'Fr', '£'];

/** Currencies whose bare symbol is read as that currency almost everywhere. */
const OWNS_SYMBOL: Record<string, string> = { USD: '$', JPY: '¥', GBP: '£' };

export function clearPrice(formatted: string | null | undefined, currency: string | null | undefined): string | null {
  if (!formatted) return null;
  const text = formatted.trim();
  const code = (currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return text;
  if (text.toUpperCase().includes(code)) return text;
  // A letter right before "$" means the store already wrote a clear prefix (CA$, US$, A$, R$, MX$).
  if (/[A-Za-z]\$/.test(text)) return text;
  const symbol = SHARED_SYMBOLS.find((s) => text.includes(s));
  if (!symbol) return text;
  if (OWNS_SYMBOL[code] && text.includes(OWNS_SYMBOL[code]) && !(code === 'JPY' && text.includes('￥'))) return text;
  return `${text} ${code}`;
}
