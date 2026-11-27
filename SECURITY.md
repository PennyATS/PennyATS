# Security policy

PennyATS stores information about job candidates, so security reports are taken seriously.

## Reporting a vulnerability

Please **don't open a public issue** for security problems.

Report privately through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability**. Include what you found, how to reproduce it, and what an attacker could do with it.

You should get an acknowledgement within a few days. Once a fix is ready, it will be released and the report credited (unless you'd rather not be named).

## In scope

- Anything that lets someone see, change, or delete candidate data they shouldn't: authentication, session handling, role checks (for example an interviewer reaching jobs they aren't on), invite links, resume downloads, data exports.
- The public careers page and apply form.
- Personal data being sent to an AI provider when redaction is on and the docs say it shouldn't be.

## Out of scope

- Problems that need an attacker to already have admin access or access to the server, its environment variables, or the database.
- Weaknesses in a particular self-hosted deployment (missing HTTPS, an exposed database, an outdated Node or Postgres). See the deployment docs for guidance.
- Name detection in AI redaction. Redaction is pattern-based and is documented as not catching names.

## Verifying a release

Releases are built by [`.github/workflows/release.yml`](.github/workflows/release.yml) from a `v*` tag. Nothing is signed with a stored key: the workflow signs with [Sigstore](https://www.sigstore.dev) keyless signing, using GitHub's OIDC identity for that workflow run, and records [GitHub artifact attestations](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations). Each release has:

- the container image `ghcr.io/pennyats/pennyats:<version>`, signed, with build provenance and an SPDX SBOM attached as attestations;
- `pennyats-<tag>.tar.gz`, the source for the tag, with a Sigstore bundle (`.sigstore.json`) and provenance;
- `pennyats-image.spdx.json` and `pennyats-source.spdx.json` (SBOMs) and `SHA256SUMS`.

You need [cosign](https://docs.sigstore.dev/cosign/system_config/installation/) 2.x or later and the [GitHub CLI](https://cli.github.com). Replace `v0.1.0` with the release you are checking.

```sh
TAG=v0.1.0
IDENTITY="https://github.com/PennyATS/PennyATS/.github/workflows/release.yml@refs/tags/$TAG"
ISSUER=https://token.actions.githubusercontent.com

# Container image: signature, build provenance, and SBOM attestation
cosign verify "ghcr.io/pennyats/pennyats:${TAG#v}" --certificate-identity "$IDENTITY" --certificate-oidc-issuer "$ISSUER"
gh attestation verify "oci://ghcr.io/pennyats/pennyats:${TAG#v}" --repo PennyATS/PennyATS
gh attestation verify "oci://ghcr.io/pennyats/pennyats:${TAG#v}" --repo PennyATS/PennyATS --predicate-type https://spdx.dev/Document/v2.3

# Source archive and SBOMs
gh release download "$TAG" --repo PennyATS/PennyATS
sha256sum -c SHA256SUMS
cosign verify-blob "pennyats-$TAG.tar.gz" --bundle "pennyats-$TAG.tar.gz.sigstore.json" --certificate-identity "$IDENTITY" --certificate-oidc-issuer "$ISSUER"
gh attestation verify "pennyats-$TAG.tar.gz" --repo PennyATS/PennyATS
```

The identity check matters: it proves the artifact was signed by this repository's release workflow for that exact tag, not by someone else's workflow. The same commands run in the release workflow's `verify` job after every release. If you deploy by digest, use `ghcr.io/pennyats/pennyats@sha256:...` from the release notes.

## How the code is checked

- Pull requests run dependency review (new dependencies with known high or critical vulnerabilities fail), CodeQL (`security-extended` queries for TypeScript and the workflows), and TruffleHog secret scanning ([`.github/workflows/security.yml`](.github/workflows/security.yml)).
- Workflow actions are pinned to commit SHAs, and Dependabot ([`.github/dependabot.yml`](.github/dependabot.yml)) proposes updates to npm packages, actions, and Docker base images weekly.

## Supported versions

PennyATS is pre-1.0. Fixes go into the `main` branch; please run the latest version.
