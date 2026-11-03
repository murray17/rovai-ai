// Standalone classic script; executed only inside the opaque Mermaid iframe.
// Keep this entry self-contained: no imports, eval or host APIs.
(() => {
  function installSandbox(channel, generation, maxTextSize, maxEdges) {
    const engine = window.mermaid
    const purifier = window.DOMPurify
    // Site-owned configuration only. Retain all upstream secure keys and protect
    // every known configuration section, including nested diagram overrides.
    const defaults = engine.mermaidAPI.defaultConfig
    const secure = [...new Set([...(defaults.secure ?? []), ...Object.keys(defaults), 'htmlLabels', 'dompurifyConfig', 'themeCSS'])]
    const fixed = { startOnLoad: false, securityLevel: 'strict', htmlLabels: false,
      suppressErrorRendering: true, maxTextSize, maxEdges, secure, theme: 'base',
      layout: 'dagre', look: 'classic' }
    engine.initialize(fixed)
    purifier.addHook('uponSanitizeAttribute', (_node, data) => {
      if ((data.attrName === 'href' || data.attrName === 'xlink:href') && !data.attrValue.startsWith('#')) data.keepAttr = false
    })
    let busy = false
    window.addEventListener('message', async (event) => {
      const request = event.data
      if (event.source !== parent || !request || request.channel !== channel || request.generation !== generation
        || request.type !== 'render' || !Number.isSafeInteger(request.id) || typeof request.source !== 'string'
        || !request.palette || typeof request.palette.darkMode !== 'boolean' || busy) return
      busy = true
      const container = document.createElement('div')
      document.body.append(container)
      try {
        if (request.source.length > maxTextSize) throw new Error('source-limit')
        const palette = request.palette
        if (![palette.background, palette.foreground, palette.line, palette.border, palette.fontFamily].every(value => typeof value === 'string')) throw new Error('palette')
        engine.initialize({ ...fixed, fontFamily: palette.fontFamily, themeVariables: {
          darkMode: palette.darkMode, fontFamily: palette.fontFamily, background: palette.background,
          primaryColor: palette.background, primaryTextColor: palette.foreground, primaryBorderColor: palette.border,
          secondaryColor: palette.background, secondaryTextColor: palette.foreground, secondaryBorderColor: palette.border,
          tertiaryColor: palette.background, tertiaryTextColor: palette.foreground, tertiaryBorderColor: palette.border,
          lineColor: palette.line, textColor: palette.foreground, mainBkg: palette.background,
          edgeLabelBackground: palette.background, clusterBkg: palette.background, clusterBorder: palette.border
        } })
        const result = await engine.render(`mermaid-${generation}-${request.id}`, request.source, container)
        const cleaned = purifier.sanitize(result.svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ['foreignObject', 'image', 'feImage', 'a', 'animate', 'animateMotion', 'animateTransform', 'set']
        })
        const doc = new DOMParser().parseFromString(cleaned, 'image/svg+xml')
        const svg = doc.documentElement
        const bounds = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/u).map(Number)
        if (svg.localName !== 'svg' || doc.querySelector('parsererror') || bounds?.length !== 4
          || !bounds.every(Number.isFinite) || bounds[2] <= 0 || bounds[3] <= 0) throw new Error('invalid-svg')
        // A standalone SVG image needs intrinsic dimensions for 100% reading.
        svg.setAttribute('width', String(Math.ceil(bounds[2])))
        svg.setAttribute('height', String(Math.ceil(bounds[3])))
        svg.style.maxWidth = 'none'
      svg.style.backgroundColor = palette.background
        parent.postMessage({ channel, generation, type: 'result', id: request.id, svg: new XMLSerializer().serializeToString(svg) }, '*')
      } catch {
        // Do not expose graph-controlled parse errors as HTML or UI copy.
        parent.postMessage({ channel, generation, type: 'result', id: request.id, error: true }, '*')
      } finally {
        container.remove()
        busy = false
      }
    })
    parent.postMessage({ channel, generation, type: 'ready' }, '*')
  }

  const data = document.currentScript.dataset
  installSandbox(data.channel, Number(data.generation), Number(data.maxTextSize), Number(data.maxEdges))
})()
