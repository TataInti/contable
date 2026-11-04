import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button, Field } from "@contable/design-system";
import { api, ApiError } from "../lib/api";
import { Icon } from "../ui/Icon";
import "./login.css";

/**
 * Recuperación de acceso para miembros internos: página pública donde el
 * usuario canjea el enlace de un solo uso que le entregó el administrador del
 * estudio y define su contraseña nueva. El admin nunca ve ni define esa
 * contraseña; el token es de un solo uso y tiene caducidad corta (backend).
 */
export function RecoverAccessPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // El fragmento no viaja en HTTP ni aparece en el access log del servidor.
  const token = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const passwordsMatch = password.length >= 12 && password === confirmPassword;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!passwordsMatch) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.post("/auth/access-recovery/redeem", { token, newPassword: password });
      setPassword("");
      setConfirmPassword("");
      navigate("/login", {
        replace: true,
        state: { notice: "Contraseña actualizada. Iniciá sesión con tu nueva contraseña." },
      });
    } catch (caught) {
      // El backend responde con un error genérico a propósito: no revela si el
      // enlace expiró, fue usado o es inválido.
      setError(
        caught instanceof ApiError
          ? caught.message
          : "El enlace de recuperación es inválido, expiró o ya fue usado. Pedile un enlace nuevo a quien administra el estudio.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login login--invitation">
      <div className="login__card">
        <div className="login__brand">
          <span className="login__brand-mark" aria-hidden="true">
            C
          </span>
          <span>
            <span className="login__brand-name">Contable</span>
            <span className="login__brand-tag">Recuperación de acceso</span>
          </span>
        </div>
        <div className="login__secure">
          <Icon name="shield" size={15} /> Enlace de un solo uso
        </div>
        <h1 className="login__title">Definí tu contraseña nueva</h1>
        <p className="login__subtitle">
          Tu administrador generó un enlace de recuperación. Elegí una contraseña nueva para
          volver a ingresar al estudio. El enlace sólo puede usarse una vez.
        </p>
        {!token ? (
          <div className="login__error" role="alert">
            El enlace de recuperación está incompleto. Pedile uno nuevo a quien administra el
            estudio.
          </div>
        ) : (
          <form className="login__form" onSubmit={submit}>
            <Field
              id="recovery-password"
              label="Contraseña nueva"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={12}
              hint="Mínimo 12 caracteres."
              required
            />
            <Field
              id="recovery-password-confirm"
              label="Repetir contraseña nueva"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={12}
              required
            />
            {error ? (
              <div className="login__error" role="alert">
                {error}
              </div>
            ) : null}
            <Button type="submit" loading={loading} disabled={!passwordsMatch}>
              Guardar contraseña <Icon name="arrow-right" size={17} />
            </Button>
          </form>
        )}
        <p className="login__privacy">
          <Icon name="shield" size={14} /> Si el enlace ya se usó o expiró, tu administrador debe
          generarte uno nuevo.
        </p>
      </div>
    </main>
  );
}
