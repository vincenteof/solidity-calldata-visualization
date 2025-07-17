import {
  encodeAbiParameters,
  keccak256,
  stringToBytes,
  parseAbiParameters,
  type AbiParameter,
} from 'viem'

// Helper to determine if a type is dynamic
const isDynamic = (abiType: AbiParameter): boolean => {
  if (
    abiType.type.endsWith('[]') ||
    abiType.type === 'string' ||
    abiType.type === 'bytes'
  ) {
    return true
  }
  if ('components' in abiType && abiType.components) {
    return abiType.components.some(isDynamic)
  }
  return false
}

export interface CalldataPart {
  name: string
  type: string
  value: string
  description?: string
  components?: CalldataPart[] // For nested structs/dynamic types
}

export interface EncodeResult {
  calldata: string
  parts: CalldataPart[]
}

// This interface helps manage dynamic items before they are processed.
interface DynamicItem {
  param: AbiParameter
  name: string
  offset: number
}

/**
 * Pads a hex string to a full 32-byte word, according to its ABI type.
 * @param hex - The hex string (without '0x' prefix).
 * @param type - The ABI type string.
 * @returns The padded hex string (without '0x' prefix).
 */
const padTo32Bytes = (hex: string, type: string): string => {
  if (type.startsWith('uint') || type.startsWith('int') || type === 'address') {
    // Numeric types and addresses are padded on the left.
    return hex.padStart(64, '0')
  }
  if (type.startsWith('bytes') && !type.endsWith(']')) {
    // Fixed-size bytesN are padded on the right.
    return hex.padEnd(64, '0')
  }
  // Default for bytes32, etc.
  return hex
}

/**
 * Parses a chunk of data belonging to a single dynamic item.
 * @param param - The ABI definition for the dynamic item.
 * @param dataHex - The hex data for this item, starting from its own beginning.
 * @returns A list of CalldataPart breaking down this dynamic item.
 */
const parseDynamicData = (
  param: AbiParameter,
  dataHex: string
): CalldataPart[] => {
  if (param.type.endsWith('[]')) {
    const elementType = param.type.slice(0, -2)
    const length = parseInt(dataHex.substring(0, 64), 16)
    const parts: CalldataPart[] = [
      {
        name: 'length',
        type: 'uint256',
        value: `0x${dataHex.substring(0, 64)}`,
        description: `${length}`,
      },
    ]

    const itemsDataHex = dataHex.substring(64)
    let itemCursor = 0
    for (let i = 0; i < length; i++) {
      const itemHex = itemsDataHex.substring(itemCursor, itemCursor + 64)
      parts.push({
        name: `[${i}]`,
        type: elementType,
        value: `0x${padTo32Bytes(itemHex, elementType)}`,
      })
      itemCursor += 64
    }
    return parts
  }

  if (param.type === 'string' || param.type === 'bytes') {
    const length = parseInt(dataHex.substring(0, 64), 16)
    const data = dataHex.substring(64, 64 + length * 2)
    // For strings and bytes, the data is padded to a multiple of 32 bytes.
    const paddedData = data.padEnd(Math.ceil(data.length / 64) * 64, '0')

    return [
      {
        name: 'length',
        type: 'uint256',
        value: `0x${dataHex.substring(0, 64)}`,
        description: `${length}`,
      },
      {
        name: 'value',
        type: param.type === 'string' ? 'utf8' : 'hex',
        value: `0x${paddedData}`,
        description: `Original data: 0x${data}`,
      },
    ]
  } else if ('components' in param && param.components) {
    // It's a dynamic tuple, so we parse its contents flatly.
    // The breakdown will be nested inside the parent tail component.
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    const { headParts, tailParts } = buildFlatBreakdown(
      param.components,
      dataHex
    )
    return [...headParts, ...tailParts]
  }
  // Fallback for any other unhandled types
  return [
    {
      name: 'data',
      type: 'bytes',
      value: `0x${dataHex}`,
      description: 'Raw dynamic data',
    },
  ]
}

/**
 * Builds a flat breakdown of calldata, separating head and tail parts.
 * @param params - The ABI parameters for this level of encoding.
 * @param encodedDataHex - The encoded hex string for this level.
 * @returns An object containing separated head and tail parts.
 */
const buildFlatBreakdown = (
  params: readonly AbiParameter[],
  encodedDataHex: string
): { headParts: CalldataPart[]; tailParts: CalldataPart[] } => {
  const headParts: CalldataPart[] = []
  const dynamicItems: DynamicItem[] = []
  let headCursor = 0

  // First pass: process the head and collect dynamic items
  params.forEach((param, i) => {
    const paramName = param.name || `param${i}`

    if (isDynamic(param)) {
      const headSlotHex = encodedDataHex.substring(headCursor, headCursor + 64)
      const offset = parseInt(headSlotHex, 16)
      headParts.push({
        name: `${paramName} (${param.type})`,
        type: 'bytes32',
        value: `0x${headSlotHex}`,
        description: `Offset to data at byte ${offset}`,
      })
      dynamicItems.push({ param, name: paramName, offset })
      headCursor += 64 // Advance cursor by 1 slot (32 bytes = 64 hex chars)
    } else if (
      'components' in param &&
      param.type === 'tuple' &&
      param.components
    ) {
      // Static tuple: its components are inlined in the head.
      const tupleDataLength = param.components.length * 64 // Length in hex chars
      const staticTupleData = encodedDataHex.substring(
        headCursor,
        headCursor + tupleDataLength
      )
      const nested = buildFlatBreakdown(param.components, staticTupleData)
      headParts.push({
        name: `${paramName} (${param.type})`,
        type: 'tuple',
        value: `0x${staticTupleData}`,
        components: [...nested.headParts, ...nested.tailParts],
      })
      headCursor += tupleDataLength // Advance cursor by the length of the tuple data
    } else {
      // Simple static type
      const headSlotHex = encodedDataHex.substring(headCursor, headCursor + 64)
      headParts.push({
        name: `${paramName} (${param.type})`,
        type: 'bytes32',
        value: `0x${padTo32Bytes(headSlotHex, param.type)}`,
      })
      headCursor += 64 // Advance cursor by 1 slot
    }
  })

  // Sort dynamic items by their offset to process tail data in order
  dynamicItems.sort((a, b) => a.offset - b.offset)

  const tailParts: CalldataPart[] = []
  dynamicItems.forEach((item, i) => {
    const dataStart = item.offset * 2
    // The data for this item runs from its start to the start of the next item, or to the end.
    const nextItem = dynamicItems[i + 1]
    const dataEnd = nextItem ? nextItem.offset * 2 : encodedDataHex.length
    const itemDataHex = encodedDataHex.substring(dataStart, dataEnd)

    tailParts.push({
      name: `Tail for ${item.name}`,
      type: item.param.type,
      value: `(see components)`,
      description: `Data located at byte ${item.offset}`,
      components: parseDynamicData(item.param, itemDataHex),
    })
  })

  return { headParts, tailParts }
}

export function encodeFunctionCall(
  input: string,
  argValues: unknown[]
): EncodeResult {
  // 1. Parse Input
  const fullSignature = input.trim()
  const funcNameMatch = fullSignature.match(/^(.*)\s*\(/)
  if (!funcNameMatch) {
    throw new Error('Invalid function signature')
  }
  const funcName = funcNameMatch[1]
  const argsStr = fullSignature.substring(
    fullSignature.indexOf('(') + 1,
    fullSignature.lastIndexOf(')')
  )
  const abiParams = parseAbiParameters(argsStr)

  const getCanonicalSignatureForParams = (
    params: readonly AbiParameter[]
  ): string => {
    return params
      .map((p) => {
        if (p.type === 'tuple' && 'components' in p && p.components) {
          return `(${getCanonicalSignatureForParams(p.components)})`
        }
        if (p.type === 'tuple[]' && 'components' in p && p.components) {
          return `(${getCanonicalSignatureForParams(p.components)})[]`
        }
        return p.type
      })
      .join(',')
  }
  const canonicalParams = getCanonicalSignatureForParams(abiParams)
  const canonicalSignature = `${funcName}(${canonicalParams})`

  // 2. Calculate Function Selector
  const selector = keccak256(stringToBytes(canonicalSignature)).slice(0, 10)

  // 3. Encode Parameters
  const encodedParamsHex = encodeAbiParameters(abiParams, argValues).slice(2)

  // 4. Assemble Calldata
  const finalCalldata = selector + encodedParamsHex

  // 5. Build the flat breakdown
  const { headParts, tailParts } = buildFlatBreakdown(
    abiParams,
    encodedParamsHex
  )

  const allParts: CalldataPart[] = [
    {
      name: 'Function Selector',
      type: 'bytes4',
      value: selector,
      description: `keccak256("${canonicalSignature}")`,
    },
    ...headParts,
    ...tailParts,
  ]

  return {
    calldata: finalCalldata,
    parts: allParts,
  }
}
