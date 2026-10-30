import { sessionAddress, validOrigin } from './wallet-session'

/** A signed session and same-origin browser request are required for state changes. */
export function authorizedMutation(request: Request) {
  const address = sessionAddress(request)
  return address && validOrigin(request) ? address : null
}

export class PayloadError extends Error {
  constructor(public readonly status: number, message: string) { super(message) }
}

/** Bound the actual bytes, including requests with a missing/incorrect Content-Length. */
export async function boundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = request.headers.get('content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new PayloadError(413, 'Request too large')
  if (!request.body) throw new PayloadError(400, 'JSON body required')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > maxBytes) { await reader.cancel(); throw new PayloadError(413, 'Request too large') }
      chunks.push(next.value)
    }
  } catch (error) {
    if (error instanceof PayloadError) throw error
    throw new PayloadError(400, 'Invalid request body')
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
  catch { throw new PayloadError(400, 'Invalid JSON') }
}

export function payloadResponse(error: unknown): Response {
  if (error instanceof PayloadError) return Response.json({ error: error.message }, { status: error.status })
  return Response.json({ error: 'Invalid request' }, { status: 400 })
}
