import { IRouter, Request, Response, NextFunction } from 'express'
import { createProxyMiddleware, RequestHandler } from 'http-proxy-middleware'
import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import type { Socket } from 'net'

interface UpgradeHandler {
  (request: IncomingMessage, socket: Duplex, head: Buffer): void
}

interface UpgradeRouter {
  upgrade(pattern: string, handler: UpgradeHandler): void
}

interface App {
  debug: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  setPluginStatus: (msg: string) => void
  setPluginError: (msg: string) => void
}

interface Config {
  cerboUrl?: string
  allowSelfSignedCert?: boolean
}

const DEFAULT_CERBO_URL = 'http://venus.local/gui-v1/'

module.exports = (app: App) => {
  let proxy: RequestHandler | null = null
  let wsProxy: RequestHandler | null = null

  // Two proxies:
  //   - HTTP (`proxy`) targets the full configured URL, e.g.
  //     https://192.168.0.227/gui-v1/, so that asset paths under the UI
  //     resolve under that base.
  //   - WebSocket (`wsProxy`) targets the origin only, e.g.
  //     https://192.168.0.227/, because Cerbo's nginx serves the
  //     websockify endpoint at the root (/websockify), not under /gui-v1/.
  function buildProxies(config: Config): {
    http: RequestHandler
    ws: RequestHandler
  } {
    const fullTarget = (config.cerboUrl ?? DEFAULT_CERBO_URL).replace(/\/$/, '')
    const isHttps = fullTarget.startsWith('https://')
    const acceptInsecure = isHttps && config.allowSelfSignedCert
    const originTarget = new URL(fullTarget).origin

    const http = createProxyMiddleware({
      target: fullTarget,
      changeOrigin: true,
      // Stock Venus OS serves plain HTTP on port 80; secure:false only
      // matters when the user has manually fronted the Cerbo with HTTPS
      // using a self-signed cert.
      secure: !acceptInsecure,
      // Strip any frame-blocking headers the upstream might add. Stock
      // Venus OS doesn't send these, but a user-installed nginx might.
      on: {
        proxyRes: (proxyRes: IncomingMessage) => {
          delete proxyRes.headers['x-frame-options']
          const csp = proxyRes.headers['content-security-policy']
          if (typeof csp === 'string') {
            proxyRes.headers['content-security-policy'] = csp.replace(/frame-ancestors[^;]*;?\s*/gi, '')
          }
        }
      }
    })

    const ws = createProxyMiddleware({
      target: originTarget,
      changeOrigin: true,
      ws: true,
      secure: !acceptInsecure
    })

    return { http, ws }
  }

  const plugin = {
    id: 'signalk-app-dock-victron-bridge',
    name: 'Victron Cerbo Bridge',

    schema: {
      type: 'object',
      required: ['cerboUrl'],
      properties: {
        cerboUrl: {
          type: 'string',
          title: 'Cerbo URL',
          description:
            'Base URL of the v1 Remote Console on your LAN, e.g. http://192.168.1.50/gui-v1/ or http://venus.local/gui-v1/. v2 (gui-v2) is NOT supported — its WASM blob hardcodes server-root paths that cannot be reverse-proxied under a sub-path.',
          default: DEFAULT_CERBO_URL
        },
        allowSelfSignedCert: {
          type: 'boolean',
          title: 'Accept self-signed certificate',
          description:
            'Only relevant if you have manually configured HTTPS on your Cerbo with a self-signed cert. Stock Venus OS serves plain HTTP and does not need this.',
          default: false
        }
      }
    },

    start(config: Config) {
      try {
        const { http, ws } = buildProxies(config)
        proxy = http
        wsProxy = ws
        const target = config.cerboUrl ?? DEFAULT_CERBO_URL
        app.setPluginStatus(`Proxying ${target}`)
        app.debug('victron-bridge: proxying to %s', target)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        app.setPluginError(`Failed to start proxy: ${msg}`)
      }
    },

    stop() {
      proxy = null
      wsProxy = null
    },

    registerWithRouter(router: IRouter) {
      // Signal K's plugin host registers GET / (plugin metadata) and
      // /config on the same router before us, so we cannot mount the
      // proxy at root — it would be shadowed. Mount under /ui instead;
      // /<pkg>/index.html (the static webapp seen by App Dock's
      // discovery) redirects browsers here.
      router.use('/ui', (req: Request, res: Response, next: NextFunction) => {
        if (!proxy) {
          res.status(503).send('Victron Cerbo Bridge not started')
          return
        }
        proxy(req, res, next)
      })
    },

    // The Cerbo's noVNC client opens a WebSocket on the same origin to
    // talk to the websockify daemon. Express routers do not see HTTP
    // upgrade events, so we use the registerWithUpgrade hook (added in
    // signalk-server >= TBD) to receive the upgrade and hand it to
    // the dedicated WebSocket proxy. The WS proxy targets the Cerbo
    // origin only (not the /gui-v1/ subpath) because nginx on the Cerbo
    // serves websockify at the root, not under the UI path.
    registerWithUpgrade(upgrader: UpgradeRouter) {
      upgrader.upgrade('/ui', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (!wsProxy) {
          socket.destroy()
          return
        }
        // Strip both the SK plugin route prefix and our /ui mount prefix
        // so the path forwarded upstream is just /websockify (or
        // whatever sub-path the client requested under /ui).
        const url = request.url ?? '/'
        const stripped = url.replace(/^\/plugins\/[^/]+\/ui/, '') || '/'
        request.url = stripped
        wsProxy.upgrade(request, socket as Socket, head)
      })
    }
  }

  return plugin
}
