// src/serviceWorkerRegistration.js
// This registers the service worker for offline/PWA capability.

export function register() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/service-worker.js")
        .then(reg => {
          console.log("✅ Service Worker registered: ", reg.scope);
        })
        .catch(err => {
          console.log("❌ Service Worker registration failed: ", err);
        });
    });
  }
}
