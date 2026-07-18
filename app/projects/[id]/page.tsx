import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase";
import { projectRepository } from "@/repositories";
import { getProjectDetail } from "@/services/finance/project.service";
import { ProjectDetailView } from "@/components/projects/ProjectDetailView";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const project = await projectRepository.getById(supabase, id).catch(() => null);
  if (!project) notFound();

  const detail = await getProjectDetail(supabase, id);

  return <ProjectDetailView project={project} detail={detail} />;
}
