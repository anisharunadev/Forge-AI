# ACME customer standards

Tenant-owned override (Forge AI-411 / 0.8.4). This file shadows the seed
customer/standards.md for tenant acme. Tenant globex (which has
not overridden this file) continues to see the seed.

## Override reason
ACME requires SOC 2 Type II reporting controls (CC6.1, CC6.6, CC7.2)
to be inherited from the platform baseline, plus an explicit change
management audit trail on every deploy.
