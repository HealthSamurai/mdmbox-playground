import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router";
import "./styles.css";
import { PatientsPage } from "./pages/patients";
import { MatchPage } from "./pages/match";
import { MergePage } from "./pages/merge";
import { MergesPage } from "./pages/merges";
import { MergeDetailPage } from "./pages/merge-detail";
import { UnmergesPage } from "./pages/unmerges";
import { UnmergeDetailPage } from "./pages/unmerge-detail";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PatientsPage />} />
        <Route path="/patients" element={<PatientsPage />} />
        <Route path="/patients/:id" element={<MatchPage />} />
        <Route path="/merge" element={<MergePage />} />
        <Route path="/merges" element={<MergesPage />} />
        <Route path="/merges/:id" element={<MergeDetailPage />} />
        <Route path="/unmerges" element={<UnmergesPage />} />
        <Route path="/unmerges/:id" element={<UnmergeDetailPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
