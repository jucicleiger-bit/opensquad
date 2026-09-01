import { Routes, Route } from "react-router-dom";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Overview } from "@/pages/Overview";
import { Approval } from "@/pages/Approval";
import { CalendarPage } from "@/pages/Calendar";
import { Company } from "@/pages/Company";
import { OffersAndPillars } from "@/pages/OffersAndPillars";
import { References } from "@/pages/References";
import { SegmentLearning } from "@/pages/SegmentLearning";
import { OfferTypeLearning } from "@/pages/OfferTypeLearning";
import { SegmentTemplates } from "@/pages/SegmentTemplates";
import { Account } from "@/pages/Account";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/conta" element={<Account />} />
        <Route path="/projects/:projectId/visao-geral" element={<Overview />} />
        <Route path="/projects/:projectId/aprovacao" element={<Approval />} />
        <Route path="/projects/:projectId/calendario" element={<CalendarPage />} />
        <Route path="/projects/:projectId/empresa" element={<Company />} />
        <Route path="/projects/:projectId/ofertas" element={<OffersAndPillars />} />
        <Route path="/projects/:projectId/referencias" element={<References />} />
        <Route path="/projects/:projectId/aprendizado" element={<SegmentLearning />} />
        <Route path="/aprendizado/tipos-de-oferta" element={<OfferTypeLearning />} />
        <Route path="/aprendizado/templates" element={<SegmentTemplates />} />
      </Route>
    </Routes>
  );
}
