import { useState } from "react";
import { Button, Field } from "@contable/design-system";
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
  const notice = (location.state as { notice?: string } | null)?.notice;

  const finish = async () => {
    await session.refresh();
    const state = location.state as { from?: string } | null;
    navigate(state?.from ?? "/", { replace: true });
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
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
      setError(caught instanceof ApiError ? caught.message : "No se pudo iniciar sesión");
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
            <span className="login__brand-tag">Gestión profesional</span>
          </span>
        </div>
        <div className="login__story-copy">
          <p className="login__eyebrow">Tu mesa de trabajo contable</p>
          <h2>
            Claridad para decidir.
            <br />
            Evidencia para confiar.
          </h2>
          <p>Documentos, revisiones, vencimientos y reportes conectados en un mismo contexto.</p>
        </div>
        <ul className="login__principles">
          <li>
            <Icon name="shield" size={17} />
            <span>
              <strong>Información trazable</strong>
              <small>Cada cifra conserva su origen.</small>
            </span>
          </li>
          <li>
            <Icon name="check" size={17} />
            <span>
              <strong>Revisión bajo control</strong>
              <small>Las decisiones sensibles quedan registradas.</small>
            </span>
          </li>
        </ul>
        <p className="login__story-footer">Diseñado para estudios contables argentinos</p>
      </section>
      <section className="login__access">
        <div className="login__mobile-brand" aria-label="Contable">
          <span className="login__brand-mark" aria-hidden="true">
            C
          </span>
          <span className="login__brand-name">Contable</span>
        </div>
        <div className="login__card">
          <div className="login__secure">
            <Icon name="shield" size={15} /> Acceso seguro
          </div>
          <h1 className="login__title">
            {challenge ? "Verificar identidad" : "Bienvenido de nuevo"}
          </h1>
          <p className="login__subtitle">
            {challenge
              ? "Ingresá el código de seis dígitos de tu autenticador para completar el acceso."
              : "Ingresá a tu espacio de trabajo con la cuenta asignada por el estudio."}
          </p>
          {notice ? (
            <p className="form-success" role="status">
              {notice}
            </p>
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
                  minLength={8}
                  required
                />
              </>
            )}
            {error ? (
              <div className="login__error" role="alert">
                <Icon name="alert" size={17} />
                <span>{error}</span>
              </div>
            ) : null}
            <Button
              type="submit"
              loading={loading}
              loadingLabel={challenge ? "Verificando identidad" : "Iniciando sesión"}
              disabled={challenge ? code.length !== 6 : !email || password.length < 8}
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
          <p className="login__privacy">
            <Icon name="shield" size={14} /> Tu sesión y el contexto del estudio se validan en cada
            acceso.
          </p>
        </div>
      </section>
    </main>
  );
}
