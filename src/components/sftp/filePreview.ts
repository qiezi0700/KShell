export type PreviewEncoding = 'UTF-8' | 'UTF-8 BOM' | 'UTF-16 LE' | 'UTF-16 BE'

export interface DecodedPreview {
  content: string
  encoding: PreviewEncoding
}

export interface FilePreviewTarget {
  name: string
  path: string
  side: 'local' | 'remote'
  size: number
}

const UTF8_BOM = Uint8Array.from([0xef, 0xbb, 0xbf])
const UTF16_LE_BOM = Uint8Array.from([0xff, 0xfe])
const UTF16_BE_BOM = Uint8Array.from([0xfe, 0xff])

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((value, index) => bytes[index] === value)
}

function decode(bytes: Uint8Array, encoding: string): string {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes)
  } catch {
    throw new Error('无法识别文件编码，仅支持 UTF-8 或带 BOM 的 UTF-16 文本。')
  }
}

export function decodePreviewBytes(bytes: Uint8Array): DecodedPreview {
  if (startsWith(bytes, UTF8_BOM)) {
    return {
      content: decode(bytes.subarray(UTF8_BOM.length), 'utf-8'),
      encoding: 'UTF-8 BOM',
    }
  }
  if (startsWith(bytes, UTF16_LE_BOM)) {
    return {
      content: decode(bytes.subarray(UTF16_LE_BOM.length), 'utf-16le'),
      encoding: 'UTF-16 LE',
    }
  }
  if (startsWith(bytes, UTF16_BE_BOM)) {
    return {
      content: decode(bytes.subarray(UTF16_BE_BOM.length), 'utf-16be'),
      encoding: 'UTF-16 BE',
    }
  }
  if (bytes.includes(0)) {
    throw new Error('该文件包含二进制内容，不支持文本预览。')
  }
  return {
    content: decode(bytes, 'utf-8'),
    encoding: 'UTF-8',
  }
}

function encodeUtf16(content: string, isLittleEndian: boolean): Uint8Array {
  const result = new Uint8Array(2 + content.length * 2)
  result[0] = isLittleEndian ? 0xff : 0xfe
  result[1] = isLittleEndian ? 0xfe : 0xff
  const view = new DataView(result.buffer)
  for (let index = 0; index < content.length; index++) {
    view.setUint16(2 + index * 2, content.charCodeAt(index), isLittleEndian)
  }
  return result
}

export function encodePreviewText(content: string, encoding: PreviewEncoding): Uint8Array {
  if (encoding === 'UTF-16 LE') return encodeUtf16(content, true)
  if (encoding === 'UTF-16 BE') return encodeUtf16(content, false)

  const bytes = new TextEncoder().encode(content)
  if (encoding === 'UTF-8') return bytes

  const result = new Uint8Array(UTF8_BOM.length + bytes.length)
  result.set(UTF8_BOM)
  result.set(bytes, UTF8_BOM.length)
  return result
}

export function formatPreviewSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
