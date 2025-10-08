# Security Policy

GEPAzilla aims to keep the optimizer safe for everyone experimenting with prompt engineering. We appreciate responsible disclosures and will work with reporters to address issues quickly.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| `main`  | ✅         |

At the moment we ship from the `main` branch and publish tagged releases as the project matures. If a particular release contains a security fix we will document it in the release notes and backport when practical.

## Reporting a Vulnerability

- Submit a private report through GitHub’s [security advisory](https://docs.github.com/code-security/security-advisories/working-with-repository-security-advisories/creating-a-repository-security-advisory) workflow and add `@brennanmceachran` as a collaborator so we see the report promptly.
- If the advisory workflow is unavailable to you, open a new issue marked “Security” and immediately request that a maintainer convert it to a private communication channel.
- Please do not open public GitHub issues for sensitive reports. We’ll acknowledge receipt within three business days and coordinate a fix and disclosure timeline.

### What to Include

- The affected commit or release (e.g., `main@<sha>` or `v0.x.y`)
- Impact summary and severity (e.g., data exposure, RCE, DoS)
- Steps to reproduce, including any required configuration
- Suggested remediation or patches if available

We will keep you informed about the fix status and coordinate a disclosure aligned with responsible vulnerability handling practices.
