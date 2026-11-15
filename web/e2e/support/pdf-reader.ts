import zlib from 'node:zlib';

// Reads the text of a PDF written by Chromium the way a conforming reader
// does: ActualText where a glyph has one, the font's ToUnicode map otherwise,
// and runs marked ReversedChars put back in logical order. It understands the
// operators Chromium writes and nothing more.

export interface PdfFont {
  name: string;
  embedded: boolean;
}

// One character of the text and the glyphs that draw it.
export interface PdfCluster {
  text: string;
  glyphs: number[];
}

interface Char {
  text: string;
  x: number;
}

interface Run {
  x: number;
  y: number;
  size: number;
  reversed: boolean;
  chars: Char[];
}

export interface Pdf {
  pages: number;
  fonts: PdfFont[];
  // Fonts that are not composite fonts with an embedded file, such as the 14
  // standard ones. Chromium writes none.
  otherFonts: number;
  runs: Run[];
  clusters: PdfCluster[];
}

interface PdfObject {
  dict: string;
  stream?: string;
}

interface Span {
  actual: string;
  cluster?: PdfCluster;
}

function objects(file: Buffer): Map<number, PdfObject> {
  const text = file.toString('latin1');
  const result = new Map<number, PdfObject>();
  for (const match of text.matchAll(/(\d+) 0 obj\b([\s\S]*?)endobj/g)) {
    const body = match[2];
    const keyword = /stream\r?\n/.exec(body);
    let stream: string | undefined;
    if (keyword) {
      const start =
        match.index +
        match[0].indexOf(body) +
        keyword.index +
        keyword[0].length;
      const end = text.indexOf('endstream', start);
      try {
        stream = zlib.inflateSync(file.subarray(start, end)).toString('latin1');
      } catch {
        stream = undefined;
      }
    }
    result.set(Number(match[1]), {
      dict: keyword ? body.slice(0, keyword.index) : body,
      stream,
    });
  }
  return result;
}

function utf16(hex: string): string {
  let out = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  }
  return out;
}

function toUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g,
    )) {
      map.set(parseInt(pair[1], 16), utf16(pair[2]));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1].matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g,
    )) {
      const from = parseInt(range[1], 16);
      const to = parseInt(range[2], 16);
      const first = parseInt(range[3], 16);
      for (let glyph = from; glyph <= to; glyph++) {
        map.set(glyph, String.fromCodePoint(first + glyph - from));
      }
    }
  }
  return map;
}

const TOKEN =
  /<<[\s\S]*?>>|<[0-9A-Fa-f\s]*>|\/[^\s/<>[\]()]+|[-+]?\d*\.?\d+|[A-Za-z*'"]+|\[|\]/g;

export function readPdf(file: Buffer): Pdf {
  const objs = objects(file);
  const referenced = (dict: string, key: string) => {
    const match = new RegExp(`/${key}\\s+(\\d+) 0 R`).exec(dict);
    return match ? objs.get(Number(match[1])) : undefined;
  };
  const isFont = (obj: PdfObject) => /\/Type\s*\/Font\b/.test(obj.dict);

  const fonts: PdfFont[] = [];
  const maps = new Map<number, { font: PdfFont; map: Map<number, string> }>();
  for (const [number, obj] of objs) {
    if (!isFont(obj) || !/\/Subtype\s*\/Type0\b/.test(obj.dict)) continue;
    const descendant = /\/DescendantFonts\s*\[\s*(\d+) 0 R/.exec(obj.dict);
    const cid = descendant ? objs.get(Number(descendant[1])) : undefined;
    const descriptor = cid ? referenced(cid.dict, 'FontDescriptor') : undefined;
    const font = {
      name: /\/BaseFont\s*\/([^\s/<>[\]]+)/.exec(obj.dict)?.[1] ?? '',
      embedded: descriptor
        ? /\/FontFile[23]?\s+\d+ 0 R/.test(descriptor.dict)
        : false,
    };
    fonts.push(font);
    maps.set(number, {
      font,
      map: toUnicode(referenced(obj.dict, 'ToUnicode')?.stream ?? ''),
    });
  }
  const otherFonts = [...objs.values()].filter(
    (obj) =>
      isFont(obj) && !/\/Subtype\s*\/(Type0|CIDFontType[02])\b/.test(obj.dict),
  ).length;

  const resources = new Map<string, Map<number, string>>();
  for (const obj of objs.values()) {
    for (const dict of obj.dict.matchAll(/\/Font\s*<<([\s\S]*?)>>/g)) {
      for (const entry of dict[1].matchAll(/\/(\w+)\s+(\d+) 0 R/g)) {
        const found = maps.get(Number(entry[2]));
        if (found) resources.set(entry[1], found.map);
      }
    }
  }

  const pages = [...objs.values()].filter((obj) =>
    /\/Type\s*\/Page\b/.test(obj.dict),
  ).length;

  const runs: Run[] = [];
  const clusters: PdfCluster[] = [];
  for (const obj of objs.values()) {
    if (!obj.stream || !/\bBT\b[\s\S]*\bET\b/.test(obj.stream)) continue;
    let operands: string[] = [];
    let map: Map<number, string> | undefined;
    let size = 0;
    let x = 0;
    let run: Run | undefined;
    const marks: (string | Span)[] = [];

    for (const token of obj.stream.match(TOKEN) ?? []) {
      if (!/^[A-Za-z*'"]+$/.test(token)) {
        operands.push(token);
        continue;
      }
      switch (token) {
        case 'BT':
          run = {
            x: 0,
            y: 0,
            size,
            reversed: marks.includes('ReversedChars'),
            chars: [],
          };
          break;
        case 'ET':
          if (run && run.chars.length > 0) runs.push(run);
          run = undefined;
          break;
        case 'Tf':
          map = resources.get(operands[0].slice(1));
          size = Number(operands[1]);
          if (run) run.size = size;
          break;
        case 'Tm':
          x = Number(operands[4]);
          if (run && run.chars.length === 0) {
            run.x = x;
            run.y = Number(operands[5]);
          }
          break;
        case 'Td':
          x += Number(operands[0]);
          break;
        case 'BMC':
          marks.push(operands[0].slice(1));
          if (run && operands[0] === '/ReversedChars') run.reversed = true;
          break;
        case 'BDC': {
          const actual = /\/ActualText\s*<([0-9A-Fa-f\s]*)>/.exec(operands[1]);
          marks.push(
            actual
              ? {
                  actual: utf16(
                    actual[1].replace(/\s/g, '').replace(/^FEFF/i, ''),
                  ),
                }
              : 'BDC',
          );
          break;
        }
        case 'EMC':
          marks.pop();
          break;
        case 'Tj': {
          const hex = operands[0].slice(1, -1).replace(/\s/g, '');
          const span = marks.findLast(
            (mark): mark is Span => typeof mark === 'object',
          );
          for (let i = 0; i + 4 <= hex.length; i += 4) {
            const glyph = parseInt(hex.slice(i, i + 4), 16);
            if (span?.cluster) {
              // Further glyphs of a character that has its text already.
              span.cluster.glyphs.push(glyph);
              continue;
            }
            const text = span ? span.actual : (map?.get(glyph) ?? '\uFFFD');
            const cluster = { text, glyphs: [glyph] };
            if (span) span.cluster = cluster;
            clusters.push(cluster);
            run?.chars.push({ text, x });
          }
          break;
        }
        default:
      }
      operands = [];
    }
  }

  return { pages, fonts, otherFonts, runs, clusters };
}

const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LTR = /[A-Za-z]/;
const NUMBER = /\d/;

type Direction = 'rtl' | 'ltr';

interface Item {
  start: number;
  end: number;
  size: number;
  text: string;
  dir?: Direction;
  number: boolean;
}

// One cell of a line, or the whole line when it has no columns, in logical
// order. A group of runs against the paragraph direction keeps its own
// order, as the bidirectional algorithm lays it out.
function logical(visual: Item[], direction: Direction): string {
  const neighbour = (from: number, step: 1 | -1) => {
    for (let i = from + step; i >= 0 && i < visual.length; i += step) {
      if (visual[i].text.trim()) return visual[i];
    }
    return undefined;
  };
  // A number next to Latin text belongs to it. Any other number stands alone
  // and counts as the paragraph's direction for what surrounds it.
  visual.forEach((item, i) => {
    if (!item.number) return;
    const joins =
      neighbour(i, -1)?.dir === 'ltr' || neighbour(i, 1)?.dir === 'ltr';
    item.dir = joins ? 'ltr' : direction;
  });
  // Whitespace and punctuation take the direction both neighbours share.
  visual.forEach((item, i) => {
    if (item.dir) return;
    const before = visual.slice(0, i).findLast((other) => other.dir)?.dir;
    const after = visual.slice(i + 1).find((other) => other.dir)?.dir;
    item.dir = before && before === after ? before : direction;
  });

  const ordered = direction === 'rtl' ? [...visual].reverse() : visual;
  const out: Item[] = [];
  let group: Item[] = [];
  const flush = () => {
    out.push(...group.reverse());
    group = [];
  };
  for (const item of ordered) {
    if (item.dir !== direction) group.push(item);
    else {
      flush();
      out.push(item);
    }
  }
  flush();
  return out.map((item) => item.text).join('');
}

// The lines of the document, top to bottom, each in logical order. The
// paragraph direction is the document's. Columns are joined with a space.
export function lines(pdf: Pdf, direction: Direction): string[] {
  const rows: { y: number; items: Item[] }[] = [];
  for (const run of [...pdf.runs].sort((a, b) => a.y - b.y)) {
    const chars = run.reversed ? [...run.chars].reverse() : run.chars;
    const text = chars.map((char) => char.text).join('');
    const xs = run.chars.map((char) => char.x);
    const item: Item = {
      start: Math.min(...xs),
      end: Math.max(...xs) + run.size * 0.5,
      size: run.size,
      text,
      dir: RTL.test(text) ? 'rtl' : LTR.test(text) ? 'ltr' : undefined,
      number: !RTL.test(text) && !LTR.test(text) && NUMBER.test(text),
    };
    const row = rows.at(-1);
    if (row && Math.abs(row.y - run.y) < 2) row.items.push(item);
    else rows.push({ y: run.y, items: [item] });
  }

  return rows.map(({ items }) => {
    const visual = items.sort((a, b) => a.start - b.start);
    // Cells of a table row are runs with a wide gap between them.
    const cells: Item[][] = [[]];
    visual.forEach((item, i) => {
      const previous = visual[i - 1];
      if (previous && item.start - previous.end > item.size * 1.5) {
        cells.push([]);
      }
      cells.at(-1)!.push(item);
    });
    return (direction === 'rtl' ? cells.reverse() : cells)
      .map((cell) => logical(cell, direction))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  });
}

// Every distinct sequence of glyphs that draws each character.
export function glyphForms(pdf: Pdf): Map<string, Set<string>> {
  const forms = new Map<string, Set<string>>();
  for (const cluster of pdf.clusters) {
    if (!forms.has(cluster.text)) forms.set(cluster.text, new Set());
    forms.get(cluster.text)!.add(cluster.glyphs.join('+'));
  }
  return forms;
}
