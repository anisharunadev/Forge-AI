## 🔒 IaC scan: **BLOCK** — 3 finding(s)

Merge is blocked. The scanner found Infrastructure-as-Code misconfigurations in the PR's added or updated files. Fix each finding per the remediation hint and re-run the scanner.

**Severity breakdown:** 🟧 HIGH: 3

### 🟧 HIGH — `CKV_AWS_19`

- **Finding ID:** `finding-1b519a55ab`
- **Scanner:** `checkov`
- **Location:** `infra/main.tf:6` (`terraform`)
- **Title:** S3 Bucket does not have default encryption enabled.
- **Misconfiguration:** S3 Bucket does not have default encryption enabled.

**Remediation:** https://docs.bridgecrew.io/docs/s3_14-server-side-encryption#terraform

### 🟧 HIGH — `CKV_AWS_53`

- **Finding ID:** `finding-3c76c2205f`
- **Scanner:** `checkov`
- **Location:** `infra/main.tf:3` (`terraform`)
- **Title:** S3 Bucket has an ACL defined which allows public READ access.
- **Misconfiguration:** S3 Bucket has an ACL defined which allows public READ access.

**Remediation:** https://docs.bridgecrew.io/docs/s3_13-acl_1#terraform---acls

### 🟧 HIGH — `CKV_AWS_54`

- **Finding ID:** `finding-a8f1cf3a33`
- **Scanner:** `checkov`
- **Location:** `infra/main.tf:3` (`terraform`)
- **Title:** S3 Bucket does not have block public ACLs enabled.
- **Misconfiguration:** S3 Bucket does not have block public ACLs enabled.

**Remediation:** https://docs.bridgecrew.io/docs/s3_16-block-public-acls#terraform

---
*Posted by the Forge AI IaC Scanner (Forge AI-77, sub-goal 5.3). Audit row: `evidence-6bf587a2f2da`. Schema: `v1.0.0`.*