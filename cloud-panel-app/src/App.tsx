import { Routes, Route } from "react-router-dom";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Approval } from "@/pages/Approval";
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
        path="/projects/:projectId/aprovacao"
        element={
          <RequireAuth>
            <Approval />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
