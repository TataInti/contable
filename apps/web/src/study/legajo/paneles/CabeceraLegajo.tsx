import { Button } from "@contable/design-system";
import type { ClientContextValue } from "../../../context/ClientContext";
import { DenseHeader } from "../../../ui/Dense";
import { Icon } from "../../../ui/Icon";
import { FiscalBooksExportAction } from "../../FiscalBooksExportAction";
import { fiscalTaxPeriodLabel } from "../periodoFiscal";
import type { FiscalTaxPeriod } from "../tipos";
import { WorkpaperActionError } from "../WorkpaperActionError";

interface CabeceraLegajoProps {
  capabilities: ClientContextValue["capabilities"];
  selectedTaxPeriod: FiscalTaxPeriod | undefined;
  creandoLegajo: boolean;
  errorCreacion: Error | null | undefined;
  onSubirLibros: () => void;
  onNuevoLegajo: () => void;
}

export function CabeceraLegajo({
  capabilities,
  selectedTaxPeriod,
  creandoLegajo,
  errorCreacion,
  onSubirLibros,
  onNuevoLegajo,
}: CabeceraLegajoProps) {
  return (
      <DenseHeader
        title="Legajo"
        description="Coordina IVA, IIBB y TEM del período con evidencia trazable."
        actions={
          <>
          <Button
            variant="secondary"
            disabled={!capabilities.has("tax.vouchers.prepare")}
            onClick={() => onSubirLibros()}
          >
            <Icon name="upload" size={16} />
            Subir Excel
          </Button>
          <FiscalBooksExportAction
            periodId={selectedTaxPeriod?.id ?? null}
            periodLabel={
              selectedTaxPeriod
                ? `${selectedTaxPeriod.taxType.name} · ${fiscalTaxPeriodLabel(selectedTaxPeriod)}`
                : null
            }
          />
          <Button
            variant="primary"
            disabled={!selectedTaxPeriod || creandoLegajo || !capabilities.has("tax.settlements.calculate")}
            onClick={() => void onNuevoLegajo()}
          >
            <Icon name="plus" size={16} />
            Nuevo legajo
          </Button>
          <WorkpaperActionError error={errorCreacion} />
        
          </>
        }
      />
  );
}
