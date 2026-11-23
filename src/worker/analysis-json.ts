import type { Analysis } from '../core/contract'

const TARGET_CHARS = 32 * 1024

function* jsonParts(analysis: Analysis): Generator<string> {
  yield '{'
  let first = true
  for (const [key, value] of Object.entries(analysis)) {
    yield (first ? '' : ',') + JSON.stringify(key) + ':'
    first = false
    if (Array.isArray(value)) {
      yield '['
      for (let i = 0; i < value.length; i++) yield (i === 0 ? '' : ',') + JSON.stringify(value[i])
      yield ']'
    } else {
      yield JSON.stringify(value)
    }
  }
  yield '}'
}

/** Serialize the large result arrays incrementally, without materializing a full JSON string. */
export function analysisJson(analysis: Analysis): ReadableStream<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder()
  const parts = jsonParts(analysis)
  return new ReadableStream({
    pull(controller) {
      let chunk = ''
      while (chunk.length < TARGET_CHARS) {
        const next = parts.next()
        if (next.done) {
          if (chunk) controller.enqueue(encoder.encode(chunk))
          controller.close()
          return
        }
        chunk += next.value
      }
      controller.enqueue(encoder.encode(chunk))
    },
    cancel() { parts.return(undefined) },
  })
}
