/**
 * content.js — runs in the ISOLATED extension world.
 *
 * Receives metadata notifications from page-context.js and applies enriched
 * MediaMetadata (with full album artwork) to the active media session.
 *
 * Security properties:
 *  - Zero network requests. No fetch(), XHR, or WebSocket anywhere.
 *  - Artwork URLs are validated to only allow lh3.googleusercontent.com,
 *    i.ytimg.com and yt3.ggpht.com — the domains YouTube Music uses for art.
 *    Any other URL is rejected and no artwork is set.
 *  - CustomEvent payloads are validated field-by-field; unexpected fields are
 *    silently dropped. No eval(), no dynamic code execution.
 *  - The event name matches the unguessable name in page-context.js.
 *  - MutationObserver only reads textContent and img.src — it never writes to
 *    the DOM or executes any string as code.
 *  - All user-visible strings come from YouTube Music's own DOM, not from
 *    any external source.
 *
 * v1.2.1 — Added yt3.googleusercontent.com to allowlist (used after April 2026
 * redesign) and added .thumbnail-image-wrapper selector as fast-path.
 */

(() => {
  'use strict';

  const EVENT_NAME = '__ytm_rich_session_9f3a2c';

  // Allowlist of domains that YouTube Music legitimately uses for artwork.
  // Any thumbnail URL not matching these is rejected.
  const ALLOWED_ART_HOSTS = [
    'lh3.googleusercontent.com',
    'yt3.googleusercontent.com', // used by YTM after April 2026 redesign
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
    // Handle both =wN-hN style params and plain URLs
    if (url.includes('=w')) {
      return url.replace(/=w\d+-h\d+[^"'\s]*$/, `=w${w}-h${h}-l90-rj`);
    }
    // For ytimg.com style URLs (e.g. /vi/<id>/hqdefault.jpg) keep as-is
    // since they don't support the resize parameter
    return url;
  }

  /**
   * Validate and sanitise a plain string field from the event payload.
   * Returns an empty string if the value is not a non-empty string.
   */
  function safeString(value) {
    return (typeof value === 'string') ? value.trim() : '';
  }

  // ─── DOM helpers ────────────────────────────────────────────────────────────

  /**
   * Find the album art thumbnail from the YouTube Music player bar.
   *
   * Strategy: rather than using fragile class/id selectors that break when
   * Google redesigns the UI, we search broadly within the player bar for any
   * <img> whose src passes our allowlist check. We prefer larger images and
   * images closer to the player bar root.
   *
   * Selector tiers (tried in order, first valid URL wins):
   *  1. Specific known selectors (fast path — works until next redesign)
   *  2. Any <img> inside ytmusic-player-bar with an allowlisted src
   *  3. Any <img> anywhere on the page with an allowlisted src that looks
   *     like album art (square-ish natural dimensions, not a tiny icon)
   */
  function getThumbnailFromDOM() {
    const playerBar = document.querySelector('ytmusic-player-bar');

    // ── Tier 1: specific selectors (fast path) ───────────────────────────────
    if (playerBar) {
      const specificCandidates = [
        playerBar.querySelector('.thumbnail-image-wrapper img'), // Current selector as of April 2026 redesign
        playerBar.querySelector('#thumbnail img'),
        playerBar.querySelector('ytmusic-thumbnail img'),
        playerBar.querySelector('img.thumbnail'),
        playerBar.querySelector('img[src*="lh3.googleusercontent"]'),
        playerBar.querySelector('img[src*="yt3.googleusercontent"]'),
        playerBar.querySelector('img[src*="yt3.ggpht"]'),
        // New redesign selectors — added v1.2.0
        playerBar.querySelector('ytmusic-player-bar-background img'),
        playerBar.querySelector('.image-wrapper img'),
        playerBar.querySelector('.thumbnail-wrapper img'),
        playerBar.querySelector('[id*="thumbnail"] img'),
        playerBar.querySelector('[class*="thumbnail"] img'),
        playerBar.querySelector('[class*="cover"] img'),
        playerBar.querySelector('[class*="artwork"] img'),
      ];

      for (const img of specificCandidates) {
        if (img?.src && isAllowedArtworkUrl(img.src)) {
          return resizeGoogleThumbnail(img.src, 512, 512);
        }
      }

      // ── Tier 2: broad scan within player bar ─────────────────────────────
      // Walk all imgs in the player bar, pick the one with the largest area
      // that passes the allowlist — most likely to be album art, not an icon.
      const allImgs = Array.from(playerBar.querySelectorAll('img'));
      const validImgs = allImgs.filter(img => isAllowedArtworkUrl(img.src));

      if (validImgs.length > 0) {
        // Prefer larger images (album art) over small icons
        const best = validImgs.reduce((a, b) =>
          (b.naturalWidth * b.naturalHeight) > (a.naturalWidth * a.naturalHeight) ? b : a
        );
        if (best.src) return resizeGoogleThumbnail(best.src, 512, 512);
      }
    }

    // ── Tier 3: page-wide fallback ───────────────────────────────────────────
    // Last resort: find any large allowlisted image on the page.
    // Filter to images that are at least 48x48 to exclude nav icons.
    const pageImgs = Array.from(document.querySelectorAll('img'));
    const validPageImgs = pageImgs.filter(img =>
      isAllowedArtworkUrl(img.src) &&
      img.naturalWidth >= 48 &&
      img.naturalHeight >= 48
    );

    if (validPageImgs.length > 0) {
      const best = validPageImgs.reduce((a, b) =>
        (b.naturalWidth * b.naturalHeight) > (a.naturalWidth * a.naturalHeight) ? b : a
      );
      if (best.src) return resizeGoogleThumbnail(best.src, 512, 512);
    }

    return null;
  }

  /**
   * Find the song title and artist from the player bar.
   * Uses multiple selector tiers for the same resilience reason as above.
   */
  function getTextFromDOM() {
    const titleSelectors = [
      // Known selectors
      'ytmusic-player-bar .title',
      'ytmusic-player-bar .title.ytmusic-player-bar',
      // Broader fallbacks for redesigns
      'ytmusic-player-bar [class*="title"]:not([class*="subtitle"])',
      'ytmusic-player-bar .song-title',
      'ytmusic-player-bar .track-title',
      'ytmusic-player-bar yt-formatted-string.title',
    ];

    const artistSelectors = [
      // Known selectors
      'ytmusic-player-bar .byline a',
      'ytmusic-player-bar .byline',
      // Broader fallbacks
      'ytmusic-player-bar [class*="byline"]',
      'ytmusic-player-bar [class*="subtitle"]',
      'ytmusic-player-bar [class*="artist"]',
      'ytmusic-player-bar yt-formatted-string.byline',
    ];

    let title = '';
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      const text = safeString(el?.textContent);
      if (text) { title = text; break; }
    }

    let artist = '';
    for (const sel of artistSelectors) {
      const el = document.querySelector(sel);
      const text = safeString(el?.textContent);
      if (text) { artist = text; break; }
    }

    return { title, artist };
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
      const { title, artist } = getTextFromDOM();

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
