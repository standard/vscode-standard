# vscode-standardjs

VSCode extension to integrate [JavaScript Standard Style](https://github.com/feross/standard) into VSCode.

## How to use

1. Install vscode-standardjs extension
2. Install `standard` either globally or locally, the later is recommended
3. Set `"javascript.validate.enable": false` in VSCode `settings.json` to disable VSCode built-in validator

### Options

We give you some options to customize vscode-standardjs in [`settings.json`](https://code.visualstudio.com/docs/customization/userandworkspace).

* `standard.enable` - enable or disable JavaScript Standard Style, defaults to `true`.
* `standard.run` - run linter `onSave` or `onType`, defaults to `onType`.
* `standard.autoFixOnSave` - enable or disable auto fix on save. It is only available when VS Code's `files.autoSave` is either `off`, `onFocusChange` or `onWindowChange`. It will not work with `afterDelay`.
* `standard.nodePath` - use this setting if an installed `standard` package can't be detected.
* `standard.validate` - an array of language identifiers specify the files to be validated, defaults to `["javascript", "javascriptreact"]`.
* `standard.workingDirectories` - an array for working directories to be used.
* `standard.semistandard` - You can use `semistandard` if you set this option to `true`. **Just make sure you installed `semistandard` package instead of `standard`.**
* `standard.usePackageJson` - enable JavaScript Standard Style only when they are presented under your project root.
* `standard.options` - of course you can still configure `standard` itself with this setting, for example:

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

	 **But it's not recommended adding them in `settings.json` file, because the settings would be applied globally. You'd better set them per project in package.json file.**

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
	},
	"files.associations": {
		"*.vue": "html"
	},
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

## How to develop

1. Run `npm install` right under project root
2. Open project in VSCode
3. Run `watch` task to compile the client and server
4. To run/debug the extension use the `Launch Extension` launch configuration
5. To debug the server use the `Attach to Server` launch configuration

## How to package

1. Run `npm install`
2. Run `npm run package` to build a .vsix file, then you can install it with `code --install-extension vscode-standardjs.vsix`

## TODO

1. [ ] add tests