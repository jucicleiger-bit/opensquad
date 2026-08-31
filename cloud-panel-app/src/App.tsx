import { Routes, Route, Navigate } from "react-router-dom";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<div>Login placeholder — Task 2 replaces this</div>} />
    </Routes>
  );
}
