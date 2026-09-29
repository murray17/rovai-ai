# Rovai website

The public English and Chinese website is built with VitePress and deployed from this directory only. The homepage, download page, and 36 guide topics each have an English and Chinese URL. Public routes start at `/` and `/zh/`; VitePress uses `base: '/'` for `rovai.dev`.

## Local build

```sh
npm ci --prefix website
npm run build --prefix website
npm run preview --prefix website
```

`scripts/source/` contains the bilingual content and the approved homepage renderer from the local prototype. `scripts/generate.mjs` turns that content into 78 static VitePress pages before the build. Generated Markdown, build output, and caches are ignored. The deployment workflow uploads only `website/site/.vitepress/dist`.

`site/public/` contains the selected product images, diagrams, and Orbit teaching example. The prototype's review evidence, capture scripts, and local test data are not published. Existing core tutorial screenshots were captured with the local v0.4.0 app; the v0.4.1 download links and upgrade wording follow the published v0.4.1 release. Screenshots illustrate the documented workflow and are not a separate v0.4.1 visual acceptance result.

Deployment guides use the separately published Desktop 0.4.1 and Server 0.4.1 packages. Their real captures, historical 0.4.0 issue, and untested network/platform paths are recorded in [deployment-notes.md](deployment-notes.md). `scripts/source/docs-deployment.js` owns this group, preserving the existing `remote.html` route. Editable network diagrams live in `site/public/assets/diagrams/`, with example service/proxy files in `site/public/examples/deployment/`.

## Release and domain

Update the version and asset names in `scripts/source/site.js` when publishing a new desktop release, then verify those assets exist on GitHub Releases. The download page currently links to Desktop v0.4.1 for macOS arm64, macOS x64, and Windows x64, and Server server-v0.4.1 for macOS arm64/x64, Windows x64, and Linux x64 GNU. Update these independently; verify both Server release pointers, the release metadata, its assets and known-issue copy for a Server change.

GitHub Pages should use **GitHub Actions** as its source and have `rovai.dev` as its custom domain. Configure DNS at Cloudflare with the GitHub Pages apex A records and `www` CNAME; keep the domain verification TXT record. The workflow runs on changes under `website/` merged into `main`, and can also run manually. It does not build or publish the desktop app.
