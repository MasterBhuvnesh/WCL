# Security Policy

## Reporting a vulnerability

Report suspected vulnerabilities privately. Do not open a public GitHub
issue for a security problem.

Preferred: use GitHub's private vulnerability reporting for this
repository (the "Security" tab, "Report a vulnerability"). This requires
the repository owner to have private vulnerability reporting enabled;
if it is not available, contact one of the maintainers listed in
[CODEOWNERS](CODEOWNERS) directly.

Include a description of the issue, the affected component, and steps
to reproduce it.

There is no fixed SLA. As a best effort, expect an acknowledgement
within five business days and an assessment or remediation timeline
within fourteen.

## Scope

In scope:

- `app/api`: candidate and administrator authentication, exam session
  handling, grading, and rate limiting.
- `app/admin`, `app/hallticket`, `app/result`: the three Next.js
  applications.
- `app/client`: the Electron exam kiosk, including its auto-update
  mechanism.
- Infrastructure configuration in `terraform/` and the deployment
  workflows in `.github/workflows/`.

Examples of what we want to hear about:

- Authentication or session bypass, for candidates or administrators.
- Accessing another candidate's session, answers, or results.
- Any path that discloses a correct answer, another candidate's data,
  or exam content before it is authorized to be shown.
- Privilege escalation from a candidate token to an administrative
  action.
- Tampering with a session's deadline, score, or submission state.
- Bypassing the exam client's kiosk lockdown or device binding.
- Credentials, secrets, or infrastructure identifiers exposed in this
  repository.
- Vulnerabilities in the exam client's auto-update mechanism.

## Out of scope

- Testing against the live production deployment (`rbuexam.in` and its
  subdomains) while an exam is in progress. Use a local instance
  instead; see [README.md](README.md) for setup.
- Denial-of-service testing against any production endpoint.
- Social engineering, physical access to exam center hardware, or
  attacks on a candidate's personal device.
- Reports that require an already-compromised administrator account.
- Best-practice or hardening suggestions with no demonstrated impact.

## Test environment

Run the stack locally rather than against production; see the
"Running it locally" section of [README.md](README.md). A local
instance uses development-only defaults for every secret, so nothing
there is sensitive.

## Disclosure

We ask for a reasonable period to investigate and remediate before any
public disclosure, and will credit reporters who wish to be credited
once a fix has shipped.
