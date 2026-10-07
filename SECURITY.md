# Security and privacy

wAIt is an experimental local companion. A passed test suite is not a security certification.

## Data boundaries

- The standalone bridge listens on loopback and uses a generated bearer token. Requests with browser origins are rejected. Native messaging connects the browser extension to the bridge.
- The browser manifest contains a public RSA key to keep its unpacked extension ID stable. It is not a secret or a signing private key.
- Groq credentials are read from `GROQ_API_KEY` or a Windows user-encrypted file. The optional VS Code path uses VS Code SecretStorage.
- With `--share-context`, selected text, supported task prompts, or compact recent code diffs can be sent to Groq. Redaction catches common credential patterns; it cannot guarantee arbitrary source is secret-free.
- Lessons, session identifiers, and feedback are stored in local SQLite history. Generated lesson text may contain details of source you shared. The database is not encrypted by the application.
- The standalone bridge keeps raw teaching context and bounded hook diagnostics in memory. Local hook-status files contain delivery status. Never publish raw transcripts or private code to diagnose a bug.
- Instagram sign-in stays in the user's browser profile. The app does not copy cookies into the tutor. Feed controls are limited to its managed tab, though the extension requests access to Instagram pages.

## Keep local

Never commit `.env*`, raw API-key files, `.wait/`, `.wait-local/`, `.wait-setup/`, connection files, databases, logs, hook backups, personal agent configuration, or screenshots of private code. Build output can contain source maps and machine paths; publish reviewed source for the initial release.

Run `npm run audit:public` before staging, and `npm run audit:public -- --staged` after staging. These focused checks report filenames and categories, not secret values. Review the actual diff too; `.gitignore` does not protect already tracked files or files forced into Git.

## Reporting

Use GitHub's private vulnerability reporting if enabled for this repository. If it is unavailable, ask the maintainer for a private contact channel without posting the vulnerability details. Do not put credentials, exploitable details, or private source in a public issue or competition PR.

If a credential has been published, revoke/rotate it before cleaning history. Making a repository private again or deleting a file does not revoke an exposed credential.
