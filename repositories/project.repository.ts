import type { SupabaseClient } from "@supabase/supabase-js";
import type { Project } from "@/domain/project";

export async function getById(supabase: SupabaseClient, id: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function list(supabase: SupabaseClient): Promise<Project[]> {
  const { data, error } = await supabase.from("projects").select("*");

  if (error) {
    throw error;
  }

  return data || [];
}

export async function insert(supabase: SupabaseClient, project: Omit<Project, "id" | "created_at" | "updated_at">): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .insert(project)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function update(supabase: SupabaseClient, id: string, project: Partial<Omit<Project, "id" | "created_at" | "updated_at">>): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .update(project)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function remove(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("projects").delete().eq("id", id);

  if (error) {
    throw error;
  }
}
