/**
 * Project Intelligence — Draft PRD detail (FORA-501, Plan 1 §3.4).
 *
 * Renders the full DraftPrdView (all 11 sections) for one PRD.
 */

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getDraftPrd } from "@/lib/intelligence/data";
import {
  canAccessProjectIntelligence,
  type ProjectIntelligencePersona,
} from "@/lib/intelligence/rbac";
import { readPersonaFromCookieHeader } from "@/lib/auth";
import { DraftPrdView } from "@/components/intelligence/DraftPrdView";

export const dynamic = "force-dynamic";

export default async function DraftPrdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const persona: ProjectIntelligencePersona = readPersonaFromCookieHeader(
    cookieHeader,
  );

  if (!canAccessProjectIntelligence(persona)) notFound();

  const { id } = await params;
  const prd = await getDraftPrd(id);
  if (!prd) notFound();

  return (
    <div className="space-y-6" data-testid="draft-prd-page">
      <nav className="text-xs text-forge-300" aria-label="Breadcrumb">
        <a
          href="/project-intelligence"
          className="hover:text-forge-100"
          data-testid="draft-prd-back"
        >
          ← Project Intelligence
        </a>
      </nav>

      <DraftPrdView prd={prd} />
    </div>
  );
}