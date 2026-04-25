export function sendJsonError(res, status, error) {
  return res.status(status).json({ error })
}

export function logServerError(prefix, error) {
  console.error(prefix, error?.message ?? error)
}
