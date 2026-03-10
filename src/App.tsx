import { useState } from "react";
import { Titlebar } from "@/components/titlebar";
import { HomeView } from "@/components/views/home-view";

function App() {
  const [isDark, setIsDark] = useState(true);

  return (
    <div className={isDark ? "dark" : ""}>
      <div className="flex h-screen flex-col bg-background text-foreground transition-colors duration-300">
        <Titlebar isDark={isDark} onToggleTheme={() => setIsDark(!isDark)} />
        <div className="relative flex-1 overflow-hidden">
          <HomeView isDark={isDark} />
        </div>
      </div>
    </div>
  );
}

export default App;
