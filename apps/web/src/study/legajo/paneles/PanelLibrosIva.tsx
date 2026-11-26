import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, useNotify } from "@contable/design-system";
import { api } from "../../../lib/api";
import { ZonaArchivo } from "../ZonaArchivo";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { fileToBase64, fileToHash } from "../archivoFuente";
import { importarLoteFuente, LoteConFilasObservadas, ladoDeLibroIva } from "../loteFuente";
import { DetalleFilasLote } from "../DetalleFilasLote";
import { SifereAnalysisPanel } from "../SifereAnalysisPanel";
import type { SifereAnalysis, WorkpaperSource } from "../tipos";
import { WorkpaperActionError } from "../WorkpaperActionError";
import { pluralizar } from "../textos";

type Lado = "SALE" | "PURCHASE";

interface PanelLibrosIvaProps {
  abierto: boolean;
  onCerrar: () => void;
  firmId: string;
  clientId: string;
  activeWorkpaperId: string | undefined;
  fuentes: WorkpaperSource[] | undefined;
  cuitCliente: string | undefined;
  /** Lado de la fila desde la que se abrió: va primero y recibe el foco. */
  ladoInicial: Lado | null;
  replacesBatchId?: string;
  /** Motivo por el que no se puede importar (permiso o legajo cerrado); null si se puede. */
  motivoBloqueo: string | null;
}

// .xlsx y .xls pasan por el análisis de alícuotas (sifere); .csv, .txt y .json se importan como lote de la fuente.
const esLibroExcel = (file: File) => /\.xlsx?$/i.test(file.name);
const ETIQUETA_LADO: Record<Lado, string> = { SALE: "ventas", PURCHASE: "compras" };

export function PanelLibrosIva({
  abierto,
  onCerrar,
  firmId,
  clientId,
  activeWorkpaperId,
  fuentes,
  cuitCliente,
  ladoInicial,
  replacesBatchId,
  motivoBloqueo,
}: PanelLibrosIvaProps) {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const [archivos, setArchivos] = useState<Record<Lado, File | null>>({
    SALE: null,
    PURCHASE: null,
  });
  const [analisis, setAnalisis] = useState<Record<Lado, SifereAnalysis | null>>({
    SALE: null,
    PURCHASE: null,
  });
  const fuenteDe = (lado: Lado) => fuentes?.find((item) => ladoDeLibroIva(item.code) === lado);

  // Con la fila de origen, el panel abre con ese lado primero y con el foco en su archivo.
  useEffect(() => {
    if (abierto && ladoInicial) document.getElementById(`libro-iva-${ladoInicial}`)?.focus();
  }, [abierto, ladoInicial]);

  const invalidarCobertura = () => {
    void queryClient.invalidateQueries({
      queryKey: ["monthly-workpaper-coverage", firmId, clientId],
    });
    void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
  };
  const limpiarPanel = () => {
    onCerrar();
    setArchivos({ SALE: null, PURCHASE: null });
    setAnalisis({ SALE: null, PURCHASE: null });
  };

  const analyzeSifereMutation = useMutation({
    mutationFn: async ({ direction, file }: { direction: Lado; file: File }) => {
      const base64 = await fileToBase64(file);
      return api.post<SifereAnalysis>(`/firms/${firmId}/clients/${clientId}/sifere/analyze`, {
        direction,
        base64,
      });
    },
    onSuccess: (data, variables) => {
      setAnalisis((current) => ({ ...current, [variables.direction]: data }));
    },
  });

  const importSifereMutation = useMutation({
    mutationFn: async ({ direction, file }: { direction: Lado; file: File }) => {
      const source = fuenteDe(direction);
      if (!source?.taxTypeId || !source?.periodId || !cuitCliente) {
        throw new Error("La fuente no tiene una obligación fiscal materializada");
      }
      const base64 = await fileToBase64(file);
      const fileHash = await fileToHash(file);
      return api.post<{
        analysis: SifereAnalysis;
        batch: { id: string; status: string; committed: number; duplicates: number };
      }>(`/firms/${firmId}/clients/${clientId}/sifere/import`, {
        direction,
        base64,
        fileName: file.name,
        fileHash,
        taxTypeId: source.taxTypeId,
        periodId: source.periodId,
        clientCuit: cuitCliente,
        ...(activeWorkpaperId ? { workpaperId: activeWorkpaperId } : {}),
        ...(replacesBatchId ? { replacesBatchId } : {}),
      });
    },
    onSuccess: (data) => {
      limpiarPanel();
      const ventasOCompras = data.analysis.direction === "SALE" ? "ventas" : "compras";
      const { committed, duplicates } = data.batch;
      notify.success(
        committed === 0 && duplicates > 0
          ? `El libro de ${ventasOCompras} quedó asociado al cliente y al período activo: ${
              duplicates === 1 ? "su comprobante ya estaba cargado" : `sus ${duplicates} comprobantes ya estaban cargados`
            }.`
          : `${committed === 1 ? "Se importó" : "Se importaron"} ${pluralizar(committed, "comprobante", "comprobantes")} de ${ventasOCompras}. ${committed === 1 ? "Quedó asociado" : "Quedaron asociados"} al cliente y al período activo.`,
      );
      invalidarCobertura();
    },
  });

  const importLoteMutation = useMutation({
    mutationFn: async ({ direction, file }: { direction: Lado; file: File }) => {
      const source = fuenteDe(direction);
      if (!source || !activeWorkpaperId || !cuitCliente) {
        throw new Error("Falta la fuente del libro o el legajo del período para importar.");
      }
      await importarLoteFuente({
        firmId,
        clientId,
        source,
        file,
        workpaperId: activeWorkpaperId,
        clientCuit: cuitCliente,
        ...(replacesBatchId ? { replacesBatchId } : {}),
      });
    },
    onSuccess: (_data, variables) => {
      limpiarPanel();
      notify.success(
        `Se importó el lote del libro de ${ETIQUETA_LADO[variables.direction]} (${variables.file.name}).`,
      );
      invalidarCobertura();
    },
  });

  const listoParaImportar = (lado: Lado) => {
    const file = archivos[lado];
    return Boolean(
      file && (!esLibroExcel(file) || analisis[lado]) && activeWorkpaperId && !motivoBloqueo,
    );
  };
  // Una sola acción primaria del panel: Importar del lado listo, en el orden que muestra el panel.
  // Un cajón por fuente: solo el libro desde cuya fila se abrió (ventas si no hay fila de origen).
  const ladosEnOrden: Lado[] = [ladoInicial ?? "SALE"];
  const principal = ladosEnOrden.find((lado) => listoParaImportar(lado)) ?? null;
  const importar = (lado: Lado, file: File) => {
    if (esLibroExcel(file)) importSifereMutation.mutate({ direction: lado, file });
    else importLoteMutation.mutate({ direction: lado, file });
  };
  const motivoDe = (
    lado: Lado,
    file: File | null,
    analysis: SifereAnalysis | null,
    excel: boolean,
  ): string | null => {
    if (motivoBloqueo) return motivoBloqueo;
    if (!file) return "Elegí el archivo del libro.";
    if (excel && !analysis) return "Analizando el libro…";
    if (!activeWorkpaperId) return "Falta un legajo del período para importar.";
    if (fuentes === undefined) return "Esperá a que cargue la cobertura del período.";
    if (!fuenteDe(lado)) return "La fuente de este libro no está en la cobertura del período.";
    return null;
  };

  return (
    <ActionDrawer
      isOpen={abierto}
      onClose={onCerrar}
      title={replacesBatchId ? "Reemplazar libro IVA" : ladoInicial === "PURCHASE" ? "Importar libro de compras" : "Importar libro de ventas"}
      description="Elegí el archivo del libro: un .xlsx se analiza solo al elegirlo y después queda un único paso, «Importar». Un .csv, .txt o .json se importa como lote de la fuente."
      size="wide"
    >
      {ladosEnOrden.map((lado) => {
        const file = archivos[lado];
        const analysis = analisis[lado];
        const excel = Boolean(file && esLibroExcel(file));
        const isAnalyzing =
          analyzeSifereMutation.isPending && analyzeSifereMutation.variables?.direction === lado;
        const isImporting =
          (importSifereMutation.isPending && importSifereMutation.variables?.direction === lado) ||
          (importLoteMutation.isPending && importLoteMutation.variables?.direction === lado);
        const motivo = isAnalyzing || isImporting ? null : motivoDe(lado, file, analysis, excel);
        const errorLote =
          importLoteMutation.variables?.direction === lado ? importLoteMutation.error : null;
        return (
          <section key={lado} aria-label={lado === "SALE" ? "Libro de ventas" : "Libro de compras"}>
            <h3>{lado === "SALE" ? "Ventas" : "Compras"}</h3>
            <Button
              href={`/api/v1/firms/${firmId}/clients/${clientId}/sifere/template?direction=${lado}`}
              download
              variant="ghost"
              size="row"
            >
              Modelo .xlsx
            </Button>
            <small className="muted-copy"> Planilla de ejemplo con las columnas que espera el análisis.</small>
            <ZonaArchivo
              id={`libro-iva-${lado}`}
              archivo={file}
              ayuda=".xlsx, .csv, .txt o .json"
              accept=".xlsx,.xls,.csv,.txt,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,application/json"
              onArchivo={(selected) => {
                setArchivos((current) => ({ ...current, [lado]: selected }));
                setAnalisis((current) => ({ ...current, [lado]: null }));
                // Un .xlsx se analiza solo al elegirlo: queda un único botón, «Importar».
                if (selected && esLibroExcel(selected)) analyzeSifereMutation.mutate({ direction: lado, file: selected });
              }}
            />
            <div>
              <div className="legajo-libro__acciones">
                <Button
                  variant={principal === lado ? "primary" : "secondary"}
                  disabled={!listoParaImportar(lado) || isImporting || fuentes === undefined}
                  loading={isImporting}
                  onClick={() => {
                    if (file) importar(lado, file);
                  }}
                >
                  Importar
                </Button>
              </div>
              {motivo ? <p className="muted-copy">{motivo}</p> : null}
            </div>
            <WorkpaperActionError
              error={
                analyzeSifereMutation.variables?.direction === lado
                  ? analyzeSifereMutation.error
                  : null
              }
            />
            <WorkpaperActionError
              error={
                importSifereMutation.variables?.direction === lado
                  ? importSifereMutation.error
                  : null
              }
            />
            <WorkpaperActionError error={errorLote} />
            {errorLote instanceof LoteConFilasObservadas ? (
              <DetalleFilasLote firmId={firmId} clientId={clientId} batchId={errorLote.batchId} />
            ) : null}
            {analysis ? <SifereAnalysisPanel analysis={analysis} /> : null}
          </section>
        );
      })}
    </ActionDrawer>
  );
}
