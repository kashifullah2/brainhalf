// ---------------------------------------------------------------------------
// Password reset landing page.
//
// functions/api/auth/password-reset.ts emails `${origin}/reset-password?token=`,
// and this page completes the flow by calling POST /auth/password-reset-confirm.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { usePageTitle } from "@/lib/use-page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { errorMessage } from "@/lib/humanize-error";

/** Mirrors MIN_PASSWORD_LENGTH in server/http.ts. The server still decides. */
const MIN_PASSWORD_LENGTH = 10;

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const { confirmPasswordReset } = useAuth();
  usePageTitle("Reset password · BrainHalf", { noindex: true });

  // A reset link is always a fresh document load, so the query string is read
  // once rather than subscribed to.
  const token = useMemo(
    () => new URLSearchParams(window.location.search).get("token") ?? "",
    [],
  );

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const matches = confirmPassword.length > 0 && password === confirmPassword;
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const canSubmit =
    !isSubmitting && password.length >= MIN_PASSWORD_LENGTH && matches;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg("");

    if (password.length < MIN_PASSWORD_LENGTH) {
      setErrorMsg(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg("The two passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      await confirmPasswordReset(token, password);
      // The endpoint signs the user in, so land them in the app rather than
      // asking for the password they just set.
      setLocation("/app");
    } catch (error) {
      setErrorMsg(
        errorMessage(error, "Could not reset the password."),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            This link is not valid
          </h1>
          <p className="text-body font-medium text-muted-foreground">
            The reset link is missing its token. Reset links expire after an hour
            and can only be used once, so request a new one.
          </p>
        </div>
        <Button asChild className="h-11 px-5 text-body font-semibold">
          <Link href="/sign-in">
            Back to sign in
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Choose a new password
        </h1>
        <p className="text-body font-medium text-muted-foreground">
          Setting a new password signs out every other device on this account.
        </p>
      </div>

      {errorMsg && (
        <div className="rounded-lg p-3.5 bg-destructive/10 border border-destructive/20 text-destructive text-label font-semibold flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5 w-full overflow-hidden">
          <label htmlFor="new-password" className="text-body-sm font-semibold text-foreground">
            New password
          </label>
          <div className="relative w-full">
            <Input
              id="new-password"
              type={showPassword ? "text" : "password"}
              maxLength={128}
              autoComplete="new-password"
              aria-invalid={tooShort}
              aria-describedby={tooShort ? "new-password-error" : undefined}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`h-11 truncate pr-10 ${
                tooShort
                  ? "border-destructive focus-visible:ring-destructive"
                  : ""
              }`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary z-10"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
          {tooShort && (
            <span id="new-password-error" className="text-caption font-semibold text-destructive">
              Password must be at least {MIN_PASSWORD_LENGTH} characters.
            </span>
          )}
        </div>

        <div className="space-y-1.5 w-full overflow-hidden">
          <label htmlFor="confirm-new-password" className="text-body-sm font-semibold text-foreground">
            Confirm new password
          </label>
          <div className="relative w-full">
            <Input
              id="confirm-new-password"
              type={showPassword ? "text" : "password"}
              maxLength={128}
              autoComplete="new-password"
              aria-invalid={mismatch}
              placeholder="Repeat the password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={`h-11 truncate pr-10 ${
                mismatch
                  ? "border-destructive focus-visible:ring-destructive"
                  : matches
                    ? "border-success/60 focus-visible:ring-success"
                    : ""
              }`}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center pointer-events-none z-10">
              {matches && <CheckCircle2 className="h-4 w-4 text-success" />}
              {mismatch && <XCircle className="w-4 h-4 text-destructive" />}
            </div>
          </div>
          {mismatch && (
            <span className="text-caption font-semibold text-destructive">
              The two passwords do not match.
            </span>
          )}
        </div>

        <Button
          type="submit"
          disabled={!canSubmit}
          className="h-11 w-full text-body font-semibold"
        >
          {isSubmitting ? "Saving..." : "Set new password"}
          {!isSubmitting && <ArrowRight className="h-4 w-4" />}
        </Button>
      </form>

      <div className="flex items-center gap-2 text-caption font-semibold text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
        <span>Reset links expire one hour after they are requested.</span>
      </div>

      <p className="text-label font-medium text-muted-foreground">
        Changed your mind?{" "}
        <Link href="/sign-in" className="font-semibold text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
