# Contributing to xl-vscode

The extension is licensed under the [Apache License 2.0](LICENSE). Unless you state otherwise, any contribution you submit is licensed under the same terms (Apache-2.0 §5).

## Rules

- The compiler (`xlc`) is the authority; the extension's parser only feeds IntelliSense. Keep `project.ts`, `toml.ts` and `parser.ts` free of `vscode` imports so `bun test` covers them.
- A new keyword, builtin, attribute, role, diagnostic code or compiler flag means updating the grammar, `builtins.ts`, `diagnosticCodes.ts`, snippets and the README in the same change.
- Do not change `version` in a feature or fix PR. Maintainers bump it in a dedicated release commit following [Semantic Versioning](https://semver.org), together with the `CHANGELOG.md` entry. Add your change to the `Unreleased` section of the changelog.

## Workflow

1. Fork, branch from `main`, keep the change focused.
2. Before opening a pull request:
   ```
   bun install
   bun run typecheck && bun test && bun run compile
   ```
   Press **F5** in VS Code to try the change in an Extension Development Host.
3. Open a pull request against `main` and fill in the template.

## Security and conduct

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
