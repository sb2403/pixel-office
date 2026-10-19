// Checks each plugin in the marketplace against the plugin directory's pre-submission checklist
// (https://claude.com/docs/plugins/pre-submission-checklist), for the rules `claude plugin validate` does not cover.
// Run from the repository root: node scripts/check-listing.mjs
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MAX_FILE = 256 * 1024
const MAX_FILES = 512
const JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '__MACOSX'])
const IMAGE_OR_FONT = /\.(png|jpe?g|gif|webp|woff2?|ttf|otf)$/i

const marketplace = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'))
const problems = []

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = lstatSync(path)
    if (JUNK.has(name)) problems.push(`${path}: remove it`)
    if (stat.isSymbolicLink()) problems.push(`${path}: symlinks are not allowed`)
    else if (stat.isDirectory()) walk(path, files)
    else files.push({ path, size: stat.size })
  }
  return files
}

for (const plugin of marketplace.plugins) {
  const root = plugin.source
  const manifest = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'))

  let readme = ''
  try {
    readme = readFileSync(join(root, 'README.md'), 'utf8')
  } catch {
    problems.push(`${root}: no README.md in the plugin folder; the directory shows it as the listing`)
  }
  // Words in code blocks do not count toward the 40.
  const words = readme.replace(/```[\s\S]*?```/g, '').split(/\s+/).filter(w => /\w/.test(w)).length
  if (readme !== '' && words < 40) problems.push(`${root}/README.md: ${words} words, at least 40 needed outside code blocks`)

  const hasLicenseFile = readdirSync(root).some(name => /^LICEN[CS]E/i.test(name))
  if (!manifest.license && !hasLicenseFile) problems.push(`${root}: set "license" in plugin.json or add a LICENSE file`)
  for (const key of ['description', 'author', 'version']) {
    if (!manifest[key]) problems.push(`${root}: plugin.json has no "${key}"`)
  }

  const files = walk(root)
  if (files.length > MAX_FILES) problems.push(`${root}: ${files.length} files, at most ${MAX_FILES}`)
  for (const file of files) {
    if (file.size > MAX_FILE && !IMAGE_OR_FONT.test(file.path)) problems.push(`${file.path}: ${file.size} bytes, at most ${MAX_FILE}`)
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::${problem}`)
  process.exit(1)
}
console.log(`Ready for the plugin directory: ${marketplace.plugins.map(p => p.name).join(', ')}`)
