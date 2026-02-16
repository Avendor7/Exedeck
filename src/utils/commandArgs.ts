export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function formatArgs(args: string[]): string {
  return args
    .map((arg) => {
      if (/\s/.test(arg)) {
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
  let quote: '"' | "'" | null = null

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]

    if (quote) {
      if (char === quote) {
        quote = null
      } else if (char === '\\' && i + 1 < input.length) {
        i += 1
        token += input[i]
      } else {
        token += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (token) {
        result.push(token)
        token = ''
      }
      continue
    }

    token += char
  }

  if (token) {
    result.push(token)
  }

  return result
}
