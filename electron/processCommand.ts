export interface PtySpawnCommand {
  command: string
  args: string[]
}

const cmdMetaCharacters = /([()\][%!^"`<>&|;, *?])/g

/**
 * Escape one argv value for cmd.exe using the same rules as cross-spawn.
 * Every argument is quoted so empty values, whitespace, trailing slashes, and
 * shell metacharacters retain their argv boundaries.
 */
export function escapeCmdArgument(value: string): string {
  let escaped = value.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"').replace(/(?=(\\+?)?)\1$/, '$1$1')

  escaped = `"${escaped}"`
  return escaped.replace(cmdMetaCharacters, '^$1')
}

export function escapeCmdCommand(value: string): string {
  return value.replace(cmdMetaCharacters, '^$1')
}

export function buildCmdCommandLine(command: string, args: string[]): string {
  return [escapeCmdCommand(command), ...args.map(escapeCmdArgument)].join(' ')
}

export function resolvePtySpawnCommand(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  comSpec = process.env.ComSpec || 'cmd.exe',
): PtySpawnCommand {
  if (platform !== 'win32') {
    return { command, args: [...args] }
  }

  return {
    command: comSpec,
    args: ['/d', '/s', '/v:off', '/c', buildCmdCommandLine(command, args)],
  }
}
