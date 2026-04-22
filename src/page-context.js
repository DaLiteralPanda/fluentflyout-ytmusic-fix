/**
 * page-context.js — runs in "world: MAIN" (the page's own JS context).
 *
 * Security notes:
 *  - No <script> tag injection. Chrome runs this file directly in the page
 *    context via the manifest "world": "MAIN" declaration, which is the
 *    safe, reviewed way to access page-level APIs like MediaMetadata.
 *  - No network requests of any kind.
 *  - No data leaves the browser tab. The CustomEvent only travels from this
 *    script to content.js, both of which live in the same tab.
 *  - The event name is a long, unguessable string to reduce the chance of
 *    another script on the page accidentally triggering it.
 */

(function () {
  'use strict';

  if (window.__ytmRichSessionPatched) return;
  window.__ytmRichSessionPatched = true;

  const OriginalMediaMetadata = window.MediaMetadata;
  if (!OriginalMediaMetadata) return;

  window.MediaMetadata = function (init) {
    // Always call the real constructor first — no behaviour change for the page
    const instance = new OriginalMediaMetadata(init || {});

    // Notify content.js about the new metadata.
    // We only pass the scalar fields (title, artist, album) — NOT the artwork
    // array from the page, because that's the thing Chrome strips anyway.
    // content.js will source artwork from the DOM instead.
    const safePayload = {
      title:  typeof init?.title  === 'string' ? init.title  : '',
      artist: typeof init?.artist === 'string' ? init.artist : '',
      album:  typeof init?.album  === 'string' ? init.album  : '',
    };

    window.dispatchEvent(new CustomEvent(
      '__ytm_rich_session_9f3a2c',   // unguessable name reduces spoofing risk
      { detail: JSON.stringify(safePayload) }
    ));

    return instance;
  };

  // Preserve prototype chain so `instanceof MediaMetadata` still works
  window.MediaMetadata.prototype = OriginalMediaMetadata.prototype;
  Object.defineProperty(window.MediaMetadata, 'name', { value: 'MediaMetadata' });
})();
