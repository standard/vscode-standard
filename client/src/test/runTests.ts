import * as path from 'path'
import * as fs from 'fs'
import { exec } from 'child_process'
import { runTests } from '@vscode/test-electron'

/**
 * Executes a shell command and return it as a Promise.
 * @param cmd {string}
 * @return {Promise<string>}
 */
async function execShellCommand (cmd: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error != null) {
        console.warn(error)
        reject(error)
      } else {
        resolve(stdout.length > 0 ? stdout : stderr)
      }
    })
  })
}

async function getDirectories (source: string): Promise<string[]> {
  return (await fs.promises.readdir(source, { withFileTypes: true }))
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
}

async function main (): Promise<void> {
  const testFixtures = await getDirectories(
    path.join(__dirname, '..', '..', 'testFixture')
  )
  for (const linter of testFixtures) {
    const extensionDevelopmentPath = path.resolve(__dirname, '..', '..', '..')
    const extensionTestsPath = path.resolve(__dirname, linter, 'index')
    const testWorkspace = path.resolve(
      __dirname,
      '..',
      '..',
      'testFixture',
      linter
    )
    process.chdir(testWorkspace)
    await execShellCommand('npm install')
    await runTests({
      version: 'stable',
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [testWorkspace, '--disable-extensions']
    })
  }
}

main().catch((err) => {
  console.error(err)
  console.error('Failed to run tests')
  process.exit(1)
})
