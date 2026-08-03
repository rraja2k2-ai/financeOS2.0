import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase";
import { projectRepository } from "@/repositories";
import { getProjectDetail } from "@/services/finance/project.service";
import { listCategoryMaster } from "@/services/finance/budget.service";
import { GENERIC_PROJECT_NAME } from "@/domain/project";
import { ProjectDetailView } from "@/components/projects/ProjectDetailView";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const project = await projectRepository.getById(supabase, id).catch(() => null);
  if (!project) notFound();

  const [detail, projects] = await Promise.all([getProjectDetail(supabase, id), projectRepository.list(supabase)]);

  // Category Master (Generic project) is the one source of truth for category names —
  // same list Capture/Review/Budget already read. Expense-type only: project lifetime
  // budgets track spending, never income.
  const genericProjectId = projects.find((p) => p.project_name === GENERIC_PROJECT_NAME)?.id ?? null;
  const categoryMaster = genericProjectId ? await listCategoryMaster(supabase, genericProjectId) : [];
  const categoryOptions = [...new Set(categoryMaster.filter((c) => c.categoryType === "expense").map((c) => c.primary))].sort();

  return <ProjectDetailView project={project} detail={detail} categoryOptions={categoryOptions} />;
}
