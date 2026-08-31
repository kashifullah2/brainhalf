import { TemplatesSettings } from "@/components/TemplatesSettings";
import { usePageTitle } from "@/lib/use-page-title";

export default function TemplatesPage() {
  usePageTitle("Saved Templates · BrainHalf", { noindex: true });

  return (
    <div className="flex w-full flex-col">
      <TemplatesSettings />
    </div>
  );
}
