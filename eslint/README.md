# vscode-standardjs

VSCode extension to integrate [JavaScript Standard Style](https://github.com/feross/standard) into VSCode.

## How to use

You shall set `"javascript.validate.enable": false` in VSCode `settings.json` to disable VSCode built-in validator first.

### Options

You can add those options to [`settings.json`](https://code.visualstudio.com/docs/customization/userandworkspace).

* `standard.enable` - enable or disable JavaScript Standard Style, defaults to `true`.
* `standard.run` - run linter `onSave` or `onType`, defaults to `onType`.
* `standard.autoFixOnSave` - enable or disable auto fix on save. It is only available when VS Code's `files.autoSave` is either `off`, `onFocusChange` or `onWindowChange`. It will not work with `afterDelay`.
* `standard.nodePath` - use this setting if an installed `standard` package can't be detected.
* `standard.validate` - an array of language identifiers specify the files to be validated, defaults to `["javascript", "javascriptreact"]`.
* `standard.workingDirectories` - an array for working directories to be used.
* `standard.semistandard` - You can use `semistandard` if you set it `true`.
* `standard.options` - of course you can still configure `standard` with this setting, for example:

	```json
	"standard.options": {
		"globals": ["$", "jQuery", "fetch"],
		"ignore": [
			"node_modules/**"
		],
		"plugins": ["html"],
		"parser": "babel-eslint"
	}
	```

### Commands

* `Fix all auto-fixable problems` - applies JavaScript Standard Style auto-fix resolutions to all fixable problems.
* `Disable JavaScript Standard Style for this Workspace` - disables JavaScript Standard Style extension for this workspace.
* `Enable JavaScript Standard Style for this Workspace` - enable JavaScript Standard Style extension for this workspace.

### FAQ

1. How to lint `script` tag in vue or html files?

    You have to install `eslint-plugin-html` first, then enable the lint for those file types in `settings.json` with:

	```json
	"standard.validate": [
		"javascript",
		"javascriptreact",
		"html"
	],
	"standard.options": {
		"plugins": ["html"]
	}
	```
	If you want to enable `autoFix` for the new languages, you should enable it yourself:

	```json
	"standard.validate": [
		"javascript",
		"javascriptreact",
		{ "language": "html", "autoFix": true }
	],
	"standard.options": {
		"plugins": ["html"]
	}
	```