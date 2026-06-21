'use client';


import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  REGIONS,
  TIMEZONES,
  type TenantForm,
} from '@/lib/onboarding/data';

export interface StepTenantSetupProps {
  value: TenantForm;
  onChange: (next: TenantForm) => void;
}

export function StepTenantSetup({ value, onChange }: StepTenantSetupProps) {
  return (
    <section
      className="card space-y-4"
      data-testid="step-tenant-setup"
    >
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Tenant setup</h2>
        <p className="text-sm text-forge-300">
          Configure the tenant-level identity, region, and cost ceiling.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="tenant-name">Tenant name</Label>
          <Input
            id="tenant-name"
            value={value.tenantName}
            onChange={(e) => onChange({ ...value, tenantName: e.target.value })}
            data-testid="tenant-name"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="tenant-region">Region</Label>
          <Select
            value={value.region}
            onValueChange={(v) => onChange({ ...value, region: v })}
          >
            <SelectTrigger id="tenant-region">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REGIONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="tenant-tz">Default timezone</Label>
          <Select
            value={value.defaultTimezone}
            onValueChange={(v) => onChange({ ...value, defaultTimezone: v })}
          >
            <SelectTrigger id="tenant-tz">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="tenant-ceiling">Cost ceiling (USD/day)</Label>
          <Input
            id="tenant-ceiling"
            type="number"
            value={value.costCeilingUsd}
            onChange={(e) => onChange({ ...value, costCeilingUsd: e.target.value })}
            data-testid="tenant-ceiling"
          />
        </div>
      </div>

      <div className="grid gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.enableSandbox}
            onChange={(e) => onChange({ ...value, enableSandbox: e.target.checked })}
            data-testid="tenant-sandbox"
          />
          Enable sandbox runtimes
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.enableQuarantine}
            onChange={(e) => onChange({ ...value, enableQuarantine: e.target.checked })}
            data-testid="tenant-quarantine"
          />
          Auto-quarantine unhealthy connectors
        </label>
      </div>
    </section>
  );
}
