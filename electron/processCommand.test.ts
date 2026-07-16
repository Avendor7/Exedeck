import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { buildCmdCommandLine, escapeCmdArgument, resolvePtySpawnCommand } from './processCommand'

const execFileAsync = promisify(execFile)

describe('PTY command construction', () => {
  it('passes argv through unchanged on Unix platforms', () => {
    expect(resolvePtySpawnCommand('npm', ['run', 'dev'], 'linux')).toEqual({
      command: 'npm',
      args: ['run', 'dev'],
    })
  })

  it('uses one cmd command line on Windows so argv boundaries are preserved', () => {
    expect(
      resolvePtySpawnCommand(
        'node',
        ['script.js', '', 'two words', 'a&b', 'C:\\path with spaces\\'],
        'win32',
        'C:\\Windows\\System32\\cmd.exe',
      ),
    ).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/v:off',
        '/c',
        'node ^"script.js^" ^"^" ^"two^ words^" ^"a^&b^" ^"C:\\path^ with^ spaces\\\\^"',
      ],
    })
  })

  it('escapes quotes, trailing backslashes, and shell operators', () => {
    expect(escapeCmdArgument('say "hello"\\')).toBe(String.raw`^"say^ \^"hello\^"\\^"`)
    expect(buildCmdCommandLine('my tool.cmd', ['one|two'])).toBe('my^ tool.cmd ^"one^|two^"')
  })

  it.runIf(process.platform === 'win32')('preserves real argv values through cmd.exe', async () => {
    const expected = ['', 'two words', 'a&b', 'a|b', 'quoted"value', 'trailing\\']
    const spawn = resolvePtySpawnCommand(
      process.execPath,
      ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...expected],
      'win32',
    )

    const { stdout } = await execFileAsync(spawn.command, spawn.args, { windowsHide: true })
    expect(JSON.parse(stdout)).toEqual(expected)
  })
})
