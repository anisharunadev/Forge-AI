## 🔒 Secret scan: **BLOCK** — 7 finding(s)

Merge is blocked. The scanner found credentials in this PR. The values are redacted below; rotate each credential before re-running the scan.

**Severity breakdown:** 🟥 CRITICAL: 4, 🟧 HIGH: 3

### 🟥 CRITICAL — AWS access key

- **Finding ID:** `finding-b34d0c6400`
- **Rule:** `fora-aws-access-key` (`gitleaks`)
- **File:** `src/example.py` (line 4)
- **Redacted match:** `[redacted:fpr=1a5d44:len=20:head=AK:tail=LE]`

**Remediation:** Revoke the IAM access key in the AWS console, then reference the secret via the Forge AI secrets MCP (`secret_ref`) and re-run the scanner.

### 🟥 CRITICAL — GitHub personal access token

- **Finding ID:** `finding-bfa5aab73e`
- **Rule:** `fora-github-pat` (`gitleaks`)
- **File:** `src/example.py` (line 7)
- **Redacted match:** `[redacted:fpr=9d6060:len=40:head=gh:tail=89]`

**Remediation:** Revoke the GitHub PAT in Settings → Developer settings → Personal access tokens. Reference secrets via the Forge AI secrets MCP (`secret_ref`).

### 🟥 CRITICAL — Stripe live key

- **Finding ID:** `finding-7aa41d7fa1`
- **Rule:** `fora-stripe-live-key` (`gitleaks`)
- **File:** `.env.example` (line 1)
- **Redacted match:** `[redacted:fpr=78a084:len=32:head=sk:tail=dc]`

**Remediation:** Roll the Stripe live key in the Stripe dashboard. Reference secrets via the Forge AI secrets MCP (`secret_ref`).

### 🟥 CRITICAL — OpenAI API key

- **Finding ID:** `finding-bb36f4963d`
- **Rule:** `fora-openai-api-key` (`gitleaks`)
- **File:** `.env.example` (line 3)
- **Redacted match:** `[redacted:fpr=a00a8c:len=73:head=sk:tail=YZ]`

**Remediation:** Revoke the OpenAI API key in the OpenAI console. Reference secrets via the Forge AI secrets MCP (`secret_ref`).

### 🟧 HIGH — Slack token

- **Finding ID:** `finding-121baa2d12`
- **Rule:** `fora-slack-token` (`gitleaks`)
- **File:** `.env.example` (line 2)
- **Redacted match:** `[redacted:fpr=e4b78f:len=51:head=xo:tail=Wx]`

**Remediation:** Rotate the Slack token in the Slack app dashboard. Reference secrets via the Forge AI secrets MCP (`secret_ref`).

### 🟧 HIGH — generic API key

- **Finding ID:** `finding-7c25ba325d`
- **Rule:** `trufflehog:AWS` (`trufflehog`)
- **File:** `src/example.py` (line 4)
- **Redacted match:** `[redacted:fpr=1a5d44:len=20:head=AK:tail=LE]`

**Remediation:** Revoke the leaked credential and reference it via the Forge AI secrets MCP (`secret_ref`).

### 🟧 HIGH — generic API key

- **Finding ID:** `finding-ddec5242c8`
- **Rule:** `trufflehog:Github` (`trufflehog`)
- **File:** `src/example.py` (line 7)
- **Redacted match:** `[redacted:fpr=9d6060:len=40:head=gh:tail=89]`

**Remediation:** Revoke the leaked credential and reference it via the Forge AI secrets MCP (`secret_ref`).

---
*Posted by the Forge AI Security Agent (Forge AI-74, sub-goal 5.1). Audit row: `evidence-992c0ad80bb7`.*