import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { Button } from "@contable/design-system";
import { ActionDrawer } from "../../ui/ActionDrawer";
import type { RulePackDetail, RuleVersion } from "./tipos";
import { shortDate } from "./utilidades";

interface ConfirmarActivacionProps {
  activationTarget: RuleVersion | null;
  setActivationTarget: Dispatch<SetStateAction<RuleVersion | null>>;
  detailQuery: UseQueryResult<RulePackDetail, Error>;
  activateMutation: UseMutationResult<unknown, Error, string>;
  confirmActivation: () => void;
  activeVersion: RuleVersion | undefined;
}

export function ConfirmarActivacion({
  activationTarget,
  setActivationTarget,
  detailQuery,
  activateMutation,
  confirmActivation,
  activeVersion,
}: ConfirmarActivacionProps) {
  return (
    <>
      <ActionDrawer
        isOpen={Boolean(activationTarget)}
        onClose={() => setActivationTarget(null)}
        title={
          activationTarget
            ? `${detailQuery.data?.name ?? "Paquete fiscal"} · versión v${activationTarget.version}`
            : "Confirmar activación"
        }
        description="Revisá el paquete y la vigencia antes de activar esta versión."
        footer={
          <div className="study-form__actions">
            <Button type="button" loading={activateMutation.isPending} onClick={confirmActivation}>
              Activar versión
            </Button>
            <Button type="button" variant="ghost" onClick={() => setActivationTarget(null)}>
              Cancelar
            </Button>
          </div>
        }
      >
        {activationTarget ? (
          <div>
            <p>Vigencia: {shortDate(activationTarget.validFrom)} — {shortDate(activationTarget.validTo)}</p>
            {activeVersion ? (
              <p role="note">Al activar esta versión, la versión vigente quedará retirada</p>
            ) : null}
          </div>
        ) : null}
      </ActionDrawer>
    </>
  );
}
