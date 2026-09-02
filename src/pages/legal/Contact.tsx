import React, { useState } from "react";
import { LegalLayout } from "./LegalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Send, Loader2 } from "lucide-react";

import { apiUrl } from "@/lib/api-paths";

// ---------------------------------------------------------------------------
// Contact form submission.
//
// One channel: our own functions/api/contact.ts. It HTML-escapes every field,
// strips CR/LF out of anything that reaches a mail header, and is rate limited
// per IP.
//
// There used to be a browser-side EmailJS fallback for the 503 that endpoint
// answers while no EMAIL binding is configured. It is gone. Reaching EmailJS
// from the page meant shipping a service id, a template id and a public key in
// the bundle, and those three together are the complete argument set for
// api.emailjs.com/api/v1.0/email/send -- enough for anyone who opened DevTools
// to send mail through our templates, including the password-reset one, whose
// reset_url the sender controls. A published credential is worse than a form
// that admits it is unavailable.
//
// So a 503 now points the visitor at the support address below. To restore an
// in-page channel, give functions/api/contact.ts the same server-side EmailJS
// HTTP call functions/api/auth/password-reset.ts already makes, where the
// credential stays a secret and the per-IP limit still applies.
// ---------------------------------------------------------------------------

/** Mirrors the caps in functions/api/contact.ts, so the client rejects first. */
const LIMITS = { name: 100, subject: 200, message: 5_000 } as const;

const SUPPORT_EMAIL = "support@brainhalf.com";

function readableError(error: unknown): string {
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "An unexpected error occurred. Please try again later.";
}

/** The body functions/api/contact.ts validates. */
interface Payload {
  name: string;
  email: string;
  subject: string;
  message: string;
}

/** "unconfigured" is the documented 503; it selects the mailto message rather than a fallback send. */
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
    // Never reached the server at all. Same outcome as "not configured": the
    // visitor is given an address that works instead of a false success.
    return { kind: "unconfigured" };
  }

  if (response.ok) return { kind: "sent" };

  // 503 is the documented "no EMAIL binding" answer. Everything else is a real
  // decision by our own endpoint -- validation, or the rate limit -- and stands.
  // Nothing routes around a 429 any more, because there is nowhere to route to.
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

      // Server-side delivery is not configured (503). There is no second
      // channel: say so plainly and give them an address that works, rather
      // than pretending to send.
      toast({
        title: "Contact form unavailable",
        description: `Please email ${SUPPORT_EMAIL} directly — we'll pick it up there.`,
        variant: "destructive",
      });
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
