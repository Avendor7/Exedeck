import { readFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const expectedTag = `v${packageJson.version}`
const actualTag = process.env.GITHUB_REF_NAME

if (actualTag && actualTag !== expectedTag) {
  throw new Error(`Release tag ${actualTag} does not match package version ${packageJson.version}.`)
}

function requireEnvironment(names, label) {
  const missing = names.filter((name) => !process.env[name])
  if (missing.length > 0) {
    throw new Error(`${label} requires these repository secrets: ${missing.join(', ')}`)
  }
}

if (process.platform === 'win32') {
  requireEnvironment(['CSC_LINK', 'CSC_KEY_PASSWORD'], 'Signed Windows releases')
}

if (process.platform === 'darwin') {
  requireEnvironment(['CSC_LINK', 'CSC_KEY_PASSWORD'], 'Signed macOS releases')
  const hasApiKey = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'].every((name) => process.env[name])
  const hasAppleId = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'].every((name) => process.env[name])
  if (!hasApiKey && !hasAppleId) {
    throw new Error(
      'Notarized macOS releases require either APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER or APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID.',
    )
  }
}

process.stdout.write(`Release prerequisites are valid for ${expectedTag} on ${process.platform}.\n`)
