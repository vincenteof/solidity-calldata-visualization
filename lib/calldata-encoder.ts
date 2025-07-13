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
  if ('components' in abiType) {
    // A tuple is dynamic if any of its components are dynamic.
    return (abiType.components || []).some(isDynamic)
  }
  return false
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
  argValues: unknown[] // argValues can be nested for structs
): EncodeResult {
  // 1. Parse Input
  const fullSignature = input.trim()
  const funcNameMatch = fullSignature.match(/^(.*?)\s*\(/)
  if (!funcNameMatch) {
    throw new Error('Invalid function signature')
  }
  const funcName = funcNameMatch[1]

  const argsStr = fullSignature.substring(
    fullSignature.indexOf('(') + 1,
    fullSignature.lastIndexOf(')')
  )

  // Use viem's parser to handle complex types like structs
  const abiParams = parseAbiParameters(argsStr)

  // Reconstruct the canonical signature for the selector, e.g., "transfer(address,uint256)"
  const getCanonicalSignatureForParams = (
    params: readonly AbiParameter[]
  ): string => {
    return params
      .map((p) => {
        if ('components' in p && p.type === 'tuple') {
          return `(${getCanonicalSignatureForParams(p.components)})`
        }
        if ('components' in p && p.type === 'tuple[]') {
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

  console.log('argValues: ', argValues)
  // 3. Encode Parameters
  const encodedParamsHex = encodeAbiParameters(abiParams, argValues).slice(2)

  // 4. Assemble Calldata
  const finalCalldata = selector + encodedParamsHex

  // 5. Build parts for visualization
  const parts: CalldataPart[] = [
    {
      name: 'Function Selector',
      type: 'bytes4',
      value: selector,
      description: `keccak256("${canonicalSignature}")`,
    },
  ]

  let headCursor = 0
  abiParams.forEach((param, i) => {
    const paramName = param.name || `Parameter ${i + 1}`
    const headData = encodedParamsHex.substring(headCursor, headCursor + 64)
    headCursor += 64

    if (isDynamic(param)) {
      const offset = parseInt(headData, 16)
      parts.push({
        name: `${paramName} (${param.type}) (offset)`,
        type: 'bytes32',
        value: `0x${headData}`,
        description: `Points to byte ${offset} in parameters data`,
      })
    } else {
      parts.push({
        name: `${paramName} (${param.type})`,
        type: 'bytes32', // Static elements always take 32 bytes
        value: `0x${headData}`,
      })
    }
  })

  const tailHex = encodedParamsHex.substring(headCursor)
  if (tailHex) {
    parts.push({
      name: 'Tail Data',
      type: 'bytes',
      value: `0x${tailHex}`,
      description: 'Concatenated data for all dynamic parameters',
    })
  }

  return {
    calldata: finalCalldata,
    parts: parts,
  }
}
