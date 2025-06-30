'use client'

import { useState, useEffect } from 'react'
import { useDebounce } from '@uidotdev/usehooks'
import { encodeFunctionCall, CalldataPart } from '../lib/calldata-encoder'
import { ThemeToggle } from '../components/ThemeToggle'

export default function Home() {
  const [input, setInput] = useState('transfer(address,uint256)')
  const debouncedInput = useDebounce(input, 500) // 500ms delay

  const [encoded, setEncoded] = useState('')
  const [parts, setParts] = useState<CalldataPart[]>([])
  const [argTypes, setArgTypes] = useState<string[]>([])
  const [argValues, setArgValues] = useState<string[]>([])

  useEffect(() => {
    try {
      const argsStr = debouncedInput.substring(
        debouncedInput.indexOf('(') + 1,
        debouncedInput.lastIndexOf(')')
      )
      if (argsStr) {
        const types = argsStr
          .split(',')
          .map((s) => s.trim().split(' ')[0])
          .filter((t) => t)
        setArgTypes(types)
        setArgValues((currentValues) =>
          types.map((_, i) => currentValues[i] || '')
        )
      } else {
        setArgTypes([])
        setArgValues([])
      }
    } catch {
      setArgTypes([])
      setArgValues([])
    }
  }, [debouncedInput])

  const handleEncode = () => {
    try {
      // Convert string numbers to BigInt for viem
      const processedValues = argValues.map((val, i) => {
        const type = argTypes[i]
        if (type.includes('uint') || type.includes('int')) {
          try {
            return BigInt(val)
          } catch {
            return BigInt(0) // Default to 0 if input is not a valid number
          }
        }
        return val
      })

      const result = encodeFunctionCall(input, processedValues)
      setEncoded(result.calldata)
      setParts(result.parts)
    } catch (error) {
      console.error(error)
      setEncoded('Error parsing input. Please check the format.')
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

            {argTypes.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 border border-gray-200 rounded-lg bg-gray-100 dark:bg-gray-800 dark:border-gray-700">
                {argTypes.map((type, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <label
                      htmlFor={`arg-${i}`}
                      className="font-mono text-sm text-gray-600 dark:text-gray-400"
                    >
                      {type}
                    </label>
                    <input
                      id={`arg-${i}`}
                      value={argValues[i] || ''}
                      onChange={(e) => {
                        const newValues = [...argValues]
                        newValues[i] = e.target.value
                        setArgValues(newValues)
                      }}
                      className="w-full p-2 border border-gray-300 rounded-md bg-gray-50 text-gray-900 font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none transition dark:bg-gray-700 dark:text-gray-50 dark:border-gray-600"
                      placeholder={`Value for ${type}`}
                    />
                  </div>
                ))}
              </div>
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
