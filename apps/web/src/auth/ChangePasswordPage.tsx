import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, Field } from "@contable/design-system";
import { api, ApiError } from "../lib/api";
import { useSession } from "../session/SessionContext";
import "./login.css";

export function ChangePasswordPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (session.status === "loading") return <main className="login login--invitation"><div className="login__card">Validando sesión…</div></main>;
  if (session.status === "unauthenticated") return <Navigate to="/login" replace />;
  if (session.status === "unavailable") return <main className="login login--invitation"><div className="login__card">No se pudo validar la sesión. Reintentá más tarde.</div></main>;
  if (!session.me?.mustChangePassword) return <Navigate to="/" replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmation) { setError("Las contraseñas nuevas no coinciden"); return; }
    setSaving(true);
    setError(null);
    try {
      await api.post("/auth/password/change", { currentPassword, newPassword });
      await session.refresh();
      navigate("/", { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo cambiar la contraseña");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="login login--invitation">
      <div className="login__card">
        <h1 className="login__title">Cambiá tu contraseña temporal</h1>
        <p className="login__subtitle">Elegí una contraseña propia para activar el acceso a tu espacio de trabajo.</p>
        <form className="login__form" onSubmit={(event) => void submit(event)}>
          <Field id="current-password" label="Contraseña temporal" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
          <Field id="new-password" label="Nueva contraseña" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={12} required />
          <Field id="confirm-password" label="Repetir nueva contraseña" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={12} required />
          {error ? <p className="login__error" role="alert">{error}</p> : null}
          <Button type="submit" loading={saving} disabled={currentPassword.length < 8 || newPassword.length < 12 || confirmation.length < 12}>Guardar contraseña</Button>
        </form>
      </div>
    </main>
  );
}
