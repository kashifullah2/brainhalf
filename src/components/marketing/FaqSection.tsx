import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { MarginNote } from "./MarginNote";

const FAQ_ITEMS = [
  {
    q: "Which file types does BrainHalf support?",
    a: "PDFs up to 14 MB and images (JPG, PNG, WEBP) up to 25 MB. A PDF is sent to the model whole, which is what makes its limit the lower of the two; photos and scans are resized in your browser first.",
  },
  {
    q: "Do I need to build a template for every document layout?",
    a: "No. Pick a preset — Invoice, Receipt, Table, Key-Value, Handwriting, Multilingual or Full Text — or write your own prompt. The extraction engine reads each page directly, so new vendors and layouts work without any setup.",
  },
  {
    q: "What happens when a field is extracted incorrectly?",
    a: "Every field carries a confidence score. Double-click any cell to correct it inline, and documents below your confidence threshold are collected in a review queue so nothing slips through.",
  },
  {
    q: "Which export formats are available?",
    a: "CSV, Excel (.xlsx) and JSON. Export a single batch or bulk-export several runs at once.",
  },
  {
    q: "Is my data kept private?",
    a: "Documents and extracted data are tied to your account only. Delete any batch from your dashboard, or the whole account from Settings \u2192 Data & Privacy, and the documents, extracted fields and stored files go with it immediately. You can also download everything as JSON first. Details are in our privacy policy.",
  },
];

/**
 * FAQ built on the shared Radix accordion rather than always-open prose, so the
 * section stays short and each answer is a real disclosure widget.
 */
export function FaqSection() {
  return (
    <div id="faq" className="mt-20 scroll-mt-[calc(var(--header-h)+2rem)]">
      <div className="mx-auto mb-10 max-w-2xl text-center space-y-4">
        <div className="flex justify-center">
          <MarginNote>03 / questions</MarginNote>
        </div>
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Frequently asked questions
        </h2>
      </div>

      <div className="mx-auto max-w-3xl">
        <Accordion
          type="single"
          collapsible
          className="overflow-hidden rounded-2xl border border-border bg-card p-2 sm:p-4 shadow-md"
        >
          {FAQ_ITEMS.map((item) => (
            <AccordionItem
              key={item.q}
              value={item.q}
              className="border-border/60 last:border-b-0 px-4"
            >
              <AccordionTrigger className="py-5 text-left text-body-lg font-semibold text-foreground hover:no-underline [&[data-state=open]]:text-primary">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="pb-5 text-body font-medium leading-relaxed text-muted-foreground">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </div>
  );
}
