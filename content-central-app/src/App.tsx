import { Navigate, Route, Routes } from "react-router-dom";
import { RootLayout } from "@/layouts/RootLayout";
import { ProjectWorkspaceLayout } from "@/layouts/ProjectWorkspaceLayout";
import { Dashboard } from "@/pages/Dashboard";
import { Overview } from "@/pages/workspace/Overview";
import { Company } from "@/pages/workspace/Company";
import { SegmentLearning } from "@/pages/workspace/SegmentLearning";
import { References } from "@/pages/workspace/References";
import { Offers } from "@/pages/workspace/Offers";
import { Pillars } from "@/pages/workspace/Pillars";
import { GenerateContent } from "@/pages/workspace/GenerateContent";
import { AdCreatives } from "@/pages/workspace/AdCreatives";
import { TestPost } from "@/pages/workspace/TestPost";
import { PendingApproval } from "@/pages/workspace/PendingApproval";
import { Calendar } from "@/pages/workspace/Calendar";
import { Account } from "@/pages/workspace/Account";

export function App() {
  return (
    <Routes>
      <Route element={<RootLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects/:projectId" element={<ProjectWorkspaceLayout />}>
          <Route index element={<Navigate to="visao-geral" replace />} />
          <Route path="visao-geral" element={<Overview />} />
          <Route path="empresa" element={<Company />} />
          <Route path="aprendizado-segmento" element={<SegmentLearning />} />
          <Route path="referencias" element={<References />} />
          <Route path="ofertas" element={<Offers />} />
          <Route path="pilares" element={<Pillars />} />
          <Route path="gerar" element={<GenerateContent />} />
          <Route path="anuncios" element={<AdCreatives />} />
          <Route path="teste" element={<TestPost />} />
          <Route path="aguardando" element={<PendingApproval />} />
          <Route path="calendario" element={<Calendar />} />
          <Route path="conta" element={<Account />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
