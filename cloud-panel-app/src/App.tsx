import { Routes, Route } from "react-router-dom";
import { Login } from "@/pages/Login";
import { RequireAuth } from "@/components/RequireAuth";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <div>Dashboard placeholder — Task 3 replaces this</div>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
