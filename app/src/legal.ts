// Terms of Use shown in the app before a vault is created (and from Settings).
// Draft by the development team; to be checked by a lawyer before public release.
// The English text lives in src/i18n/en.ts (terms.*) and is kept in sync with docs/TERMS.md;
// other languages are translations, and the English version applies if they differ.
import { t } from './i18n';

export const TERMS_VERSION = '2026-11-12.2';

export const termsTitle = () => t('common.termsOfUse');

export const terms = (): { heading: string; body: string }[] =>
  ([1, 2, 3, 4, 5, 6] as const).map((i) => ({ heading: t(`terms.h${i}`), body: t(`terms.b${i}`) }));
