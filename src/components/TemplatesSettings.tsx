import { useState } from "react";
import {
  useListTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  type ExtractionTemplate,
} from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { getTemplatesQueryKey } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AutoResizingTextarea } from "@/components/ui/auto-resizing-textarea";
import { useToast } from "@/hooks/use-toast";
import { PRESETS } from "@/components/UploadModal";
import {
  Trash2,
  Plus,
  Loader2,
  Pencil,
  Save,
  X,
  FileCode2,
} from "lucide-react";

export function TemplatesSettings() {
  const { data: templates, isLoading } = useListTemplates();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [baseMode, setBaseMode] = useState("custom");
  const [prompt, setPrompt] = useState("");
  const [description, setDescription] = useState("");

  const resetForm = () => {
    setName("");
    setBaseMode("custom");
    setPrompt("");
    setDescription("");
    setIsCreating(false);
    setEditingId(null);
  };

  const startEdit = (template: ExtractionTemplate) => {
    setName(template.name);
    setBaseMode(template.baseMode);
    setPrompt(template.prompt || "");
    setDescription(template.description || "");
    setEditingId(template.id);
    setIsCreating(false);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }

    try {
      if (editingId) {
        await updateTemplate(editingId, {
          name,
          baseMode,
          prompt: prompt || undefined,
          description: description || undefined,
        });
        toast({ title: "Template updated" });
      } else {
        await createTemplate({
          name,
          baseMode,
          prompt: prompt || undefined,
          description: description || undefined,
        });
        toast({ title: "Template created" });
      }
      queryClient.invalidateQueries({ queryKey: getTemplatesQueryKey() });
      resetForm();
    } catch (e: any) {
      toast({
        title: "Could not save template",
        description: e.message,
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this template? This cannot be undone.")) return;
    try {
      await deleteTemplate(id);
      queryClient.invalidateQueries({ queryKey: getTemplatesQueryKey() });
      toast({ title: "Template deleted" });
    } catch (e: any) {
      toast({
        title: "Delete failed",
        description: e.message,
        variant: "destructive",
      });
    }
  };

  const renderForm = () => (
    <div className="space-y-4 p-5 rounded-2xl border border-border/60 bg-muted/20 mt-4">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Template Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Monthly Utility Bill"
              className="bg-background"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Base Mode
            </label>
            <select
              value={baseMode}
              onChange={(e) => setBaseMode(e.target.value)}
              className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Custom Instructions / Prompt (Optional)
          </label>
          <AutoResizingTextarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Additional instructions for the AI..."
            className="bg-background"
            minRows={3}
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Description (Optional)
          </label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description for the UI..."
            className="bg-background"
          />
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <Button variant="ghost" onClick={resetForm}>
          Cancel
        </Button>
        <Button onClick={handleSave}>
          <Save className="w-4 h-4 mr-2" /> Save Template
        </Button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="py-8 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-extrabold mb-1">Extraction Templates</h2>
          <p className="text-sm text-muted-foreground font-medium">
            Save your custom extraction schemas for one-click re-use.
          </p>
        </div>
        {!isCreating && !editingId && (
          <Button onClick={() => setIsCreating(true)} size="sm">
            <Plus className="w-4 h-4 mr-2" /> New Template
          </Button>
        )}
      </div>

      {(isCreating || editingId) && renderForm()}

      {!isCreating && !editingId && (
        <div className="space-y-3 mt-6">
          {!templates?.length ? (
            <div className="text-center py-12 bg-muted/20 rounded-2xl border border-dashed border-border/60">
              <FileCode2 className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-sm font-medium text-muted-foreground">
                You haven't saved any templates yet.
              </p>
            </div>
          ) : (
            [...templates].sort((a, b) => (b.useCount || 0) - (a.useCount || 0)).map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between p-4 rounded-xl border border-border/60 bg-card hover:border-primary/30 transition-colors group"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-foreground">{t.name}</span>
                    <span className="text-[10px] uppercase tracking-widest font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      {PRESETS.find((p) => p.id === t.baseMode)?.label ||
                        t.baseMode}
                    </span>
                  </div>
                  {t.description && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t.description}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground/70 mt-1">
                    Used {t.useCount} times
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => startEdit(t)}
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(t.id)}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
