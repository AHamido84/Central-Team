import 'server-only';

import type { Browser } from 'puppeteer-core';

/**
 * HTML → PDF with headless Chromium (ADR-097): `@sparticuz/chromium` on Vercel, a local Chromium elsewhere
 * (`PDF_CHROMIUM_PATH`, else Playwright's). One browser per call: board reports are rare and the function is short-lived.
 */
async function launch(): Promise<Browser> {
  const puppeteer = await import('puppeteer-core');
  if (process.env.VERCEL) {
    const chromium = (await import('@sparticuz/chromium')).default;
    return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  }
  return puppeteer.launch({
    executablePath: process.env.PDF_CHROMIUM_PATH ?? process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });
}

export async function htmlToPdf(html: string, footer: { left: string; dir: 'rtl' | 'ltr' }): Promise<Buffer> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    // The document is self-contained (fonts and images inlined): nothing may be fetched while rendering.
    await page.setRequestInterception(true);
    page.on('request', (req) => (req.url().startsWith('data:') ? req.continue() : req.abort()));
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div dir="${footer.dir}" style="width:100%;font-size:8px;color:#9ca3af;padding:0 14mm;display:flex;justify-content:space-between;font-family:Arial"><span>${footer.left.replace(/[<>&"]/g, '')}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      margin: { top: '14mm', bottom: '16mm', left: '14mm', right: '14mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
