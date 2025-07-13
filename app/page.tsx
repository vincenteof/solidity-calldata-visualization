'use client'

import { useState, useEffect } from 'react'
import { useDebounce } from '@uidotdev/usehooks'
import { encodeFunctionCall, CalldataPart } from '../lib/calldata-encoder'
import { ThemeToggle } from '../components/ThemeToggle'
import { type AbiParameter, parseAbiParameters } from 'viem'

// Define a recursive type for argument values to avoid using 'any'
type Value = string | Value[] | bigint

// Recursive component to render inputs for ABI parameters
const ArgInputs = ({
  params,
  values,
  onValueChange,
}: {
  params: readonly AbiParameter[]
  values: Value[]
  onValueChange: (newValues: Value[]) => void
}) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 border border-gray-200 rounded-lg bg-gray-100 dark:bg-gray-800 dark:border-gray-700">
      {params.map((param, i) => {
        const paramName = param.name || `arg${i}`
        const paramType = param.type

        if ('components' in param && param.components) {
          return (
            <fieldset
              key={i}
              className="border border-gray-300 rounded-lg p-4 col-span-full dark:border-gray-600"
            >
              <legend className="px-2 font-mono text-sm text-gray-600 dark:text-gray-400">
                {paramName} ({paramType})
              </legend>
              <ArgInputs
                params={param.components}
                values={(values[i] as Value[]) || []}
                onValueChange={(newSubValues) => {
                  const newValues = [...values]
                  newValues[i] = newSubValues
                  onValueChange(newValues)
                }}
              />
            </fieldset>
          )
        }

        return (
          <div key={i} className="flex flex-col gap-1">
            <label
              htmlFor={`arg-${i}`}
              className="font-mono text-sm text-gray-600 dark:text-gray-400"
            >
              {paramName} ({paramType})
            </label>
            <input
              id={`arg-${i}`}
              value={(values[i] as string) || ''}
              onChange={(e) => {
                const newValues = [...values]
                newValues[i] = e.target.value
                onValueChange(newValues)
              }}
              className="w-full p-2 border border-gray-300 rounded-md bg-gray-50 text-gray-900 font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none transition dark:bg-gray-700 dark:text-gray-50 dark:border-gray-600"
              placeholder={`Value for ${paramType}`}
            />
          </div>
        )
      })}
    </div>
  )
}

// Helper to recursively process values, converting numbers to BigInt and strings to booleans
const processValues = (
  params: readonly AbiParameter[],
  values: Value[]
): unknown[] => {
  return values.map((val, i) => {
    const param = params[i]
    if ('components' in param && param.components) {
      return processValues(param.components, (val as Value[]) || [])
    }
    if (param.type.includes('uint') || param.type.includes('int')) {
      try {
        return BigInt(val as string)
      } catch {
        return BigInt(0) // Default to 0 if input is not a valid number
      }
    }
    if (param.type === 'bool') {
      return (val as string).toLowerCase() === 'true'
    }
    return val
  })
}

export default function Home() {
  const [input, setInput] = useState(
    'transferFrom(address from, address to, uint256 amount)'
  )
  const debouncedInput = useDebounce(input, 500) // 500ms delay

  const [encoded, setEncoded] = useState('')
  const [parts, setParts] = useState<CalldataPart[]>([])
  const [abiParams, setAbiParams] = useState<readonly AbiParameter[]>([])
  const [argValues, setArgValues] = useState<Value[]>([])

  useEffect(() => {
    try {
      const argsStr = debouncedInput.substring(
        debouncedInput.indexOf('(') + 1,
        debouncedInput.lastIndexOf(')')
      )
      const params = parseAbiParameters(argsStr)
      setAbiParams(params)

      // Reset values when params change, preserving structure
      const buildInitialValues = (p: readonly AbiParameter[]): Value[] =>
        p.map((c) =>
          'components' in c && c.components
            ? buildInitialValues(c.components)
            : ''
        )
      setArgValues(buildInitialValues(params))
    } catch {
      setAbiParams([])
      setArgValues([])
    }
  }, [debouncedInput])

  const handleEncode = () => {
    try {
      const processed = processValues(abiParams, argValues)
      const result = encodeFunctionCall(input, processed)
      setEncoded(result.calldata)
      setParts(result.parts)
    } catch (error: unknown) {
      console.error(error)
      const message = error instanceof Error ? error.message : String(error)
      setEncoded(
        `Error parsing input. Please check format. Details: ${message}`
      )
      setParts([])
    }
  }

  return (
    <div className="grid grid-rows-[auto_1fr_auto] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)] bg-gray-50 dark:bg-[#0d1117]">
      <main className="flex flex-col gap-8 w-full max-w-4xl row-start-2">
        <div className="flex justify-end w-full">
          <ThemeToggle />
        </div>
        <h1 className="text-2xl font-bold text-center text-gray-900 dark:text-white">
          Solidity Calldata Visualizer
        </h1>
        <div className="w-full max-w-4xl bg-white rounded-2xl p-8 shadow-lg border border-gray-200 dark:bg-gray-900 dark:border-gray-700">
          <div className="flex flex-col gap-4">
            <label
              htmlFor="input"
              className="font-medium text-gray-700 dark:text-gray-200"
            >
              Function Signature / Call
            </label>
            <textarea
              id="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50 text-gray-900 font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none transition dark:bg-gray-800 dark:text-gray-50 dark:border-gray-600"
              rows={3}
              placeholder="e.g., transfer(address to, uint256 amount)"
            />

            {abiParams.length > 0 && (
              <ArgInputs
                params={abiParams}
                values={argValues}
                onValueChange={setArgValues}
              />
            )}

            <button
              onClick={handleEncode}
              className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 active:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all transform hover:scale-105"
            >
              Encode
            </button>
          </div>
        </div>

        {encoded && (
          <div className="w-full max-w-4xl mt-8">
            <div className="bg-white rounded-2xl p-8 shadow-lg border border-gray-200 dark:bg-gray-900 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                Encoded Calldata
              </h2>
              <div className="p-4 bg-gray-100 rounded-lg text-green-700 font-mono break-all text-sm dark:bg-gray-800 dark:text-emerald-400">
                {encoded}
              </div>

              <h2 className="text-xl font-bold text-gray-900 dark:text-white mt-6 mb-4">
                Breakdown
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {parts.map((part, index) => (
                  <div
                    key={index}
                    className="p-4 bg-gray-100 rounded-lg flex flex-col gap-2 border border-gray-200 hover:border-blue-500 transition dark:bg-gray-800 dark:border-gray-700 dark:hover:border-blue-500"
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-gray-800 dark:text-gray-100">
                        {part.name}
                      </span>
                      <span className="text-xs px-2 py-1 bg-gray-200 text-gray-600 rounded-full dark:bg-gray-700 dark:text-gray-300">
                        {part.type}
                      </span>
                    </div>
                    <div className="font-mono text-green-700 break-all text-sm dark:text-emerald-400">
                      {part.value}
                    </div>
                    {part.description && (
                      <div className="text-xs text-gray-500 italic dark:text-gray-400">
                        {part.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
      <footer className="row-start-3 flex gap-4 items-center justify-center">
        <p className="text-gray-500 dark:text-gray-400">
          Built with Next.js and viem
        </p>
      </footer>
    </div>
  )
}
