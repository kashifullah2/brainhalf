import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";

import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2, Shield, Lock, Users, CreditCard, LogOut, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";

import { getConfidenceThreshold, setConfidenceThreshold } from "@/lib/review-queue-store";
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

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await logout();
      setLocation("/");
    } catch (err) {
      setIsSigningOut(false);
      toast({
        title: "Could not sign out",
        description: err instanceof Error ? err.message : "Try again.",
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

  const handleThresholdChange = async (newVal: number) => {
    const previous = threshold;
    setThresholdState(newVal);
    try {
      await setConfidenceThreshold(newVal);
      toast({
        title: "Threshold Updated",
        description: `Default confidence threshold set to ${(newVal * 100).toFixed(0)}%. Fields below this will route to Review Queue.`,
      });
    } catch (err) {
      // Roll back so the slider never shows a value the server rejected.
      setThresholdState(previous);
      toast({
        title: "Could not save the threshold",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "Settings saved",
      description: "Your preferences have been successfully updated.",
    });
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
      {/* AppLayout's <main> supplies the page padding; max-w-5xl only narrows
          the settings column inside it. */}
      <div className="flex flex-col flex-1 w-full max-w-5xl mx-auto">
        <div className="space-y-2 mb-8 border-b border-border/40 pb-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-primary shadow-sm border border-primary/20">
            Account
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-foreground">
            Settings
          </h1>
          <p className="text-lg font-medium text-muted-foreground">
            Manage your organization, team members, and billing details.
          </p>
        </div>

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
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl font-bold text-sm transition-all duration-200 group ${
                      isActive
                        ? "bg-primary border border-primary text-primary-foreground shadow-md scale-[1.02]"
                        : "text-muted-foreground hover:bg-card hover:text-foreground border border-transparent hover:border-border/60 hover:shadow-sm"
                    }`}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
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
            <div className="bg-card border border-border/60 rounded-3xl p-6 sm:p-8 shadow-sm md:min-h-[480px]">
              <div>
                {activeTab === "organization" && (
                  <form onSubmit={handleSave} className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-extrabold mb-1">Organization Profile</h2>
                      <p className="text-sm text-muted-foreground font-medium mb-8">
                        Update your company details and workspace settings.
                      </p>
                    </div>

                    <div className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                          Organization Name
                        </label>
                        <Input
                          type="text"
                          placeholder="Your company name"
                          disabled
                          className="h-12 rounded-xl bg-muted border-transparent opacity-60 font-semibold"
                        />
                        <p className="text-[11px] text-muted-foreground font-semibold mt-1">
                          Organization profiles arrive with team accounts.
                          Until then this field is read-only.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                          Contact Email
                        </label>
                        <Input
                          type="email"
                          value={user?.email ?? ""}
                          readOnly
                          disabled
                          className="h-12 rounded-xl bg-muted border-transparent opacity-60 font-semibold"
                        />
                        <p className="text-[11px] text-muted-foreground font-semibold mt-1">
                          Primary billing and administrative contact.
                        </p>
                      </div>

                      <div className="space-y-2 pt-2 border-t border-border/40">
                        <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                          Default Confidence Threshold (Review Queue Routing)
                        </label>
                        <div className="flex items-center gap-4">
                          <input
                            type="range"
                            min="0.50"
                            max="0.95"
                            step="0.05"
                            value={threshold}
                            onChange={(e) => handleThresholdChange(parseFloat(e.target.value))}
                            className="flex-1 accent-primary h-2 bg-muted rounded-lg cursor-pointer"
                          />
                          <span className="px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-black border border-primary/20">
                            {(threshold * 100).toFixed(0)}%
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground font-semibold mt-1">
                          Extracted fields scoring below this score are automatically routed to your Review Queue for verification.
                        </p>
                      </div>
                    </div>

                    <div className="pt-8 border-t border-border/40 flex items-center justify-between gap-4">
                      <p className="text-[11px] font-semibold text-muted-foreground">
                        The confidence threshold saves to your account as soon as
                        you move the slider.
                      </p>
                      {/* The slider persists on change; no separate save
                          action is needed. */}
                    </div>
                  </form>
                )}

                {activeTab === "security" && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-extrabold mb-1">Security</h2>
                      <p className="text-sm text-muted-foreground font-medium mb-8">
                        Manage your account security and session policies.
                      </p>
                    </div>
                    
                    <div className="space-y-4">
                      {/* Both controls below are inert. They are disabled and
                          labelled as such instead of looking operational: an
                          enabled “Enable 2FA” button that does nothing is a
                          security claim the product cannot honour. */}
                      <div className="flex items-center justify-between p-5 rounded-2xl border border-border/60 bg-background/50">
                        <div className="flex flex-col">
                          <span className="font-bold text-foreground">Two-Factor Authentication</span>
                          <span className="text-sm font-medium text-muted-foreground">Coming soon.</span>
                        </div>
                        <Button variant="outline" disabled className="rounded-full font-bold uppercase text-xs">
                          Coming soon
                        </Button>
                      </div>

                      <div className="flex items-center justify-between p-5 rounded-2xl border border-border/60 bg-background/50">
                        <div className="flex flex-col">
                          <span className="font-bold text-foreground">Single Sign-On (SSO)</span>
                          <span className="text-sm font-medium text-muted-foreground">Coming soon.</span>
                        </div>
                        <Button variant="outline" disabled className="rounded-full font-bold uppercase text-xs">
                          Coming soon
                        </Button>
                      </div>

                      <div className="flex items-center justify-between gap-4 p-5 rounded-2xl border border-border/60 bg-background/50">
                        <div className="flex flex-col">
                          <span className="font-bold text-foreground">Sign out</span>
                          <span className="text-sm font-medium text-muted-foreground">
                            Ends your session on this device.
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          onClick={handleSignOut}
                          disabled={isSigningOut}
                          className="rounded-full font-bold uppercase text-xs shrink-0"
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
                      <h2 className="text-2xl font-extrabold mb-1">Data & Privacy</h2>
                      <p className="text-sm text-muted-foreground font-medium mb-8">
                        Control how long we retain your processed documents.
                      </p>
                    </div>
                    <div className="space-y-4">
                      <div className="flex flex-col gap-4 p-5 rounded-2xl border border-border/60 bg-background/50">
                        <div className="flex flex-col">
                          <span className="font-bold text-foreground">Data Retention Policy</span>
                          <span className="text-sm font-medium text-muted-foreground">
                            Scheduled deletion is on our roadmap. Until it
                            ships, documents stay in your account until you
                            delete them.
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" disabled className="rounded-full font-bold uppercase text-xs">30 Days</Button>
                          <Button variant="outline" disabled className="rounded-full font-bold uppercase text-xs">90 Days</Button>
                          <Button variant="outline" disabled className="rounded-full font-bold uppercase text-xs">Indefinitely</Button>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 p-5 rounded-2xl border border-border/60 bg-background/50">
                        <span className="font-bold text-foreground">Delete a batch</span>
                        <span className="text-sm font-medium text-muted-foreground">
                          Deleting a batch from the dashboard removes its documents,
                          extracted fields, and the stored source files. That is
                          immediate and cannot be undone.
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "team" && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between mb-8">
                      <div>
                        <h2 className="text-2xl font-extrabold mb-1">Team Members</h2>
                        <p className="text-sm text-muted-foreground font-medium">
                          Team workspaces are coming. For now this account is
                          single-user.
                        </p>
                      </div>
                      <Button disabled variant="outline" className="rounded-full font-bold uppercase text-xs">
                        Coming soon
                      </Button>
                    </div>

                    <div className="rounded-2xl border border-border/60 overflow-hidden bg-card">
                      <div className="flex items-center justify-between p-5">
                        <div className="flex items-center gap-4 min-w-0">
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={user?.picture} alt="" />
                            <AvatarFallback className="bg-primary/10 text-primary font-bold">
                              {user?.firstName?.charAt(0) || user?.name?.charAt(0) || "?"}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex flex-col min-w-0">
                            <span className="font-bold text-foreground truncate">
                              {user?.name ?? "—"}
                            </span>
                            <span className="text-xs font-medium text-muted-foreground truncate">
                              {user?.email ?? "—"}
                            </span>
                          </div>
                        </div>
                        <span className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-extrabold uppercase tracking-widest shrink-0">
                          Owner
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "billing" && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-extrabold mb-1">Billing & Plans</h2>
                      <p className="text-sm text-muted-foreground font-medium mb-8">
                        Subscriptions and payment methods.
                      </p>
                    </div>

                    {/* Billing reports the actual account state; no sample
                        subscription or card data is shown. */}
                    <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border/70 bg-background/50 px-6 py-12 text-center">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                        <CreditCard className="h-7 w-7" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-lg font-extrabold text-foreground">
                          No billing set up
                        </h3>
                        <p className="mx-auto max-w-md text-sm font-medium leading-relaxed text-muted-foreground">
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
    </>
  );
}
