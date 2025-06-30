import { encodeAbiParameters, keccak256, stringToBytes, toHex } from 'viem'

// Helper to determine if a type is dynamic
const isDynamic = (type: string): boolean => {
  return type.endsWith('[]') || type === 'string' || type === 'bytes'
}

export interface CalldataPart {
  name: string
  type: string
  value: string
  description?: string
}

export interface EncodeResult {
  calldata: string
  parts: CalldataPart[]
}

export function encodeFunctionCall(
  input: string,
  argValues: any[]
): EncodeResult {
  const parts: CalldataPart[] = []

  // 1. Parse Input
  const fullSignature = input.trim()
  const funcNameWithTypes = fullSignature.substring(
    0,
    fullSignature.indexOf(')') + 1
  )
  const funcSignature = funcNameWithTypes.replace(/\s+\w+/g, '') // remove argument names

  const argsStr = fullSignature.substring(
    fullSignature.indexOf('(') + 1,
    fullSignature.lastIndexOf(')')
  )
  const argTypes = argsStr
    .split(',')
    .map((s) => s.trim().split(' ')[0])
    .filter((t) => t)

  // 2. Calculate Function Selector
  const selector = keccak256(stringToBytes(funcSignature)).slice(0, 10)
  parts.push({
    name: 'Function Selector',
    type: 'bytes4',
    value: selector,
    description: `keccak256("${funcSignature}")`,
  })

  // 3. Encode Parameters
  const head: string[] = []
  const tail: { type: string; value: string }[] = []
  let tailOffset = argTypes.length * 32
  const dynamicParams: { index: number; type: string; value: any }[] = []

  argTypes.forEach((type, i) => {
    if (isDynamic(type)) {
      head.push(toHex(tailOffset, { size: 32 }).slice(2))
      dynamicParams.push({ index: i, type, value: argValues[i] })
      parts.push({
        name: `Parameter ${i + 1} (offset)`,
        type: `bytes32`,
        value: toHex(tailOffset, { size: 32 }),
      })
      const encoded = encodeAbiParameters([{ type }], [argValues[i]])
      tailOffset += (encoded.length - 2) / 2 // length in bytes
    } else {
      const encoded = encodeAbiParameters([{ type }], [argValues[i]])
      head.push(encoded.slice(2)) // remove 0x prefix
      parts.push({ name: `Parameter ${i + 1}`, type, value: encoded })
    }
  })

  dynamicParams.forEach((param) => {
    const encodedFull = encodeAbiParameters(
      [{ type: param.type }],
      [param.value]
    )
    const encodedWithout0x = encodedFull.slice(2)

    // For dynamic types, the first 32 bytes (64 hex chars) is an internal offset.
    // We need to skip this internal offset to get the actual [length][data][padding] part.
    const actualTailData = encodedWithout0x.substring(64)

    // Add to tail (this is for the final calldata assembly)
    tail.push({ type: param.type, value: actualTailData })

    // For visualization, split actualTailData further
    const lengthPart = actualTailData.substring(0, 64)
    const dataAndPaddingPart = actualTailData.substring(64)

    parts.push({
      name: `Parameter ${param.index + 1} (tail - length)`,
      type: `uint256`, // Length is always uint256
      value: `0x${lengthPart}`,
      description: `Length of ${param.type} data`,
    })
    parts.push({
      name: `Parameter ${param.index + 1} (tail - data)`,
      type: param.type,
      value: `0x${dataAndPaddingPart}`,
      description: `Actual data and padding for ${param.type}`,
    })
  })

  // 4. Assemble Calldata
  const finalCalldata =
    selector + head.join('') + tail.map((t) => t.value).join('')

  return {
    calldata: finalCalldata,
    parts: parts,
  }
}
