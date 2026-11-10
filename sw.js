/* Offline app shell for Survey Desk.
   Bump SHELL_VERSION whenever a file below is added, removed or renamed: that is what
   makes installed clients throw away the old cache. Content edits to an existing file
   are picked up by revalidation, so no bump is needed for those. */

const SHELL_VERSION = 'survey-desk-shell-v8';

const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/styles.css',
  '/vendor/html2pdf.bundle.min.js',
  '/vendor/docx.umd.js',
  '/assets/survey-desk-logo.svg',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/maskable-512.png',
  '/assets/icons/apple-touch-icon.png',
  '/js/platform.js',
  '/js/ai-config.js',
  '/js/auth.js',
  '/js/01-core.js',
  '/js/insurers-nepal.js',
  '/js/02-schema-motor.js',
  '/js/03-state-validation.js',
  '/js/04-rules-and-nav.js',
  '/js/05-form-fields.js',
  '/js/06-data-review.js',
  '/js/07-photos.js',
  '/js/08-case-actions.js',
  '/js/09-module-property.js',
  '/js/10-bills-final-report.js',
  '/js/11-dashboard.js',
  '/js/12-date-picker-bs.js',
  '/js/13-report-layout-helpers.js',
  '/js/14-app-shell.js',
  '/js/15-fonts-lmroman.js',
  '/js/16-export-docx-md.js',
  '/js/17-report-paginate.js',
  '/js/18-bills-ui.js',
  '/js/19-property-assessment.js',
  '/js/20-quick-capture.js',
  '/js/21-all-cases.js',
  '/js/22-header.js',
  '/js/23-third-parties.js',
  '/js/24-case-sync.js',
  '/js/25-assignments.js',
  '/js/26-documents.js',
  '/js/27-comments.js',
  '/js/28-place.js',
  '/js/99-main.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_VERSION)
      // allSettled, not addAll: one unavailable file must not abort the whole install
      .then((cache) =>
        Promise.allSettled(
          SHELL.map((url) => cache.add(url).catch(() => console.warn('[sw] precache missed', url)))
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Google OAuth and any other third party stays on the network
  if (url.origin !== self.location.origin) return;

  // Server data is per-user and must never be served from an offline cache
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') return;

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(offlineFirstNavigation(request, url));
    return;
  }

  event.respondWith(revalidateInBackground(request));
});

async function offlineFirstNavigation(request, url) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(SHELL_VERSION);
    await cache.put('/index.html', response.clone());
    await cache.put(url.pathname, response.clone());
    return response;
  } catch (error) {
    const cache = await caches.open(SHELL_VERSION);
    return (
      (await cache.match(url.pathname)) ||
      (await cache.match('/index.html')) ||
      (await cache.match('/')) ||
      new Response('Survey Desk is offline and this page was never cached.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' },
      })
    );
  }
}

async function revalidateInBackground(request) {
  const cache = await caches.open(SHELL_VERSION);
  const cached = await cache.match(request);

  const fresh = fetch(request)
    .then(async (response) => {
      if (response && response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) {
    // serve instantly, let the next load see the updated file
    fresh.catch(() => {});
    return cached;
  }

  const network = await fresh;
  if (network) return network;

  return new Response('', { status: 503, statusText: 'offline' });
}
