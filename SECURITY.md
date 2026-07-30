# Security Policy

Valx Prose Writer is a local-first desktop writing app: a Rust/Tauri shell around
the OS webview, reading and writing plain files in a folder you pick. There is no
Valx server, no account system and no telemetry, so almost the entire attack
surface is on the user's own machine — the desktop shell, the file-system scope it
grants the webview, and the code that parses documents you import.

## Supported Versions

Valx ships as a single line of releases; there are no long-term-support branches.
Only the newest release gets security fixes, and a fix is published as a new
patch version rather than backported.

| Version                       | Supported          |
| ----------------------------- | ------------------ |
| 1.1.x (current release line)  | :white_check_mark: |
| 1.0.x                         | :x:                |
| < 1.0                         | :x:                |
| Unreleased branches (`android-port`, `macos-port`, `claude/*`) | :x: |

"Latest release" means the newest tag on the [releases page](https://github.com/natededforver/valx-writer/releases).
If you are more than one patch version behind, please reproduce on the latest
release before reporting — and if you cannot upgrade, say so in the report.

Self-built packages (including the Linux builds described in the README) are
supported only insofar as the bug is in this repository's source. Distro or
third-party repackages are not covered here; report those to whoever built them.

## Reporting a Vulnerability

**Do not open a public issue for a security bug.**

Report it privately through GitHub's private vulnerability reporting:

1. Go to <https://github.com/natededforver/valx-writer/security/advisories/new>
2. Fill in what you found. The report is visible only to the maintainer until an
   advisory is published.

If you cannot use GitHub advisories, open a public issue containing nothing but
the sentence "requesting a private security contact" — no details — and a private
channel will be arranged.

Please include, as far as you can:

- Version of Valx, operating system and version, and whether the build came from
  the releases page or was built from source.
- The webview engine, if it matters (WebView2 on Windows, WKWebView on macOS,
  WebKitGTK on Linux).
- Step-by-step reproduction, and a sample file if the bug involves an imported or
  opened document. Please note in the report that a file is attached and what it
  is meant to trigger.
- What an attacker gets out of it: file access outside the chosen workspace,
  arbitrary code execution, silent network egress, and so on.

### What to expect

| Stage | Timeline |
| --- | --- |
| Acknowledgement that the report was received | within 5 days |
| Initial assessment — accepted, needs more information, or declined | within 14 days |
| Progress updates while a fix is in development | every 14 days, or sooner on change |
| Fix released for a confirmed high-severity issue | target 30 days from confirmation |

Valx is maintained by one person as a non-commercial project, so these are honest
targets rather than a contractual SLA. If a deadline slips you will be told, not
left waiting.

**If the report is accepted:** the fix ships in the next patch release, and a
GitHub Security Advisory is published with a description of the issue, the
affected versions and the fixed version. You will be credited by whatever name or
handle you ask for, or left anonymous if you prefer. There is no bug bounty — this
project has no revenue.

**If the report is declined:** you get a written reason. Common ones are: the
behaviour is intentional and documented (see *Known and accepted* below), the
issue is in the OS webview or another upstream project and belongs there, or the
threat model requires an attacker who already has code execution as your user
account — at which point they do not need Valx.

### Disclosure

Please give the maintainer a chance to ship a fix before going public. Ninety days
from acknowledgement is a reasonable default, shorter by agreement once a release
is out, longer if we agree a fix is genuinely hard. Publishing early, or publishing
a working exploit against a version users are still running, is discouraged. If a
report goes unanswered past the timelines above, you are within your rights to
disclose.

## Scope

**In scope:**

- The Tauri/Rust shell in [`src-tauri/`](src-tauri/) — commands exposed over IPC,
  and the capability set in
  [`src-tauri/capabilities/default.json`](src-tauri/capabilities/default.json).
- Escapes from the chosen workspace: any path that lets the app read or write
  files outside the folder the user picked, including through symlinks, `..`
  segments, or the runtime scope extension performed by `set_workspace_root`.
- Anything that gets code or script running in the webview from content the user
  merely opened — a Markdown, HTML, `.docx` or ODT file, a pasted fragment, an
  embedded image or media reference.
- Document import and export paths and the third-party libraries they use
  (`mammoth`, `jszip`, `html2pdf.js`, `html-docx-js-typescript`, `file-saver`).
- Unexpected network traffic. Valx is meant to make no outbound requests at all;
  a build that phones anywhere is a bug worth reporting.
- Data left behind where the user would not expect it — note contents in
  temporary files, logs, or IndexedDB after a workspace is closed.
- The release and packaging scripts in [`scripts/`](scripts/) and the
  installer configuration, where they affect what lands on a user's disk.
- The site under [`site/`](site/), for anything that could compromise a visitor
  or misdirect a download.

**Out of scope:**

- Vulnerabilities in the OS webview itself (WebView2, WKWebView, WebKitGTK), in
  Rust crates, or in npm packages, where Valx only passes them through. Report
  those upstream; do tell us if Valx needs a version bump or a workaround, and
  that will be treated as a dependency-hygiene issue rather than a Valx
  vulnerability.
- Attacks that require an attacker to already run code as the user, or to have
  write access to the workspace folder or the installed application. Valx cannot
  defend a machine that is already compromised.
- Physical or local access to an unlocked machine; the app has no password, no
  lock screen and no at-rest encryption, by design.
- Whatever your sync provider does with the folder. If your workspace lives in a
  Drive/Dropbox/OneDrive directory, that service's security is between you and it.
- Missing hardening with no demonstrated impact — a header, a flag or a lint
  finding on its own. Show what it lets an attacker do.
- Reports produced solely by an automated scanner, without a reproduction.
- Denial of service through absurd input (a gigabyte-long single line, ten
  thousand notes) unless it corrupts or loses a user's file. Bug reports about
  those are still welcome as ordinary issues.
- Social engineering of the maintainer, and spam or abuse of the issue tracker.

## Known and accepted

These are deliberate trade-offs, documented so nobody spends time reporting them:

- **Release binaries are not code-signed.** Windows SmartScreen and macOS
  Gatekeeper will warn on first launch; the README says so. Signing certificates
  cost money this project does not have. Verify a download by building from
  source if that matters to you.
- **There is no auto-update.** Nothing in the app fetches or installs new
  versions, which also means a security fix reaches you only when you download
  the new release yourself. Watch the releases page.
- **Notes are stored as plain files with no encryption.** That is the point of the
  app — anything on your system that can read your documents folder can read your
  notes. Use full-disk encryption if you need it.
- **The user grants the workspace folder deliberately**, through a native folder
  picker, and the app then has full read/write access inside it, including hidden
  subdirectories. Access *within* the chosen folder is not a vulnerability;
  access *outside* it is.
- **`opener` can hand a path or an `https:`/`mailto:` URL to the OS** so that
  links and attachments open in your browser or default application. A link
  opening in your browser is expected behaviour; a link opening without any user
  action, or a scheme other than those, is not.

## Dependencies

Dependency updates are applied on a best-effort basis and land in ordinary
releases. If you find a known-vulnerable version pinned in
[`package.json`](package.json), [`package-lock.json`](package-lock.json) or
[`src-tauri/Cargo.toml`](src-tauri/Cargo.toml), a normal public issue is the right
place — unless you can show it is actually exploitable through Valx, in which case
use the private advisory flow above.

## Licence note

Valx is released under the Polyform Noncommercial 1.0.0 licence (see
[LICENSE](LICENSE)). Nothing in this policy grants permission to test against
anyone else's machine or data — test on your own installation only.
