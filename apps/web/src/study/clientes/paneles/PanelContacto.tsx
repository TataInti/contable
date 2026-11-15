import type { UseMutationResult } from "@tanstack/react-query";
import { Button, Field, Notice } from "@contable/design-system";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { ApiError, type ClientContact } from "../../../lib/api";
import type { ClientContactForm } from "../tipos";

interface PanelContactoProps {
  contactEditorOpen: boolean;
  closeContactEditor: () => void;
  editingContact: ClientContact | null;
  contactForm: ClientContactForm;
  setContactForm: (valor: ClientContactForm) => void;
  saveContact: UseMutationResult<ClientContact, Error, void>;
}

export function PanelContacto({
  contactEditorOpen,
  closeContactEditor,
  editingContact,
  contactForm,
  setContactForm,
  saveContact,
}: PanelContactoProps) {
  return (
    <ActionDrawer
      isOpen={contactEditorOpen}
      onClose={closeContactEditor}
      title={editingContact ? "Editar contacto" : "Nuevo contacto"}
      description="Completá los datos de contacto y, si corresponde, marcá el principal."
      footer={
        <>
          <Button type="button" variant="ghost" onClick={closeContactEditor}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="client-contact-form"
            loading={saveContact.isPending}
            loadingLabel="Guardando contacto"
            disabled={contactForm.name.trim().length === 0}
          >
            Guardar contacto
          </Button>
        </>
      }
    >
      <form
        id="client-contact-form"
        className="study-inline-form study-inline-form--client"
        onSubmit={(event) => {
          event.preventDefault();
          saveContact.mutate();
        }}
      >
        <Field
          id="client-contact-name"
          label="Nombre"
          value={contactForm.name}
          onChange={(event) => setContactForm({ ...contactForm, name: event.target.value })}
          maxLength={200}
          required
        />
        <Field
          id="client-contact-function"
          label="Función"
          value={contactForm.function}
          onChange={(event) => setContactForm({ ...contactForm, function: event.target.value })}
          maxLength={100}
        />
        <Field
          id="client-contact-email"
          label="Email"
          type="email"
          value={contactForm.email}
          onChange={(event) => setContactForm({ ...contactForm, email: event.target.value })}
          maxLength={254}
        />
        <Field
          id="client-contact-phone"
          label="Teléfono"
          type="tel"
          value={contactForm.phone}
          onChange={(event) => setContactForm({ ...contactForm, phone: event.target.value })}
          maxLength={50}
        />
        <label className="client-contact-primary">
          <input
            type="checkbox"
            checked={contactForm.isPrimary}
            onChange={(event) => setContactForm({ ...contactForm, isPrimary: event.target.checked })}
          />
          <span>Contacto principal</span>
        </label>
        {saveContact.isError ? (
          <Notice tone="error" className="study-inline-form__feedback">
            {saveContact.error instanceof ApiError
              ? saveContact.error.message
              : "No se pudo guardar el contacto. Revisá los datos e intentá nuevamente."}
          </Notice>
        ) : null}
      </form>
    </ActionDrawer>
  );
}
