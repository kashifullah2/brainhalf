import { useState, useEffect, useRef, useCallback } from "react";
import { useRoute, useLocation } from "wouter";

import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Building2, Shield, Lock, Users, CreditCard, LogOut, Loader2, Download, Trash2,
} from "lucide-react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteAccount, downloadAccountExport } from "@/lib/api-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";

import { getConfidenceThreshold, setConfidenceThreshold } from "@/lib/review-queue-store";
import {
  CONSENT_CHANGED_EVENT,
  openAnalyticsConsentSettings,
  readAnalyticsConsent,
  type Consent,
} from "@/components/analytics-consent";
import { useSyncConfidenceThreshold } from "@/hooks/use-confidence-threshold";
import { usePageTitle } from "@/lib/use-page-title";


/** Valid tab slugs, also used to validate the :tab route parameter. */
const TAB_IDS = ["organization", "security", "privacy", "team", "billing"];

export default function Settings() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  usePageTitle("Settings · BrainHalf", { noindex: true });
  // The tab is read from the URL so /app/settings/billing is linkable and the
  // browser's back button steps through tabs.
  const [match, params] = useRoute<{ tab: string }>("/app/settings/:tab");
  const [, setLocation] = useLocation();

  const tabFromUrl = match ? params?.tab : undefined;
  const activeTab = TAB_IDS.includes(tabFromUrl ?? "") ? (tabFromUrl as string) : "organization";

  const setActiveTab = (id: string) => {
    setLocation(id === "organization" ? "/app/settings" : `/app/settings/${id}`);
  };

  const [threshold, setThresholdState] = useState<number>(0.80);
  const [isSigningOut, setIsSigningOut] = useState(false);

  /**
   * The current analytics choice, so this panel can state it rather than just
   * offering a button. A signed-in user never sees the marketing footer, so
   * without this the only cookie control in the product was unreachable from
   * inside the app.
   */
  // ── Export / erasure ────────────────────────────────────────────────
  const [isExporting, setIsExporting] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleteState, setDeleteState] = useState<"idle" | "working">("idle");

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await downloadAccountExport();
      toast({
        title: "Export downloaded",
        description: "Your batches, documents, extracted fields and templates are in the file.",
      });
    } catch (err) {
      toast({
        title: "Could not build the export",
        description: err instanceof Error ? err.message : "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  // The typed email is the safeguard that survives both SameSite and the origin
  // check being wrong: a cross-site request cannot know the address.
  const canDelete =
    confirmEmail.trim().toLowerCase() === (user?.email ?? "").trim().toLowerCase();

  const handleDeleteAccount = async () => {
    if (!canDelete || deleteState === "working") return;
    setDeleteState("working");
    try {
      await deleteAccount(confirmEmail.trim());
      // The session row went with the account, so there is nothing to sign out of.
      setIsDeleteOpen(false);
      setLocation("/");
      toast({
        title: "Account deleted",
        description: "Your documents, extracted data and stored files have been removed.",
      });
    } catch (err) {
      setDeleteState("idle");
      toast({
        title: "Could not delete the account",
        description: err instanceof Error ? err.message : "Nothing has been removed.",
        variant: "destructive",
      });
    }
  };

  const [analyticsConsent, setAnalyticsConsent] = useState<Consent | null>(null);
  useEffect(() => {
    const sync = () => setAnalyticsConsent(readAnalyticsConsent());
    sync();
    // The notice lives outside this tree and records the choice itself, so this
    // waits to be told rather than polling or guessing at a timeout.
    window.addEventListener(CONSENT_CHANGED_EVENT, sync);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, sync);
  }, []);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await logout();
      setLocation("/");
    } catch (err) {
      setIsSigningOut(false);
      toast({
        title: "Could not sign out",
        // The session is still live when revocation fails, and saying so is the
        // difference between an error the user can act on and a dead end.
        description:
          err instanceof Error
            ? `${err.message} You are still signed in — try again.`
            : "You are still signed in. Check your connection and try again.",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    getConfidenceThreshold()
      .then(setThresholdState)
      // Keep the default rather than leaving the slider in an unknown state.
      .catch((err) => console.error("Could not load the confidence threshold:", err));
  }, []);

  const syncThreshold = useSyncConfidenceThreshold();

  /**
   * Persisting the threshold, once the user has stopped moving the slider.
   *
   * A range input fires `change` on every step, and this used to PATCH
   * /api/settings and raise a toast on each one -- so a single drag from 50% to
   * 95% was ten writes and ten stacked toasts, nine of which were for values the
   * user was only passing through. There is no commit event on a range input, so
   * the settle is timed.
   *
   * The last value the server accepted is tracked separately from the displayed
   * one, because a rollback has to restore what was actually saved, not whatever
   * step the drag happened to pass through before it failed.
   */
  const SAVE_SETTLE_MS = 400;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedThreshold = useRef<number>(0.8);
  const [isSavingThreshold, setIsSavingThreshold] = useState(false);

  useEffect(() => {
    getConfidenceThreshold()
      .then((value) => {
        savedThreshold.current = value;
      })
      .catch(() => {
        // The load error is already reported by the effect above.
      });
  }, []);

  // A drag left mid-flight when the user navigates away must not fire afterwards.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const persistThreshold = useCallback(
    async (value: number) => {
      setIsSavingThreshold(true);
      try {
        await setConfidenceThreshold(value);
        savedThreshold.current = value;
        // Every other open view reads this through useConfidenceThreshold; push
        // the new value in so none of them keeps colouring against the old one.
        syncThreshold(value);
        toast({
          title: "Threshold updated",
          description: `Anything read below ${(value * 100).toFixed(0)}% now goes to your review queue.`,
        });
      } catch (err) {
        // Roll back to the value the server actually holds.
        setThresholdState(savedThreshold.current);
        toast({
          title: "Could not save the threshold",
          description: err instanceof Error ? err.message : "Try again.",
          variant: "destructive",
        });
      } finally {
        setIsSavingThreshold(false);
      }
    },
    [syncThreshold, toast],
  );

  const handleThresholdChange = (newVal: number) => {
    // The slider itself stays immediate; only the write waits.
    setThresholdState(newVal);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void persistThreshold(newVal);
    }, SAVE_SETTLE_MS);
  };

  const tabs = [
    { id: "organization", label: "Organization", icon: Building2 },
    { id: "security", label: "Security", icon: Shield },
    { id: "privacy", label: "Data & Privacy", icon: Lock },
    { id: "team", label: "Team", icon: Users },
    { id: "billing", label: "Billing", icon: CreditCard },
  ];

  return (
    <>
      <div className="flex w-full flex-1 flex-col">
        <PageHeader
          eyebrow={<><Building2 className="h-3.5 w-3.5" /> Account</>}
          title="Settings"
          description="Your account, your data, and how sure brainhalf has to be before it asks for your help."
        />

        <div className="flex flex-col md:flex-row gap-10">
          {/* Settings Sidebar */}
          <aside className="w-full md:w-64 shrink-0">
            <nav className="flex flex-col gap-2">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    aria-current={isActive ? "page" : undefined}
                    className={`group flex items-center gap-3 rounded-lg border px-3 py-2.5 text-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      isActive
                        ? "border-primary-border bg-primary text-primary-foreground"
                        : "border-transparent text-muted-foreground hover:bg-card hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <div className="flex flex-col text-left">
                      <span className="leading-tight">{tab.label}</span>
                    </div>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Settings Content Area. Was a translucent "glass" card with
              backdrop-blur and a gradient overlay — the only card in the app
              styled that way, and the blur lagged on scroll. Now the same flat
              card treatment as every other panel. */}
          <div className="flex-1 min-w-0">
            {/* min-h keeps the card from jumping vertically as you switch
                between short (Team) and tall (Organization) tabs. */}
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8 md:min-h-[480px]">
              <div>
                {activeTab === "organization" && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="mb-1 text-2xl font-semibold tracking-tight">Organization Profile</h2>
                      <p className="text-body text-muted-foreground font-medium mb-8">
                        Update your company details and workspace settings.
                      </p>
                    </div>

                    <div className="space-y-6">
                      <div className="space-y-2">
                        <label htmlFor="org-name" className="text-body-sm font-semibold text-foreground">
                          Organization Name
                        </label>
                        <Input
                          id="org-name"
                          type="text"
                          placeholder="Your company name"
                          disabled
                          className="h-11 bg-muted/60 text-muted-foreground/80 cursor-not-allowed border-dashed"
                        />
                        <p className="text-caption text-muted-foreground font-semibold mt-1">
                          Organization profiles arrive with team accounts.
                          Until then this field is read-only.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <label htmlFor="org-email" className="text-body-sm font-semibold text-foreground">
                          Contact Email
                        </label>
                        <Input
                          id="org-email"
                          type="email"
                          value={user?.email ?? ""}
                          readOnly
                          disabled
                          className="h-11 bg-muted/60 text-muted-foreground/80 cursor-not-allowed border-dashed"
                        />
                        <p className="text-caption text-muted-foreground font-semibold mt-1">
                          Primary billing and administrative contact.
                        </p>
                      </div>

                      <div className="space-y-2 pt-2 border-t border-border/40">
                        <label htmlFor="confidence-threshold" className="text-body-sm font-semibold text-foreground">
                          How sure should brainhalf be before it asks you?
                        </label>
                        <div className="flex items-center gap-4">
                          <input
                            id="confidence-threshold"
                            type="range"
                            min="0.50"
                            max="0.95"
                            step="0.05"
                            value={threshold}
                            onChange={(e) => handleThresholdChange(parseFloat(e.target.value))}
                            aria-valuetext={`${(threshold * 100).toFixed(0)} percent`}
                            /* --range-fill drives the filled portion of the
                               track (see index.css). Without it the track was
                               a uniform grey bar with a lone dot on it. */
                            style={{ ["--range-fill" as string]: `${((threshold - 0.5) / 0.45) * 100}%` }}
                            className="flex-1 cursor-pointer"
                          />
                          <span className="inline-flex items-center justify-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 font-data text-body font-semibold tabular-nums text-primary leading-none shrink-0">
                            {(threshold * 100).toFixed(0)}%
                          </span>
                        </div>
                        <p className="text-caption text-muted-foreground font-semibold mt-1">
                          Anything read with less confidence than this lands in
                          your review queue instead of quietly going into an
                          export. Raise it if you would rather check more.
                        </p>
                        {/* The slider persists on change, so this belongs next
                            to the slider — it used to sit alone under a divider
                            at the bottom of the card, which read as an empty
                            form footer waiting for a Save button. */}
                        <p className="pt-1 text-caption font-semibold text-muted-foreground/80">
                          {isSavingThreshold
                            ? "Saving…"
                            : "Saved to your account a moment after you let go."}
                        </p>
                      </div>
                    </div>
                  </div>
                )}



                {activeTab === "security" && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="mb-1 text-2xl font-semibold tracking-tight">Security</h2>
                      <p className="text-body text-muted-foreground font-medium mb-8">
                        Manage your account security and session policies.
                      </p>
                    </div>
                    
                    <div className="space-y-4">
                      {/* Both controls below are inert. They are disabled and
                          labelled as such instead of looking operational: an
                          enabled “Enable 2FA” button that does nothing is a
                          security claim the product cannot honour. */}
                      <div className="flex items-center justify-between p-5 rounded-xl border border-border bg-background/50">
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground">Two-Factor Authentication</span>
                          <span className="text-body-sm font-medium text-muted-foreground">
                            An extra code at sign-in, on top of your password.
                          </span>
                        </div>
                        <Badge variant="neutral" className="shrink-0 rounded-full">Coming soon</Badge>
                      </div>

                      <div className="flex items-center justify-between p-5 rounded-xl border border-border bg-background/50">
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground">Single Sign-On (SSO)</span>
                          <span className="text-body-sm font-medium text-muted-foreground">
                            Sign in through your organisation's identity provider.
                          </span>
                        </div>
                        <Badge variant="neutral" className="shrink-0 rounded-full">Coming soon</Badge>
                      </div>

                      <div className="flex items-center justify-between gap-4 p-5 rounded-xl border border-border bg-background/50">
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground">Sign out</span>
                          <span className="text-body-sm font-medium text-muted-foreground">
                            Ends your session on this device.
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          onClick={handleSignOut}
                          disabled={isSigningOut}
                          className="rounded-full font-semibold text-label shrink-0"
                        >
                          {isSigningOut ? (
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <LogOut className="mr-2 h-3.5 w-3.5" />
                          )}
                          Sign out
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "privacy" && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="mb-1 text-2xl font-semibold tracking-tight">Data & Privacy</h2>
                      <p className="text-body text-muted-foreground font-medium mb-8">
                        Take a copy of your data, or remove it. Both take effect
                        immediately.
                      </p>
                    </div>
                    <div className="space-y-4">
                      <div className="flex flex-col gap-4 p-5 rounded-xl border border-border bg-background/50">
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground">Data Retention Policy</span>
                          <span className="text-body-sm font-medium text-muted-foreground">
                            Scheduled deletion is on our roadmap. Until it
                            ships, documents stay in your account until you
                            delete them.
                          </span>
                        </div>
                        <div
                          role="radiogroup"
                          aria-label="Data retention period"
                          className="flex flex-wrap gap-2"
                          title="Automated retention policies are on our roadmap."
                        >
                          {["30 Days", "90 Days", "Indefinitely"].map((option) => (
                            <span
                              key={option}
                              role="radio"
                              aria-checked={option === "Indefinitely"}
                              aria-disabled
                              className={`rounded-full border px-3.5 py-1.5 text-label font-medium ${
                                option === "Indefinitely"
                                  ? "border-primary/40 bg-primary/10 text-primary"
                                  : "border-border bg-muted/40 text-muted-foreground/70"
                              }`}
                            >
                              {option}
                            </span>
                          ))}
                        </div>
                        <p className="text-caption font-medium text-muted-foreground/80">
                          Indefinite retention is in effect today; the other two
                          arrive with scheduled deletion.
                        </p>
                      </div>

                      <div className="flex flex-col gap-2 p-5 rounded-xl border border-border bg-background/50">
                        <span className="font-semibold text-foreground">Delete a batch</span>
                        <span className="text-body-sm font-medium text-muted-foreground">
                          Deleting a batch from the dashboard removes its documents,
                          extracted fields, and the stored source files. That is
                          immediate and cannot be undone.
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-xl border border-border bg-background/50">
                        <div className="flex min-w-0 flex-col">
                          <span className="font-semibold text-foreground">Analytics cookies</span>
                          <span className="text-body-sm font-medium text-muted-foreground">
                            {analyticsConsent === "granted"
                              ? "Allowed. We measure page usage only — no advertising cookies."
                              : analyticsConsent === "denied"
                                ? "Declined. No analytics tag is loaded."
                                : "You have not made a choice yet."}
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          onClick={openAnalyticsConsentSettings}
                          className="shrink-0 rounded-full font-semibold text-label"
                        >
                          Change
                        </Button>
                      </div>

                      {/* Right of access. There was no way to obtain a copy of your
                          own data from anywhere in the product. */}
                      <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-xl border border-border bg-background/50">
                        <div className="flex min-w-0 flex-col">
                          <span className="font-semibold text-foreground">Export your data</span>
                          <span className="text-body-sm font-medium text-muted-foreground">
                            One JSON file with every batch, document, extracted field
                            and saved template on this account.
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          onClick={handleExport}
                          disabled={isExporting}
                          className="shrink-0 gap-2 rounded-full font-semibold text-label"
                        >
                          {isExporting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                          {isExporting ? "Preparing…" : "Download"}
                        </Button>
                      </div>

                      {/* Right to erasure. This tab promised retention control and
                          offered none; deleting an account was not possible at all. */}
                      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
                        <div className="flex min-w-0 flex-col">
                          <span className="font-semibold text-foreground">Delete this account</span>
                          <span className="text-body-sm font-medium text-muted-foreground">
                            Removes your account, every batch, all extracted data and
                            all stored files. Immediate, and it cannot be undone.
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setConfirmEmail("");
                            setIsDeleteOpen(true);
                          }}
                          className="shrink-0 gap-2 rounded-full border-destructive/40 font-semibold text-label text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete account
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "team" && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between mb-8">
                      <div>
                        <h2 className="mb-1 text-2xl font-semibold tracking-tight">Team Members</h2>
                        <p className="text-body-sm font-medium text-muted-foreground">
                          Team workspaces are coming. For now this account is
                          single-user.
                        </p>
                      </div>
                      <Badge variant="neutral" className="shrink-0 rounded-full">Coming soon</Badge>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-border bg-card">
                      <div className="flex items-center justify-between p-5">
                        <div className="flex items-center gap-4 min-w-0">
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={user?.picture} alt="" />
                            <AvatarFallback className="bg-primary/10 font-semibold text-primary">
                              {user?.firstName?.charAt(0) || user?.name?.charAt(0) || "?"}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex flex-col min-w-0">
                            <span className="truncate font-semibold text-foreground">
                              {user?.name ?? "—"}
                            </span>
                            <span className="text-label font-medium text-muted-foreground truncate">
                              {user?.email ?? "—"}
                            </span>
                          </div>
                        </div>
                        <span className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-caption font-semibold shrink-0">
                          Owner
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "billing" && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="mb-1 text-2xl font-semibold tracking-tight">Billing & Plans</h2>
                      <p className="text-body text-muted-foreground font-medium mb-8">
                        Subscriptions and payment methods.
                      </p>
                    </div>

                    {/* Billing reports the actual account state; no sample
                        subscription or card data is shown. */}
                    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border bg-background/50 px-6 py-12 text-center">
                      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                        <CreditCard className="h-7 w-7" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-body-lg font-semibold text-foreground">
                          No billing set up
                        </h3>
                        <p className="mx-auto max-w-md text-body font-medium leading-relaxed text-muted-foreground">
                          BrainHalf is free while we build paid plans. No
                          payment method is on file, and nothing will be
                          charged without notice.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Account deletion ──────────────────────────────────── */}
      <AlertDialog
        open={isDeleteOpen}
        onOpenChange={(open) => {
          if (!open && deleteState !== "working") setIsDeleteOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes every batch, every extracted field and every stored file
              on this account, along with the account itself. It happens
              immediately and cannot be undone. Download your data first if you
              want to keep a copy.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <label htmlFor="confirm-delete-email" className="text-body-sm font-semibold text-foreground">
              Type <span className="font-data">{user?.email}</span> to confirm
            </label>
            <Input
              id="confirm-delete-email"
              type="email"
              autoComplete="off"
              value={confirmEmail}
              onChange={(event) => setConfirmEmail(event.target.value)}
              disabled={deleteState === "working"}
              className="h-11"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteState === "working"}>Cancel</AlertDialogCancel>
            {/* Not AlertDialogAction: that closes the dialog on click, and this
                needs to stay open while the deletion runs. */}
            <Button
              onClick={handleDeleteAccount}
              disabled={!canDelete || deleteState === "working"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteState === "working" ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Deleting…
                </>
              ) : (
                "Delete permanently"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
