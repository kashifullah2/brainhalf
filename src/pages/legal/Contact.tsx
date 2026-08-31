import React, { useState } from "react";
import { LegalLayout } from "./LegalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Send, Loader2 } from "lucide-react";
import emailjs from '@emailjs/browser';

import { apiUrl } from "@/lib/api-paths";

// ---------------------------------------------------------------------------
// Contact form submission, server first.
//
// functions/api/contact.ts is the better implementation -- it HTML-escapes every
// field, strips CR/LF out of anything that reaches a mail header, and is rate
// limited per IP -- so it is tried FIRST. It only answers 503 while no EMAIL
// binding is configured (see wrangler.toml); the moment one is, this form starts
// using it with no change here.
//
// EmailJS is the fallback, and only for that 503. It is reached from the browser
// with a public key, so it has no rate limit of its own -- which is exactly why a
// 429 from our own endpoint must NOT fall through to it. Falling back on anything
// other than "delivery is not configured" would hand an attacker a documented way
// around the throttle.
//
// Note for whoever removes EmailJS: drop `@emailjs/browser`, the three VITE_
// variables, and https://api.emailjs.com from connect-src in public/_headers.
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

/**
 * A type alias rather than an interface: TypeScript infers an implicit index
 * signature for the former, which is what `emailjs.send` needs to accept it as
 * template parameters. An interface would not be assignable.
 */
type Payload = {
  name: string;
  email: string;
  subject: string;
  message: string;
};

/** Distinguishes "not configured" from "refused", because only the first may fall back. */
type ServerOutcome =
  | { kind: "sent" }
  | { kind: "unconfigured" }
  | { kind: "refused"; message: string };

async function sendViaServer(payload: Payload): Promise<ServerOutcome> {
  let response: Response;
  try {
    response = await fetch(apiUrl("/contact"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Never reached the server at all. Treat it the same as "not configured" so
    // the visitor still has a route to the inbox.
    return { kind: "unconfigured" };
  }

  if (response.ok) return { kind: "sent" };

  // 503 is the documented "no EMAIL binding" answer. Everything else is a real
  // decision by our own endpoint -- validation, or the rate limit -- and stands.
  if (response.status === 503) return { kind: "unconfigured" };

  let message = "Could not send your message. Please try again.";
  try {
    const parsed = (await response.json()) as { error?: string };
    if (parsed.error) message = parsed.error;
  } catch {
    // Keep the generic message.
  }
  return { kind: "refused", message };
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

    const data: Payload = {
      name: String(formData.get("name") ?? "").slice(0, LIMITS.name),
      email: String(formData.get("email") ?? ""),
      subject: String(formData.get("subject") ?? "").slice(0, LIMITS.subject),
      message: String(formData.get("message") ?? "").slice(0, LIMITS.message),
    };

    const sent = () => {
      toast({
        title: "Message sent",
        description: "Thanks — we read every one of these and will reply soon.",
      });
      form.reset();
    };

    setIsBusy(true);

    try {
      const outcome = await sendViaServer(data);

      if (outcome.kind === "sent") {
        sent();
        return;
      }

      if (outcome.kind === "refused") {
        // Our own endpoint said no -- a validation problem or the rate limit.
        // Show its reason; do not route around it.
        toast({
          title: "Message not sent",
          description: outcome.message,
          variant: "destructive",
        });
        return;
      }

      // Delivery is not configured server-side. Fall back to EmailJS.
      const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
      const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
      const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

      if (!serviceId || !templateId || !publicKey) {
        // Neither channel exists. Say so plainly and give them an address that
        // works, rather than pretending to send.
        toast({
          title: "Contact form unavailable",
          description: `Please email ${SUPPORT_EMAIL} directly — we'll pick it up there.`,
          variant: "destructive",
        });
        return;
      }

      await emailjs.send(serviceId, templateId, data, publicKey);
      sent();
    } catch (err: unknown) {
      toast({
        title: "Sending Failed",
        description: readableError(err),
        variant: "destructive",
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
      
      <div className="mt-8 rounded-xl border border-border bg-card p-6 md:p-8 shadow-sm not-prose">
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="name" className="text-body-sm font-semibold text-foreground">Name</label>
              <Input id="name" name="name" required maxLength={LIMITS.name} placeholder="Jane Doe" className="h-11 bg-background" />
            </div>
            <div className="space-y-2">
              <label htmlFor="email" className="text-body-sm font-semibold text-foreground">Email</label>
              <Input id="email" name="email" type="email" required maxLength={254} placeholder="jane@example.com" className="h-11 bg-background" />
            </div>
          </div>
          
          <div className="space-y-2">
            <label htmlFor="subject" className="text-body-sm font-semibold text-foreground">Subject</label>
            <Input id="subject" name="subject" required maxLength={LIMITS.subject} placeholder="How can we help?" className="h-11 bg-background" />
          </div>

          <div className="space-y-2">
            <label htmlFor="message" className="text-body-sm font-semibold text-foreground">Message</label>
            <Textarea 
              id="message" 
              name="message"
              required 
              maxLength={LIMITS.message}
              placeholder="What are you trying to do, and where did it go sideways?" 
              className="min-h-[150px] resize-y bg-background" 
            />
          </div>

          <Button type="submit" disabled={isBusy} className="h-11 w-full self-end px-6 text-body font-semibold sm:w-auto">
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
