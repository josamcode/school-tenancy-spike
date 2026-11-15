// Finds CSS and copy that break the design rules of the app: six colors and
// no others, flat surfaces, square corners, no decoration in the type, and
// motion only for people who have not asked for less of it.

export const PALETTE = {
  ink: '#1a1d21',
  paper: '#fbfaf7',
  line: '#cfcbc2',
  lapis: '#1d4f91',
  allowed: '#1e6b3a',
  refused: '#a32a1e',
} as const;

// The one stylesheet that may name a monospace font: the raw server response.
export const MONOSPACE_STYLESHEET = 'server-response.css';

const NAMED_COLORS =
  /\b(white|black|red|green|blue|yellow|orange|purple|pink|gr[ae]y|silver|gold|navy|teal|maroon|olive|lime|aqua|cyan|magenta|brown|beige|ivory|crimson|indigo|violet|tomato|coral|salmon|khaki|lavender|whitesmoke|gainsboro|(?:dark|light|dim|medium|pale|deep)[a-z]+)\b/i;
const COLOR_FUNCTION =
  /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i;
const FONTS = ['noto sans', 'noto sans arabic', 'sans-serif', 'inherit'];
const MONOSPACE_FONTS = [
  'ui-monospace',
  'cascadia mono',
  'consolas',
  'menlo',
  'monospace',
  'noto sans arabic',
];

function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Cuts out every block that starts with the given at-rule, braces matched.
function withoutBlocks(css: string, start: RegExp): string {
  let text = css;
  for (;;) {
    const match = start.exec(text);
    if (!match) return text;
    let depth = 0;
    let end = match.index + match[0].length;
    for (; end < text.length; end++) {
      if (text[end] === '{') depth++;
      if (text[end] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    text = text.slice(0, match.index) + text.slice(end + 1);
  }
}

function declarations(css: string): { property: string; value: string }[] {
  return [...css.matchAll(/(?:^|[;{\s])([a-z-]+)\s*:\s*([^;{}]+)/gi)].map(
    (match) => ({
      property: match[1].toLowerCase(),
      value: match[2].trim().toLowerCase(),
    }),
  );
}

export function designProblems(source: string, fileName = ''): string[] {
  const css = withoutComments(source);
  const problems: string[] = [];
  const add = (property: string, value: string, why: string) =>
    problems.push(`${property}: ${value} (${why})`);

  if (/@keyframes/i.test(css)) problems.push('@keyframes (no animations)');
  if (/gradient\(/i.test(css)) problems.push('gradient( (no gradients)');

  const calm = withoutBlocks(
    css,
    /@media\s*\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)\s*/i,
  );
  for (const { property, value } of declarations(calm)) {
    if (property === 'transition' || property.startsWith('transition-')) {
      add(
        property,
        value,
        'motion only under prefers-reduced-motion: no-preference',
      );
    }
  }

  for (const { property, value } of declarations(css)) {
    const tokenDefinition = property.startsWith('--color-');
    for (const [hex] of value.matchAll(/#[0-9a-f]{3,8}\b/g)) {
      if (!tokenDefinition) add(property, value, 'use a color token');
      else if (!(Object.values(PALETTE) as string[]).includes(hex)) {
        add(property, value, 'not in the palette');
      }
    }
    if (COLOR_FUNCTION.test(value)) add(property, value, 'not in the palette');
    if (
      /^(color|background|background-color|border|border-.*|outline|outline-color|fill|stroke|caret-color|text-decoration.*|column-rule.*)$/.test(
        property,
      ) &&
      NAMED_COLORS.test(value.replace(/var\([^)]*\)/g, ''))
    ) {
      add(property, value, 'not in the palette');
    }

    if (
      /^(box-shadow|text-shadow|filter|backdrop-filter|-webkit-backdrop-filter)$/.test(
        property,
      ) &&
      value !== 'none'
    ) {
      add(property, value, 'no shadows, glows or glass');
    }
    if (/^border(-.+)?-radius$/.test(property) && !/^0(px)?$/.test(value)) {
      add(property, value, 'corners are square');
    }
    if (property === 'text-transform' && value !== 'none') {
      add(property, value, 'no all-caps labels');
    }
    if (property === 'font-variant' && /caps/.test(value)) {
      add(property, value, 'no all-caps labels');
    }
    if (property === 'letter-spacing' && !/^(0|normal)$/.test(value)) {
      add(property, value, 'no tracked-out labels');
    }
    if (property === 'animation' || property.startsWith('animation-')) {
      add(property, value, 'no animations');
    }
    if (property === 'font-family' || property === 'font') {
      const families = value
        .split(',')
        .map((family) => family.trim().replace(/^['"]|['"]$/g, ''));
      const monospace = families.some((family) =>
        /mono|consolas|menlo|courier/.test(family),
      );
      if (monospace && fileName !== MONOSPACE_STYLESHEET) {
        add(property, value, 'monospace is for the raw server response only');
      }
      const allowed = monospace ? MONOSPACE_FONTS : FONTS;
      if (
        property === 'font-family' &&
        families.some((family) => !allowed.includes(family))
      ) {
        add(property, value, 'only the bundled Noto faces');
      }
    }
  }
  return problems;
}

// Decoration in the words themselves.
export function copyProblems(text: string): string[] {
  const problems: string[] = [];
  if (/\p{Extended_Pictographic}/u.test(text)) problems.push('an emoji');
  if (/[\u2190-\u21ff\u27a1\u2794\u279c\u25b6\u25ba\u00bb\u203a]/.test(text)) {
    problems.push('an arrow');
  }
  if (/\s[\u00b7\u2022]\s/.test(text))
    problems.push('a separator between labels');
  if (/[\u2713\u2714\u2717\u2718]/.test(text))
    problems.push('a mark instead of a word');
  return problems;
}

// English labels are sentences: no shouting, and capitals only where a
// sentence has them.
export function englishCaseProblems(text: string): string[] {
  const problems: string[] = [];
  const words = text.split(/\s+/).filter((word) => /[A-Za-z]/.test(word));
  if (
    words.some((word) => /^[A-Z]{4,}$/.test(word.replace(/[^A-Za-z]/g, '')))
  ) {
    problems.push('a word in capitals');
  }
  if (
    words.length >= 3 &&
    words.every((word) => /^[A-Z]/.test(word.replace(/^[^A-Za-z]+/, '')))
  ) {
    problems.push('every word capitalised');
  }
  return problems;
}

// WCAG relative luminance and contrast ratio of two #rrggbb colors.
function luminance(hex: string): number {
  const channel = (index: number) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// The color tokens a stylesheet defines on :root, by name.
export function colorTokens(source: string): Record<string, string> {
  const root = /:root\s*\{([^}]*)\}/.exec(withoutComments(source))?.[1] ?? '';
  return Object.fromEntries(
    [...root.matchAll(/--color-([a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)].map(
      (match) => [match[1], match[2].toLowerCase()],
    ),
  );
}
