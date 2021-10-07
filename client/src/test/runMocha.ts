import * as path from 'path'
import * as Mocha from 'mocha'
import * as glob from 'glob'

export async function runMocha (testName: string): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true
  })
  mocha.timeout(100000)
  const testsRoot = __dirname

  return await new Promise((resolve, reject) => {
    glob(`**/${testName}.test.js`, { cwd: testsRoot }, (err, files) => {
      if (err != null) {
        return reject(err)
      }

      files.forEach(file => mocha.addFile(path.resolve(testsRoot, file)))

      try {
        mocha.run(failures => {
          if (failures > 0) {
            reject(new Error(`${failures} tests failed.`))
          } else {
            resolve()
          }
        })
      } catch (err) {
        console.error(err)
        reject(err)
      }
    })
  })
}
