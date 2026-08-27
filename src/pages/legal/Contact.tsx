import React, { useState } from "react";
import { LegalLayout } from "./LegalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Send, Loader2 } from "lucide-react";
import emailjs from '@emailjs/browser';

// ---------------------------------------------------------------------------
// This form sends from the browser through EmailJS.
//
// functions/api/contact.ts is the better implementation -- it escapes every
// field, strips CR/LF out of anything that reaches a mail header, and is rate
// limited -- but it sends through `env.EMAIL`, and no EMAIL binding is declared
// in wrangler.toml. Until mail delivery is configured, that endpoint answers
// 503 and this is the only channel that actually reaches the inbox, so the
// EmailJS path stays.
//
// What is fixed here is the part that was broken either way: the credentials
// used to fall back to the literals "template_contact" and "public_key_here"
// when the env vars were absent, so a misconfigured deploy did not disable the
// form -- it sent a request that EmailJS rejected, and showed the visitor
// whatever error came back.
// ---------------------------------------------------------------------------

/** Mirrors the caps in functions/api/contact.ts, so both paths agree. */
const LIMITS = { name: 100, subject: 200, message: 5_000 } as const;

const SUPPORT_EMAIL = "support@brainhalf.com";

function readableError(error: unknown): string {
  // EmailJS rejects with { status, text }, which has no `message` at all.
  if (error && typeof error === "object") {
    const text = (error as { text?: unknown }).text;
    if (typeof text === "string" && text) return text;
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "An unexpected error occurred. Please try again later.";
}

export default function Contact() {
  const { toast } = useToast();
  const [isBusy, setIsBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Captured before the first await: React clears currentTarget once the
    // synthetic event has been handled.
    const form = e.currentTarget;
    const formData = new FormData(form);

    const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
    const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
    const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

    if (!serviceId || !templateId || !publicKey) {
      // Say so plainly and give them an address that works, rather than
      // pretending to send and failing upstream.
      toast({
        title: "Contact form unavailable",
        description: `Please email ${SUPPORT_EMAIL} directly — we'll pick it up there.`,
        variant: "destructive",
      });
      return;
    }

    setIsBusy(true);

    const data = {
      name: String(formData.get("name") ?? "").slice(0, LIMITS.name),
      email: String(formData.get("email") ?? ""),
      subject: String(formData.get("subject") ?? "").slice(0, LIMITS.subject),
      message: String(formData.get("message") ?? "").slice(0, LIMITS.message),
    };

    try {
      await emailjs.send(serviceId, templateId, data, publicKey);

      toast({
        title: "Message sent",
        description: "Thanks — we read every one of these and will reply soon.",
      });
      form.reset();
    } catch (err: unknown) {
      toast({
        title: "Sending Failed",
        description: readableError(err),
        variant: "destructive"
      });
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <LegalLayout title="Contact Us" canonicalPath="/contact">
      <p>
        A real person reads these. Whether it is a document brainhalf keeps
        misreading, a volume question, or something that is just plain broken —
        write it below and we will come back to you.
      </p>
      
      <div className="mt-8 rounded-2xl border border-border/40 bg-card p-6 md:p-8 shadow-sm not-prose">
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-bold tracking-tight text-foreground">Name</label>
              <Input id="name" name="name" required maxLength={LIMITS.name} placeholder="Jane Doe" className="h-11 rounded-lg bg-background" />
            </div>
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-bold tracking-tight text-foreground">Email</label>
              <Input id="email" name="email" type="email" required maxLength={254} placeholder="jane@example.com" className="h-11 rounded-lg bg-background" />
            </div>
          </div>
          
          <div className="space-y-2">
            <label htmlFor="subject" className="text-sm font-bold tracking-tight text-foreground">Subject</label>
            <Input id="subject" name="subject" required maxLength={LIMITS.subject} placeholder="How can we help?" className="h-11 rounded-lg bg-background" />
          </div>

          <div className="space-y-2">
            <label htmlFor="message" className="text-sm font-bold tracking-tight text-foreground">Message</label>
            <Textarea 
              id="message" 
              name="message"
              required 
              maxLength={LIMITS.message}
              placeholder="What are you trying to do, and where did it go sideways?" 
              className="min-h-[150px] resize-y rounded-lg bg-background" 
            />
          </div>

          <Button type="submit" disabled={isBusy} className="h-12 w-full sm:w-auto self-end px-8 rounded-full shadow-sm text-sm font-bold uppercase tracking-wide">
            {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {isBusy ? "Sending…" : "Send message"}
          </Button>
        </form>
      </div>

      <div className="mt-12">
        <h3>Prefer plain email?</h3>
        <ul>
          <li><strong>Email:</strong> {SUPPORT_EMAIL}</li>
        </ul>
      </div>
    </LegalLayout>
  );
}
