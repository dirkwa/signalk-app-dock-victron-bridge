import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const pluginFactory = createRequire(__filename)('../index')

interface MockApp {
  debug: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  setPluginStatus: (msg: string) => void
  setPluginError: (msg: string) => void
}

function createMockApp(): MockApp {
  return {
    debug: () => {},
    error: () => {},
    setPluginStatus: () => {},
    setPluginError: () => {}
  }
}

describe('plugin identity', () => {
  it('returns the expected id and name', () => {
    const plugin = pluginFactory(createMockApp())
    assert.equal(plugin.id, 'signalk-app-dock-victron-bridge')
    assert.equal(plugin.name, 'Victron Cerbo Bridge')
  })

  it('has the required plugin interface methods', () => {
    const plugin = pluginFactory(createMockApp())
    assert.equal(typeof plugin.start, 'function')
    assert.equal(typeof plugin.stop, 'function')
    assert.equal(typeof plugin.registerWithRouter, 'function')
    assert.equal(typeof plugin.schema, 'object')
  })
})

describe('schema', () => {
  it('declares cerboUrl with sensible default', () => {
    const plugin = pluginFactory(createMockApp())
    const props = plugin.schema.properties
    assert.equal(props.cerboUrl.type, 'string')
    assert.equal(props.cerboUrl.default, 'http://venus.local/gui-v1/')
  })

  it('declares allowSelfSignedCert as opt-in boolean', () => {
    const plugin = pluginFactory(createMockApp())
    const props = plugin.schema.properties
    assert.equal(props.allowSelfSignedCert.type, 'boolean')
    assert.equal(props.allowSelfSignedCert.default, false)
  })

  it('requires cerboUrl', () => {
    const plugin = pluginFactory(createMockApp())
    assert.deepEqual(plugin.schema.required, ['cerboUrl'])
  })
})

describe('lifecycle', () => {
  it('start sets plugin status and stop clears proxy', () => {
    let status = ''
    const app = {
      ...createMockApp(),
      setPluginStatus: (msg: string) => {
        status = msg
      }
    }
    const plugin = pluginFactory(app)
    plugin.start({ cerboUrl: 'http://192.168.1.50' })
    assert.match(status, /192\.168\.1\.50/)
    plugin.stop()
  })

  it('mounts proxy under /ui and returns 503 before start', () => {
    const plugin = pluginFactory(createMockApp())

    const mounts: { path: string; handler: (req: unknown, res: unknown, next: unknown) => void }[] = []
    const router = {
      use: (path: string, handler: (req: unknown, res: unknown, next: unknown) => void) => {
        mounts.push({ path, handler })
      }
    }
    plugin.registerWithRouter(router)
    assert.equal(mounts.length, 1)
    assert.equal(mounts[0].path, '/ui')

    let statusCode = 0
    let body = ''
    const res = {
      status(code: number) {
        statusCode = code
        return this
      },
      send(b: string) {
        body = b
      }
    }
    mounts[0].handler({}, res, () => {})
    assert.equal(statusCode, 503)
    assert.match(body, /not started/i)
  })
})
