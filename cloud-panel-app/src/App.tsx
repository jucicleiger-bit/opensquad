import { Routes, Route } from "react-router-dom";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Approval } from "@/pages/Approval";
import { CalendarPage } from "@/pages/Calendar";
import { Company } from "@/pages/Company";
import { OffersAndPillars } from "@/pages/OffersAndPillars";
import { References } from "@/pages/References";
import { SegmentLearning } from "@/pages/SegmentLearning";
import { OfferTypeLearning } from "@/pages/OfferTypeLearning";
import { SegmentTemplates } from "@/pages/SegmentTemplates";
import { Account } from "@/pages/Account";
import { RequireAuth } from "@/components/RequireAuth";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/conta"
        element={
          <RequireAuth>
            <Account />
          </RequireAuth>
        }
      />
      <Route
        path="/projects/:projectId/aprovacao"
        element={
          <RequireAuth>
            <Approval />
          </RequireAuth>
        }
      />
      <Route
        path="/projects/:projectId/calendario"
        element={
          <RequireAuth>
            <CalendarPage />
          </RequireAuth>
        }
      />
      <Route
        path="/projects/:projectId/empresa"
        element={
          <RequireAuth>
            <Company />
          </RequireAuth>
        }
      />
      <Route
        path="/projects/:projectId/ofertas"
        element={
          <RequireAuth>
            <OffersAndPillars />
          </RequireAuth>
        }
      />
      <Route
        path="/projects/:projectId/referencias"
        element={
          <RequireAuth>
            <References />
          </RequireAuth>
        }
      />
      <Route
        path="/projects/:projectId/aprendizado"
        element={
          <RequireAuth>
            <SegmentLearning />
          </RequireAuth>
        }
      />
      <Route
        path="/aprendizado/tipos-de-oferta"
        element={
          <RequireAuth>
            <OfferTypeLearning />
          </RequireAuth>
        }
      />
      <Route
        path="/aprendizado/templates"
        element={
          <RequireAuth>
            <SegmentTemplates />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
