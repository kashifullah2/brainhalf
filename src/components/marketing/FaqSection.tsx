import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQ_ITEMS = [
  {
    q: "Which file types does BrainHalf support?",
    a: "JPG, PNG, WEBP and PDF, up to 25 MB per file. Photos, scans and exported PDFs all work.",
  },
  {
    q: "Do I need to build a template for every document layout?",
    a: "No. Pick a preset such as Invoice, Receipt, Table or Handwriting, or write a custom prompt. The extraction engine reads each page directly, so new vendors and layouts work without any setup.",
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
    a: "Documents and extracted data are tied to your account only, and you can delete them at any time from Settings → Data & Privacy. Details are in our privacy policy.",
  },
];

/**
 * FAQ built on the shared Radix accordion rather than always-open prose, so the
 * section stays short and each answer is a real disclosure widget.
 */
export function FaqSection() {
  return (
    <div id="faq" className="mt-16 scroll-mt-24">
      <h3 className="mb-10 text-center text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
        Frequently asked questions
      </h3>
      <Accordion
        type="single"
        collapsible
        className="mx-auto max-w-3xl overflow-hidden rounded-3xl border border-border/60 bg-card px-6 shadow-sm"
      >
        {FAQ_ITEMS.map((item) => (
          <AccordionItem
            key={item.q}
            value={item.q}
            className="border-border/50 last:border-b-0"
          >
            <AccordionTrigger className="py-5 text-left text-base font-bold text-foreground hover:no-underline [&[data-state=open]]:text-primary">
              {item.q}
            </AccordionTrigger>
            <AccordionContent className="text-sm font-medium leading-relaxed text-muted-foreground">
              {item.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
