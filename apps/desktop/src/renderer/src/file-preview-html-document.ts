import { filePreviewAssetUrl } from '../../file-preview-asset-url'

const LOCKED_POLICY = [
  "default-src 'none'",
  "img-src data: blob: rovai-preview:",
  "style-src 'unsafe-inline' rovai-preview:",
  'font-src rovai-preview:',
  'media-src blob: rovai-preview:',
  "script-src 'unsafe-inline' rovai-preview:",
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join('; ')

function rewriteCss(css: string, tabToken: string, basePath: string): string {
  const rewrite = (reference: string): string => filePreviewAssetUrl(reference, tabToken, basePath) ?? reference
  return css
    .replace(/url\(\s*(['"]?)([^)'"\s][^)'"\n]*?)\1\s*\)/giu, (_match, quote: string, value: string) =>
      `url(${quote}${rewrite(value.trim())}${quote})`)
    .replace(/(@import\s+)(['"])([^'"]+)\2/giu, (_match, prefix: string, quote: string, value: string) =>
      `${prefix}${quote}${rewrite(value)}${quote}`)
}

function rewriteModuleImports(source: string, tabToken: string, basePath: string): string {
  return source.replace(
    /(\b(?:from\s*|import\s*\(\s*))(['"])([^'"]+)\2/gu,
    (match, prefix: string, quote: string, value: string) => {
      const rewritten = filePreviewAssetUrl(value, tabToken, basePath)
      return rewritten ? `${prefix}${quote}${rewritten}${quote}` : match
    }
  )
}

function rewriteSourceSet(value: string, tabToken: string, basePath: string): string {
  return value.split(',').map((candidate) => {
    const [reference, ...descriptor] = candidate.trim().split(/\s+/u)
    const rewritten = filePreviewAssetUrl(reference, tabToken, basePath) ?? reference
    return [rewritten, ...descriptor].join(' ')
  }).join(', ')
}

function rewriteStaticResources(document: Document, tabToken: string, basePath: string): void {
  const rewriteAttribute = (element: Element, name: string): void => {
    const value = element.getAttribute(name)
    if (!value) return
    const rewritten = name === 'srcset'
      ? rewriteSourceSet(value, tabToken, basePath)
      : filePreviewAssetUrl(value, tabToken, basePath)
    if (rewritten) element.setAttribute(name, rewritten)
  }

  for (const element of document.querySelectorAll('script[src]')) rewriteAttribute(element, 'src')
  for (const element of document.querySelectorAll('link[rel~="stylesheet"][href]')) rewriteAttribute(element, 'href')
  for (const element of document.querySelectorAll('img[src], source[src], video[src], audio[src], track[src], input[type="image"][src], image[href]')) {
    rewriteAttribute(element, element.hasAttribute('href') ? 'href' : 'src')
  }
  for (const element of document.querySelectorAll('[srcset]')) rewriteAttribute(element, 'srcset')
  for (const element of document.querySelectorAll('video[poster]')) rewriteAttribute(element, 'poster')
  for (const element of document.querySelectorAll('image[xlink\\:href]')) rewriteAttribute(element, 'xlink:href')
  for (const element of document.querySelectorAll<HTMLElement>('[style]')) {
    const style = element.getAttribute('style')
    if (style) element.setAttribute('style', rewriteCss(style, tabToken, basePath))
  }
  for (const style of document.querySelectorAll('style')) {
    style.textContent = rewriteCss(style.textContent ?? '', tabToken, basePath)
  }
  for (const script of document.querySelectorAll('script[type="module"]:not([src])')) {
    script.textContent = rewriteModuleImports(script.textContent ?? '', tabToken, basePath)
  }
}

function bootstrapSource(tabToken: string, bridgeToken: string, basePath: string): string {
  return `(() => {
    const tabToken = ${JSON.stringify(tabToken)};
    const bridgeToken = ${JSON.stringify(bridgeToken)};
    const basePath = ${JSON.stringify(basePath)};
    const nativeSetAttribute = Element.prototype.setAttribute;
    const nativeGetAttribute = Element.prototype.getAttribute;
    const nativeClosest = Element.prototype.closest;
    const sendToHost = parent.postMessage.bind(parent);
    const blockedScheme = /^[a-z][a-z0-9+.-]*:/i;
    const assetUrl = (input) => {
      if (typeof input !== 'string') return input;
      const reference = input.trim();
      if (!reference || reference.startsWith('#') || blockedScheme.test(reference)) return input;
      const suffixAt = reference.search(/[?#]/);
      const path = suffixAt < 0 ? reference : reference.slice(0, suffixAt);
      const suffix = suffixAt < 0 ? '' : reference.slice(suffixAt);
      const resolved = path.startsWith('/') || path.startsWith('\\\\')
        ? []
        : basePath.replace(/\\\\/g, '/').split('/').filter(Boolean);
      for (const raw of path.replace(/\\\\/g, '/').split('/')) {
        if (!raw || raw === '.') continue;
        let segment;
        try { segment = decodeURIComponent(raw); } catch { return input; }
        if (!segment || /[\\/\\\\\\0\\r\\n]/.test(segment)) return input;
        if (segment === '..') {
          if (resolved.length === 0) return input;
          resolved.pop();
        } else resolved.push(segment);
      }
      if (resolved.length === 0) return input;
      return 'rovai-preview://asset/' + encodeURIComponent(tabToken) + '/'
        + resolved.map(encodeURIComponent).join('/') + suffix;
    };
    const scrollToFragment = (rawFragment) => {
      if (typeof rawFragment !== 'string' || !rawFragment || rawFragment.length > 1024) return false;
      let fragment;
      try { fragment = decodeURIComponent(rawFragment.replace(/^#/, '')); } catch { return false; }
      const target = document.getElementById(fragment)
        || Array.from(document.getElementsByName(fragment))[0];
      target?.scrollIntoView({ block: 'start' });
      return Boolean(target);
    };
    const resourceAttribute = (element, name) => {
      const tag = element.tagName.toLowerCase();
      const attribute = String(name).toLowerCase();
      if (attribute === 'srcset' && (tag === 'img' || tag === 'source')) return 'srcset';
      if (attribute === 'poster' && tag === 'video') return 'url';
      if (attribute === 'src' && ['script','img','source','video','audio','track'].includes(tag)) return 'url';
      if (attribute === 'src' && tag === 'input' && element.type === 'image') return 'url';
      if ((attribute === 'href' || attribute === 'xlink:href') && tag === 'image') return 'url';
      if (attribute === 'href' && tag === 'link' && String(element.rel).split(/\\s+/).includes('stylesheet')) return 'url';
      return null;
    };
    Element.prototype.setAttribute = function(name, value) {
      const kind = resourceAttribute(this, name);
      if (kind === 'url') value = assetUrl(String(value));
      if (kind === 'srcset') value = String(value).split(',').map((candidate) => {
        const parts = candidate.trim().split(/\\s+/);
        parts[0] = assetUrl(parts[0]);
        return parts.join(' ');
      }).join(', ');
      return nativeSetAttribute.call(this, name, value);
    };
    for (const [constructorName, property] of [
      ['HTMLScriptElement','src'], ['HTMLImageElement','src'], ['HTMLImageElement','srcset'],
      ['HTMLSourceElement','src'], ['HTMLSourceElement','srcset'], ['HTMLVideoElement','src'],
      ['HTMLVideoElement','poster'], ['HTMLAudioElement','src'], ['HTMLTrackElement','src'],
      ['HTMLLinkElement','href']
    ]) {
      const Constructor = window[constructorName];
      const descriptor = Constructor && Object.getOwnPropertyDescriptor(Constructor.prototype, property);
      if (!descriptor || !descriptor.set || !descriptor.get) continue;
      Object.defineProperty(Constructor.prototype, property, {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set(value) { descriptor.set.call(this, assetUrl(String(value))); }
      });
    }
    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? nativeClosest.call(event.target, 'a[href]') : null;
      if (!target) return;
      event.preventDefault();
      if (!event.isTrusted || (event.button !== 0 && event.button !== undefined)) return;
      const href = nativeGetAttribute.call(target, 'href');
      if (!href || href.length > 4096) return;
      if (href.startsWith('#')) {
        scrollToFragment(href);
        return;
      }
      sendToHost({ type: 'rovai-preview-link', tabToken, bridgeToken, href }, '*');
    }, true);
    addEventListener('message', (event) => {
      if (event.source !== parent || !event.data || typeof event.data !== 'object') return;
      const data = event.data;
      if (data.type !== 'rovai-preview-fragment'
        || data.tabToken !== tabToken) return;
      const found = scrollToFragment(data.fragment);
      sendToHost({ type: 'rovai-preview-fragment-result', tabToken, bridgeToken, found }, '*');
    });
    document.currentScript?.remove();
  })();`
}

export function secureFilePreviewHtml({
  html,
  tabToken,
  bridgeToken,
  assetBasePath
}: {
  html: string
  tabToken: string
  bridgeToken: string
  assetBasePath: string
}): string {
  const document = new DOMParser().parseFromString(html, 'text/html')
  for (const base of document.querySelectorAll('base')) base.remove()
  for (const meta of document.querySelectorAll('meta[http-equiv]')) {
    const directive = meta.getAttribute('http-equiv')?.trim().toLocaleLowerCase('en-US')
    if (directive === 'refresh' || directive === 'content-security-policy') meta.remove()
  }
  rewriteStaticResources(document, tabToken, assetBasePath)
  const policy = document.createElement('meta')
  policy.setAttribute('http-equiv', 'Content-Security-Policy')
  policy.setAttribute('content', LOCKED_POLICY)
  document.head.prepend(policy)
  const bootstrap = document.createElement('script')
  bootstrap.textContent = bootstrapSource(tabToken, bridgeToken, assetBasePath)
  policy.after(bootstrap)
  return `<!doctype html>${document.documentElement.outerHTML}`
}
