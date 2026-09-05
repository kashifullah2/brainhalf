import { Link } from "@remix-run/react";
import { ThemeToggle } from "../theme-toggle";

const nav = [
  { to: "/studio", label: "Studio" },
  { to: "/arcade", label: "Arcade" },
  { to: "/pricing", label: "Pricing" },
];

export function SiteHeader() {
  return (
    <header className="landing-header">
      <div className="landing-header-inner">
        <Link to="/" className="landing-logo">
          <span className="landing-logo-dot" aria-hidden />
          <span>brainhalf</span>
        </Link>

        <nav className="landing-nav" aria-label="Main">
          {nav.map((item) => (
            <Link key={item.to} to={item.to} className="landing-nav-link">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="landing-header-actions">
          <ThemeToggle />
          <Link to="/sign-in" className="landing-nav-link landing-nav-link-muted">
            Sign in
          </Link>
          <Link to="/studio" className="landing-btn-primary landing-btn-sm">
            Open studio
          </Link>
        </div>
      </div>
    </header>
  );
}
