import { useState } from "react";
import { Button, Field, Notice } from "@contable/design-system";
import { useLocation, useNavigate } from "react-router-dom";
import { login, verifyMfa } from "../lib/auth";
import { ApiError } from "../lib/api";
import { useSession } from "../session/SessionContext";
import { Icon } from "../ui/Icon";
import "./login.css";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState<{ email?: string; password?: string }>({});
  const notice = (location.state as { notice?: string } | null)?.notice;

  const finish = async () => {
    await session.refresh();
    const state = location.state as { from?: string } | null;
    navigate(state?.from ?? "/", { replace: true });
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!challenge) {
      const faltan = {
        email: email.trim() ? undefined : "Ingresá tu correo.",
        password: password ? undefined : "Ingresá tu contraseña.",
      };
      setMissing(faltan);
      if (faltan.email) return void document.getElementById("email")?.focus();
      if (faltan.password) return void document.getElementById("password")?.focus();
    }
    setLoading(true);
    try {
      if (challenge) {
        await verifyMfa(challenge, code);
        await finish();
        return;
      }
      const result = await login(email, password);
      if (result.status === "MFA_REQUIRED") {
        setChallenge(result.mfaSessionToken);
        setCode("");
      } else {
        await finish();
      }
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.message === "Credenciales inválidas"
          ? "El correo o la contraseña no coinciden. Revisalos y probá de nuevo."
          : caught instanceof ApiError
            ? caught.message
            : "No se pudo iniciar sesión",
      );
      if (!challenge) document.getElementById("email")?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login">
      <section className="login__story" aria-label="Contable">
        <div className="login__brand" aria-label="Contable">
          <span className="login__brand-mark" aria-hidden="true">
            C
          </span>
          <span>
            <span className="login__brand-name">Contable</span>
            <span className="login__brand-tag">Gestión del estudio</span>
          </span>
        </div>
        <div className="login__story-copy">
          <h2>Claridad para decidir. Evidencia para confiar.</h2>
        </div>
      </section>
      <section className="login__access">
        <div className="login__mobile-brand" aria-label="Contable">
          <span className="login__brand-mark" aria-hidden="true">
            C
          </span>
          <span className="login__brand-name">Contable</span>
        </div>
        <div className="login__card">
          <h1 className="login__title">
            {challenge ? "Verificar identidad" : "Bienvenido de nuevo"}
          </h1>
          <p className="login__subtitle">
            {challenge
              ? "Ingresá el código de seis dígitos de tu autenticador para completar el acceso."
              : "Ingresá a tu espacio de trabajo con la cuenta asignada por el estudio."}
          </p>
          {notice ? (
            <Notice tone="success" >
              {notice}
            </Notice>
          ) : null}
          <form className="login__form" onSubmit={onSubmit} noValidate>
            {challenge ? (
              <Field
                label="Código de verificación"
                id="mfa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                pattern="[0-9]{6}"
                hint="Código de tu aplicación de autenticación"
                required
              />
            ) : (
              <>
                <Field
                  label="Correo electrónico"
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  error={missing.email}
                  placeholder="nombre@estudio.com"
                  required
                />
                <Field
                  label="Contraseña"
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  error={missing.password}
                  required
                />
              </>
            )}
            <div aria-live="polite">{error ? <Notice tone="error">{error}</Notice> : null}</div>
            <Button
              type="submit"
              loading={loading}
              loadingLabel={challenge ? "Verificando identidad" : "Iniciando sesión"}
              disabled={challenge ? code.length !== 6 : false}
            >
              {challenge ? (
                "Verificar y continuar"
              ) : (
                <>
                  Entrar a Contable <Icon name="arrow-right" size={17} />
                </>
              )}
            </Button>
            {challenge ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setChallenge(null);
                  setCode("");
                  setError(null);
                }}
              >
                Volver al inicio de sesión
              </Button>
            ) : null}
          </form>
          {challenge ? null : (
            <p className="login__help">
              ¿No podés entrar? Pedile un enlace nuevo a quien administra el estudio.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
