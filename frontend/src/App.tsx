import { Route, Routes } from "react-router-dom";
import AuthPage from "./pages/AuthPage";
import DashboardPage from "./pages/DashboardPage";
import RequireAuth from "./auth/RequireAuth";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<DashboardPage />} />
      </Route>
    </Routes>
  );
}