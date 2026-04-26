const sseClients = new Set()

export function registerOpenFileRoutes(app) {
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    sseClients.add(res)
    req.on('close', () => sseClients.delete(res))
  })

  app.post('/api/notes/open-file', (req, res) => {
    const { content, fileName } = req.body ?? {}
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'content is required' })
    }

    if (sseClients.size === 0) {
      return res.json({ delivered: false })
    }

    const event = `data: ${JSON.stringify({ type: 'open-file', fileName, content })}\n\n`
    for (const client of sseClients) {
      client.write(event)
    }
    res.json({ delivered: true })
  })
}
