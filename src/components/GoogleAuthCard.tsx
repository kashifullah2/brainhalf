import React, { useState, useEffect, useRef } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ShieldCheck, ArrowRight, Eye, EyeOff, CheckCircle2, AlertCircle, Mail, XCircle } from "lucide-react";

interface AuthCardProps {
  mode?: "sign-in" | "sign-up" | "forgot-password";
}

function getPasswordStrength(pass: string) {
  if (!pass) return { score: 0, text: "", color: "bg-muted", width: "w-0" };
  let score = 0;
  if (pass.length >= 6) score += 1;
  if (pass.length >= 10) score += 1;
  if (/[A-Z]/.test(pass)) score += 1;
  if (/[0-9]/.test(pass)) score += 1;
  if (/[^A-Za-z0-9]/.test(pass)) score += 1;

  if (score <= 2) return { score: 1, text: "Weak", color: "bg-destructive", width: "w-1/3" };
  if (score === 3 || score === 4) return { score: 2, text: "Good", color: "bg-yellow-500", width: "w-2/3" };
  return { score: 3, text: "Strong", color: "bg-emerald-500", width: "w-full" };
}

export function GoogleAuthCard({ mode: initialMode = "sign-in" }: AuthCardProps) {
  const [, setLocation] = useLocation();
  const { loginWithGoogle, loginWithEmail, signupWithEmail, resetPassword, renderGoogleButton, clientId, isGoogleLoaded, isSignedIn, isLoading } = useAuth();
  
  const [currentMode, setCurrentMode] = useState<"sign-in" | "sign-up" | "forgot-password">(initialMode);
  
  // Form fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreedToLicense, setAgreedToLicense] = useState(false);
  const [rememberMe, setRememberMe] = useState(false); // Fixed: default to false for privacy/security

  // UI States
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [topErrorMsg, setTopErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const googleBtnContainerRef = useRef<HTMLDivElement>(null);

  // Derived UX states
  const passwordStrength = getPasswordStrength(password);
  const passwordsMatch = password.length > 0 && confirmPassword.length > 0 && password === confirmPassword;
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const isSubmitDisabled = isLoading || isSubmitting;

  useEffect(() => {
    setCurrentMode(initialMode);
    setTopErrorMsg(null);
    setSuccessMsg(null);
    setErrors({});
  }, [initialMode]);

  useEffect(() => {
    if (isSignedIn) {
      setLocation("/app");
    }
  }, [isSignedIn, setLocation]);

  useEffect(() => {
    if (googleBtnContainerRef.current && clientId) {
      renderGoogleButton(googleBtnContainerRef.current);
    }
  }, [clientId, renderGoogleButton]);

  const handleGoogleLogin = async () => {
    setTopErrorMsg(null);
    setIsSubmitting(true);
    try {
      await loginWithGoogle(email || undefined);
      setLocation("/app");
    } catch (err: any) {
      setTopErrorMsg(err.message || "Failed to sign in with Google");
    } finally {
      setIsSubmitting(false);
    }
  };

  const validateSignUp = () => {
    const newErrors: Record<string, string> = {};
    if (!firstName.trim()) newErrors.firstName = "First name is required";
    if (!lastName.trim()) newErrors.lastName = "Last name is required";
    if (!email.trim() || !email.includes("@")) newErrors.email = "Valid email is required";
    if (!password || password.length < 10) newErrors.password = "Password must be at least 10 characters";
    if (password !== confirmPassword) newErrors.confirmPassword = "Passwords do not match";
    if (!agreedToLicense) newErrors.agreedToLicense = "You must agree to the Terms to continue";
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateSignIn = () => {
    const newErrors: Record<string, string> = {};
    if (!email.trim() || !email.includes("@")) newErrors.email = "Valid email is required";
    if (!password) newErrors.password = "Password is required";
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateForgot = () => {
    const newErrors: Record<string, string> = {};
    if (!email.trim() || !email.includes("@")) newErrors.email = "Valid email is required";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTopErrorMsg(null);
    setSuccessMsg(null);
    setErrors({});

    if (currentMode === "sign-up") {
      if (!validateSignUp()) return;
      setIsSubmitting(true);
      try {
        await signupWithEmail({ firstName, lastName, email, password });
        setLocation("/app");
      } catch (err: any) {
        setTopErrorMsg(err.message || "Sign up failed. Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    } else if (currentMode === "sign-in") {
      if (!validateSignIn()) return;
      setIsSubmitting(true);
      try {
        await loginWithEmail({ email, password });
        setLocation("/app");
      } catch (err: any) {
        setTopErrorMsg(err.message || "Invalid credentials. Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    } else if (currentMode === "forgot-password") {
      if (!validateForgot()) return;
      setIsSubmitting(true);
      try {
        await resetPassword(email);
        setSuccessMsg(`Password reset instructions sent to ${email}. Check your inbox.`);
      } catch (err: any) {
        setTopErrorMsg(err.message || "Could not process password reset request.");
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* Header */}
      <div className="space-y-1.5 text-center sm:text-left">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
          {currentMode === "sign-in" && "Welcome back"}
          {currentMode === "sign-up" && "Create an account"}
          {currentMode === "forgot-password" && "Reset password"}
        </h1>
        <p className="text-sm font-medium text-muted-foreground">
          {currentMode === "sign-in" && "Your batches are right where you left them."}
          {currentMode === "sign-up" && "Free while we build the paid plans. No card, no sales call."}
          {currentMode === "forgot-password" && "Tell us the email you signed up with and we'll send a reset link."}
        </p>
      </div>

      {/* Top-Level Error / Success Notifications */}
      {topErrorMsg && (
        <div className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-semibold flex items-start gap-2.5 animate-in fade-in slide-in-from-top-1">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{topErrorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-start gap-2.5 animate-in fade-in slide-in-from-top-1">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Primary Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* SIGN UP FIELDS */}
        {currentMode === "sign-up" && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-foreground">First Name</label>
                <Input
                  type="text"
                  placeholder=""
                  value={firstName}
                  onChange={(e) => { setFirstName(e.target.value); if(errors.firstName) setErrors({...errors, firstName: ""}) }}
                  className={`h-11 rounded-xl bg-card font-medium text-sm transition-colors ${errors.firstName ? 'border-destructive focus-visible:ring-destructive' : 'border-border/80 focus:border-primary'}`}
                />
                {errors.firstName && <span className="text-[11px] font-semibold text-destructive">{errors.firstName}</span>}
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-foreground">Last Name</label>
                <Input
                  type="text"
                  placeholder=""
                  value={lastName}
                  onChange={(e) => { setLastName(e.target.value); if(errors.lastName) setErrors({...errors, lastName: ""}) }}
                  className={`h-11 rounded-xl bg-card font-medium text-sm transition-colors ${errors.lastName ? 'border-destructive focus-visible:ring-destructive' : 'border-border/80 focus:border-primary'}`}
                />
                {errors.lastName && <span className="text-[11px] font-semibold text-destructive">{errors.lastName}</span>}
              </div>
            </div>

            <div className="space-y-1.5 w-full overflow-hidden">
              <label className="text-[13px] font-semibold text-foreground">Email</label>
              <Input
                type="email"
                maxLength={255}
                placeholder="name@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if(errors.email) setErrors({...errors, email: ""}) }}
                className={`h-11 rounded-xl bg-card font-medium text-sm truncate transition-colors ${errors.email ? 'border-destructive focus-visible:ring-destructive' : 'border-border/80 focus:border-primary'}`}
              />
              {errors.email && <span className="text-[11px] font-semibold text-destructive">{errors.email}</span>}
            </div>

            <div className="space-y-1.5 w-full overflow-hidden">
              <label className="text-[13px] font-semibold text-foreground flex justify-between">
                Password
                {password.length > 0 && (
                  <span className={`text-[11px] font-bold ${passwordStrength.text === 'Weak' ? 'text-destructive' : passwordStrength.text === 'Good' ? 'text-yellow-600 dark:text-yellow-500' : 'text-emerald-500'}`}>
                    {passwordStrength.text}
                  </span>
                )}
              </label>
              <div className="relative w-full">
                <Input
                  type={showPassword ? "text" : "password"}
                  maxLength={128}
                  placeholder="Create a strong password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if(errors.password) setErrors({...errors, password: ""}) }}
                  className={`h-11 rounded-xl bg-card font-medium text-sm pr-10 truncate transition-colors ${errors.password ? 'border-destructive focus-visible:ring-destructive' : 'border-border/80 focus:border-primary'}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary z-10"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {/* Password strength meter line */}
              <div className="h-1 w-full bg-muted rounded-full mt-1.5 overflow-hidden flex">
                <div className={`h-full ${passwordStrength.width} ${passwordStrength.color} transition-all duration-300 ease-out`} />
              </div>
              {password.length === 0 && <p className="text-[11px] text-muted-foreground mt-1 font-medium">Use 10+ characters with a mix of letters, numbers & symbols.</p>}
              {errors.password && <span className="text-[11px] font-semibold text-destructive">{errors.password}</span>}
            </div>

            <div className="space-y-1.5 w-full overflow-hidden">
              <label className="text-[13px] font-semibold text-foreground">Confirm Password</label>
              <div className="relative w-full">
                <Input
                  type={showConfirmPassword ? "text" : "password"}
                  maxLength={128}
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); if(errors.confirmPassword) setErrors({...errors, confirmPassword: ""}) }}
                  onBlur={() => {
                    if (confirmPassword.length > 0 && password !== confirmPassword) {
                      setErrors({...errors, confirmPassword: "Passwords do not match"});
                    }
                  }}
                  className={`h-11 rounded-xl bg-card font-medium text-sm pr-10 truncate transition-colors ${passwordsMismatch || errors.confirmPassword ? 'border-destructive focus-visible:ring-destructive' : passwordsMatch ? 'border-emerald-500/50 focus-visible:ring-emerald-500' : 'border-border/80 focus:border-primary'}`}
                />
                
                {/* Status Indicator */}
                <div className="absolute right-9 top-1/2 -translate-y-1/2 flex items-center pr-2 pointer-events-none z-10">
                  {passwordsMatch && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                  {passwordsMismatch && <XCircle className="w-4 h-4 text-destructive" />}
                </div>

                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary z-10"
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.confirmPassword && <span className="text-[11px] font-semibold text-destructive">{errors.confirmPassword}</span>}
            </div>

            <hr className="my-2 border-border/40" />

            {/* License Agreement Checkbox (Explicitly styled as Checkbox) */}
            <div className="space-y-2">
              <div className="flex items-start gap-3 pt-2">
                <Checkbox
                  id="license-agree"
                  checked={agreedToLicense}
                  onCheckedChange={(checked) => { setAgreedToLicense(!!checked); if(errors.agreedToLicense) setErrors({...errors, agreedToLicense: ""}) }}
                  className={`mt-0.5 rounded shadow-sm w-4 h-4 shrink-0 transition-colors ${errors.agreedToLicense ? 'border-destructive bg-destructive/10' : ''}`}
                />
                <label htmlFor="license-agree" className="text-xs font-medium leading-normal text-muted-foreground cursor-pointer select-none max-w-[280px]">
                  I agree with the <a href="/terms" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold text-foreground underline hover:text-primary transition-colors">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold text-foreground underline hover:text-primary transition-colors">Privacy Policy</a>
                </label>
              </div>
              {errors.agreedToLicense && <p className="text-[11px] font-semibold text-destructive pl-7">{errors.agreedToLicense}</p>}
            </div>
          </>
        )}

        {/* SIGN IN FIELDS */}
        {currentMode === "sign-in" && (
          <>
            <div className="space-y-1.5 w-full overflow-hidden">
              <label className="text-[13px] font-semibold text-foreground">Work Email</label>
              <Input
                type="email"
                maxLength={255}
                placeholder="name@brainhalf.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if(errors.email) setErrors({...errors, email: ""}) }}
                className={`h-11 rounded-xl bg-card font-medium text-sm truncate transition-colors ${errors.email ? 'border-destructive focus-visible:ring-destructive' : 'border-border/80 focus:border-primary'}`}
              />
              {errors.email && <span className="text-[11px] font-semibold text-destructive">{errors.email}</span>}
            </div>

            <div className="space-y-1.5 w-full overflow-hidden">
              <div className="flex items-center justify-between">
                <label className="text-[13px] font-semibold text-foreground">Password</label>
                <button
                  type="button"
                  onClick={() => setCurrentMode("forgot-password")}
                  className="text-[13px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm -mr-1"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative w-full">
                <Input
                  type={showPassword ? "text" : "password"}
                  maxLength={128}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if(errors.password) setErrors({...errors, password: ""}) }}
                  className={`h-11 rounded-xl bg-card font-medium text-sm pr-10 truncate transition-colors ${errors.password ? 'border-destructive focus-visible:ring-destructive' : 'border-border/80 focus:border-primary'}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary z-10"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <span className="text-[11px] font-semibold text-destructive">{errors.password}</span>}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Checkbox
                id="remember-me"
                checked={rememberMe}
                onCheckedChange={(checked) => setRememberMe(!!checked)}
                className="rounded shadow-sm w-4 h-4"
              />
              <label htmlFor="remember-me" className="text-xs font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors">
                Remember me on this browser
              </label>
            </div>
          </>
        )}

        {/* FORGOT PASSWORD FIELDS */}
        {currentMode === "forgot-password" && (
          <div className="space-y-1.5">
            <label className="text-[13px] font-semibold text-foreground">Account Email</label>
            <Input
              type="email"
              placeholder="name@brainhalf.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); if(errors.email) setErrors({...errors, email: ""}) }}
              className={`h-11 rounded-xl bg-card font-medium text-sm transition-colors ${errors.email ? 'border-destructive focus-visible:ring-destructive' : 'border-border/80 focus:border-primary'}`}
            />
            {errors.email && <span className="text-[11px] font-semibold text-destructive">{errors.email}</span>}
          </div>
        )}

        {/* Submit Action Button */}
        <Button
          type="submit"
          disabled={isSubmitDisabled}
          className={`w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm shadow-md shadow-primary/20 transition-all flex items-center justify-center gap-2 mt-4 ${isSubmitDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isSubmitting ? (
            <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
          ) : (
            <>
              {currentMode === "sign-in" && <span>Sign In</span>}
              {currentMode === "sign-up" && <span>Create Account</span>}
              {currentMode === "forgot-password" && <Mail className="w-4 h-4" />}
              {currentMode === "forgot-password" && <span>Send Recovery Email</span>}
            </>
          )}
        </Button>
      </form>

      {/* Google Auth Section for Sign In / Sign Up modes */}
      {currentMode !== "forgot-password" && (isLoading || clientId) && (
        <div className="flex flex-col gap-5 pt-2">
          {/* Divider */}
          <div className="relative flex items-center justify-center">
            <div className="border-t border-border/60 w-full" />
            <span className="bg-background px-4 text-[11px] font-bold tracking-widest text-muted-foreground uppercase absolute top-1/2 -translate-y-1/2">
              Or continue with
            </span>
          </div>

          {/* Official Google Identity Button Container */}
          <div className="w-full flex flex-col gap-3 items-center justify-center">
            <div className="relative w-full min-h-[44px] flex justify-center">
              {(!isGoogleLoaded || isLoading) && (
                <div className="absolute inset-0 w-full h-[44px] rounded-xl bg-card border border-border/80 flex items-center justify-center animate-pulse shadow-sm">
                  <div className="flex gap-3 items-center">
                    <div className="w-5 h-5 rounded-full bg-muted-foreground/20" />
                    <div className="w-32 h-3 rounded-full bg-muted-foreground/20" />
                  </div>
                </div>
              )}
              <div ref={googleBtnContainerRef} className="w-full flex justify-center z-10" />
            </div>
          </div>
        </div>
      )}

      {/* Footer Navigation Links */}
      <div className="pt-3 text-center text-[13px] font-medium text-muted-foreground">
        {currentMode === "sign-in" && (
          <p>
            Don't have an account?{" "}
            <Link href="/sign-up" onClick={() => setCurrentMode("sign-up")} className="font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm">
              Create account
            </Link>
          </p>
        )}

        {currentMode === "sign-up" && (
          <p>
            Already have an account?{" "}
            <Link href="/sign-in" onClick={() => setCurrentMode("sign-in")} className="font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm">
              Sign in
            </Link>
          </p>
        )}

        {currentMode === "forgot-password" && (
          <p>
            Remembered your password?{" "}
            <button
              type="button"
              onClick={() => setCurrentMode("sign-in")}
              className="font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
            >
              Back to Sign in
            </button>
          </p>
        )}
      </div>

    </div>
  );
}
