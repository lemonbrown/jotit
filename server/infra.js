export function registerEnvRoute(app) {
  app.get('/env.mjs', (_req, res) => {
    res.type('application/javascript').send(
      "const env = Object.freeze({});\nglobalThis.__JOTIT_ENV__ = env;\nexport { env };\nexport default env;\n"
    )
  })
}

export function registerSpaFallback(app, { distIndexFile }) {
  app.get('*', (req, res) => {
    if (req.path.includes('.')) {
      return res.status(404).type('text/plain').send('Not found')
    }
    res.sendFile(distIndexFile)
  })
}
