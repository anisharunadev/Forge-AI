## 🔒 Dependency scan: **BLOCK** — 6 finding(s)

Merge is blocked. The scanner found CVEs in the PR's added or updated dependencies. Upgrade each package to the fixed version (or later) and re-run the scanner.

**Severity breakdown:** 🟥 CRITICAL: 2, 🟧 HIGH: 2, 🟨 MEDIUM: 2

### 🟥 CRITICAL — CVE-2022-3517

- **Finding ID:** `finding-a0c2aabf99`
- **Scanner:** `trivy`
- **Package:** `minimatch` (`generic`) — installed `3.0.4`
- **Fixed in:** `3.0.5`
- **Title:** ReDoS in minimatch minimatch() function

**Remediation:** Upgrade the package to a fixed version and re-run the scanner.

### 🟥 CRITICAL — CVE-2022-3517

- **Finding ID:** `finding-7a3e57246b`
- **Scanner:** `dependabot`
- **Package:** `minimatch` (`npm`) — installed `package.json`
- **Fixed in:** `3.0.5`
- **Title:** minimatch ReDoS

**Remediation:** Upgrade with `npm install <pkg>@<fixed_version>` and re-run the scanner. Pin in `package.json`.

### 🟧 HIGH — CVE-2022-22818

- **Finding ID:** `finding-d554a1da13`
- **Scanner:** `trivy`
- **Package:** `django` (`PyPI`) — installed `3.2.0`
- **Fixed in:** `3.2.10`
- **Title:** {% debug %} template tag did not properly escape user-supplied input

**Remediation:** Upgrade with `pip install <pkg>==<fixed_version>` and re-run the scanner. Pin in `requirements.txt` / `pyproject.toml`.

### 🟧 HIGH — CVE-2022-22818

- **Finding ID:** `finding-0fc849f1e6`
- **Scanner:** `dependabot`
- **Package:** `django` (`PyPI`) — installed `requirements.txt`
- **Fixed in:** `3.2.10`
- **Title:** Django 3.2.0 before 3.2.10 — {% debug %} tag XSS

**Remediation:** Upgrade with `pip install <pkg>==<fixed_version>` and re-run the scanner. Pin in `requirements.txt` / `pyproject.toml`.

### 🟨 MEDIUM — CVE-2021-33203

- **Finding ID:** `finding-0a7141f82b`
- **Scanner:** `trivy`
- **Package:** `django` (`PyPI`) — installed `3.2.0`
- **Fixed in:** `3.2.10`
- **Title:** Potential bypass of validation when uploading multiple files

**Remediation:** Upgrade with `pip install <pkg>==<fixed_version>` and re-run the scanner. Pin in `requirements.txt` / `pyproject.toml`.

### 🟨 MEDIUM — CVE-2020-28500

- **Finding ID:** `finding-b9f035d93e`
- **Scanner:** `trivy`
- **Package:** `lodash` (`generic`) — installed `4.17.20`
- **Fixed in:** `4.17.21`
- **Title:** Command injection via template

**Remediation:** Upgrade the package to a fixed version and re-run the scanner.

---
*Posted by the FORA Dependency Scanner (FORA-76, sub-goal 5.2). Audit row: `evidence-1d6cabf38e00`. CycloneDX SBOM: `sbom-9a7ccc9a8cd2`.*