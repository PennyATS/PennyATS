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

## Supported versions

PennyATS is pre-1.0. Fixes go into the `main` branch; please run the latest version.
