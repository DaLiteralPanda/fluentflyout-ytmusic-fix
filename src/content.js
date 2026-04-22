/**
 * content.js — runs in the ISOLATED extension world.
 *
 * Receives metadata notifications from page-context.js and applies enriched
 * MediaMetadata (with full album artwork) to the active media session.
 *
 * Security properties:
 *  - Zero network requests. No fetch(), XHR, or WebSocket anywhere.
 *  - Artwork URLs are validated to only allow lh3.googleusercontent.com and
 *    i.ytimg.com — the two domains YouTube Music actually uses for thumbnails.
 *    Any other URL is rejected and no artwork is set.
 *  - CustomEvent payloads are validated field-by-field; unexpected fields are
 *    silently dropped. No eval(), no dynamic code execution.
 *  - The event name matches the unguessable name in page-context.js.
 *  - MutationObserver only reads textContent and img.src — it never writes to
 *    the DOM or executes any string as code.
 *  - All user-visible strings come from YouTube Music's own DOM, not from
 *    any external source.
 */

(() => {
  'use strict';

  const EVENT_NAME = '__ytm_rich_session_9f3a2c';

  // Allowlist of domains that YouTube Music legitimately uses for artwork.
  // Any thumbnail URL not matching these is rejected.
  const ALLOWED_ART_HOSTS = [
    'lh3.googleusercontent.com',
    'i.ytimg.com',
    'yt3.ggpht.com',
  ];

  // ─── State ──────────────────────────────────────────────────────────────────
  let lastTitle   = '';
  let lastArtist  = '';
  let lastArtwork = '';

  // ─── URL validation ─────────────────────────────────────────────────────────

  /**
   * Returns true only if the URL is HTTPS and the hostname is in our allowlist.
   * Rejects data: URIs, blob: URIs, relative paths, and any unknown host.
   */
  function isAllowedArtworkUrl(url) {
    if (typeof url !== 'string' || url.length === 0) return false;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') return false;
      return ALLOWED_ART_HOSTS.some(host => parsed.hostname === host);
    } catch {
      return false;
    }
  }

  /**
   * Rewrites a Google thumbnail URL to a specific size.
   * Only operates on already-validated URLs.
   */
  function resizeGoogleThumbnail(url, w, h) {
    return url.replace(/=w\d+-h\d+[^"'\s]*$/, `=w${w}-h${h}-l90-rj`);
  }

  /**
   * Validate and sanitise a plain string field from the event payload.
   * Returns an empty string if the value is not a non-empty string.
   */
  function safeString(value) {
    return (typeof value === 'string') ? value.trim() : '';
  }

  // ─── DOM helpers ────────────────────────────────────────────────────────────

  function getThumbnailFromDOM() {
    const playerBar = document.querySelector('ytmusic-player-bar');
    if (playerBar) {
      const img =
        playerBar.querySelector('#thumbnail img') ||
        playerBar.querySelector('ytmusic-thumbnail img') ||
        playerBar.querySelector('img.thumbnail');
      if (img?.src && isAllowedArtworkUrl(img.src)) {
        return resizeGoogleThumbnail(img.src, 512, 512);
      }
    }

    const fallback = document.querySelector(
      'ytmusic-player #song-image img, .ytmusic-player-bar img[src*="lh3.googleusercontent"]'
    );
    if (fallback?.src && isAllowedArtworkUrl(fallback.src)) {
      return resizeGoogleThumbnail(fallback.src, 512, 512);
    }

    return null;
  }

  // ─── Core: apply enriched metadata ──────────────────────────────────────────

  function applyRichMetadata({ title, artist, album, artworkUrl }) {
    if (!('mediaSession' in navigator)) return;

    const finalTitle  = safeString(title)  || safeString(navigator.mediaSession.metadata?.title);
    const finalArtist = safeString(artist) || safeString(navigator.mediaSession.metadata?.artist);
    const finalAlbum  = safeString(album)  || safeString(navigator.mediaSession.metadata?.album);

    // Validate the artwork URL before using it
    const validatedArt = (artworkUrl && isAllowedArtworkUrl(artworkUrl))
      ? artworkUrl
      : getThumbnailFromDOM();

    // Skip if nothing has changed
    if (
      finalTitle   === lastTitle &&
      finalArtist  === lastArtist &&
      validatedArt === lastArtwork
    ) return;

    lastTitle   = finalTitle;
    lastArtist  = finalArtist;
    lastArtwork = validatedArt ?? '';

    const artworkArray = validatedArt
      ? [
          { src: resizeGoogleThumbnail(validatedArt, 96,  96),  sizes: '96x96',   type: 'image/jpeg' },
          { src: resizeGoogleThumbnail(validatedArt, 128, 128), sizes: '128x128', type: 'image/jpeg' },
          { src: resizeGoogleThumbnail(validatedArt, 256, 256), sizes: '256x256', type: 'image/jpeg' },
          { src: resizeGoogleThumbnail(validatedArt, 512, 512), sizes: '512x512', type: 'image/jpeg' },
        ]
      : [];

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title:   finalTitle,
        artist:  finalArtist,
        album:   finalAlbum,
        artwork: artworkArray,
      });
    } catch {
      // Ignore — page may not have audio focus yet
    }
  }

  // ─── Event listener (from page-context.js) ──────────────────────────────────

  window.addEventListener(EVENT_NAME, (e) => {
    try {
      const raw = JSON.parse(e.detail);

      // Validate shape — only accept known string fields, drop everything else
      const data = {
        title:  safeString(raw?.title),
        artist: safeString(raw?.artist),
        album:  safeString(raw?.album),
      };

      // Short delay lets the DOM thumbnail update before we read it
      setTimeout(() => {
        applyRichMetadata({
          ...data,
          artworkUrl: getThumbnailFromDOM(),
        });
      }, 300);
    } catch {
      // Malformed payload — silently ignore
    }
  });

  // ─── MutationObserver fallback ───────────────────────────────────────────────

  function observePlayerBar() {
    const target = document.querySelector('ytmusic-player-bar') || document.body;

    const observer = new MutationObserver(() => {
      const titleEl  = document.querySelector(
        'ytmusic-player-bar .title, .ytmusic-player-bar .title.ytmusic-player-bar'
      );
      const artistEl = document.querySelector(
        'ytmusic-player-bar .byline a, .ytmusic-player-bar .byline'
      );

      const title  = safeString(titleEl?.textContent);
      const artist = safeString(artistEl?.textContent);

      if (title && title !== lastTitle) {
        applyRichMetadata({ title, artist, artworkUrl: getThumbnailFromDOM() });
      }
    });

    observer.observe(target, { childList: true, subtree: true, characterData: true });
  }

  // ─── Init ────────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observePlayerBar);
  } else {
    observePlayerBar();
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      setTimeout(() => applyRichMetadata({ artworkUrl: getThumbnailFromDOM() }), 500);
    }
  });
})();
