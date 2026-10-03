import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { MapDoc } from "./types";

const LOCAL_DRAFT_KEY = "svit_map_draft";
const LOCAL_PUBLISHED_KEY = "svit_map_published";

export async function loadDraft(): Promise<{ id: string | null; doc: MapDoc | null }> {
  // 1. Check localStorage first so work is preserved locally without needing Supabase
  try {
    if (typeof window !== "undefined") {
      const raw = localStorage.getItem(LOCAL_DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.doc) {
          return { id: parsed.id ?? "local-draft", doc: parsed.doc as MapDoc };
        }
      }
    }
  } catch (e) {
    console.warn("Local storage draft check failed", e);
  }

  // 2. Fall back to Supabase if available
  try {
    const { data, error } = await supabase
      .from("map_documents").select("id, data").eq("kind", "draft")
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!error && data) {
      return { id: data.id ?? null, doc: (data.data as unknown as MapDoc) ?? null };
    }
  } catch (e) {
    // Supabase optional / not connected
  }

  return { id: null, doc: null };
}

export async function saveDraft(id: string | null, doc: MapDoc): Promise<string> {
  const currentId = id || `draft_${Date.now()}`;

  // 1. Always save to localStorage immediately for reliable, offline autosave
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        LOCAL_DRAFT_KEY,
        JSON.stringify({
          id: currentId,
          doc,
          updated_at: new Date().toISOString(),
        })
      );
    }
  } catch (e) {
    console.warn("Failed to save to localStorage", e);
  }

  // 2. Try Supabase in the background if configured, but do NOT throw if not connected
  try {
    const payload = doc as unknown as Json;
    if (id && !id.startsWith("draft_") && !id.startsWith("local-")) {
      await supabase
        .from("map_documents")
        .update({ data: payload, updated_at: new Date().toISOString() })
        .eq("id", id);
    } else {
      const { data } = await supabase
        .from("map_documents")
        .insert({ kind: "draft", data: payload })
        .select("id")
        .single();
      if (data?.id) return data.id;
    }
  } catch (e) {
    // Supabase not required; local draft is saved
  }

  return currentId;
}

export async function publishDoc(doc: MapDoc, note?: string) {
  // 1. Always save to localStorage for the student view
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        LOCAL_PUBLISHED_KEY,
        JSON.stringify({
          doc,
          at: new Date().toISOString(),
          note: note ?? null,
        })
      );
    }
  } catch (e) {
    console.warn("Failed to publish to localStorage", e);
  }

  // 2. Try Supabase if available
  try {
    await supabase.from("map_documents").insert({
      kind: "published",
      data: doc as unknown as Json,
      note: note ?? null,
    });
  } catch (e) {
    // Supabase not required; published locally
  }
}

export async function loadPublished(): Promise<{ doc: MapDoc; at: string } | null> {
  // 1. Check local published map first
  try {
    if (typeof window !== "undefined") {
      const raw = localStorage.getItem(LOCAL_PUBLISHED_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.doc) {
          return { doc: parsed.doc, at: parsed.at || new Date().toISOString() };
        }
      }
    }
  } catch (e) {
    console.warn("Failed to load local published map", e);
  }

  // 2. Fall back to Supabase
  try {
    const { data, error } = await supabase
      .from("map_documents").select("data, created_at").eq("kind", "published")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!error && data) {
      return { doc: data.data as unknown as MapDoc, at: data.created_at };
    }
  } catch (e) {
    // Supabase optional
  }

  return null;
}
