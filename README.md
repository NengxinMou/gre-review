# GRE Review

Standalone GitHub Pages GRE app with opt-in private GitHub progress sync.

- Public files contain only the app and word list. Progress goes exclusively to a separate PRIVATE gre-review-data repository after user authorization.
- Use a fine-grained token restricted to that private repository with Contents read/write only. Never use an account password or an all-repositories token.
- The local unlock password never leaves the browser. The token is encrypted with PBKDF2-SHA256 (600000 iterations) and AES-GCM, and is sent only to api.github.com after unlock. Encryption does not protect against compromised same-origin scripts or an unlocked device. Revoke the token on GitHub if needed.
- Import the latest learning backup before initializing the private repository. Old cloud records are not removed.
- Private updates use GitHub SHA checks and three-way merging; conflicting changes require an explicit choice and retain a recovery backup.
- Exported authorization files contain encrypted credentials; keep them private and never commit them or learning backups.
- All learning rules, spaced retries, shortcuts and undo remain in place. The existing personal website is not modified.

- Keep connected is off by default. On a trusted device, opting in stores token ciphertext and a non-exportable AES-GCM device key in IndexedDB, not the password. Same-origin scripts or someone using this browser can access the remembered authorization; device encryption is not protection against a compromised origin or unlocked device. Turning it off removes the device grant; removing authorization also removes the portable password vault.
- Each wrong answer resets that word's pending retries to three; each uncertain answer resets them to one. Pending old copies are replaced, not accumulated. Retries stay spaced and only the first correct recall of the study day can count toward mastery. Repeated failures may extend a round; it can always be ended manually.

- The verbal question bank contains four text-only questions transcribed from user-provided screenshots. Answer keys follow the red check marks; explanations are editorial notes based on the stems, not official solutions. Question practice records use a separate local browser key and separate export/import; they are not included in word-progress sync or word backups.

- Study time zone is a browser-local preference, defaulting to Asia/Shanghai regardless of the operating system. Select America/New_York for Atlanta. All day boundaries and calendar intervals use 04:00 in the selected IANA zone, including DST. Existing records and historical counters are not rewritten; due dates are interpreted from the last attempt and existing repetition interval. Choose the same study zone on other devices. This preference is not included in cloud sync or learning backups.
