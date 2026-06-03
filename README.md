# Bookmark Maker - Double-Sided Song Lyrics (React)

This is a static React app that generates the printable PDF directly in the browser.
No backend is required, which makes it ideal for Cloudflare Pages.

## Features

- 2-page PDF output for double-sided printing
- Page 1: 5 bookmark fronts (title + optional image)
- Page 2: 5 bookmark backs (lyrics) at matching coordinates
- Letter landscape layout (11 x 8.5 in)
- 5 bookmarks per sheet with centered 3-over-2 style by default
- Custom bookmark size, margins, rows/columns, lyric font size, and alignment
- Optional dashed cut lines and bookmark borders

## Local development

```powershell
cd c:\Users\Brockston King\Code\HomeUse\bookmark-maker
npm install
npm run dev
```

## Production build

```powershell
npm run build
```

Output folder: `dist`

## Deploy to Cloudflare Pages

1. Go to Cloudflare Dashboard > Workers & Pages > Create application > Pages.
2. Connect your GitHub repository: `brockstonking/bookmark-maker`.
3. Use these build settings:
	- Framework preset: `Vite`
	- Build command: `npm run build`
	- Build output directory: `dist`
4. Deploy.

After deployment, Cloudflare will provide a `*.pages.dev` URL.
