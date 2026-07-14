import { describe, expect, it } from 'vitest'
import { formatArgs, parseArgs } from './commandArgs'

describe('command argument helpers', () => {
  it('parses quoted values and escaped spaces', () => {
    expect(parseArgs('run dev --label "hello world" one\\ two')).toEqual([
      'run',
      'dev',
      '--label',
      'hello world',
      'one two',
    ])
  })

  it('preserves empty arguments and Windows-style paths', () => {
    expect(parseArgs('"" "C:\\Program Files\\Example"')).toEqual([
      '',
      'C:\\Program Files\\Example',
    ])
  })

  it('round trips arbitrary argument arrays', () => {
    const args = ['', 'plain', 'two words', 'a"quote', 'C:\\tools\\bin']
    expect(parseArgs(formatArgs(args))).toEqual(args)
  })
})
