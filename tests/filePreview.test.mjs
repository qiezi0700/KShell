import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import ts from 'typescript'

const source = await readFile(new URL('../src/components/sftp/filePreview.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
const { decodePreviewBytes, encodePreviewText } = await import(moduleUrl)
const dialogContentSource = await readFile(
  new URL('../src/components/ui/dialog/DialogContent.vue', import.meta.url),
  'utf8',
)

test('解码 UTF-8 并保持可编辑', () => {
  const result = decodePreviewBytes(new TextEncoder().encode('你好\nKShell'))

  assert.equal(result.content, '你好\nKShell')
  assert.equal(result.encoding, 'UTF-8')
})

test('识别并保留 UTF-8 BOM', () => {
  const result = decodePreviewBytes(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]))
  const encoded = encodePreviewText(result.content, result.encoding)

  assert.equal(result.content, 'a')
  assert.deepEqual(Array.from(encoded), [0xef, 0xbb, 0xbf, 0x61])
})

test('识别并保留 UTF-16 LE 和 UTF-16 BE', () => {
  const littleEndian = decodePreviewBytes(Uint8Array.from([0xff, 0xfe, 0x41, 0x00]))
  const bigEndian = decodePreviewBytes(Uint8Array.from([0xfe, 0xff, 0x00, 0x41]))

  assert.equal(littleEndian.content, 'A')
  assert.equal(littleEndian.encoding, 'UTF-16 LE')
  assert.deepEqual(Array.from(encodePreviewText(littleEndian.content, littleEndian.encoding)), [0xff, 0xfe, 0x41, 0x00])
  assert.equal(bigEndian.content, 'A')
  assert.equal(bigEndian.encoding, 'UTF-16 BE')
  assert.deepEqual(Array.from(encodePreviewText(bigEndian.content, bigEndian.encoding)), [0xfe, 0xff, 0x00, 0x41])
})

test('拒绝包含 NUL 的非 UTF-16 文件', () => {
  assert.throws(
    () => decodePreviewBytes(Uint8Array.from([0x61, 0x00, 0x62])),
    /二进制/,
  )
})

test('拒绝无效 UTF-8 内容', () => {
  assert.throws(
    () => decodePreviewBytes(Uint8Array.from([0xc3, 0x28])),
    /编码/,
  )
})

test('DialogContent 将键盘等透传事件绑定到真实内容节点', () => {
  assert.match(dialogContentSource, /defineOptions\(\{ inheritAttrs: false \}\)/)
  assert.match(dialogContentSource, /const attrs = useAttrs\(\)/)
  assert.match(dialogContentSource, /<DialogContent[\s\S]*v-bind="mergeProps\(forwarded, attrs\)"/)
})
