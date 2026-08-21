import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { logFrontend } from "./api";
import "./styles.css";

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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
