import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Field, Notice, useNotify } from "@contable/design-system";
import type { TaxCalendarEntriesImportReport } from "@contable/contracts";
import { api } from "../lib/api";
import { ActionDrawer, ActionDrawerFooter } from "../ui/ActionDrawer";
import { InspectorFacts } from "../ui/Dense";
import {
  agruparAvisos,
  agruparRechazos,
  COLUMNAS_OBLIGATORIAS,
  COLUMNAS_OPCIONALES,
  TOPE_ARCHIVO,
  TOPE_FILAS,
  errorDeContenido,
  errorDeImportacion,
  etiquetaGrupo,
  errorDeTamano,
  lineaDudosas,
  motivoImportar,
  motivoProbar,
  notificacionImportacion,
  resumenInforme,
  rotuloImportar,
  tamanoArchivo,
  type EstadoImportacion,
  type ErrorDeImportacion,
} from "./calendariosFiscalesImportacion";

function leerTexto(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(typeof lector.result === "string" ? lector.result : "");
    lector.onerror = () => reject(lector.error);
    lector.readAsText(archivo, "utf-8");
  });
}

/**
 * Cajón «Importar celdas desde un archivo» (corte 2b-2): explica el formato, recibe un CSV,
 * muestra el informe de una prueba sin guardar y, con un informe sin errores de archivo,
 * importa. La API decide qué se guarda; el cajón lo muestra con su motivo (P1, P4).
 */
export function CalendarioFiscalImportDrawer({
  firmId,
  calendarId,
  onClose,
}: {
  firmId: string | null;
  calendarId: string;
  onClose: () => void;
}) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const entradaArchivo = useRef<HTMLInputElement>(null);
  const probarBoton = useRef<HTMLButtonElement>(null);
  const salidaArchivo = useRef<HTMLButtonElement>(null);
  const salidaReintentar = useRef<HTMLButtonElement>(null);
  const salidaFicha = useRef<HTMLButtonElement>(null);
  const lecturaActual = useRef(0);
  const [archivo, setArchivo] = useState<{ nombre: string; bytes: number } | null>(null);
  const [texto, setTexto] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [archivoError, setArchivoError] = useState<string | null>(null);
  const [errorServidor, setErrorServidor] = useState<ErrorDeImportacion | null>(null);
  const [informe, setInforme] = useState<TaxCalendarEntriesImportReport | null>(null);
  const [ultimoDryRun, setUltimoDryRun] = useState(true);
  const ruta = `/firms/${firmId}/tax-calendars/${calendarId}/entries/import`;

  const enviar = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.post<TaxCalendarEntriesImportReport>(ruta, { csv: texto ?? "", dryRun }),
    onSuccess: (resultado, dryRun) => {
      setErrorServidor(null);
      if (dryRun) {
        setInforme(resultado);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["tax-calendars", firmId] });
      notify.success(
        notificacionImportacion(resultado.importadas, resumenInforme(resultado).dudosas),
      );
      onClose();
    },
    onError: (error) => {
      const clasificado = errorDeImportacion(error);
      if (clasificado.tipo === "archivo") {
        setInforme(null);
        setArchivoError(clasificado.mensaje);
        return;
      }
      setErrorServidor(clasificado);
      if (clasificado.tipo === "borrador") {
        void queryClient.invalidateQueries({ queryKey: ["tax-calendars", firmId] });
      }
    },
  });

  const elegirArchivo = (elegido: File | null) => {
    const numeroLectura = ++lecturaActual.current;
    setInforme(null);
    setErrorServidor(null);
    setTexto(null);
    setArchivoError(null);
    setLeyendo(false);
    if (!elegido) {
      setArchivo(null);
      return;
    }
    setArchivo({ nombre: elegido.name, bytes: elegido.size });
    const tamano = errorDeTamano(elegido.size);
    if (tamano) {
      setArchivoError(tamano);
      return;
    }
    setLeyendo(true);
    leerTexto(elegido).then(
      (contenido) => {
        if (numeroLectura !== lecturaActual.current) return;
        setLeyendo(false);
        const error = errorDeTamano(new Blob([contenido]).size) ?? errorDeContenido(contenido);
        if (error) setArchivoError(error);
        else setTexto(contenido);
      },
      () => {
        if (numeroLectura !== lecturaActual.current) return;
        setLeyendo(false);
        setArchivoError("No se pudo leer el archivo. Elegí otro archivo.");
      },
    );
  };

  const elegirOtro = () => {
    if (entradaArchivo.current) {
      entradaArchivo.current.value = "";
      entradaArchivo.current.click();
    }
  };

  const probar = () => {
    setUltimoDryRun(true);
    enviar.mutate(true);
  };

  const importar = () => {
    setUltimoDryRun(false);
    enviar.mutate(false);
  };

  const estado: EstadoImportacion = {
    archivoElegido: archivo !== null,
    leyendo,
    archivoError,
    borradorCerrado: errorServidor?.tipo === "borrador",
    informe,
  };
  const motivoDePrueba = motivoProbar(estado);
  const motivoDeImportar = motivoImportar(estado);

  // Tras un error, el foco va a la primera salida que ofrece la pantalla (P1). Se mueve solo si
  // quedó en el cuerpo, en «Probar sin guardar» (que se deshabilita mientras corre la prueba) o en
  // el campo de archivo; si la persona lo llevó a otro control, no se lo quita. Se reevalúa al
  // elegir cada archivo, así que un error repetido con el mismo texto también mueve el foco.
  useEffect(() => {
    const salida = archivoError
      ? salidaArchivo.current
      : errorServidor?.tipo === "reintentar"
        ? salidaReintentar.current
        : errorServidor?.tipo === "borrador"
          ? salidaFicha.current
          : null;
    const activo = document.activeElement;
    const sinFoco =
      activo === null ||
      activo === document.body ||
      activo === probarBoton.current ||
      activo === entradaArchivo.current;
    if (salida && sinFoco) salida.focus();
  }, [archivo, archivoError, errorServidor]);

  const accionDelError =
    errorServidor?.tipo === "reintentar" ? (
      <Button
        ref={salidaReintentar}
        type="button"
        variant="secondary"
        loading={enviar.isPending}
        onClick={() => enviar.mutate(ultimoDryRun)}
      >
        Reintentar
      </Button>
    ) : errorServidor?.tipo === "borrador" ? (
      <Button ref={salidaFicha} type="button" variant="secondary" onClick={onClose}>
        Volver a la ficha
      </Button>
    ) : undefined;

  return (
    <ActionDrawer
      isOpen
      onClose={onClose}
      title="Importar celdas desde un archivo"
      description="Carga las celdas de este borrador desde un CSV. Primero probalo sin guardar: el informe muestra qué se importa y qué queda para revisar."
      footer={
        <ActionDrawerFooter
          primary={
            <Button
              type="button"
              variant="primary"
              disabled={motivoDeImportar !== null || enviar.isPending}
              loading={enviar.isPending && !ultimoDryRun}
              onClick={importar}
            >
              {rotuloImportar(informe ? informe.validas : null)}
            </Button>
          }
          hint={motivoDeImportar}
          onCancel={onClose}
        />
      }
    >
      <div className="importar-celdas">
        <div className="importar-celdas__formato">
          <p>
            Cada fila del archivo es una celda. Es un CSV de texto con el encabezado en la primera
            fila; las columnas se leen por su nombre, en cualquier orden.
          </p>
          <p>Columnas obligatorias: {COLUMNAS_OBLIGATORIAS.join(", ")}.</p>
          <p>Columnas opcionales: {COLUMNAS_OPCIONALES.join(", ")}.</p>
          <p>
            Topes: hasta {TOPE_ARCHIVO} y {TOPE_FILAS} filas de datos por archivo.
          </p>
        </div>
        <Field
          id="importar-archivo"
          ref={entradaArchivo}
          type="file"
          name="archivo"
          label="Archivo CSV"
          accept=".csv,text/csv"
          disabled={enviar.isPending}
          hint={
            archivo
              ? `${archivo.nombre} · ${tamanoArchivo(archivo.bytes)}`
              : "Un archivo .csv de texto."
          }
          onChange={(evento) => elegirArchivo(evento.target.files?.[0] ?? null)}
        />
        {archivoError ? (
          <Notice
            tone="error"
            action={
              <Button ref={salidaArchivo} type="button" variant="secondary" onClick={elegirOtro}>
                Elegir otro archivo
              </Button>
            }
          >
            {archivoError}
          </Notice>
        ) : null}
        {errorServidor && errorServidor.tipo !== "archivo" ? (
          <Notice tone="error" action={accionDelError}>
            {errorServidor.mensaje}
          </Notice>
        ) : null}
        <div className="importar-celdas__probar">
          <Button
            ref={probarBoton}
            type="button"
            variant="secondary"
            disabled={motivoDePrueba !== null || enviar.isPending}
            loading={enviar.isPending && ultimoDryRun}
            aria-describedby={motivoDePrueba ? "importar-probar-motivo" : undefined}
            onClick={probar}
          >
            Probar sin guardar
          </Button>
          {motivoDePrueba ? <span id="importar-probar-motivo">{motivoDePrueba}</span> : null}
        </div>
        {informe ? <InformeImportacion informe={informe} /> : null}
      </div>
    </ActionDrawer>
  );
}

function InformeImportacion({ informe }: { informe: TaxCalendarEntriesImportReport }) {
  const resumen = resumenInforme(informe);
  const dudosas = lineaDudosas(resumen.dudosas);
  const rechazos = agruparRechazos(informe.rechazadas);
  const avisos = agruparAvisos(informe.avisos);
  const bloque = useRef<HTMLDivElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  // Después de una prueba correcta, el informe va a la vista y su título recibe el foco.
  // Si la prueba falla no se mueve nada: el foco queda donde está.
  useEffect(() => {
    bloque.current?.scrollIntoView?.({ block: "start" });
    titulo.current?.focus({ preventScroll: true });
  }, [informe]);
  return (
    <div
      className="importar-informe"
      role="status"
      aria-labelledby="importar-informe-titulo"
      ref={bloque}
    >
      <h3
        id="importar-informe-titulo"
        className="importar-informe__titulo"
        tabIndex={-1}
        ref={titulo}
      >
        Informe de la prueba
      </h3>
      <InspectorFacts
        items={[
          ["Filas leídas", String(resumen.leidas)],
          ["A importar", String(resumen.aImportar)],
          ["Rechazadas", String(resumen.filasRechazadas)],
          ["Dudosas", String(resumen.dudosas)],
        ]}
      />
      {dudosas ? <Notice tone="warning">{dudosas}</Notice> : null}
      {rechazos.length > 0 ? (
        <div className="importar-informe__seccion">
          <h4>Filas rechazadas</h4>
          <ul className="importar-informe__lista">
            {rechazos.map((fila) => (
              <li key={fila.fila}>
                <strong>{`Fila ${fila.fila}`}</strong>
                <ul className="importar-informe__motivos">
                  {fila.motivos.map((motivo, indice) => (
                    <li key={indice}>
                      {motivo.columna
                        ? `${motivo.motivo} · columna ${motivo.columna}`
                        : motivo.motivo}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {avisos.length > 0 ? (
        <div className="importar-informe__seccion">
          <h4>Avisos</h4>
          <ul className="importar-informe__lista">
            {avisos.map((grupo, indice) => (
              <li key={indice}>
                {etiquetaGrupo(grupo)}
                {grupo.detalle.length > 0 ? (
                  <ul className="importar-informe__motivos">
                    {grupo.detalle.map((linea, lineaIndice) => (
                      <li key={lineaIndice}>{`Fila ${linea.fila}: ${linea.motivo}`}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
