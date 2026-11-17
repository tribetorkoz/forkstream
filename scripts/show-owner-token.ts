import fs from 'node:fs'
import path from 'node:path'

const tokenPath = path.resolve(process.env.FORKSTREAM_API_TOKEN_FILE || path.join(process.cwd(), 'data', 'owner-token'))
if (process.env.FORKSTREAM_API_TOKEN) {
  console.log(process.env.FORKSTREAM_API_TOKEN)
} else if (fs.existsSync(tokenPath)) {
  console.log(fs.readFileSync(tokenPath, 'utf8').trim())
} else {
  console.error(`No owner token exists yet. Start ForkStream once, then run this command again. Expected file: ${tokenPath}`)
  process.exitCode = 1
}
