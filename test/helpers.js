export function createMockApp() {
  return {
    routes: {
      get: new Map(),
      post: new Map(),
      put: new Map(),
      delete: new Map(),
    },
    get(path, ...handlers) {
      this.routes.get.set(path, handlers)
    },
    post(path, ...handlers) {
      this.routes.post.set(path, handlers)
    },
    put(path, ...handlers) {
      this.routes.put.set(path, handlers)
    },
    delete(path, ...handlers) {
      this.routes.delete.set(path, handlers)
    },
  }
}

export function createMockResponse() {
  return {
    statusCode: 200,
    jsonBody: null,
    textBody: null,
    headers: {},
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.jsonBody = body
      return this
    },
    send(body) {
      this.textBody = body
      return this
    },
    type(contentType) {
      this.headers['content-type'] = contentType
      return this
    },
    sendFile(path) {
      this.textBody = path
      return this
    },
  }
}

export async function runHandlers(handlers, req, res) {
  let index = 0
  const next = async () => {
    const handler = handlers[index]
    index += 1
    if (!handler) return
    if (handler.length >= 3) {
      return handler(req, res, next)
    }
    return handler(req, res)
  }
  await next()
}
