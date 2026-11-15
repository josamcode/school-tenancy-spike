import { Browser, chromium } from 'playwright';
import { SESSION_COOKIE } from './api';

// Where this app answers. The headless browser is only ever sent here, and
// the address never comes from a request.
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3200';

// One browser per server process, started on first use. A context per PDF
// keeps one caller's session away from the next.
const shared = globalThis as { pdfBrowser?: Promise<Browser> };

function browser(): Promise<Browser> {
  shared.pdfBrowser ??= chromium.launch().catch((error: unknown) => {
    shared.pdfBrowser = undefined;
    throw error;
  });
  return shared.pdfBrowser;
}

// Prints one of this app's own pages to PDF, as the caller.
export async function renderPdf(
  path: string,
  token: string | undefined,
): Promise<Buffer> {
  const context = await (await browser()).newContext();
  try {
    if (token) {
      await context.addCookies([
        {
          name: SESSION_COOKIE,
          value: token,
          url: ORIGIN,
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
    }
    // The document must be complete with what this app serves. A request to
    // any other host is stopped, and then the PDF is not produced.
    const refused: string[] = [];
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(`${ORIGIN}/`) || url.startsWith('data:')) {
        return route.continue();
      }
      refused.push(url);
      return route.abort();
    });

    const page = await context.newPage();
    const response = await page.goto(ORIGIN + path, { waitUntil: 'load' });
    if (!response?.ok()) {
      throw new Error(`The print page answered ${response?.status()}`);
    }
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    if (refused.length > 0) {
      throw new Error(`The document asked another host: ${refused.join(', ')}`);
    }
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    await context.close();
  }
}
