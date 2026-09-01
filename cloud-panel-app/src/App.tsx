import { Routes, Route } from "react-router-dom";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Overview } from "@/pages/Overview";
import { Approval } from "@/pages/Approval";
import { CalendarPage } from "@/pages/Calendar";
import { Company } from "@/pages/Company";
import { Offers } from "@/pages/Offers";
import { Pillars } from "@/pages/Pillars";
import { References } from "@/pages/References";
import { SegmentLearning } from "@/pages/SegmentLearning";
import { OfferTypeLearning } from "@/pages/OfferTypeLearning";
import { SegmentTemplates } from "@/pages/SegmentTemplates";
import { Account } from "@/pages/Account";
import { RootLayout } from "@/layouts/RootLayout";
import { ProjectWorkspaceLayout } from "@/layouts/ProjectWorkspaceLayout";
import { RequireAuth } from "@/components/RequireAuth";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <RootLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/conta" element={<Account />} />
        <Route path="/aprendizado/tipos-de-oferta" element={<OfferTypeLearning />} />
        <Route path="/aprendizado/templates" element={<SegmentTemplates />} />
        <Route path="/projects/:projectId" element={<ProjectWorkspaceLayout />}>
          <Route path="visao-geral" element={<Overview />} />
          <Route path="empresa" element={<Company />} />
          <Route path="referencias" element={<References />} />
          <Route path="ofertas" element={<Offers />} />
          <Route path="pilares" element={<Pillars />} />
          <Route path="aguardando" element={<Approval />} />
          <Route path="calendario" element={<CalendarPage />} />
          <Route path="aprendizado" element={<SegmentLearning />} />
        </Route>
      </Route>
    </Routes>
  );
}
