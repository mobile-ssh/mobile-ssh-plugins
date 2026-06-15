# Governance

## License & trust tiers

All code in this repo is MIT-licensed. Plugins fall into two trust tiers:

- **Core plugins** (`plugins/`) — reviewed by maintainers, shipped in the app's bundled snapshot, and
  treated as part of the app's trust boundary. Held to the rules in [CONTRIBUTING.md](CONTRIBUTING.md).
- **Community plugins** — listed in the catalog but clearly labelled unreviewed; the bridge still gates
  capabilities and the user still consents to every recipe command.

## Review

- `sdk/` and `schema/` are the stable contract; changes require maintainer approval (CODEOWNERS) and a
  semver rationale (bridge compatibility is documented in `docs/bridge-api.md`).
- New plugins: a maintainer checks the capability set is minimal and honest, recipe commands are safe
  and shown to the user, there are no bundled secrets, and any internet egress is disclosed.

## Third-party / native plugins

This repo is for JS-in-WebView plugins only. Heavy native add-ons (e.g. an on-device LLM, or a native
resilient-terminal client) are first-party features of the host app, or a future documented
companion-APK track — not entries here.
