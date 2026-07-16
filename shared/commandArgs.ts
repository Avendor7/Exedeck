export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function formatArgs(args: string[]): string {
  return args
    .map((arg) => {
      if (!arg || /[\s"']/.test(arg)) {
        return JSON.stringify(arg)
      }
      return arg
    })
    .join(' ')
}

export function parseArgs(value: string): string[] {
  const result: string[] = []
  const input = value.trim()
  if (!input) {
    return result
  }

  let token = ''
  let tokenStarted = false
  let quote: '"' | "'" | null = null

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]

    if (quote) {
      if (char === quote) {
        quote = null
      } else if (char === '\\' && i + 1 < input.length) {
        const next = input[i + 1]
        if (next === quote || next === '\\') {
          i += 1
          token += next
        } else {
          token += char
        }
      } else {
        token += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      tokenStarted = true
      continue
    }

    if (char === '\\' && i + 1 < input.length && /[\s\\"']/.test(input[i + 1])) {
      i += 1
      token += input[i]
      tokenStarted = true
      continue
    }

    if (/\s/.test(char)) {
      if (tokenStarted) {
        result.push(token)
        token = ''
        tokenStarted = false
      }
      continue
    }

    token += char
    tokenStarted = true
  }

  if (tokenStarted) {
    result.push(token)
  }

  return result
}
