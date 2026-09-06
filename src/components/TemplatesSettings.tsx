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
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/app";
import { PRESETS } from "@/components/UploadModal";
import {
  Trash2,
  Plus,
  Pencil,
  Save,
  FileCode2,
} from "lucide-react";
import { errorMessage } from "@/lib/humanize-error";

export function TemplatesSettings() {
  const { data: templates, isLoading, error, refetch } = useListTemplates();
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
    } catch (e: unknown) {
      toast({
        title: "Could not save template",
        description: errorMessage(e),
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
    } catch (e: unknown) {
      toast({
        title: "Delete failed",
        description: errorMessage(e),
        variant: "destructive",
      });
    }
  };

  const renderForm = () => (
    <div className="mt-4 space-y-4 rounded-xl border border-border bg-muted/20 p-5">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="template-name" className="text-label font-medium text-muted-foreground">
              Template Name
            </label>
            <Input
              id="template-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Monthly Utility Bill"
              className="bg-background"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="template-base-mode" className="text-label font-medium text-muted-foreground">
              Base Mode
            </label>
            <select
              id="template-base-mode"
              value={baseMode}
              onChange={(e) => setBaseMode(e.target.value)}
              /* h-9 to match the Input beside it — this was h-10, so the two
                 controls in one grid row had different heights. */
              className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-background px-3 py-2 text-body shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
          <label htmlFor="template-prompt" className="text-label font-medium text-muted-foreground">
            Custom Instructions / Prompt (Optional)
          </label>
          <AutoResizingTextarea
            id="template-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Additional instructions for the AI..."
            className="bg-background"
            minRows={3}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="template-description" className="text-label font-medium text-muted-foreground">
            Description (Optional)
          </label>
          <Input
            id="template-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description for the UI..."
            className="bg-background"
          />
        </div>
      </div>

      {/* A rule and real space. The row used to sit 8px under the Description
          field with nothing between them, so "Cancel / Save Template" read as
          another form row rather than as the form's actions. The negative
          margin lets the rule span the card's padding instead of floating
          inside it. */}
      <div className="-mx-5 flex justify-end gap-2 border-t border-border/60 px-5 pt-4">
        <Button variant="ghost" onClick={resetForm}>
          Cancel
        </Button>
        <Button onClick={handleSave}>
          <Save className="w-4 h-4 mr-2" /> Save Template
        </Button>
      </div>
    </div>
  );

  // A bare centred spinner where every other list on the product shows the
  // shape of the rows it is about to render.
  if (isLoading) return <ListSkeleton rows={3} />;

  if (error) {
    return (
      <ErrorState
        title="Could not load your templates"
        body="Your saved templates are safe. Try again in a moment."
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Templates was the one app page with no PageHeader at all: a 24px h2
          where its siblings use a 36px serif h1, and no eyebrow line. */}
      <PageHeader
        eyebrow={<><FileCode2 className="h-3.5 w-3.5" /> Library</>}
        title="Extraction Templates"
        description="Save your custom extraction schemas for one-click re-use."
        actions={
          !isCreating && !editingId ? (
            <Button onClick={() => setIsCreating(true)} className="rounded-lg font-semibold">
              <Plus className="h-4 w-4" /> New Template
            </Button>
          ) : undefined
        }
      />

      {(isCreating || editingId) && renderForm()}

      {!isCreating && !editingId && (
        <div className="space-y-3 mt-6">
          {!templates?.length ? (
            <EmptyState
              icon={FileCode2}
              title="No templates yet"
              body="Save a custom prompt from the upload screen and it will show up here for one-click re-use."
              inset
            />
          ) : (
            [...templates].sort((a, b) => (b.useCount || 0) - (a.useCount || 0)).map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between p-4 rounded-xl border border-border/60 bg-card hover:border-primary/30 transition-colors group"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{t.name}</span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-caption font-medium text-primary">
                      {PRESETS.find((p) => p.id === t.baseMode)?.label ||
                        t.baseMode}
                    </span>
                  </div>
                  {t.description && (
                    <p className="text-label text-muted-foreground mt-1">
                      {t.description}
                    </p>
                  )}
                  <p className="text-caption text-muted-foreground/70 mt-1">
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
