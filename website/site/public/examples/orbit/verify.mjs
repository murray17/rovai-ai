import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const css = readFileSync(resolve(root, 'styles.css'), 'utf8');

assert.match(html, /^<!doctype html>/i);
assert.match(html, /<html\s+lang="en">/i);
assert.match(html, /<meta\s+name="viewport"\s+content="width=device-width, initial-scale=1">/i);
assert.equal((html.match(/<main\b/g) ?? []).length, 1);
assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
assert.match(html, /<link\s+rel="stylesheet"\s+href="styles\.css">/i);
assert.match(html, /not an Orbit installer/i);
assert.match(css, /\.download-link:focus-visible\s*\{[^}]*outline:/s);
assert.match(css, /grid-template-columns:\s*repeat\(auto-fit,/);

const footerColor = css.match(/\.site-footer\s*\{[^}]*\bcolor:\s*(#[\da-f]{6})/is)?.[1];
const bodyBackground = css.match(/\bbody\s*\{[^}]*\bbackground:\s*([^;]+);/is)?.[1];
const backgroundColors = bodyBackground?.match(/#[\da-f]{6}/gi) ?? [];
assert.ok(footerColor && backgroundColors.length, 'Missing footer or page background color');

function luminance(hex) {
  const [r, g, b] = hex.slice(1).match(/.{2}/g)
    .map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const footerLuminance = luminance(footerColor);
const minimumContrast = Math.min(...backgroundColors.map(color => {
  const backgroundLuminance = luminance(color);
  return (Math.max(footerLuminance, backgroundLuminance) + 0.05)
    / (Math.min(footerLuminance, backgroundLuminance) + 0.05);
}));
assert.ok(minimumContrast >= 4.5, `Footer contrast is ${minimumContrast.toFixed(2)}:1; expected at least 4.5:1`);

// Check nesting for the simple static markup used by this page.
const voidTags = new Set(['meta', 'link', 'br', 'hr', 'img', 'input']);
const stack = [];
for (const [, closing, tag] of html.matchAll(/<(\/)?([a-z][a-z0-9]*)\b[^>]*>/gi)) {
  const name = tag.toLowerCase();
  if (voidTags.has(name)) continue;
  if (closing) assert.equal(stack.pop(), name, `Mismatched closing tag: ${name}`);
  else stack.push(name);
}
assert.deepEqual(stack, [], 'Unclosed HTML elements');

const expected = new Map([
  ['downloads/orbit-apple-silicon.txt', 'Apple Silicon'],
  ['downloads/orbit-intel.txt', 'Intel Mac'],
  ['downloads/orbit-windows-x64.txt', 'Windows x64'],
]);
const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
assert.equal(links.length, expected.size, 'Expected one download link per platform');

for (const [, attributes, content] of links) {
  const href = attributes.match(/\bhref="([^"]+)"/)?.[1];
  assert.ok(href && expected.has(href), `Unexpected link: ${href}`);
  assert.match(attributes, /\bdownload(?:\s|=|$)/);
  assert.match(content.replace(/<[^>]*>/g, ''), new RegExp(`${expected.get(href)} tutorial`, 'i'));
  assert.ok(existsSync(resolve(root, href)), `Missing download: ${href}`);
  const fixture = readFileSync(resolve(root, href), 'utf8');
  assert.match(fixture, /not an installable application/i);
  expected.delete(href);
}
assert.equal(expected.size, 0, 'Missing platform link');

console.log(`Verified HTML nesting, required markup, focus and responsive CSS, all 3 local tutorial links, and footer contrast (${minimumContrast.toFixed(2)}:1 minimum).`);
