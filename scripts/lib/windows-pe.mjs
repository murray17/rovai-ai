import { readFile } from 'node:fs/promises'

const PE_SIGNATURE = 0x00004550
const PE32_PLUS_MAGIC = 0x20b
const IMAGE_DIRECTORY_ENTRY_RESOURCE = 2

function assertRange(buffer, offset, length, label) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > buffer.length) {
    throw new Error(`${label} is outside the PE image`)
  }
}

function decodeResourceText(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le').replace(/\0+$/g, '')
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 128))
  const zeroOddBytes = [...sample].filter((value, index) => index % 2 === 1 && value === 0).length
  if (zeroOddBytes > sample.length / 4) return buffer.toString('utf16le').replace(/\0+$/g, '')
  return buffer.toString('utf8').replace(/^\uFEFF/, '').replace(/\0+$/g, '')
}

export async function inspectPortableExecutable(path) {
  const buffer = await readFile(path)
  assertRange(buffer, 0x3c, 4, 'DOS header')
  const peOffset = buffer.readUInt32LE(0x3c)
  assertRange(buffer, peOffset, 24, 'PE header')
  if (buffer.readUInt32LE(peOffset) !== PE_SIGNATURE) throw new Error('invalid PE signature')

  const machine = buffer.readUInt16LE(peOffset + 4)
  const sectionCount = buffer.readUInt16LE(peOffset + 6)
  const optionalHeaderSize = buffer.readUInt16LE(peOffset + 20)
  const optionalHeader = peOffset + 24
  assertRange(buffer, optionalHeader, optionalHeaderSize, 'PE optional header')
  const magic = buffer.readUInt16LE(optionalHeader)
  if (magic !== PE32_PLUS_MAGIC) throw new Error(`expected a PE32+ image, found magic 0x${magic.toString(16)}`)

  const sizeOfHeaders = buffer.readUInt32LE(optionalHeader + 60)
  const dataDirectories = optionalHeader + 112
  const resourceDirectory = dataDirectories + IMAGE_DIRECTORY_ENTRY_RESOURCE * 8
  assertRange(buffer, resourceDirectory, 8, 'PE resource data directory')
  const resourceRva = buffer.readUInt32LE(resourceDirectory)
  const resourceSize = buffer.readUInt32LE(resourceDirectory + 4)
  const sectionTable = optionalHeader + optionalHeaderSize
  const sections = []
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionTable + index * 40
    assertRange(buffer, offset, 40, 'PE section header')
    sections.push({
      virtualSize: buffer.readUInt32LE(offset + 8),
      virtualAddress: buffer.readUInt32LE(offset + 12),
      rawSize: buffer.readUInt32LE(offset + 16),
      rawOffset: buffer.readUInt32LE(offset + 20)
    })
  }

  const rvaToOffset = (rva, length = 1) => {
    if (rva < sizeOfHeaders) {
      assertRange(buffer, rva, length, 'PE header RVA')
      return rva
    }
    const section = sections.find((candidate) => (
      rva >= candidate.virtualAddress
      && rva + length <= candidate.virtualAddress + Math.max(candidate.virtualSize, candidate.rawSize)
    ))
    if (!section) throw new Error(`PE RVA 0x${rva.toString(16)} is not mapped by a section`)
    const offset = section.rawOffset + (rva - section.virtualAddress)
    assertRange(buffer, offset, length, 'PE section RVA')
    return offset
  }

  const resourceTypes = new Set()
  const resources = new Map()
  if (resourceRva !== 0 && resourceSize !== 0) {
    const resourceBase = rvaToOffset(resourceRva, Math.min(resourceSize, 16))
    const directoryEntries = (relativeOffset) => {
      const directory = resourceBase + relativeOffset
      assertRange(buffer, directory, 16, 'PE resource directory')
      const count = buffer.readUInt16LE(directory + 12) + buffer.readUInt16LE(directory + 14)
      assertRange(buffer, directory + 16, count * 8, 'PE resource entries')
      return Array.from({ length: count }, (_, index) => {
        const entry = directory + 16 + index * 8
        const name = buffer.readUInt32LE(entry)
        const target = buffer.readUInt32LE(entry + 4)
        return {
          id: (name & 0x80000000) === 0 ? name : null,
          isDirectory: (target & 0x80000000) !== 0,
          target: target & 0x7fffffff
        }
      })
    }
    const collect = (typeId, entry) => {
      if (entry.isDirectory) {
        for (const child of directoryEntries(entry.target)) collect(typeId, child)
        return
      }
      const dataEntry = resourceBase + entry.target
      assertRange(buffer, dataEntry, 16, 'PE resource data entry')
      const dataRva = buffer.readUInt32LE(dataEntry)
      const size = buffer.readUInt32LE(dataEntry + 4)
      const dataOffset = rvaToOffset(dataRva, size)
      const values = resources.get(typeId) ?? []
      values.push(buffer.subarray(dataOffset, dataOffset + size))
      resources.set(typeId, values)
    }
    for (const entry of directoryEntries(0)) {
      if (entry.id === null) continue
      resourceTypes.add(entry.id)
      collect(entry.id, entry)
    }
  }

  return {
    machine,
    machineHex: `0x${machine.toString(16).padStart(4, '0')}`,
    format: 'PE32+',
    resourceTypes: [...resourceTypes].sort((left, right) => left - right),
    manifests: (resources.get(24) ?? []).map(decodeResourceText)
  }
}
