# GRE Review

Standalone GitHub Pages GRE app with opt-in private GitHub progress sync.

- Public files contain only the app and word list. Progress goes exclusively to a separate PRIVATE gre-review-data repository after user authorization.
- Use a fine-grained token restricted to that private repository with Contents read/write only. Never use an account password or an all-repositories token.
- The local unlock password never leaves the browser. The token is encrypted with PBKDF2-SHA256 (600000 iterations) and AES-GCM, and is sent only to api.github.com after unlock. Encryption does not protect against compromised same-origin scripts or an unlocked device. Revoke the token on GitHub if needed.
- Import the latest learning backup before initializing the private repository. Old cloud records are not removed.
- Private updates use GitHub SHA checks and three-way merging; conflicting changes require an explicit choice and retain a recovery backup.
- Exported authorization files contain encrypted credentials; keep them private and never commit them or learning backups.
- All learning rules, spaced retries, shortcuts and undo remain in place. The existing personal website is not modified.
