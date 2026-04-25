import authTests from './auth.test.js'
import searchUtilityTests from './search-utils.test.js'
import syncTests from './sync.test.js'
import searchServerTests from './search.server.test.js'
import attachmentTests from './attachments.test.js'
import publicSharingTests from './public-sharing.test.js'
import sqliteWorkspaceTests from './sqlite-workspace.test.js'
import openApiTests from './openapi.test.js'

const suites = [...authTests, ...searchUtilityTests, ...syncTests, ...searchServerTests, ...attachmentTests, ...publicSharingTests, ...sqliteWorkspaceTests, ...openApiTests]

let failures = 0

for (const [name, fn] of suites) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

if (failures) {
  process.exitCode = 1
} else {
  console.log(`PASS ${suites.length} tests`)
}
