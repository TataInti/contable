import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Field, MoneyField } from "@contable/design-system";
import { api } from "../../../lib/api";
import { ActionDrawer } from "../../../ui/ActionDrawer";
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
  return (
    <ActionDrawer
      isOpen
      onClose={onCerrar}
      title={`Registrar pago · ${posicion.regime.taxType.name}`}
      description="El pago se registrará de forma manual y actualizará el saldo pendiente."
    >
      <form
        className="study-form study-form--compact fiscal-action-form"
        onSubmit={(event) => {
          event.preventDefault();
          recordPaymentMutation.mutate();
        }}
      >
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
          label="Referencia"
          id="tax-payment-reference"
          value={paymentForm.reference}
          onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })}
          placeholder="Opcional"
        />
        <div className="study-form__actions">
          <Button
            type="submit"
            loading={recordPaymentMutation.isPending}
            disabled={!paymentForm.amount}
          >
            Registrar pago
          </Button>
          <Button type="button" variant="ghost" onClick={onCerrar}>
            Cancelar
          </Button>
        </div>
        <WorkpaperActionError error={recordPaymentMutation.error} />
      </form>
    </ActionDrawer>
  );
}
