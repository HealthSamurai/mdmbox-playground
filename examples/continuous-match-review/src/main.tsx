import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import "./styles.css";
import { Layout } from "./components/layout";
import { DashboardPage } from "./pages/dashboard";
import { ReviewPage } from "./pages/review";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="pairs/:id1/:id2" element={<ReviewPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
    <Toaster position="top-right" richColors closeButton />
  </StrictMode>,
);
