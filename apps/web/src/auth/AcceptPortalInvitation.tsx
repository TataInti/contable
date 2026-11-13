import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Field, Notice } from "@contable/design-system";
import { api, ApiError } from "../lib/api";
import { Icon } from "../ui/Icon";
import "./login.css";

export function AcceptPortalInvitation() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/portal/invitations/accept", { token, email, name, password });
      navigate("/login", {
        replace: true,
        state: { notice: "Invitación aceptada. Ya podés iniciar sesión." },
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo aceptar la invitación");
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
            <span className="login__brand-tag">Portal del cliente</span>
          </span>
        </div>
        <div className="login__secure">
          <Icon name="shield" size={15} /> Invitación segura
        </div>
        <h1 className="login__title">Activá tu acceso</h1>
        <p className="login__subtitle">
          Confirmá el correo invitado y creá una contraseña para consultar la información compartida
          de tu empresa.
        </p>
        {!token ? (
          <Notice tone="error">
            El enlace de invitación está incompleto.
          </Notice>
        ) : (
          <form className="login__form" onSubmit={submit}>
            <Field
              id="invite-name"
              label="Nombre"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
            <Field
              id="invite-email"
              label="Email invitado"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <Field
              id="invite-password"
              label="Contraseña"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={12}
              hint="Mínimo 12 caracteres."
              required
            />
            {error ? (
              <Notice tone="error">
                {error}
              </Notice>
            ) : null}
            <Button
              type="submit"
              loading={loading}
              disabled={name.trim().length < 2 || !email || password.length < 12}
            >
              Activar cuenta <Icon name="arrow-right" size={17} />
            </Button>
          </form>
        )}
        <p className="login__privacy">
          <Icon name="shield" size={14} /> Sólo vas a ver información publicada expresamente por tu
          estudio.
        </p>
      </div>
    </main>
  );
}
