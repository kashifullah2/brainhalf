import { TemplatesSettings } from "@/components/TemplatesSettings";
import { usePageTitle } from "@/lib/use-page-title";

export default function TemplatesPage() {
  usePageTitle("Saved Templates · BrainHalf", { noindex: true });

  return (
    <div className="flex flex-col w-full max-w-5xl mx-auto py-8 px-4">
      <TemplatesSettings />
    </div>
  );
}
