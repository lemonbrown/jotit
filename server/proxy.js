import { sendJsonError } from './http.js'

export function registerProxyRoute(app) {
  app.post('/proxy', async (req, res) => {
    const { url, method = 'GET', headers = {}, body } = req.body ?? {}

    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return sendJsonError(res, 400, 'url must be an http/https URL')
    }

    const t0 = Date.now()
    try {
      const opts = { method, headers }
      if (body && method !== 'GET' && method !== 'HEAD') opts.body = body

      const upstream = await fetch(url, opts)
      const elapsed = Date.now() - t0
      const bodyText = await upstream.text()
      const respHeaders = {}
      upstream.headers.forEach((value, key) => { respHeaders[key] = value })

      res.json({
        status: upstream.status,
        statusText: upstream.statusText,
        headers: respHeaders,
        body: bodyText,
        elapsed,
      })
    } catch (e) {
      res.status(502).json({ error: e.message ?? String(e), elapsed: Date.now() - t0 })
    }
  })
}
