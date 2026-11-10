/* Start the app
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

if (window.SurveyAuth) {
  window.SurveyAuth.init();
} else {
  showDash();
}

/* Offline app shell. Browsers only expose service workers on https or localhost, so a
   phone reached through a LAN address like http://192.168.1.5:3000 stays online-only. */
if ('serviceWorker' in navigator) {
  if (window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => reg.update())
        .catch((error) => console.warn('[pwa] service worker failed to register', error.message));
    });
  } else {
    console.info('[pwa] offline mode needs https or localhost; serving over an insecure origin');
  }
}
