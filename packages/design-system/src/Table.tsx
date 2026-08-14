import type { HTMLAttributes, ReactNode } from "react";
import "./Table.css";

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  align?: "left" | "right" | "center";
  render?: (row: T) => ReactNode;
  accessor?: (row: T) => ReactNode;
}

export interface TableProps<T> extends HTMLAttributes<HTMLTableElement> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
}

export function Table<T>({ columns, rows, rowKey, empty, ...rest }: TableProps<T>) {
  if (rows.length === 0) {
    return <>{empty ?? <div className="ds-table__empty">Sin resultados</div>}</>;
  }

  return (
    <div className="ds-table__wrapper">
      <table className="ds-table" {...rest}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={col.align ? `ds-table__cell--${col.align}` : undefined}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={col.align ? `ds-table__cell--${col.align}` : undefined}
                >
                  {col.render ? col.render(row) : col.accessor ? col.accessor(row) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
