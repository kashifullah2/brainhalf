

import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeInitScript = () => {
  const script = `
    (function() {
      try {
        var storedTheme = localStorage.getItem('brainhalf-theme');
        var systemLight = window.matchMedia('(prefers-color-scheme: light)').matches;
        if (storedTheme === 'light' || (!storedTheme && systemLight)) {
          document.documentElement.classList.add('light');
        } else {
          document.documentElement.classList.remove('light');
        }
      } catch (e) {}
    })();
  `;
  // eslint-disable-next-line react/no-danger
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
};

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const storedTheme = localStorage.getItem("brainhalf-theme") as Theme | null;
    const systemPrefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;

    let initialTheme: Theme = "dark";
    if (storedTheme) {
      initialTheme = storedTheme;
    } else if (systemPrefersLight) {
      initialTheme = "light";
    }

    setTheme(initialTheme);
    applyTheme(initialTheme);
  }, []);

  const applyTheme = (newTheme: Theme) => {
    const html = document.documentElement;
    if (newTheme === "light") {
      html.classList.add("light");
      html.classList.remove("dark");
    } else {
      html.classList.remove("light");
      html.classList.add("dark");
    }
  };

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    localStorage.setItem("brainhalf-theme", newTheme);
    applyTheme(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
