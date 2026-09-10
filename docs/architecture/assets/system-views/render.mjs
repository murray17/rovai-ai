import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderLayout } from './source/layouts.mjs';

// Rendering dependencies stay outside the application workspace.
const assetDir = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = process.env.ROVAI_DIAGRAM_TOOLS;
if (!toolRoot) {
  throw new Error('Set ROVAI_DIAGRAM_TOOLS to the isolated Puppeteer and Rough.js installation directory. See README.md.');
}
const requireTool = createRequire(path.join(path.resolve(toolRoot), 'package.json'));
const { default: puppeteer } = await import(pathToFileURL(requireTool.resolve('puppeteer')).href);
const figures = JSON.parse(await fs.readFile(path.join(assetDir, 'figures.json'), 'utf8'));
const selected = new Set(process.argv.slice(2));
for (const id of selected) {
  if (!figures.some((figure) => figure.id === id)) throw new Error(`Unknown figure: ${id}`);
}
const xml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const font = 'PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif';

function frame(raw, figure) {
  const viewBox = raw.match(/viewBox="([^"]+)"/);
  if (!viewBox) throw new Error(`Missing SVG viewBox: ${figure.id}`);
  const [, , graphWidth, graphHeight] = viewBox[1].split(/\s+/).map(Number);
  // Keep diagram typography at its native size; expand the page for wide diagrams.
  const width = Math.max(1120, Math.ceil(graphWidth + 104));
  const subtitle = figure.subtitle?.trim();
  const graphY = subtitle ? 174 : 134;
  const footer = figure.footer?.trim();
  const height = Math.ceil(graphY + graphHeight + (footer ? 84 : 26));
  const x = (width - graphWidth) / 2;
  const inner = raw.replace(/<svg\b[^>]*>/, (tag) => {
    const clean = tag.replace(/\s(?:width|height|style)="[^"]*"/g, '');
    return clean.replace(/>$/, ` x="${x}" y="${graphY}" width="${graphWidth}" height="${graphHeight}">`);
  });
  return {
    width,
    height,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="figure-title figure-description">
<title id="figure-title">${xml(figure.title)}</title>
<desc id="figure-description">${xml([figure.description || subtitle, footer].filter(Boolean).join(' '))}</desc>
<rect width="${width}" height="${height}" fill="#fcfdfc"/>
<g font-family="${font}" fill="#253c31">
<text x="48" y="40" fill="#708078" font-size="12" font-weight="600" letter-spacing="2">ROVAI AI / ARCHITECTURE</text>
<text x="${width - 48}" y="40" fill="#708078" font-size="13" text-anchor="end">图 ${figure.id.slice(0, 2)}</text>
<text x="48" y="94" font-size="34" font-weight="600">${xml(figure.title)}</text>
${subtitle ? `<text x="49" y="130" fill="#708078" font-size="17">${xml(subtitle)}</text>` : ''}
<path d="M48 ${graphY - 23} H${width - 48}" stroke="#dce5df" stroke-width="1"/>
</g>
${inner}
${footer ? `<g font-family="${font}" fill="#708078">
<path d="M48 ${height - 59} H${width - 48}" stroke="#dce5df" stroke-width="1"/>
<text x="49" y="${height - 27}" font-size="16">${xml(footer)}</text>
</g>` : ''}
</svg>\n`,
  };
}

const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  headless: true,
  args: ['--disable-gpu'],
});
try {
  for (const figure of figures) {
    if (selected.size && !selected.has(figure.id)) continue;
    const raw = renderLayout(figure.id);
    const result = frame(raw, figure);
    await fs.writeFile(path.join(assetDir, `${figure.id}.svg`), result.svg);
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: result.width, height: result.height, deviceScaleFactor: 1.5 });
      await page.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0}svg{display:block}</style>${result.svg}`);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(assetDir, `${figure.id}.png`), fullPage: true });
    } finally {
      await page.close();
    }
    console.log(`${figure.id}: ${result.width} × ${result.height} SVG + PNG`);
  }
} finally {
  await browser.close();
}
