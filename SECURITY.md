# Security

## Supported versions

Security fixes are applied to the **latest published minor release** on the default development branch, subject to maintainer capacity. Use the current release from npm when deploying to production.

## Reporting a vulnerability

**Please do not** file a public GitHub issue for undisclosed security problems.

1. **Preferred:** use [GitHub Security Advisories](https://github.com/AshishViradiya153/s3download/security/advisories/new) for this repository (“Report a vulnerability”). That keeps details private until a fix is ready.
2. If you cannot use GitHub, contact the repository maintainers through a channel they publish on the repo or org profile.

Include as much of the following as you can:

- A short description of the impact (confidentiality, integrity, availability).
- Steps to reproduce, or a minimal proof of concept.
- Affected **s3-archive-download** version(s) and **Node.js** version.
- Whether you believe the issue is already exploitable in typical use or only under narrow conditions.

## Scope

**In scope** for this project:

- The **s3-archive-download** library and **CLI** code shipped in this repository (including optional entry points such as `s3-archive-download/platform`, `s3-archive-download/bullmq`, and cloud adapters when used as documented).
- Dependencies **only** insofar as we can mitigate by upgrading or changing our usage (we do not fix upstream AWS/GCP/Azure SDK bugs ourselves).

**Out of scope** (report to the vendor or project instead):

- Issues in **AWS**, **Google Cloud**, **Azure**, or other provider APIs or consoles.
- Compromise of **your** AWS credentials, IAM policies, or buckets outside what this library documents.
- Denial-of-service against **your** infrastructure that is not specific to a defect in s3-archive-download's code (for example generic high traffic without a bug).

## Disclosure

We aim to acknowledge receipt of valid reports in a reasonable time and to coordinate **embargoed** disclosure: we will work on a fix before public details are published when that is practical. Thank you for responsible disclosure.
