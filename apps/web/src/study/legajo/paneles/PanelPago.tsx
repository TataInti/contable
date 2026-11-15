import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Field, MoneyField } from "@contable/design-system";
import { api } from "../../../lib/api";
import { ActionDrawer, ActionDrawerFooter } from "../../../ui/ActionDrawer";
import { formatMoney } from "../formato";
import type { TaxPosition } from "../tipos";
import { WorkpaperActionError } from "../WorkpaperActionError";

interface PanelPagoProps {
  posicion: TaxPosition;
  onCerrar: () => void;
  firmId: string;
  clientId: string;
}

// Se monta al abrir el cajón desde la tabla de cálculo: el estado arranca con la posición elegida.
export function PanelPago({ posicion, onCerrar, firmId, clientId }: PanelPagoProps) {
  const queryClient = useQueryClient();
  const [paymentForm, setPaymentForm] = useState({
    amount: posicion.totalPayable,
    paidAt: new Date().toISOString().slice(0, 10),
    method: "TRANSFERENCIA",
    reference: "",
  });
  const recordPaymentMutation = useMutation({
    mutationFn: () =>
      api.post(
        `/firms/${firmId}/clients/${clientId}/tax-obligations/${posicion.obligationId}/payments`,
        {
          ...(posicion.settlement ? { settlementId: posicion.settlement.id } : {}),
          paidAt: paymentForm.paidAt,
          amount: paymentForm.amount,
          method: paymentForm.method,
          ...(paymentForm.reference.trim() ? { reference: paymentForm.reference.trim() } : {}),
        },
      ),
    onSuccess: () => {
      onCerrar();
      void queryClient.invalidateQueries({
        queryKey: ["tax-position", firmId, clientId],
      });
    },
  });
  // Motivo visible junto al botón deshabilitado (P1).
  const motivoRegistrar = !paymentForm.amount ? "Indicá el importe del pago." : null;
  return (
    <ActionDrawer
      isOpen
      onClose={onCerrar}
      title="Registrar pago"
      description={`${posicion.regime.taxType.name}. El pago se registrará de forma manual y actualizará el saldo pendiente.`}
      footer={
        <ActionDrawerFooter
          primary={
            <Button
              type="submit"
              form="legajo-pago"
              loading={recordPaymentMutation.isPending}
              disabled={motivoRegistrar !== null}
            >
              Registrar pago
            </Button>
          }
          hint={motivoRegistrar}
          onCancel={onCerrar}
        />
      }
    >
      <form
        id="legajo-pago"
        className="study-form"
        onSubmit={(event) => {
          event.preventDefault();
          recordPaymentMutation.mutate();
        }}
      >
        <p className="muted-copy study-form__full">Pendiente: {formatMoney(posicion.pending)}</p>
        <MoneyField
          label="Importe"
          id="tax-payment-amount"
          value={paymentForm.amount}
          onChange={(value) => setPaymentForm({ ...paymentForm, amount: value })}
          required
        />
        <Field
          label="Fecha de pago"
          id="tax-payment-date"
          type="date"
          value={paymentForm.paidAt}
          onChange={(event) => setPaymentForm({ ...paymentForm, paidAt: event.target.value })}
          required
        />
        <div className="ds-field">
          <label className="ds-field__label" htmlFor="tax-payment-method">
            Medio
          </label>
          <select
            id="tax-payment-method"
            className="ds-field__input"
            value={paymentForm.method}
            onChange={(event) => setPaymentForm({ ...paymentForm, method: event.target.value })}
          >
            <option value="TRANSFERENCIA">Transferencia</option>
            <option value="VEP">VEP</option>
            <option value="EFECTIVO">Efectivo</option>
            <option value="OTRO">Otro</option>
          </select>
        </div>
        <Field
          label="Referencia (opcional)"
          id="tax-payment-reference"
          value={paymentForm.reference}
          onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })}
        />
        <WorkpaperActionError error={recordPaymentMutation.error} />
      </form>
    </ActionDrawer>
  );
}
