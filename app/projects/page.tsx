import { createServerSupabaseClient } from "@/lib/supabase";
import { projectRepository } from "@/repositories";
import { getProjectSummaries } from "@/services/finance/project.service";
import { ProjectsView } from "@/components/projects/ProjectsView";

export default async function ProjectsPage() {
  const supabase = await createServerSupabaseClient();
  const projects = await projectRepository.list(supabase);
  const summaries = await getProjectSummaries(supabase, projects);

  // Newest first, but Generic always last (it's the system default, shown only via toggle).
  summaries.sort((a, b) => {
    if (a.project.project_name === "Generic") return 1;
    if (b.project.project_name === "Generic") return -1;
    return (b.project.created_at ?? "").localeCompare(a.project.created_at ?? "");
  });

  return <ProjectsView summaries={summaries} />;
}
