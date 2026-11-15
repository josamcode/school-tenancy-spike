// Finds CSS that names a physical side. The layout must follow the page
// direction, so only logical properties and values are allowed.

const SHORTHANDS =
  /(?:^|[;{\s])(margin|padding|inset|border-width|border-style|border-color|scroll-margin|scroll-padding)\s*:\s*([^;}]+)/g;

function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Splits on spaces that are not inside parentheses.
function values(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value.replace(/!important/g, '').trim()) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (/\s/.test(char) && depth === 0) {
      if (current) parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export function physicalCss(css: string): string[] {
  const text = withoutComments(css);
  const problems: string[] = [];

  for (const match of text.matchAll(/[^;{}]*\b(left|right)\b[^;{}]*/gi)) {
    problems.push(match[0].trim());
  }
  // Four values are top, right, bottom, left: physical unless both sides match.
  for (const match of text.matchAll(SHORTHANDS)) {
    const parts = values(match[2]);
    if (parts.length === 4 && parts[1] !== parts[3]) {
      problems.push(`${match[1]}: ${match[2].trim()}`);
    }
  }
  return problems;
}

// The same for style props written in a component.
export function physicalInlineStyle(source: string): string[] {
  const problems: string[] = [];
  for (const match of source.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
    if (/left|right/i.test(match[1])) problems.push(match[0]);
  }
  return problems;
}
