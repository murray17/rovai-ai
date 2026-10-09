# Rovai website

The public English and Chinese website is built with VitePress and deployed from this directory only. The homepage, download page, and 36 guide topics each have an English and Chinese URL. Public routes start at `/` and `/zh/`; VitePress uses `base: '/'` for `rovai.dev`.

## Local build

```sh
npm ci --prefix website
npm run build --prefix website
npm run preview --prefix website
```

`scripts/source/` contains the bilingual content and the approved homepage renderer from the local prototype. `scripts/generate.mjs` turns that content into 78 static VitePress pages before the build. Generated Markdown, build output, and caches are ignored. The deployment workflow uploads only `website/site/.vitepress/dist`.

`site/public/` contains the selected product images, diagrams, and Orbit teaching example. The prototype's review evidence, capture scripts, and local test data are not published. Existing core tutorial screenshots were captured with the local v0.4.0 app; download links and upgrade wording follow the published v0.4.7 release. Screenshots illustrate the documented workflow and are not a separate v0.4.7 visual acceptance result.

Deployment guides use Desktop 0.4.7 and Server 0.4.7 from the same `v0.4.7` release and source commit. Their real captures, historical 0.4.0 issue, and untested network/platform paths are recorded in [deployment-notes.md](deployment-notes.md). `scripts/source/docs-deployment.js` owns this group, preserving the existing `remote.html` route. Editable network diagrams live in `site/public/assets/diagrams/`, with example service/proxy files in `site/public/examples/deployment/`.

## Release and domain

Update the version and asset names in `scripts/source/site.js` only after the complete unified release is published and its assets are publicly downloadable. The download page links to `v0.4.7`: Desktop for macOS arm64, macOS x64, and Windows x64; Server for macOS arm64/x64, Windows x64, and Linux x64 GNU. Verify versions, shared source SHA, release metadata and all download assets together. Promote `scripts/server-release-tag.txt` after publication; keep the legacy `scripts/server-channel.txt` fixed at `0.4.1` for older clients.

GitHub Pages should use **GitHub Actions** as its source and have `rovai.dev` as its custom domain. Configure DNS at Cloudflare with the GitHub Pages apex A records and `www` CNAME; keep the domain verification TXT record. The workflow runs on changes under `website/` merged into `main`, and can also run manually. It does not build or publish the desktop app.
