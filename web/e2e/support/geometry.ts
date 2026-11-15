import type { Locator } from '@playwright/test';

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// Where a piece of text is drawn, measured from the laid-out glyphs. The text
// must sit inside one text node of the element.
export function boxOfText(element: Locator, text: string): Promise<Box> {
  return element.evaluate((root, wanted) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node.textContent ?? '').indexOf(wanted);
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + wanted.length);
      const rects = [...range.getClientRects()];
      return {
        left: Math.min(...rects.map((rect) => rect.left)),
        right: Math.max(...rects.map((rect) => rect.right)),
        top: Math.min(...rects.map((rect) => rect.top)),
        bottom: Math.max(...rects.map((rect) => rect.bottom)),
      };
    }
    throw new Error(`"${wanted}" is not in one text node of the element`);
  }, text);
}

export async function boxOf(element: Locator): Promise<Box> {
  const box = await element.boundingBox();
  if (!box) throw new Error('The element is not visible');
  return {
    left: box.x,
    right: box.x + box.width,
    top: box.y,
    bottom: box.y + box.height,
  };
}

export const isLeftOf = (a: Box, b: Box) => a.right <= b.left + 0.5;
export const onOneLine = (a: Box, b: Box) =>
  Math.abs(a.top - b.top) < (a.bottom - a.top) / 2;
