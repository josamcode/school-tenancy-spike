import ar from '../messages/ar.json';
import en from '../messages/en.json';

// Arabic first.
export const LANGS = ['ar', 'en'] as const;
export type Lang = (typeof LANGS)[number];

export const isLang = (value: unknown): value is Lang =>
  LANGS.includes(value as Lang);

// The page direction follows the language and nothing else.
export const dirOf = (lang: Lang) => (lang === 'ar' ? 'rtl' : 'ltr');
export const otherLang = (lang: Lang): Lang => (lang === 'ar' ? 'en' : 'ar');

// Each language is named in itself, whatever the page is in.
export const LANGUAGE_NAMES: Record<Lang, string> = {
  ar: 'العربية',
  en: 'English',
};

export type Messages = typeof en;
export const messages = (lang: Lang): Messages => (lang === 'ar' ? ar : en);

// Content the API returns in one or both languages.
export interface I18nText {
  ar?: string;
  en?: string;
}

export interface PickedText {
  text: string;
  // The language the text is really in, when that is known. It may not be
  // the page's, so whoever shows it can mark it.
  lang: Lang | undefined;
}

export function pickText(
  text: I18nText | null | undefined,
  lang: Lang,
  fallback?: string,
): PickedText | undefined {
  for (const candidate of [lang, otherLang(lang)]) {
    const found = text?.[candidate];
    if (found) return { text: found, lang: candidate };
  }
  return fallback === undefined
    ? undefined
    : { text: fallback, lang: undefined };
}
