import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { getPlatform } from "./mobile/api";
import { logFrontend } from "./api";
import "./styles/tokens.css";
import { applySavedTheme } from "./theme";
applySavedTheme();

function describe(reason: unknown): string {
  if (reason instanceof Error) return reason.stack ?? reason.message;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}
window.addEventListener("error", (e) => {
  void logFrontend(`uncaught: ${e.message} (${e.filename}:${e.lineno})`);
});
window.addEventListener("unhandledrejection", (e) => {
  void logFrontend(`unhandled rejection: ${describe(e.reason)}`);
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

const App = React.lazy(() => import("./App"));
const MobileApp = React.lazy(() =>
  import("./mobile/MobileApp").then((m) => ({ default: m.MobileApp })),
);

function Root() {
  const platform = useQuery({
    queryKey: ["platform"],
    queryFn: getPlatform,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  if (platform.isLoading) return null;
  return (
    <React.Suspense fallback={null}>
      {platform.data?.mobile ? <MobileApp /> : <App />}
    </React.Suspense>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  </React.StrictMode>,
);
