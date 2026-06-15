# Contributing

Thanks for adding to the Mobile SSH plugin ecosystem!

## Ground rules (these are enforced in review)

1. **Plugins are interpreted JS + data only.** No compiled code (no `.dex`/`.jar`/`.so`/`.aar`),
   no downloading executable code at runtime. This is what keeps the host Play-compliant.
2. **Declare capabilities honestly.** Request the minimum set in `manifest.json`. The host gates every
   bridge call on a declared capability.
3. **Show what you run.** Every server command lives in `recipe.json` as a literal `run` string; the
   host displays it for user consent. Don't hide commands or fetch scripts to eval.
4. **No bundled secrets.** Never commit tokens/keys. Use `storage.putSecret` for anything sensitive.
5. **Disclose egress.** If you use `HTTP_INTERNET` (anything beyond the loopback tunnel), say so in the
   description and in the UI before sending user/terminal data off-device.

## Workflow

```bash
npm install
cp -r template-plugin plugins/<your-id>     # directory name = short slug
# edit manifest.json (id must be reverse-DNS), recipe.json, ui/
npm run check                                # regenerates catalog + validates manifests/recipes
```

Open a PR. CI runs `npm run check` and lints the UI JS. Core plugins are reviewed by maintainers
(see [GOVERNANCE.md](GOVERNANCE.md)); changes to `sdk/` or `schema/` require maintainer sign-off
(CODEOWNERS).

## Versioning

- Bump your plugin's `version` (semver) on every change.
- `minBridgeVersion` is the lowest `window.MobileSSH` version your plugin needs. Adding a bridge method
  is a MINOR host bump; removing/changing is MAJOR. Keep `minBridgeVersion` as low as your plugin allows.

## Testing locally

You can run a plugin's UI in a desktop browser by stubbing the native bridge — define
`window.__MobileSSHNative = { invoke(method,args){ /* mock */ } }` before loading `sdk/mobilessh.js`,
then your `ui/`. See [docs/testing.md](docs/testing.md).
