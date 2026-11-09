# Contributing

Please open a focused issue with reproduction steps and a proposed scope before
submitting a large change. Do not include credentials, personal data or customer
artifacts. For vulnerabilities use the private channel in SECURITY.md.

Use Node.js 22+, `npm ci`, `npm run typecheck`, `npm test`, `npm run test:local`
and `npm run build`. Integration tests use a separate database ending in `_test`.
Never run fixture setup or reset commands against a customer database.

KeRnCloud is source available, not OSI open source. Free public forks must obey
LICENSE, including source availability and the commercial restrictions. External
patches intended for the official commercial product require a separate written
contributor agreement before merge. A DCO sign-off does not grant exclusive
commercial rights. Do not submit code you cannot license appropriately.
