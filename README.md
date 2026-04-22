# YouTube Music – Rich Media Session

A Chrome extension that fixes album art, artist name, and track metadata for YouTube Music in the browser — so apps like **[FluentFlyout](https://github.com/unchihugo/FluentFlyout)** display the full, beautiful flyout instead of just a Chrome logo.

## The problem

When you play music on [music.youtube.com](https://music.youtube.com), Chrome only forwards a bare minimum of metadata to the **Windows System Media Transport Controls (SMTC)** — the OS-level layer that media overlay apps read from. You get the song title, but no album art, no artist name, and no accent colours.

| Without this extension | With this extension |
| --- | --- |
| ![Chrome logo, no artist, no art](<./assets/images/before.png>) | ![Album cover, artist, accent colours](<./assets/images/after.png>) |
| Chrome logo, no artist, no art | Album cover, artist, accent colours |

This isn't a FluentFlyout bug. It's a Chrome limitation — Chrome strips artwork from the media session before passing it to Windows. YouTube Music sets the metadata correctly in the browser, but it never reaches the OS.

## What this extension does

- Intercepts every `MediaMetadata` write on `music.youtube.com`
- Reads the high-resolution album art directly from the YouTube Music player DOM
- Re-injects a complete, artwork-rich `MediaMetadata` object back into the media session
- Windows now receives the full track info → FluentFlyout (and any other SMTC-reading app) displays album cover, artist, and colours correctly

## Installation

### Chrome Web Store
> Coming soon

### Manual (Developer Mode)
1. Download the [latest release](../../releases/latest) and unzip it
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle, top right)
4. Click **Load unpacked** → select the unzipped folder
5. Play any song on [music.youtube.com](https://music.youtube.com) — done

## How it works

The extension is split into two scripts declared in the manifest:

- **`page-context.js`** runs in `"world": "MAIN"` — Chrome loads it directly into YouTube Music's JS context, so it can wrap the `MediaMetadata` constructor. Every time YouTube Music creates a new metadata object (on track change, play, etc.), this script captures the title, artist, and album fields and fires a custom event.

- **`content.js`** runs in the isolated extension world. It listens for that event, reads the current thumbnail URL directly from the player bar DOM, validates it against an allowlist of known Google CDN domains, and re-sets `navigator.mediaSession.metadata` with a full multi-size artwork array.

A `MutationObserver` on the player bar provides a secondary detection path for track changes that don't trigger a metadata re-write.

## Security

This extension was designed with security as a first-class concern:

- **Zero network requests.** No `fetch()`, `XHR`, `WebSocket`, or any outbound call. Nothing is sent anywhere.
- **Zero permissions.** The manifest declares `"permissions": []`. The only `host_permissions` is `music.youtube.com`.
- **No background worker.** The extension is entirely dormant until you open YouTube Music.
- **URL allowlist.** Artwork URLs are validated with `new URL()` and checked against a strict hostname allowlist (`lh3.googleusercontent.com`, `i.ytimg.com`, `yt3.ggpht.com`). Any other URL is rejected.
- **No dynamic code execution.** No `eval()`, no `innerHTML`, no `new Function()`, no `<script>` tag injection.
- **No dependencies.** Zero npm packages — pure vanilla JS with no build step and no supply chain.
- **Input validation.** All strings from the page are type-checked, trimmed, and only accepted if they are plain strings.

## Compatibility

- Chrome / Chromium, Manifest V3
- Windows 10/11
- Works with FluentFlyout, the native Windows media flyout, lock screen controls, and any app that reads from SMTC

## Contributing

Issues and PRs are welcome. If you find edge cases (radio stations, podcasts, music videos), please open an issue with steps to reproduce.

## License

MIT
