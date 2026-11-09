# Bridge server address (operator instructions)

The public server address is bundled in `server.json`; it contains no credentials.
Customers normally enter only their device name and enrollment key. Other server
addresses are available under Advanced settings. Existing saved server addresses
and credentials remain unchanged across updates.

Set `BRIDGE_DEFAULT_ORIGIN` to the public HTTPS origin when building releases.
The release scripts also accept `PUBLIC_URL` if `BRIDGE_DEFAULT_ORIGIN` is absent.
Without either environment variable they validate and retain `server.json`.
Only an origin is allowed, with no credentials, path, query or fragment.
HTTP is limited to loopback development; signed releases require HTTPS.
Do not use an internal Docker service URL or guess a production domain.

Example: `BRIDGE_DEFAULT_ORIGIN=https://cloud.example.com npm run package`.
The same configuration step runs before Windows signing and macOS signing /
notarization, so the installed code is not changed after signing. Linux repository
signing consumes already-built Debian packages: build them for the desired origin
first. Build separate versioned artifacts for different deployments; never replace
an already distributed release under the same filename. Verify the embedded
`resources/app/server.json` (macOS: `Contents/Resources/app/server.json`).

The checked-in loopback origin is for the local installation only. A deployment
must build and distribute packages configured for its actual public address.

Automatic updates are described in the internal UPDATES.md. Run prepare-updates.cjs before packaging. Include production dependencies in each package and preserve the update trust keys across versions.
