import { Button, EmptyState, Field, Table } from "@contable/design-system";
import "./Demo.css";

interface Row {
  id: string;
  cliente: string;
  responsable: string;
  vencimiento: string;
  total: string;
}

const ROWS: Row[] = [
  { id: "1", cliente: "Alimentos del Sur S.A.", responsable: "M. López", vencimiento: "2026-08-20", total: "1.240.500,00" },
  { id: "2", cliente: "Constructora Roca S.R.L.", responsable: "J. Pérez", vencimiento: "2026-08-25", total: "3.102.750,00" },
  { id: "3", cliente: "Servicios Norte S.A.", responsable: "M. López", vencimiento: "2026-09-01", total: "980.000,00" },
];

export function Demo() {
  return (
    <div className="demo">
      <h1>Design system — demo interna</h1>
      <section className="demo__section">
        <h2>Botones</h2>
        <div className="demo__row">
          <Button>Primario</Button>
          <Button variant="secondary">Secundario</Button>
          <Button variant="ghost">Fantasma</Button>
          <Button variant="danger">Peligro</Button>
          <Button loading>Procesando</Button>
          <Button disabled>Deshabilitado</Button>
        </div>
      </section>

      <section className="demo__section">
        <h2>Formulario</h2>
        <div className="demo__row">
          <Field label="CUIT" name="cuit" hint="11 dígitos sin guiones" placeholder="20123456789" />
          <Field label="Razón social" name="razon" error="La razón social es obligatoria" />
        </div>
      </section>

      <section className="demo__section">
        <h2>Tabla densa</h2>
        <Table<Row>
          rows={ROWS}
          rowKey={(r) => r.id}
          columns={[
            { key: "cliente", header: "Cliente", render: (r) => r.cliente },
            { key: "responsable", header: "Responsable", render: (r) => r.responsable },
            { key: "vencimiento", header: "Próximo vencimiento", render: (r) => r.vencimiento },
            { key: "total", header: "Total", align: "right", render: (r) => r.total },
          ]}
        />
      </section>

      <section className="demo__section">
        <h2>Empty state</h2>
        <EmptyState
          title="Sin documentos pendientes"
          description="Cuando los clientes carguen documentación, aparecerá aquí para su revisión."
          action={<Button variant="secondary">Cargar un documento</Button>}
        />
      </section>
    </div>
  );
}