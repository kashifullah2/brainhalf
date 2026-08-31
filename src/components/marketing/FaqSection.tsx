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
    /* Was a centred h3 dropped inside the previous section: the one heading on
       the page that broke both the left-aligned editorial rhythm and the
       h1 → h2 heading order. */
    /* Two columns, matching the rhythm the sections above it established
       (label and heading left, content right). It used to be a full-width
       heading over a max-w-3xl accordion inside a max-w-7xl container, so the
       one block on the page with the most to read was also the narrowest, and
       it sat against a third of the page left empty. */
    <div id="faq" className="grid scroll-mt-24 gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-24">
      <div>
        {/* Sticky, so the ~130px of heading no longer leaves 250px of empty
            column beside a tall accordion. */}
        <div className="lg:sticky lg:top-28">
          <MarginNote>03 / questions</MarginNote>
          <h2 className="mt-4 max-w-sm text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Frequently asked questions
          </h2>
        </div>
      </div>
      <Accordion
        type="single"
        collapsible
        className="overflow-hidden rounded-xl border border-border bg-card px-6 shadow-sm"
      >
        {FAQ_ITEMS.map((item) => (
          <AccordionItem
            key={item.q}
            value={item.q}
            className="border-border/50 last:border-b-0"
          >
            <AccordionTrigger className="py-5 text-left text-body-xl font-semibold text-foreground hover:no-underline [&[data-state=open]]:text-primary">
              {item.q}
            </AccordionTrigger>
            <AccordionContent className="text-body font-medium leading-relaxed text-muted-foreground">
              {item.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
