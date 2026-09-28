import { Navigate } from "react-router-dom";
import { useSelector } from "react-redux";

// Wrap any page that requires auth: <ProtectedRoute><Dashboard /></ProtectedRoute>
export default function ProtectedRoute({ children }) {
  const user = useSelector((s) => s.auth.user);
  const hasToken = !!localStorage.getItem("ledger_token");

  if (!user && !hasToken) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
