import { useLayoutEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { SectionIndex } from "../ui/SectionIndex";
import "./study.css";
import "./ayuda.css";

const CHAPTERS = [
  { id: "indice", label: "Índice" },
  { id: "principios", label: "Principios" },
  { id: "entrar", label: "Cómo entrar" },
  { id: "contexto", label: "Cliente y período" },
  { id: "pantallas", label: "Pantallas" },
  { id: "roles", label: "Roles" },
  { id: "circuito", label: "Circuito del mes" },
  { id: "clientes", label: "Clientes" },
  { id: "configuracion-fiscal", label: "Configuración fiscal" },
  { id: "reglas", label: "Reglas fiscales" },
  { id: "trabajo", label: "Trabajo" },
  { id: "bandeja", label: "Bandeja" },
  { id: "expediente", label: "Expediente mensual" },
  { id: "liquidaciones", label: "Liquidaciones" },
  { id: "portal", label: "Qué ve el cliente" },
  { id: "rentabilidad", label: "Rentabilidad" },
  { id: "usuarios", label: "Usuarios" },
  { id: "si-esto-pasa", label: "Si esto pasa" },
] as const;

function HelpTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="help-table-wrap">
      <table className="help-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StudyAyuda() {
  const location = useLocation();

  useLayoutEffect(() => {
    const id = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (!id) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.hash]);

  return (
    <article className="study-page study-page--wide help-page">
      <header className="study-page__header" id="indice">
        <div>
          <p className="study-page__eyebrow">Ayuda paso a paso</p>
          <h1 className="study-page__title">Manual del estudio</h1>
          <p className="study-page__subtitle">
            Cómo liquidar un período con evidencia, revisión y publicación controlada. Esta guía es
            para el equipo interno. El portal del cliente tiene su propio uso.
          </p>
        </div>
      </header>

      <SectionIndex items={[...CHAPTERS]} label="Capítulos del manual" />

      <section className="study-page__section help-section" id="principios">
        <h2 className="study-page__section-title">Principios que no se negocian</h2>
        <ol>
          <li>
            <strong>Siempre hay un contexto.</strong> Antes de operar, elegí cliente y, cuando
            corresponda, período en la barra superior.
          </li>
          <li>
            <strong>Cuatro ojos.</strong> Quien prepara no puede revisar el mismo expediente o
            liquidación. Titular y administrador pueden hacer las dos cosas, pero no sobre el mismo
            objeto.
          </li>
          <li>
            <strong>La evidencia manda.</strong> No se calcula ni se cierra con fuentes incompletas,
            duplicadas o sin revisar.
          </li>
          <li>
            <strong>Cerrado es cerrado.</strong> Un período o liquidación finalizados no se editan: se
            abre una rectificativa. La anterior queda como historial.
          </li>
          <li>
            <strong>El portal es un vidrio, no un taller.</strong> El cliente carga lo pedido y ve lo
            publicado. No ve borradores ni controles abiertos.
          </li>
        </ol>
        <ul className="help-flow" aria-label="Preparar, revisar, cerrar y publicar">
          <li>Preparar</li>
          <li>Revisar</li>
          <li>Cerrar</li>
          <li>Publicar</li>
        </ul>
      </section>

      <section className="study-page__section help-section" id="entrar">
        <h2 className="study-page__section-title">Cómo entrar</h2>
        <ol>
          <li>Abrí Contable e ingresá con correo y contraseña.</li>
          <li>Si el estudio tiene doble factor, cargá el código de verificación.</li>
          <li>Quedás en Inicio. El menú izquierdo muestra las secciones de tu rol.</li>
          <li>
            <strong>Recorrer el estudio</strong> (abajo a la izquierda) ubica cada bloque del menú.
            Esta página es el procedimiento de trabajo.
          </li>
        </ol>
        <p>
          Si no ves un cliente, no está asignado a tu usuario. Pedile al titular o al administrador
          que te lo asigne en Usuarios y accesos.
        </p>
      </section>

      <section className="study-page__section help-section" id="contexto">
        <h2 className="study-page__section-title">Barra de contexto</h2>
        <p>Arriba ves Estudio, Cliente y Período. Si cambiás el selector, cambia toda la pantalla.</p>
        <HelpTable
          headers={["Campo", "Qué hace"]}
          rows={[
            ["Estudio", "Queda fijo para el equipo del estudio."],
            ["Cliente", "Define de qué empresa estás hablando. Sin esto no se abre bandeja ni expediente."],
            ["Período", "Define el mes. Lo piden Expediente, Liquidaciones y Rentabilidad."],
          ]}
        />
        <p>
          El badge al lado del período muestra si está abierto, en trabajo o cerrado. No mezcles
          clientes ni meses.
        </p>
      </section>

      <section className="study-page__section help-section" id="pantallas">
        <h2 className="study-page__section-title">Mapa de pantallas</h2>
        <p>Lo que no aparece en el menú no está liberado para operar.</p>
        <HelpTable
          headers={["Grupo", "Pantalla", "Para qué"]}
          rows={[
            ["General", "Inicio", "Pendientes, cartera y qué requiere atención."],
            ["General", "Clientes / Resumen", "Alta y ficha de cada empresa."],
            ["Preparación", "Bandeja documental", "Recibir, extraer y revisar archivos."],
            ["Preparación", "Configuración fiscal", "Perfil, regímenes, períodos y obligaciones."],
            ["Ejecución", "Trabajo", "Pedidos al cliente, mensajes y vencimientos."],
            ["Ejecución", "Expediente mensual", "Circuito del mes."],
            ["Ejecución", "Liquidaciones", "Cartera por impuesto, papeles PDF/CSV, rectificativa."],
            ["Análisis", "Rentabilidad", "Resultado de gestión, aparte de lo fiscal."],
            ["Configuración", "Usuarios y accesos", "Equipo interno e invitaciones al portal."],
            ["Configuración", "Reglas fiscales", "Alícuotas, vencimientos y fuentes del estudio."],
          ]}
        />
      </section>

      <section className="study-page__section help-section" id="roles">
        <h2 className="study-page__section-title">Quién hace qué</h2>
        <HelpTable
          headers={["Rol", "Encargado de", "No hace"]}
          rows={[
            [
              "Titular / Administrador",
              "Toda la cartera, usuarios, reglas. Puede preparar o revisar.",
              "No puede ser preparador y revisor del mismo expediente.",
            ],
            [
              "Preparador",
              "Pedir docs, cargar, clasificar, calcular, enviar a revisión.",
              "Aprobar, finalizar, presentar, pagar ni publicar rentabilidad.",
            ],
            [
              "Revisor",
              "Controlar fuentes, aprobar o pedir cambios, finalizar, presentar, pagar, publicar.",
              "Preparar el mismo objeto que va a revisar.",
            ],
            ["Auditor · sólo lectura", "Consultar.", "Cambiar datos."],
          ]}
        />
        <p>
          Preparador, revisor y auditor sólo ven los clientes asignados. Titular y administrador ven
          toda la firma.
        </p>
      </section>

      <section className="study-page__section help-section" id="circuito">
        <h2 className="study-page__section-title">Circuito del mes</h2>
        <p>Este es el orden habitual. No saltees la revisión.</p>
        <ul className="help-flow" aria-label="Orden de trabajo del mes">
          <li>Perfil</li>
          <li>Pedir docs</li>
          <li>Bandeja</li>
          <li>Expediente</li>
          <li>Revisión</li>
          <li>Cerrar</li>
          <li>Presentar</li>
          <li>Papeles</li>
        </ul>
        <HelpTable
          headers={["Paso", "Dónde", "Listo cuando"]}
          rows={[
            ["1. Cliente en condiciones", "Clientes + Configuración fiscal", "Perfil activo, regímenes, período y obligaciones."],
            ["2. Pedir lo que falta", "Trabajo", "Pedido enviado, con fecha límite e ítems claros."],
            ["3. Entrar la evidencia", "Bandeja documental", "Cada archivo validado, extraído y aprobado."],
            ["4. Armar el mes", "Expediente mensual", "Fuentes cubiertas, clasificación hecha, controles resueltos."],
            ["5. Calcular", "Expediente / Liquidaciones", "Posición calculada, sin diferencias abiertas."],
            ["6. Cuatro ojos", "Expediente", "Un revisor distinto aprueba."],
            ["7. Cerrar", "Expediente", "Finalizar. El mes queda congelado."],
            ["8. Organismo y cobro", "Expediente · Cálculo", "Presentación con acuse y pago registrados."],
            ["9. Informar al cliente", "Liquidaciones", "PDF y CSV generados."],
            ["10. Gestión (opcional)", "Rentabilidad", "Devengado y caja; publicar si el cliente debe verlos."],
          ]}
        />
      </section>

      <section className="study-page__section help-section" id="clientes">
        <h2 className="study-page__section-title">Alta de un cliente</h2>
        <p>Pantalla Clientes. Hace falta permiso de gestión (titular o administrador).</p>
        <ol>
          <li>Crear cliente.</li>
          <li>
            Completá razón social, nombre comercial, CUIT, condición frente al IVA, forma jurídica,
            provincia, moneda (por ejemplo ARS) y datos de alta.
          </li>
          <li>Guardá. La configuración impositiva fina sigue en Configuración fiscal.</li>
          <li>Asigná quién del equipo trabaja esa cuenta en Usuarios y accesos.</li>
          <li>Si el cliente va a cargar solo, invitá al portal.</li>
        </ol>
        <p>
          Resumen del cliente sirve para controlar que el alta quedó completa. Si algo falta, el
          recuadro Próximo paso te dice a qué pantalla ir.
        </p>
      </section>

      <section className="study-page__section help-section" id="configuracion-fiscal">
        <h2 className="study-page__section-title">Configuración fiscal</h2>
        <p>Elegí el cliente. Orden sugerido:</p>
        <ol>
          <li>Crear perfil con CUIT, razón social y condición nacional. Queda en borrador.</li>
          <li>Enviar a revisión y Activar perfil. Sin perfil activo no hay liquidación seria.</li>
          <li>Registrar inscripción de cada régimen (IVA, IIBB, TEM, monotributo, CM03, etc.).</li>
          <li>Vincular actividad económica.</li>
          <li>Crear período fiscal (mes de trabajo, fechas reales).</li>
          <li>Crear obligación vinculando régimen, período y vencimiento.</li>
        </ol>
        <p>
          Si hay que corregir el perfil vigente: Crear nueva versión. No se pisa el historial.
        </p>
      </section>

      <section className="study-page__section help-section" id="reglas">
        <h2 className="study-page__section-title">Reglas fiscales</h2>
        <p>
          Las alícuotas, vencimientos y fuentes viven a nivel estudio, no del cliente. Las propone y
          aprueba titular o administrador. Un cálculo usa la versión vigente en esa fecha; un mes ya
          cerrado conserva la versión con la que se liquidó.
        </p>
      </section>

      <section className="study-page__section help-section" id="trabajo">
        <h2 className="study-page__section-title">Pedir documentación</h2>
        <ol>
          <li>Elegí cliente (y período si el pedido es del mes).</li>
          <li>Pedir documentación / Crear pedido.</li>
          <li>Poné asunto, instrucciones claras, fecha límite e ítems (qué archivo esperás).</li>
          <li>Enviá el pedido. El cliente lo ve en el portal, en pendientes.</li>
        </ol>
        <p>
          Cuando llegan archivos: Verificar pedidos (aceptar, rechazar con motivo o dispensar) y
          Enviar mensaje si hace falta una precisión. Atá cada archivo a un ítem del pedido.
        </p>
      </section>

      <section className="study-page__section help-section" id="bandeja">
        <h2 className="study-page__section-title">Bandeja documental</h2>
        <p>Siempre con un cliente elegido.</p>
        <h3 className="study-page__eyebrow">Si carga el estudio</h3>
        <ol>
          <li>Subir documento.</li>
          <li>Elegí el ítem solicitado al que corresponde.</li>
          <li>Elegir archivo y Subir y procesar.</li>
          <li>Esperá a que deje de decir Procesando comprobante.</li>
        </ol>
        <h3 className="study-page__eyebrow">Revisión de la extracción</h3>
        <ol>
          <li>Abrí el documento y confrontalo con Ver o descargar el archivo.</li>
          <li>Controlá CUIT, fechas, importes, tipo y que sea de ese cliente y ese mes.</li>
          <li>Corregí lo que la lectura haya propuesto mal.</li>
          <li>Aprobá cuando el dato coincida con el papel. Recién ahí es evidencia usable.</li>
        </ol>
        <div className="help-note">
          <p>Si no hay pedido, andá a Trabajo y crealo. La bandeja te va a pedir ese vínculo.</p>
        </div>
      </section>

      <section className="study-page__section help-section" id="expediente">
        <h2 className="study-page__section-title">Expediente mensual</h2>
        <p>Requiere cliente y período. Cabecera: Nuevo expediente, o Crear expediente si está vacío.</p>
        <p>
          Subir Excel importa libros IVA de compras y ventas por separado. Las seis etapas quedan
          siempre visibles. El cálculo no habilita si falta evidencia.
        </p>
        <ul className="help-flow" aria-label="Seis etapas del expediente">
          <li>1 Saldos</li>
          <li>2 Fuentes</li>
          <li>3 Clasificación</li>
          <li>4 Cálculo</li>
          <li>5 Controles</li>
          <li>6 Cierre</li>
        </ul>
        <HelpTable
          headers={["Etapa", "Qué hacer"]}
          rows={[
            ["1. Saldos", "Revisá arrastres. Cargar saldo inicial si el mes arranca con un saldo que todavía no está en el sistema."],
            ["2. Fuentes", "Subí o vinculá cada fuente. El revisor aprueba el lote. El preparador no se autoaprueba."],
            ["3. Clasificación", "Completá actividades y rubros. Tiene que llegar a clasificados / 0 pendientes."],
            ["4. Cálculo", "Calcular se habilita cuando está listo. Si pidieron cambios, el botón pasa a Recalcular."],
            ["5. Controles", "Resolvé hallazgos bloqueantes con evidencia. No finalices con controles abiertos."],
            ["6. Cierre", "Enviar a revisión → Aprobar o Solicitar cambios → Finalizar. Finalizar congela el mes."],
          ]}
        />
        <HelpTable
          headers={["Estado", "Quién", "Botón"]}
          rows={[
            ["Listo para calcular", "Preparador", "Calcular"],
            ["Calculado", "Preparador", "Enviar a revisión"],
            ["En revisión", "Revisor", "Aprobar revisión o Solicitar cambios"],
            ["Revisado", "Revisor", "Finalizar"],
            ["Finalizado", "Revisor", "Crear rectificativa, si hay que enmendar"],
          ]}
        />
        <p>
          Desde Cálculo también se registran presentación (con acuse) y pago cuando la liquidación
          ya está finalizada. No des por presentada una DDJJ que el organismo no recibió.
        </p>
      </section>

      <section className="study-page__section help-section" id="liquidaciones">
        <h2 className="study-page__section-title">Liquidaciones</h2>
        <p>Tablero del mes: cada régimen, versión, estado y total a ingresar.</p>
        <HelpTable
          headers={["Botón", "Cuándo"]}
          rows={[
            ["Ver expediente", "Siempre, para volver a la evidencia."],
            ["Calcular liquidación", "Hay régimen, período y documentación aprobada."],
            ["Enviar a revisión", "Estado calculado."],
            ["Revisar", "Estado en revisión."],
            ["Finalizar", "Estado revisado."],
            ["Rectificar", "Ya finalizado: abre v2 en borrador y conserva v1."],
            ["PDF / CSV", "Finalizado: papel de trabajo que el portal puede mostrar."],
          ]}
        />
        <p>
          El cálculo sólo toma documentación aprobada. Si el número no cierra, el problema está en
          fuentes, clasificación o saldos, no en el botón.
        </p>
      </section>

      <section className="study-page__section help-section" id="portal">
        <h2 className="study-page__section-title">Qué ve el cliente</h2>
        <p>Invitá al portal desde Usuarios y accesos, con un cliente seleccionado.</p>
        <ol>
          <li>Invitar al portal (email y rol).</li>
          <li>Roles: Titular (carga y consulta), Colaborador (carga), Sólo lectura (consulta).</li>
          <li>Copiá el enlace. La invitación vence a los siete días y vale para ese correo.</li>
          <li>Revocá acceso o invitación cuando la persona deje de operar.</li>
        </ol>
        <p>
          El cliente ve pendientes, carga archivos si su rol lo permite, y consulta obligaciones y
          resultados publicados. No ve borradores ni reglas. Si algo no le aparece, casi siempre es
          porque el estudio todavía no finalizó o no generó el PDF/CSV.
        </p>
      </section>

      <section className="study-page__section help-section" id="rentabilidad">
        <h2 className="study-page__section-title">Rentabilidad</h2>
        <p>No contamina IVA, IIBB ni TEM. Tratá estos números como gestión, no como estados certificados.</p>
        <ol>
          <li>Elegí cliente y período con obligaciones materializadas.</li>
          <li>Calcular devengado.</li>
          <li>Calcular caja.</li>
          <li>El revisor publica si el cliente debe verlo. Hasta entonces, no sale en el portal.</li>
        </ol>
      </section>

      <section className="study-page__section help-section" id="usuarios">
        <h2 className="study-page__section-title">Usuarios internos</h2>
        <ol>
          <li>Invitar al estudio con email y rol interno.</li>
          <li>El rol define los módulos que esa persona ve.</li>
          <li>Para preparador, revisor y auditor: asigná clientes. Sin asignación no operan cuentas.</li>
        </ol>
        <p>Módulos de estudios es una pantalla de administración de la plataforma, no del día a día.</p>
      </section>

      <section className="study-page__section help-section" id="si-esto-pasa">
        <h2 className="study-page__section-title">Si esto pasa</h2>
        <HelpTable
          headers={["Situación", "Qué hacer"]}
          rows={[
            ["No veo el cliente", "Pedir asignación. No es un error de la pantalla."],
            ["No puedo calcular", "Faltan fuentes revisadas o clasificación. El botón lo dice."],
            ["No puedo aprobar un expediente que armé yo", "Es correcto: tiene que revisar otra persona."],
            ["El cliente no ve la liquidación", "¿Está finalizada? ¿Se generaron PDF/CSV? ¿El acceso al portal sigue activo?"],
            ["Hay que corregir un mes cerrado", "Rectificar / Crear rectificativa. No reabrir a mano."],
            ["La lectura del PDF está mal", "Corregir en bandeja antes de aprobar."],
            ["Pedido eterno en Trabajo", "Verificar ítems: aceptar, rechazar con motivo o dispensar."],
            ["Perfil fiscal en borrador", "Enviar a revisión y activar."],
            ["Controles en rojo", "Resolverlos con evidencia en la etapa 5."],
            ["Cargué en otro cliente", "Parar. Cambiar el selector no mueve el archivo. No apruebes lo ajeno."],
          ]}
        />
        <h3 className="study-page__eyebrow">Rutina sugerida del mes</h3>
        <p>
          <strong>Primera semana:</strong> perfil, período, obligaciones, pedido documental y saldos
          iniciales.
        </p>
        <p>
          <strong>Durante el mes:</strong> vaciar bandeja, completar fuentes y clasificación.
        </p>
        <p>
          <strong>Semana de vencimiento:</strong> calcular, revisión de otra persona, cierre,
          presentación con acuse, pago, papeles y aviso al cliente.
        </p>
      </section>
    </article>
  );
}
