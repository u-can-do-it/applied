import type { MetadataRoute } from 'next';

// The web app manifest (/manifest.webmanifest): what makes Jobwatch installable (Chrome on Android:
// menu → Add to Home screen), in its own window. Reachable without the login (proxy.ts): the browser
// fetches it without the cookie. The colours are app/globals.css's light --background; the icons
// are made by scripts/icons.ts.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Jobwatch',
    short_name: 'Jobwatch',
    description: 'Job offers from several boards, newest first',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f7f5',
    theme_color: '#f7f7f5',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
