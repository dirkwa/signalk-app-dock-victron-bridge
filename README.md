# Signal K App Dock — Victron Cerbo Bridge

Reverse-proxy bridge that exposes a [Victron Cerbo GX](https://www.victronenergy.com/panel-systems-remote-monitoring/cerbo-gx) (or any [Venus OS](https://github.com/victronenergy/venus) device) Remote Console as a Signal K webapp.

Once installed, the Cerbo's Remote Console appears in [App Dock](https://github.com/SignalK/app-dock)'s **Discover Installed Webapps** list and embeds cleanly inside the dock — no cross-origin / mixed-content / self-signed-cert headaches.

## Why this exists

Putting `http://venus.local/` directly into an iframe runs into three avoidable problems:

1. **Cross-origin** — the parent (Signal K) and the Cerbo are different origins, so the dock's full-screen double-tap gesture cannot see taps inside the iframe.
2. **Mixed content** — if Signal K is served over HTTPS, the browser blocks an HTTP iframe.
3. **Self-signed certs** — when users have manually configured HTTPS on the Cerbo, the browser refuses to embed it without a cert exception.

This plugin fixes all three by reverse-proxying the Cerbo through the Signal K server. The browser sees a single same-origin iframe; the certificate handling moves to the plugin's outbound HTTP client.

## Install

Via the Signal K App Store, or:

```bash
cd ~/.signalk
npm install signalk-app-dock-victron-bridge
```

Then in **Admin UI → Plugin Config → Victron Cerbo Bridge**:

- **Cerbo URL** — base URL of your Cerbo's **v1** Remote Console on the LAN, e.g. `http://192.168.1.50/gui-v1/` or `http://venus.local/gui-v1/`. Defaults to `http://venus.local/gui-v1/`.
- **Accept self-signed certificate** — only relevant if you have manually configured HTTPS on your Cerbo with a self-signed cert. Stock Venus OS serves plain HTTP and does not need this.

After enabling the plugin, open App Dock's plugin config and click **Discover Installed Webapps** — the Victron Cerbo Bridge will appear and can be reordered like any other dock app.

## v1 only — v2 (GUI-v2) is not supported

Venus OS ships two Remote Console UIs:

- **v1 (`/gui-v1/`)** — noVNC-based, the same UI the Cerbo's physical buttons launch. Works through this bridge.
- **v2 (`/gui-v2/`)** — Qt/WASM, prettier on mobile. **Does not work** through this bridge.

The v2 UI is a compiled WASM blob that hardcodes server-root paths (`/websocket-mqtt`, others) with no option to run under a sub-path. Reverse-proxying it would require Signal K to let plugins claim arbitrary root paths, which is a much bigger architectural change than the v1 bridge needs and would still leave the bridge fragile against firmware updates.

The proper fix would be Victron adding a sub-path option to the v2 build. If that lands, this bridge can support v2 trivially.

For now, point the bridge at the v1 URL (`/gui-v1/`) and you'll get the same Remote Console you see on the Cerbo's screen.

## How it works

The plugin registers itself as a `signalk-webapp` and mounts an HTTP + WebSocket proxy at `/plugins/signalk-app-dock-victron-bridge/`. The static webapp at `/<pkg>/` (which App Dock discovers) redirects to the proxy with the right WebSocket query parameters for the noVNC client.

The noVNC `/websockify` stream is forwarded as a WebSocket upgrade through Signal K's plugin upgrade hook (requires `signalk-server` with `Plugin.registerWithUpgrade` support).

Any `X-Frame-Options` or CSP `frame-ancestors` headers from the upstream are stripped on the way back so the response can be embedded. Stock Venus OS does not send these, but a user-installed nginx might.

## Compatibility

- Tested with Venus OS firmware **3.71** on a Cerbo GX, v1 Remote Console.
- Should work with any Venus OS device exposing the v1 Remote Console (CCGX, Cerbo, Cerbo S, Ekrano).
- Requires `signalk-server` with `Plugin.registerWithUpgrade` support (currently unreleased — see SignalK/signalk-server PR).

## License

[Apache-2.0](./LICENSE)
