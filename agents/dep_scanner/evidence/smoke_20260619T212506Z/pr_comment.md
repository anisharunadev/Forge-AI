## 🔒 Dependency scan: **BLOCK** — 4 finding(s)

Merge is blocked. The scanner found CVEs in the PR's added or updated dependencies. Upgrade each package to the fixed version (or later) and re-run the scanner.

**Severity breakdown:** 🟨 MEDIUM: 2, 🟥 CRITICAL: 1, 🟧 HIGH: 1

### 🟥 CRITICAL — CVE-2022-3517

- **Finding ID:** `finding-a5ed8e06d8`
- **Scanner:** `trivy`
- **Package:** `minimatch` (`generic`) — installed `3.0.4`
- **Fixed in:** `3.0.5`
- **Title:** ReDoS in minimatch minimatch() function

**Remediation:** Upgrade the package to a fixed version and re-run the scanner.

### 🟧 HIGH — CVE-2022-22818

- **Finding ID:** `finding-45168a348d`
- **Scanner:** `trivy`
- **Package:** `django` (`PyPI`) — installed `3.2.0`
- **Fixed in:** `3.2.10`
- **Title:** {% debug %} template tag did not properly escape user-supplied input

**Remediation:** Upgrade with `pip install <pkg>==<fixed_version>` and re-run the scanner. Pin in `requirements.txt` / `pyproject.toml`.

### 🟨 MEDIUM — CVE-2021-33203

- **Finding ID:** `finding-dbd06f354b`
- **Scanner:** `trivy`
- **Package:** `django` (`PyPI`) — installed `3.2.0`
- **Fixed in:** `3.2.10`
- **Title:** Potential bypass of validation when uploading multiple files

**Remediation:** Upgrade with `pip install <pkg>==<fixed_version>` and re-run the scanner. Pin in `requirements.txt` / `pyproject.toml`.

### 🟨 MEDIUM — CVE-2020-28500

- **Finding ID:** `finding-bfb763a480`
- **Scanner:** `trivy`
- **Package:** `lodash` (`generic`) — installed `4.17.20`
- **Fixed in:** `4.17.21`
- **Title:** Command injection via template

**Remediation:** Upgrade the package to a fixed version and re-run the scanner.

---
*Posted by the FORA Dependency Scanner (FORA-76, sub-goal 5.2). Audit row: `evidence-ba5bea7650b9`. CycloneDX SBOM: `sbom-9a7ccc9a8cd2`.*