# Prepare a source release

This directory is a curated self-hosted export with a fresh local Git repository. It does not include the operator's SaaS marketing site, original Git history or customer database. English is the default; German documentation is optional.

Before publication:

1. Run `node scripts/release-check.mjs` and inspect the staged files. Configuration, backups, sessions, private keys, signing accounts and generated runtime data must stay excluded. The check covers common credential patterns and file hygiene, rather than every possible secret.
2. Confirm the intended repository owner and public URL. Do not expose the old private prototype's history. Public links should point to the actual self-hosted repository.
3. Keep LICENSE and third-party notices with the code. The custom Source Available license permits personal and internal use and reserves resale/paid hosting to written commercial permission from KeRn-WS. It is not an OSI open-source license. Preserve the rights and attribution of dependencies.
4. Check the illustrated README and setup guides. Images must use neutral examples, with no customer content or invented claims.
5. Build installers from this self-hosted root. Use the existing CI platform jobs; signing/notarization needs the owner's credentials. Record actual platform test coverage for each release. Do not advertise a platform artifact that has not been built.
6. Verify installer sizes, formats and SHA-256 hashes. Publish only explicitly listed artifacts in the operator's release catalog. Keep any private signing material outside both the repository and Docker build context.

The local source staging step does not create a remote repository, push changes, change repository visibility or publish a release. Those actions need an actual publication instruction and a confirmed destination.

The operator can mount a dedicated release directory read-only into its SaaS web app. That website offers direct downloads and links to this repository; the public self-hosted package contains the application instead of the SaaS sales website.
