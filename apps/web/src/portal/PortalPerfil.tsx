import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Field, Notice } from "@contable/design-system";
import { api } from "../lib/api";
import { useClientContext } from "../context/ClientContext";
import { Icon } from "../ui/Icon";
import { PortalLoading, PortalPageHeader, PortalRetryButton } from "./PortalUI";
import { SectionIndex } from "../ui/SectionIndex";
import "./portal.css";

interface Profile {
  id: string;
  name: string;
  emailNormalized: string;
}

export function PortalPerfil() {
  const { clientId } = useClientContext();
  const queryClient = useQueryClient();
  const profile = useQuery({
    queryKey: ["portal-profile", clientId],
    queryFn: () => api.get<Profile>(`/portal/clients/${clientId}/profile`),
    enabled: Boolean(clientId),
  });
  const [name, setName] = useState("");
  useEffect(() => {
    if (profile.data) setName(profile.data.name);
  }, [profile.data]);
  const save = useMutation({
    mutationFn: () => api.patch<Profile>(`/portal/clients/${clientId}/profile`, { name: name.trim() }),
    onSuccess: (data) => {
      queryClient.setQueryData(["portal-profile", clientId], data);
      setName(data.name);
    },
  });
  const normalizedName = name.trim();
  const isDirty = normalizedName !== (profile.data?.name ?? "");
  return (
    <div className="portal-page portal-page--profile">
      <PortalPageHeader
        eyebrow="Tu cuenta"
        title="Perfil"
        description="Mantené actualizado el nombre con el que te identifica tu estudio."
      />
      {!clientId ? (
        <EmptyState
          title="Sin empresa seleccionada"
          description="Elegí una empresa para consultar tu perfil."
        />
      ) : profile.isLoading ? (
        <PortalLoading label="Cargando tu perfil…" />
      ) : profile.isError ? (
        <Notice
          tone="error"
          title="No pudimos cargar tu perfil"
          action={<PortalRetryButton onRetry={() => void profile.refetch()} />}
        >
          Reintentá en unos minutos.
        </Notice>
      ) : profile.data ? (
        <>
        <SectionIndex items={[{ id: "profile-data-title", label: "Datos personales" }]} />
        <section className="portal-profile" aria-labelledby="profile-data-title">
          <div className="portal-profile__intro">
            <span className="portal-profile__avatar" aria-hidden="true">
              <Icon name="users" size={24} />
            </span>
            <div>
              <h2 id="profile-data-title">Datos personales</h2>
              <p>Estos datos se comparten con el estudio en tus mensajes y entregas.</p>
            </div>
          </div>
          <form
            className="portal-page__form"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <Field
              id="profile-name"
              name="name"
              label="Nombre"
              hint="Así te verá el estudio en los mensajes y entregas."
              autoComplete="name"
              value={name}
              onChange={(event) => {
                if (save.isSuccess || save.isError) save.reset();
                setName(event.target.value);
              }}
              maxLength={120}
              required
            />
            <Field
              id="profile-email"
              name="email"
              type="email"
              label="Email"
              hint="Para cambiarlo, comunicate con tu estudio."
              value={profile.data.emailNormalized}
              readOnly
            />
            {save.isError ? (
              <Notice tone="error" >
                No pudimos guardar los cambios.
              </Notice>
            ) : null}
            {save.isSuccess ? (
              <Notice tone="success">
                Cambios guardados.
              </Notice>
            ) : null}
            <div className="portal-page__actions">
              <Button
                type="submit"
                loading={save.isPending}
                disabled={normalizedName.length < 2 || !isDirty}
              >
                Guardar cambios
              </Button>
              {isDirty && !save.isPending ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    save.reset();
                    setName(profile.data.name);
                  }}
                >
                  Descartar
                </Button>
              ) : null}
            </div>
          </form>
        </section>
        </>
      ) : null}
    </div>
  );
}
