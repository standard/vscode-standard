# Changelog

## 2.1.3

- **Fix**: "Unable to locate the project file" after upgrading `ts-standard` to v12 ([#494](https://github.com/standard/vscode-standard/pull/494))
- **Fix**: "TypeError: callback is not a function" error message ([#465](https://github.com/standard/vscode-standard/issues/465))

## 2.1.2

- **Fix**: Publishing issue on the VSCode Marketplace ([#444](https://github.com/standard/vscode-standard/issues/444))

## 2.1.1

- **Fix**: Detect brackets in filename and **folders** ([#443](https://github.com/standard/vscode-standard/pull/443))

## 2.1.0

- **Feature**: Add support for `standard-engine@15` ([#376](https://github.com/standard/vscode-standard/pull/376))

## 2.0.1

- **Fix**: Crash if a `package.json` file does not have a `devDependencies` property. ([#310](https://github.com/standard/vscode-standard/pull/310))
- **Chore**: Add automated tests ([#297](https://github.com/standard/vscode-standard/pull/297))

## 2.0.0

- **Feature**: Better options default to reduce configurations overhead for users so that they can use the extension fast without too much configurations and still following "best practices" by encouraging local installation per project. ([#263](https://github.com/standard/vscode-standard/pull/263))

Now the extension will be automatically be enabled in projects that has one of the engines (`standard`, `semistandard`, `standardx` or `ts-standard`) installed in `devDependencies` in `package.json`.

**Note**: This feature is only working if you have only **one** open folder in your VSCode workspace.

**Note 2**: If you still want to enable the extension globally you can set the new option : `"standard.enableGlobally": true` (by default it is set to `false`).

**BREAKING CHANGE**: This feature changed the default settings, before: `"standard.usePackageJson": false`, after: `"standard.usePackageJson": true`

**BREAKING CHANGE**: By default (if you don't set `"standard.enableGlobally": true`), the extension will not lint your files if you haven't got a `package.json` containing one of the engines installed in `devDependencies`.

## 1.5.1

- **Fix**: Find babel config files with `@babel/eslint-parser` ([#207](https://github.com/standard/vscode-standardjs/pull/207))

## 1.5.0

- **Feature**: Add `treatErrorsAsWarnings` to forces all warnings and errors from standard to become warnings ([#108](https://github.com/standard/vscode-standard/pull/108))
- **Fix**: Detect brackets in filename ([#126](https://github.com/standard/vscode-standard/pull/126) and [#139](https://github.com/standard/vscode-standard/pull/139))

## 1.4.0

- **Feature**: Add support for `ts-standard` ([#103](https://github.com/standard/vscode-standard/pull/103))

## 1.3.0

- **Feature**: Add support for `standardx`, and potentially more standard-engine based linters ([#71](https://github.com/standard/vscode-standard/pull/71))
- **Feature**: Add context standardEnabled ([#106](https://github.com/standard/vscode-standard/pull/106))
- **Fix**: Enable typescript by default ([#96](https://github.com/standard/vscode-standard/pull/96))

## 1.2.0

1. Add a new `usePackageJson` option to enable locally installed standard only.

## 1.1.8

1. Fix [bug](https://github.com/standard/vscode-standard/issues/37)
2. Update deps

## 1.1.7

1. Fix doc
2. Update icon

## 1.1.6

1. Fix vue doc

## 1.1.5

1. Fix `ignore` [bug](https://github.com/standard/vscode-standard/issues/22)

## 1.1.3

1. Add semistandard option, thanks to kutyel

## 1.1.2

1. Fix typo

## 1.1.1

1. Warn user the reason when StandardJS failed to lint

## 1.0.9

1. Update from upstream.
