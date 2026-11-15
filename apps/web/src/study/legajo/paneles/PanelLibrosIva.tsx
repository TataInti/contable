import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Field, useNotify } from "@contable/design-system";
import { api } from "../../../lib/api";
import { ActionDrawer } from "../../../ui/ActionDrawer";
import { fileToBase64, fileToHash } from "../archivoFuente";
import { SifereAnalysisPanel } from "../SifereAnalysisPanel";
import type { SifereAnalysis, WorkpaperSource } from "../tipos";
import { WorkpaperActionError } from "../WorkpaperActionError";

interface PanelLibrosIvaProps {
  abierto: boolean;
  onCerrar: () => void;
  firmId: string;
  clientId: string;
  activeWorkpaperId: string | undefined;
  fuentes: WorkpaperSource[] | undefined;
  cuitCliente: string | undefined;
}

export function PanelLibrosIva({
  abierto,
  onCerrar,
  firmId,
  clientId,
  activeWorkpaperId,
  fuentes,
  cuitCliente,
}: PanelLibrosIvaProps) {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const [sifereFiles, setSifereFiles] = useState<{
    sales: File | null;
    purchases: File | null;
  }>({ sales: null, purchases: null });
  const [sifereAnalysis, setSifereAnalysis] = useState<{
    sales: SifereAnalysis | null;
    purchases: SifereAnalysis | null;
  }>({ sales: null, purchases: null });
  const analyzeSifereMutation = useMutation({
    mutationFn: async ({ direction, file }: { direction: "SALE" | "PURCHASE"; file: File }) => {
      const base64 = await fileToBase64(file);
      return api.post<SifereAnalysis>(`/firms/${firmId}/clients/${clientId}/sifere/analyze`, {
        direction,
        base64,
      });
    },
    onSuccess: (data, variables) => {
      setSifereAnalysis((current) => ({
        ...current,
        [variables.direction === "SALE" ? "sales" : "purchases"]: data,
      }));
    },
  });

  const importSifereMutation = useMutation({
    mutationFn: async ({ direction, file }: { direction: "SALE" | "PURCHASE"; file: File }) => {
      const source = fuentes?.find((item) =>
        direction === "SALE" ? item.code === "ARCA_IVA_SALES" : item.code === "ARCA_IVA_PURCHASES",
      );
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
      });
    },
    onSuccess: (data) => {
      onCerrar();
      setSifereFiles({ sales: null, purchases: null });
      setSifereAnalysis({ sales: null, purchases: null });
      notify.success(
        `Se importaron ${data.batch.committed} comprobante(s) de ${data.analysis.direction === "SALE" ? "ventas" : "compras"} (${data.analysis.sheetName}). Quedaron asociados al cliente y al período activo.`,
      );
      void queryClient.invalidateQueries({
        queryKey: ["monthly-workpaper-coverage", firmId, clientId],
      });
      void queryClient.invalidateQueries({ queryKey: ["monthly-workpapers", firmId, clientId] });
    },
  });
  const listoParaImportar = (direccion: "SALE" | "PURCHASE") =>
    Boolean(
      (direccion === "SALE" ? sifereFiles.sales : sifereFiles.purchases) &&
      (direccion === "SALE" ? sifereAnalysis.sales : sifereAnalysis.purchases) &&
      activeWorkpaperId,
    );
  // Una sola acción primaria del panel: Importar del lado con análisis listo (ventas primero).
  const principal = listoParaImportar("SALE")
    ? "SALE"
    : listoParaImportar("PURCHASE")
      ? "PURCHASE"
      : null;
  return (
    <ActionDrawer
      isOpen={abierto}
      onClose={onCerrar}
      title="Subir libros IVA (Excel)"
      description="Subí por separado el libro de compras y el de ventas. El análisis de alícuotas y tributos no depende de que esté completo: lo podés correr con lo que ya tengas."
      size="wide"
    >
      {(["SALE", "PURCHASE"] as const).map((direction) => {
        const file = direction === "SALE" ? sifereFiles.sales : sifereFiles.purchases;
        const analysis = direction === "SALE" ? sifereAnalysis.sales : sifereAnalysis.purchases;
        const isAnalyzing =
          analyzeSifereMutation.isPending &&
          analyzeSifereMutation.variables?.direction === direction;
        const isImporting =
          importSifereMutation.isPending && importSifereMutation.variables?.direction === direction;
        const motivo =
          isAnalyzing || isImporting
            ? null
            : !file
              ? "Elegí el .xlsx para analizarlo."
              : !analysis
                ? "Analizá el libro para poder importarlo."
                : !activeWorkpaperId
                  ? "Falta un legajo del período para importar."
                  : fuentes === undefined
                    ? "Esperá a que cargue la cobertura del período."
                    : null;
        return (
          <section
            key={direction}
            aria-label={direction === "SALE" ? "Libro de ventas" : "Libro de compras"}
          >
            <h3>{direction === "SALE" ? "Ventas" : "Compras"}</h3>
            <Button
              href={`/api/v1/firms/${firmId}/clients/${clientId}/sifere/template?direction=${direction}`}
              download
              variant="ghost"
              size="row"
            >
              Modelo .xlsx
            </Button>
            <Field
              id={`libro-iva-${direction}`}
              type="file"
              label="Archivo .xlsx"
              hint={file ? file.name : "Elegí el .xlsx del libro"}
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                setSifereFiles((current) => ({
                  ...current,
                  [direction === "SALE" ? "sales" : "purchases"]: selected,
                }));
                setSifereAnalysis((current) => ({
                  ...current,
                  [direction === "SALE" ? "sales" : "purchases"]: null,
                }));
              }}
            />
            <div>
              <Button
                variant="secondary"
                disabled={!file || isAnalyzing}
                loading={isAnalyzing}
                onClick={() => {
                  if (file) {
                    analyzeSifereMutation.mutate({ direction, file });
                  }
                }}
              >
                Analizar alícuotas
              </Button>
              <Button
                variant={principal === direction ? "primary" : "secondary"}
                disabled={
                  !file || !analysis || isImporting || !activeWorkpaperId || fuentes === undefined
                }
                loading={isImporting}
                onClick={() => {
                  if (file) {
                    importSifereMutation.mutate({ direction, file });
                  }
                }}
              >
                Importar
              </Button>
              {motivo ? <p className="muted-copy">{motivo}</p> : null}
            </div>
            <WorkpaperActionError
              error={
                analyzeSifereMutation.variables?.direction === direction
                  ? analyzeSifereMutation.error
                  : null
              }
            />
            <WorkpaperActionError
              error={
                importSifereMutation.variables?.direction === direction
                  ? importSifereMutation.error
                  : null
              }
            />
            {analysis ? <SifereAnalysisPanel analysis={analysis} /> : null}
          </section>
        );
      })}
    </ActionDrawer>
  );
}
