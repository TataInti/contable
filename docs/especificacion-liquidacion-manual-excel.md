# Especificación Técnica — Flujo de Liquidación Mensual (archivo `demo-liquidacion-manual.xlsx`)

> **Propósito:** documentar, de forma detallada y extensa, la lógica de negocio encontrada dentro del archivo Excel `demo-liquidacion-manual.xlsx`, para usarla como **especificación técnica del flujo a replicar** en el software Contable.
>
> **Fuente:** extracción programática del workbook con `openpyxl` (modo fórmulas, `data_only=False`). Período analizado: **Junio 2026** (aunque el workbook contiene datos históricos 2013–2026).
>
> **Contribuyente de referencia:** `VALLEJO ESTEBAN` — CUIT `23-23140251-9` — "Distribuidora Brako S.R.L." (encabezados históricos de la hoja `EERRDO 2017` y `AUDITOR`).
>
> **Alcance tributario:** IVA (nacional), Ingresos Brutos Convenio Multilateral (Córdoba, Santa Fe, Tucumán) y TEM (Tucumán).

---

## 1. Vista general del workbook

El archivo es un **libro de cálculo mensual** (25 hojas, ~2.200 fórmulas) organizado en una **pirámide de dependencias**:

```
┌────────────────────────────────────────────────────────────────────┐
│  CAPA 1 · LIBROS AUXILIARES (datos crudos del mes)                 │
│  Ventas · Compras · Base de Datos Compras · Ret perc IVA           │
│  Mis Retenc · Sirtac · Sircar PER · SIRCREB · RB/RET/PER TUC       │
│  F.931 (sueldos)                                                   │
└──────────────────────────────┬─────────────────────────────────────┘
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│  CAPA 2 · SOPORTES / RESUMENES (agregaciones)                      │
│  F.931 (totales) · Sirtac (totales) · Sircar (totales)             │
│  SIFERE (saldos anteriores IIBB) · SCT (saldo técnico IVA)         │
│  DJ IVA PA (saldo a favor IVA)                                     │
└──────────────────────────────┬─────────────────────────────────────┘
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│  CAPA 3 · HOJA PRINCIPAL DE CÁLCULO (IVA-IB-TEM)                   │
│  Resumen IVA → Resultado IVA (a pagar / a favor)                   │
│  IIBB por jurisdicción → Resultado por provincia                   │
│  TEM → Resultado TEM                                               │
│  Intereses → Total impuestos a pagar                               │
└────────────────────────────────────────────────────────────────────┘
```

Las hojas se agrupan funcionalmente así:

| Grupo | Hojas | Rol |
|---|---|---|
| Libros de IVA | `Ventas`, `Compras`, `Base de Datos Compras`, `Ret perc IVA`, `Mis Retenc` | Detalle de comprobantes (ventas/compras) y retenciones/percepciones de IVA |
| Retenciones/percepciones IIBB | `Sirtac` (SF), `Sircar PER` (Cba), `SIRCREB` (CM), `RB TUC`/`RET TUC`/`PER TUC` | Detalle y totales de retenciones y percepciones provinciales |
| Sueldos | `F.931` | Determinación de sueldos y contribuciones patronales (base para Dto. 814) |
| Saldos anteriores | `SCT`, `DJ IVA PA`, `SIFERE` | Saldo técnico IVA, saldo a favor IVA y saldos de IIBB |
| **Cálculo principal** | **`IVA-IB-TEM`** | **Resumen de IVA, IIBB, TEM, intereses y total** |
| Auditoría/control | `AUD IVA`, `AUD IIBB 2017`, `EERRDO 2017`, `CAJA FISCAL`, `AUDITOR`, `Control de las acred.`, `DIFERENCIAS-AJUSTE DE COEF` | Conciliaciones y análisis histórico anual |

---

## 2. Convenciones y constantes globales

### 2.1 Alícuotas de IVA (vigentes en el período)

| Alícuota | Celda de referencia | Uso |
|---|---|---|
| 21% (general) | `Ventas!N18`, `Compras` columna AB | Débito/crédito fiscal general |
| 10,5% (reducida) | `Ventas!N19`, `Compras` columna Z | Bienes y servicios con alícuota reducida |
| 27% (incrementada) | `Ventas!N20`, `Compras` columna AD | Servicios públicos, energía |
| 0% / exento / no gravado | `Ventas` M/N, `Compras` K/L | No generan IVA |

### 2.2 Alícuotas y coeficientes de IIBB (Junio 2026)

| Jurisdicción | Código | Alícuota | Fuente |
|---|---|---|---|
| Córdoba | 904 | 4,25% (diferencial CM) | `IVA-IB-TEM!D93` |
| Santa Fe | 921 | 3,00% (diferencial CM) | `IVA-IB-TEM!D94` |
| Tucumán | 924 | 3,50% (TEM) | `IVA-IB-TEM!N79` |

Coeficientes de Convenio Multilateral (`SIRCREB!B2:B3`): **0,3333** (redondeado); ponderación **0,5**; alícuota **1,5%**.

TEM: alícuota **1,25%** (`F105`), mínimo **$61.446** (`F107`).

### 2.3 Crédito por contribuciones (Dto. 814 / Art. 19 Ley 27.541)

- Alícuota: **6,5%** (`D30`) aplicada sobre la **remuneración total** (sueldos) del período.
- Sueldo = `F.931!R17` (total remuneraciones − importe a detraer).

### 2.4 Redondeos y precisión

- Los libros de IVA del SIFERE (Ventas/Compras) redondean a **2 decimales** en el total (`AF`/`AG`), mientras que la suma de las alícuotas puede diferir en centavos (el IVA total está redondeado a 2 dígitos, no es la suma exacta de los componentes).
- El motor de la app debe decidir una política de redondeo explícita (ver §10).

---

## 3. Capa 1 — Libros auxiliares

### 3.1 Hoja `Ventas`

**Columnas** (formato SIFERE/libro IVA ventas):

`A` Fecha de Emisión · `B` Tipo de Comprobante · `C` Punto de Venta · `D` Número · `E` Hasta · `F` Tipo Doc. · `G` Nro. Doc. · `H` Denominación · `I` Vto. Pago · `J` Importe Total · `K` Moneda · `L` Tipo de Cambio · `M` No Gravado · `N` Exento · `O` Per. Otros Imp. Nac. · `P` Percepción IIBB · `Q` Imp. Municipales · `R` Percepción No Categorizados · `S` Imp. Internos · `T` Otros Tributos · `U` Neto 0% · `V` Neto 2,5% · `W` IVA 2,5% · `X` Neto 5% · `Y` IVA 5% · `Z` Neto 10,5% · `AA` IVA 10,5% · `AB` Neto 21% · `AC` IVA 21% · `AD` Neto 27% · `AE` IVA 27% · `AF` Total Neto Gravado · `AG` Total IVA.

**Agregaciones (filas 16–29):**

| Celda | Fórmula | Significado |
|---|---|---|
| `M16:AG16` | `SUM(...2:15)` | Total por columna del mes |
| `M18` | `=O18/N18` | Base = IVA 21% / 0,21 |
| `M19` | `=O19/N19` | Base = IVA 10,5% / 0,105 |
| `M20` | `=O20/N20` | Base = IVA 27% / 0,27 |
| `M21` | `=SUM(M18:M20)` | Base total según alícuotas |
| `S24`/`S25` | `=T24/0.21` | Neto 21% de Facturas A / Facturas B |
| `N26` | `=N24-N25` | Neto gravado total (operaciones − NC) |
| `P26` | `=P24-P25` | Débito fiscal total |
| `N27` | `=N26-Z16-AB16-AD16` | Neto gravado ajustado (menos netos por alícuota) → **diferencia a investigar** |
| `P27` | `=P26-AC16-AA16-AE16` | Débito fiscal ajustado (menos IVA por alícuota) → **diferencia a investigar** |
| `S28` | `=T28/0.21` | Base de la actividad "Servicio de transporte automotor" |
| `S29`/`T29` | `=S28+S26` / `=T28+T26` | **Base total** y **IVA total** del mes (consolidado) |

**Reglas de negocio identificadas:**

1. Los comprobantes se agrupan por tipo: **Factura A** (RI), **Factura B/Consumidor Final**, y **Notas de Crédito** (tipo 3/6/8) que restan.
2. El débito fiscal del mes = suma de `AC` (IVA 21%) + `AA` (10,5%) + `AE` (27%), neteado por NC.
3. Se distingue la actividad **"Servicio de transporte automotor"** (línea `R28`) con su propia base/IVA, porque tributa IIBB de forma diferencial (ver §5.2).
4. La hoja calcula **diferencias** entre el total según libro y la suma por alícuota (`N27`, `P27`) — estas diferencias se arrastran a la hoja principal como "Diferencia" del débito fiscal.

> **Nota de precisión:** los montos de la fila 16 (totales por columna) están redondeados a 2 decimales por el importador (AFIP). La suma de las alícuotas puede no coincidir con el total general por centavos. En la app, el **débito fiscal** debe ser la suma de los IVA por alícuota del libro, y la "diferencia" debe calcularse contra el total general.

### 3.2 Hoja `Compras`

**Columnas** (formato SIFERE/libro IVA compras):

`A` Fecha · `B` Tipo Comp. · `C` Punto de Venta · `D` Número · `E` Tipo Doc. · `F` Nro. Doc. · `G` Denominación · `H` Importe Total · `I` Moneda · `J` Tipo Cambio · `K` No Gravado · `L` Exento · `M` **Crédito Fiscal Computable** · `N` Per. Otros Imp. Nac. · `O` Percepción IIBB · `P` Imp. Municipales · `Q` Percepción IVA · `R` Imp. Internos · `S` Otros Tributos · `T` Neto 0% · `U` Neto 2,5% · `V` IVA 2,5% · `W` Neto 5% · `X` IVA 5% · `Y` Neto 10,5% · `Z` IVA 10,5% · `AA` Neto 21% · `AB` IVA 21% · `AC` Neto 27% · `AD` IVA 27% · `AE` Total Neto · `AF` Total IVA · `AH` Actividad (VLOOKUP).

**Columna `AH` (actividad del proveedor):**

```
=+VLOOKUP(F2,'Base de Datos Compras'!$B$2:$C$71,2,0)
```

- Busca el **CUIT** del proveedor (`F`) en la tabla `Base de Datos Compras` (B:C) y trae el **rubro** (`SUPER` / `TRANSPORTE`).
- Si el CUIT no está en la tabla → `#N/A` (y no participa de las retenciones de IIBB).

**Agregaciones (filas 101, 108–129):**

| Celda | Fórmula | Significado |
|---|---|---|
| `K101:AF101` | `SUM(...2:99)` | Totales del mes por columna |
| `J109`/`L109` | valores | Operaciones de compras: neto 14.303.653,89 / CF 2.705.101,97 (cargados manualmente) |
| `J110`/`L110` | valores | Notas de Crédito de compras: neto 329.290,71 / CF 69.151,04 |
| `J111`/`L111` | `=J109-J110` | Neto y CF netos de NC |
| `J112` | `=J111-AE101` | Diferencia neto vs. suma por alícuota |
| `K112` | `=K111-L101-K101` | Exento/no gravado ajustado |
| `L112` | `=L111-AD101-AB101-Z101` | **Diferencia de CF** vs. suma por alícuota |
| `J117`/`J118` | valores | CF computable (2.705.101,97) y CF computable a restituir (69.151,04) |
| `J123:K125` | `=K123/0.21` | Totales por rubro: **Minimercados** (21% y 10,5%) |
| `J127:K129` | `=K127/0.21` | Totales por rubro: **Servicio de transporte automotor** |

**Reglas de negocio identificadas:**

1. El **crédito fiscal computable** del mes = suma de `AB` (21%) + `Z` (10,5%) + `AD` (27%), neteado por NC.
2. Las **compras no gravadas/exentas** (`K` + `L`) se informan en la hoja principal (celda `D42`) para el cálculo de la **prorrata** y del débito técnico.
3. El **CF a restituir** (69.151,04) corresponde a las notas de crédito (devuelve CF).
4. Se clasifican las compras en dos grandes rubros para IIBB: **Minimercados** (SUPER) y **Servicio de transporte automotor** (TRANSPORTE), con sus totales por alícuota.
5. Hay una tabla de control `G104:G105` con notas: "Cargados manualmente" / "Ok en Portal Iva" — indicando que los totales de la fila 109-110 son **ingresados a mano** (conciliación con el Portal IVA de AFIP) y no derivados de las filas.

### 3.3 Hoja `Base de Datos Compras`

Tabla maestra de proveedores:

`A` Denominación · `B` Nro. Doc. (CUIT) · `C` Rubro (`SUPER` / `TRANSPORTE`).

- Rango: `B2:C71` (70 proveedores).
- Se usa únicamente para clasificar compras en los rubros de IIBB.

### 3.4 Hoja `Ret perc IVA`

Detalle de **retenciones y percepciones de IVA** (SICORE):

`A` CUIT Agente · `B` Denominación · `C` Impuesto (767) · `D` Descripción · `E` Régimen (493/602) · `F` Descripción Régimen · `G` Fecha Ret./Perc. · `H` Número Certificado · `I` Tipo de Operación (**RETENCION** / **PERCEPCION**) · `J` Importe · `K` Número Comprobante · `L` Fecha Comprobante · `M` Descripción Comprobante (FACTURA / NOTA DE CREDITO / OTRO COMPROBANTE) · `N` Fecha Registración DJ.

**Agregaciones (filas 47–51):**

| Celda | Fórmula | Significado |
|---|---|---|
| `J47` | `=SUM(J2:J46)` | Total del período (incluye NC negativas) |
| `J49` | `=SUMIF($I$2:$I$44,I49,$J$2:$J$44)` | **Total retenciones** (solo `RETENCION`) |
| `J50` | `=SUMIF($I$2:$I$44,I50,$J$2:$J$44)` | **Total percepciones** (solo `PERCEPCION`) |
| `J51` | `=J47-J49-J50` | Diferencia (debe ser 0 si todos están clasificados) |

**Reglas de negocio identificadas:**

1. Los importes pueden ser **negativos** (notas de crédito de percepciones/retenciones) — se suman algebraicamente.
2. La clasificación retención vs. percepción se hace por la columna `I` (texto exacto `RETENCION`/`PERCEPCION`).
3. Los totales alimentan la hoja principal: `D37` = retenciones, `D35` = percepciones.

### 3.5 Hoja `Mis Retenc`

Libro histórico de retenciones/percepciones (desde 2015):

- Mismo formato que `Ret perc IVA` (columnas A–N).
- Incluye bloque de **restitución de percepciones** (filas 88–106: notas de crédito negativas) y bloque con **formato de constancias** (filas 110+).
- **Fórmulas de formato de constancia** (a replicar en la app):

```
O111 = RIGHT(K111,12)                    -- últimos 12 dígitos del nº de comprobante
P111 = TEXT(O111,"0000-00000000")        -- constancia con formato "0000-00000000"
Q111 = TEXT(A111,"00-00000000-0")        -- CUIT con formato "00-00000000-0"
```

- `J86` = `SUM(J2:J85)` (total período); `G106` = `SUM(G90:G105)` (total restituciones).

**Regla:** las **restitución de percepciones** (notas de crédito) se informan como importes **negativos** y se acumulan aparte.

### 3.6 Hoja `F.931` (sueldos)

Detalle del F.931 (seguridad social):

`A` CUIL · `B` Apellido y Nombre · `C` Obra Social · `D` ¿Reducción? · `E` Cobertura SCVO · `F` Situación · `G` Condición · `H` Actividad · `I` Modalidad · `J` Siniestrado · `K` Localidad · `L` % Reducción · `M` Cónyuge · `N` Hijos · `O` Adherentes · `P` **Remuneración Total** · `Q:Z` Remuneraciones por período · `AA` **Importe a detraer** · `AB:AG` Situación de revista · `AH` Días trabajados · `AI` Horas · `AJ` Sueldo · `AK` Adicionales · `AL:AM` Horas extras · `AN` Plus zona · `AO` SAC · `AP` Vacaciones · `AQ` Premios · `AR` No remun. · `AS` Incremento salarial · `AT` Maternidad · `AU` Rectificación · `AV` Asignaciones familiares · `AW:BD` **Contribuciones previsionales** · `BE` % aplicado · `BF:BG` RENATEA · `BH:BP` **Aportes** · `BR:BU` **Contribuciones OS** · `BV:BY` Aporte OS.

**Agregaciones (filas 15–17):**

| Celda | Fórmula | Significado |
|---|---|---|
| `R15` | `=SUM(R6:R14)` | Total remuneraciones |
| `AA15` | `=SUM(AA6:AA14)` | Total importe a detraer |
| `R16` | `=+AA15` | Importe a detraer |
| `R17` | `=+R15-R16` | **Remuneración neta** (base para Dto. 814) |

**Regla de negocio:** la base para el crédito por contribuciones es la **remuneración total menos el importe a detraer** (deducciones no remunerativas).

---

## 4. Capa 2 — Soportes y resúmenes

### 4.1 Hoja `SCT` — Saldo técnico IVA período anterior

| Celda | Contenido |
|---|---|
| `E38` | `Sdo. Tecnico` |
| `F38` | **651.983,11** |

- Valor **pegado** (no es fórmula) — proviene de la DDJJ de IVA del período anterior.
- Alimenta `IVA-IB-TEM!D38` (Saldo a Favor 1° Párrafo).

### 4.2 Hoja `DJ IVA PA` — Saldo a favor de períodos anteriores

| Celda | Contenido |
|---|---|
| `K34` | `SLD` |
| `L34` | **500.276,66** |
| `K37` | `Compensación por ...` |
| `L37` | **181.580,01** |

- `L34` alimenta `IVA-IB-TEM!D39` (Saldo a Favor 2° Párrafo).
- `L37` es la **compensación** aplicada en el período (alimenta `AUDITOR!N14`).

### 4.3 Hoja `SIFERE` — Saldos anteriores de IIBB

| Celda | Jurisdicción | Saldo |
|---|---|---|
| `K22` / `L22` | Córdoba | 1.761.112,83 |
| `K23` / `L23` | Santa Fe | 2.292.123,08 |
| `K24` / `L24` | Tucumán | 7.104.721,89 |

- Alimentan `IVA-IB-TEM!G87/K87/O87` (SALDO ANTERIOR por jurisdicción).

### 4.4 Hoja `Sirtac` — Retenciones SIRTAC (Santa Fe)

Detalle de operaciones informadas por los agentes (líneas 3–65):

`A` Agente (CUIT + razón social) · `B` DDJJ (ID + período + secuencia) · `C` Tipo Registro (2 = Informativo) · `D` Nro. Liquidación · `E` Fecha Liquidación · `F` Fecha Retención · `G` Cant. Movimientos · `H` Jur. Informada (924) · `I` Monto Sujeto a Retención · `J` Alícuota Aplicada · `K` Monto Retenido.

**Agregaciones:**

| Celda | Fórmula | Significado |
|---|---|---|
| `K66` | 0 | Total (línea informativa) |
| `K69` | `=SUM(K3:K68)` | Total retenciones SIRTAC |
| `K23` | (referencia) | Retenciones SIRTAC → `IVA-IB-TEM!G85` |
| `K53` | (referencia) | Percepciones SIRTAC → `IVA-IB-TEM!K85` |

> **Nota:** en el período analizado los montos retenidos están en 0 (solo informativo). La estructura soporta montos positivos.

### 4.5 Hoja `Sircar PER` — Percepciones SIRCAR (Córdoba)

Detalle de percepciones de IIBB Córdoba (líneas 23–73):

`A` CUIT Agente · `B` Denominación · `C` Mes · `D` Año · `E` DDJJ · `F` Rect. · `G` Comprobante · `H` Tipo Comp. · `I` Letra · `J` Régimen (559 - RG 15/97) · `K` Monto Sujeto · `L` Alícuota (%) · `M` **Monto Percibido** · `N` Fecha Percepción · `O` Tipo Operación · `P` Nro. Constancia.

**Agregación:**

| Celda | Fórmula | Significado |
|---|---|---|
| `M27` | `=SUM(M23:M26)` | Total percepciones SIRCAR → `IVA-IB-TEM!K83` |

**Regla:** admite **notas de crédito** (importes negativos, p.ej. `M23 = -73,45`).

### 4.6 Hoja `SIRCREB` — Convenio Multilateral

Tabla de distribución de IIBB CM:

| Jurisdicción | Coef Original | Alícuota | Ponderación | Distribución | Importe |
|---|---|---|---|---|---|
| 904 Córdoba | 0,3333 | 1,5% | 0,5 | 0,5 | 223.738,05 |
| 921 Santa Fe | 0,3333 | 1,5% | 0,5 | 0,5 | 223.738,07 |
| Total | — | — | 0,9999 | 1 | 447.476,12 |

- Alimenta `IVA-IB-TEM!G84` (Rec. Bancarias Córdoba = `O14`) y `K84` (Rec. Bancarias Santa Fe = `O15`).
- Los valores `O14`/`O15` están fuera del rango visible pero son referenciados; representan **retenciones bancarias** del CM.

### 4.7 Hojas `RB TUC`, `RET TUC`, `PER TUC` — Tucumán

| Hoja | Celda | Valor | Significado |
|---|---|---|---|
| `RB TUC` | `L17` | 64.425,94 | Retenciones bancarias TEM |
| `RET TUC` | `M33` | 6.859,36 | Retenciones TEM |
| `PER TUC` | `M33` | 122.173,32 | Percepciones TEM |

- Alimentan `IVA-IB-TEM!O84/O85/O83` respectivamente.

---

## 5. Capa 3 — Hoja principal de cálculo (`IVA-IB-TEM`)

Es el **núcleo** del flujo. Se divide en bloques numerados por zona de filas.

### 5.1 Bloque Débito Fiscal (filas 5–14)

| Celda | Fórmula | Significado |
|---|---|---|
| `D9` | `=F9/E9` | Base = IVA / alícuota (Servicio de transporte automotor) |
| `F9` | `=+Ventas!T28` | IVA transporte automotor |
| `D10` | `=F10/E10` | Base = IVA / alícuota (Cultivo caña) |
| `D11` | `=F11/E11` | Base = IVA / alícuota (Minimercados) |
| `D12` | `=SUM(D9:D11)` | Base total por alícuotas |
| `F12` | `=SUM(F9:F11)` | **Débito fiscal total** |
| `D13` | `=+Ventas!S29` | Base según libro (total) |
| `F13` | `=+Ventas!T29` | IVA según libro (total) |
| `D14` | `=D13-D12` | **Diferencia de base** (libro vs. alícuotas) |
| `F14` | `=F12-F13` | **Diferencia de IVA** (alícuotas vs. libro) |

**Regla:** el débito fiscal del período es `F12` (suma por alícuota). Las diferencias `D14/F14` se muestran como control, no se suman al resultado.

### 5.2 Bloque Crédito Fiscal (filas 16–25)

| Celda | Fórmula | Significado |
|---|---|---|
| `F20` | `=+Compras!AB101` | IVA 21% compras |
| `F21` | `=+Compras!Z101` | IVA 10,5% compras |
| `F22` | `=+Compras!AD101` | IVA 27% compras |
| `D20:D22` | `=F20/E20` | Bases por alícuota |
| `D23` | `=SUM(D20:D22)` | Base total por alícuotas |
| `D24` | `=+Compras!AE101` | Base según libro |
| `F24` | `=+Compras!AF101` | IVA según libro |
| `D25` | `=D24-D23` | Diferencia de base |
| `F25` | `=F23-F24` | Diferencia de IVA |

**Regla:** el crédito fiscal del período es `F23` (suma por alícuota). Las diferencias se muestran como control.

### 5.3 Bloque Crédito Contribuciones Dto. 814 (filas 27–31)

| Celda | Fórmula | Significado |
|---|---|---|
| `C30` | `=+F.931!R17` | Remuneración neta del período |
| `D30` | 0,065 | Alícuota 6,5% |
| `E30` | `=C30*D30` | **Crédito por contribuciones** |
| `E31` | `=+E30` | A computar |
| `F31` | `=+F30` | Tomado (ajuste manual) |

### 5.4 Bloque Otros Datos (filas 34–42)

| Celda | Fórmula | Significado |
|---|---|---|
| `D35` | `=+'Ret perc IVA'!J50` | **Percepciones de IVA** (SICORE) |
| `D36` | 0 | Restitución de percepciones (manual) |
| `D37` | `=+'Ret perc IVA'!J49` | **Retenciones de IVA** (SICORE) |
| `D38` | `=+SCT!F38` | **Saldo a favor 1° párrafo** (saldo técnico período anterior) |
| `D39` | `=+'DJ IVA PA'!L34` | **Saldo a favor 2° párrafo** (saldo LD período anterior) |
| `D40` | — | Monto utilizado (manual) |
| `D42` | `=+Compras!K101+Compras!L101` | **Compras no gravadas** (no gravado + exento) |

### 5.5 Bloque Detalle de la DDJJ de IVA (filas 44–66)

| Celda | Fórmula | Significado |
|---|---|---|
| `E48` | `=+F12` | Débito fiscal |
| `D49` | `=+F20` | Crédito 21% |
| `D50` | `=+F22` | Crédito 27% |
| `D51` | `=+F21` | Crédito 10,5% |
| `D52` | `=+E30` | Crédito contribuciones |
| `D54` | `=+D38` | Saldo a favor 1° párrafo |
| `D55` | `=SUM(D49:D54)` | **Sub-total créditos** |
| `E55` | `=E48+E52` | Sub-total débitos |
| `E57` | `=E55-D55` | **Saldo técnico del período** |
| `D59` | `=+D39` | Saldo a favor 2° párrafo |
| `D61` | `=+'Ret perc IVA'!J50` | Percepciones |
| `D62` | 0 | Restitución percepciones |
| `D63` | `=+D37` | Retenciones |
| `D64` | `=SUM(D59:D63)` | **Sub-total** (saldo anterior + ret/perc) |
| `E66` | `=E57-D64` | **Resultado IVA** |
| `B66` | `=IF(E66>0,"A Pagar","A Favor")` | Etiqueta resultado |

**Regla de negocio clave (DDJJ IVA):**

```
Saldo técnico = Débito fiscal − (Crédito fiscal + Crédito contribuciones + Saldo técnico anterior)
Resultado IVA = Saldo técnico − (Saldo a favor 2° párrafo + Percepciones − Restituciones + Retenciones)
Etiqueta: E66 > 0 → "A Pagar"; E66 < 0 → "A Favor"
```

### 5.6 Bloque IIBB — Grilla por jurisdicción (filas 69–88)

Encabezados de actividad y códigos de jurisdicción:

| Celda | Valor | Significado |
|---|---|---|
| `D73` | `904 - Cordoba` | Código actividad / jurisdicción |
| `H73` | `921 - Santa Fe` | Ídem |
| `L73` | `924 - Tucuman` | Ídem |
| `E73` / `I73` / `M73` | 0 / 0 / 1 | Flag de jurisdicción activa en el mes |
| `P73` | `=I73+E73+M73` | Cantidad de jurisdicciones activas |

**Cálculo de base por jurisdicción (filas 77–79), para cada actividad:**

```
Ej. fila 77 (Servicio de transporte automotor):
  D77 = $D$9 * E73      -- Base Córdoba = Base actividad × flag Cba
  G77 = (D77+E77)*F77   -- Impuesto Córdoba = (Base + Ajuste) × Alícuota
  H77 = $D$9 * I73      -- Base Santa Fe = Base actividad × flag SF
  K77 = (H77+I77)*J77   -- Impuesto Santa Fe
  L77 = $D$9 * M73      -- Base Tucumán = Base actividad × flag TUC
  O77 = (L77+M77)*N77   -- Impuesto Tucumán = (Base + Ajuste) × Alícuota
  P77 = D77+E77+H77+I77+L77+M77  -- Total país (base)
```

**Totales (filas 81–88):**

| Celda | Fórmula | Significado |
|---|---|---|
| `G81` | `=SUM(G77:G80)` | Impuesto determinado Córdoba |
| `K81` | `=SUM(K77:K80)` | Impuesto determinado Santa Fe |
| `O81` | `=SUM(O77:O80)` | Impuesto determinado Tucumán |
| `P81` | `=SUM(P77:P80)` | Total país |
| `Q81` | `=P81-D12` | Diferencia base país vs. débito fiscal |
| `G83` | 0 | Percepciones Córdoba (manual) |
| `K83` | `=+'Sircar PER'!M27` | **Percepciones Santa Fe** (SIRCAR) |
| `O83` | `=+'PER TUC'!M33` | Percepciones Tucumán |
| `G84` | `=+SIRCREB!O14` | **Rec. bancarias Córdoba** |
| `K84` | `=+SIRCREB!O15` | **Rec. bancarias Santa Fe** |
| `O84` | `=+'RB TUC'!L17` | Rec. bancarias Tucumán |
| `G85` | `=+Sirtac!K23` | Retenciones Córdoba (SIRTAC) |
| `K85` | `=+Sirtac!K53` | Retenciones Santa Fe (SIRTAC) |
| `O85` | `=+'RET TUC'!M33` | Retenciones Tucumán |
| `G86` | 0 | Otros créditos (manual) |
| `G87` | `=+SIFERE!L22` | Saldo anterior Córdoba |
| `K87` | `=+SIFERE!L23` | Saldo anterior Santa Fe |
| `O87` | `=+SIFERE!L24` | Saldo anterior Tucumán |
| `G88` | `=G81+G82-SUM(G83:G87)` | **Resultado IIBB Córdoba** |
| `K88` | `=K81-SUM(K83:K87)` | **Resultado IIBB Santa Fe** |
| `O88` | `=O81-SUM(O83:O87)` | **Resultado IIBB Tucumán** |
| `H88` | `=IF(K88<0,"A favor","A pagar")` | Etiqueta |
| `P88` | `=+G88+K88` | Subtotal Córdoba + Santa Fe |

**Regla de negocio clave (IIBB):**

```
Resultado jurisdicción = Impuesto determinado − (Percepciones + Retenciones bancarias
                          + Retenciones + Otros créditos + Saldo anterior)
Si resultado < 0 → "A favor" (pasa a saldo anterior del próximo período)
```

> **Nota de implementación:** el flag `M73 = 1` (solo Tucumán activo en la grilla del período analizado) muestra que el esquema es **multi-jurisdicción configurable por período**. Las alícuotas por jurisdicción están en `D93` (4,25%) y `D94` (3%) para el cálculo de intereses, y `N79` (3,5%) para el TEM de la actividad 3.

### 5.7 Bloque Cálculo de Intereses (filas 91–94)

| Celda | Fórmula | Significado |
|---|---|---|
| `H93` | `=F93-E93` | Días de atraso (fecha pago − fecha vto.) |
| `J93` | `=C93*D93/30*H93` | **Intereses** = (impuesto × alícuota/30 × días) |
| `K93` | `=C93+J93` | Total = impuesto + intereses |

**Regla:** intereses por mora = base × (tasa mensual / 30) × días de atraso. Tasas: Córdoba 4,25% mensual, Santa Fe 3% mensual.

### 5.8 Bloque TEM — Tucumán (filas 98–113)

| Celda | Fórmula | Significado |
|---|---|---|
| `F101` | `San Miguel de Tucumán` | Jurisdicción |
| `F103` | `=D9+D10` | Base imponible TEM (transporte + caña) |
| `F105` | 0,0125 | Alícuota 1,25% |
| `F106` | `=F103*F105` | Impuesto bruto |
| `F107` | 61.446 | **Mínimo** |
| `F108` | `=IF(F106<F107,F107,F106)` | **Subtotal = max(impuesto, mínimo)** |
| `F109` | `=#REF!` | Retenciones/percepciones TEM (**fórmula rota**) |
| `F110` | `=F108-F109` | Subtotal TEM |
| `F113` | `=F110` | **Total TEM a pagar** |

**Regla:** el TEM paga el **mayor entre** el impuesto calculado (1,25%) y el mínimo ($61.446), menos retenciones/percepciones.

> ⚠️ **Bug del archivo:** `F109` = `=#REF!`. En la app, este valor debe ser la suma de retenciones + percepciones TEM (`RET TUC!M33` + `PER TUC!M33` + `RB TUC!L17` o el subconjunto correspondiente).

### 5.9 Bloque Totales (filas 116–120)

| Celda | Fórmula | Significado |
|---|---|---|
| `F116` | `=+E66` | IVA |
| `F117` | `=+G88` | IIBB Córdoba |
| `F118` | `=+F113` | TEM |
| `B116` | `=IF(F116<0,"IVA A FAVOR","IVA A PAGAR")` | Etiqueta |
| `B117` | `=IF(F117<0,"IIBB A FAVOR","IIBB A PAGAR")` | Etiqueta |
| `B118` | `=IF(F118<0,"TEM A FAVOR","TEM A PAGAR")` | Etiqueta |
| `F120` | `=SUMIF(F116:F118,">=0",F116:F118)` | **Total impuestos a pagar** (solo positivos) |

**Regla de negocio clave (total):**

```
Total a pagar = Σ de (IVA, IIBB, TEM) solo si el resultado es ≥ 0.
Los impuestos "a favor" (negativos) NO se restan del total a pagar.
```

---

## 6. Hojas de auditoría y control histórico

Estas hojas **no participan del cálculo mensual** pero documentan controles que la app debería emular:

### 6.1 `AUDITOR` — Conciliación mensual IVA (2026)

- **Débito fiscal** por actividad (`B9` transporte automotor, `C9` minimercados) — valores cargados del Portal IVA.
- **Crédito fiscal** `E` (a 21%), `F` (a 10,5%), `G` (a 27%), `H` (Dto. 814) — valores cargados del Portal IVA (p.ej. `E9 = 3245148.68 - 54500.88` = ajuste por NC).
- **Saldo técnico** `J9 = 1257988.04` (saldo del mes anterior).
- **Saldo 1° párrafo** `K9 = IF((D9-I9-J9)>0, -(D9-I9-J9), 0)` — solo si el débito supera a los créditos.
- **Saldo 2° párrafo** `L9 = IF((D9-I9-J9)>0, 0, -(D9-I9-J9))` — solo si hay excedente de créditos.
- **Monto utilizado** `N12/N13` — compensaciones aplicadas.
- **Retenciones/percepciones** `O` — totales del mes.
- **Saldo final** `Q9 = K9 + L9 + P9` (P9 = saldo 2° párrafo + ret/perc − utilizado).
- **Ventas netas gravadas** `U9 = B9/0.21`, `V9 = C9/0.21` (despeje de base).
- **Compras** `AC9 = SUM(E9/0.21) + (F9/0.105) + (G9/0.27)` (despeje de base por alícuota).
- `Z9` = diferencia ventas libro vs. Portal.

**Reglas:** el saldo técnico se arrastra mes a mes (`J10 = L9`, `J11 = L10`, …). El saldo 2° párrafo se convierte en saldo 1° del mes siguiente cuando corresponde (`M10 = IF(IF(K9=0,P9,Q9)>0, ...)`).

### 6.2 `AUD IVA` — Histórico de IVA mensual (2016–2018)

- Columnas: Mes, IVA DF, IVA CF, STFPA (saldo técnico período anterior), S. Técnico, SLD PA (saldo período anterior), PERC, RET, RESTITUCIÓN, Monto utilizado, SLD, Sdo. a pagar, Original/Rect., CF LIOBRO, DEC-814.
- **Ecuación mensual**: `F = -DF + CF + STFPA`; `L = SLD PA + PERC − RET − Monto utilizado − RESTITUCIÓN`; `M = F + L` (saldo a pagar).
- Cambio de criterio en 2017: `E = IF(F<0, 0, F)` / `G = IF(M<0, M, 0)` (solo negativos) — el saldo técnico negativo se arrastra.
- Marca de rectificación: columna `N` con `Orig`, `Rect 1`, `Rect 2`, `Rec 1`.

### 6.3 `AUD IIBB 2017` — Determinación de IIBB mensual (2017)

- Cálculo por mes con **alícuotas diferenciales por actividad**: transporte automotor 3,5%, minimercados 4,4%, y otros 2,5%.
- **Saldo a favor** `G13 = IF(H10<0, H10, 0)` — arrastre.
- **Pago a cuenta** `M13 = J11*0.05 + J11*0.1525` (TEM + percepciones).
- `O13 = J13 + J13 − K13 − L13 + N13 + M13 + J11` — determinación consolidada.

### 6.4 `EERRDO 2017` — Estado de resultados proyectado

- Ventas/Compras mensuales (2017) con proyecciones: `O6 = promedio`, `R6 = O6*0.21` (proyección IVA DF), `U6 = B7*0.21` (proyección IVA CF), `Z6 = AVERAGE(...)`.
- `AC6 = C6/B6 − 1` (variación % ventas).
- `AD6 = K6*0.035` (proyección IIBB 3,5%), `AF6 = AD6*0.21` (IVA sobre IIBB).
- `AN6 = 300000*13` — constante de proyección (mínimo TEM anualizado).
- Fila 16: `Decreto 814` con valores negativos (crédito a favor) y `AE16 = M6*0.21` (IVA sobre ventas).
- Fila 19: `Q19 = O6*0.3` — ventas gravadas al 30% (prorrata).

### 6.5 `CAJA FISCAL` y `Control de las acred.`

- `CAJA FISCAL`: cruce de caja/imputaciones mensuales con ratios (`O18 = N18/N7`, `S18 = R18/R7`), y ajustes por cuenta (`M23 = M7*1.25%` — 1,25% sobre ventas, `M24 = L24*1.5`, `M25 = L25*1.5`).
- `Control de las acred.`: **cruce de acreditaciones bancarias por banco** (RIO, COMAFI, GALICIA, CITI, ISBC, TUCUMAN) contra **total facturado según libro IVA**; `K = J − H` (diferencia), y **justificaciones** de acreditaciones no originadas por ventas (`R = SUM(M:Q)`).

### 6.6 `DIFERENCIAS-AJUSTE DE COEF`

- Control de diferencias entre lo **pagado** y el **saldo rectificado** de IIBB: `D = C − B` (diferencia) e `F = D + E` (intereses).
- `B4 = 930.6 + 259888.09` — pago compuesto (impuesto + intereses).

---

## 7. Flujo de cálculo completo (secuencia ejecutable)

El siguiente es el **orden de ejecución** que la app debe replicar para liquidar un período:

### Paso 0 — Preparación
1. Seleccionar **período** (mes/año) y **contribuyente** (CUIT + jurisdicciones habilitadas).
2. Verificar **saldos anteriores** disponibles: saldo técnico IVA (`SCT`), saldo a favor IVA (`DJ IVA PA`), saldos IIBB por jurisdicción (`SIFERE`).

### Paso 1 — Importar libros
3. Importar **ventas** (SIFERE/libro IVA ventas) → hoja `Ventas`.
4. Importar **compras** (SIFERE/libro IVA compras) → hoja `Compras`.
5. Clasificar proveedores por rubro (`Base de Datos Compras` → `AH`).
6. Importar **retenciones/percepciones IVA** (SICORE) → `Ret perc IVA`.
7. Importar **retenciones/percepciones provinciales** → `Sirtac`, `Sircar PER`, `RB/RET/PER TUC`.
8. Importar **sueldos F.931**.

### Paso 2 — Calcular débito fiscal (ventas)
9. Calcular **bases por alícuota** despejando IVA: `base = IVA / alícuota` (21%, 10,5%, 27%).
10. Calcular **débito fiscal total** = Σ IVA por alícuota (neteando NC).
11. Separar por **actividad** (transporte automotor, minimercados, otros).
12. Calcular **diferencia** contra el total general del libro (control).

### Paso 3 — Calcular crédito fiscal (compras)
13. Calcular **crédito fiscal computable** = Σ IVA por alícuota (neteando NC).
14. Separar **compras no gravadas/exentas** (K + L) para prorrata.
15. Calcular **CF a restituir** (NC) y **diferencias** contra el total del libro.

### Paso 4 — Crédito por contribuciones (Dto. 814)
16. Tomar **remuneración neta** del F.931 (`R17`).
17. Calcular crédito = remuneración × **6,5%**.

### Paso 5 — Consolidar IVA (DDJJ)
18. Calcular **saldo técnico** = DF − CF − Crédito contribuciones − Saldo técnico anterior.
19. Calcular **resultado IVA** = saldo técnico − (saldo 2° párrafo + percepciones − restituciones + retenciones).
20. Determinar etiqueta **A Pagar / A Favor**.

### Paso 6 — Calcular IIBB por jurisdicción
21. Para cada jurisdicción activa (Córdoba/Santa Fe/Tucumán):
    - Base = Σ (base actividad × flag jurisdicción).
    - Impuesto = (base + ajuste) × alícuota.
    - Resultado = impuesto − (percepciones + retenciones bancarias + retenciones + otros créditos + saldo anterior).
22. Determinar etiqueta **A pagar / A favor** por jurisdicción.

### Paso 7 — Calcular TEM (Tucumán)
23. Base = base transporte + base caña.
24. Impuesto = base × 1,25%; **aplicar mínimo** ($61.446): subtotal = max(impuesto, mínimo).
25. Subtotal − retenciones/percepciones TEM = **TEM a pagar**.

### Paso 8 — Calcular intereses (si hay mora)
26. Días = fecha pago − fecha vencimiento.
27. Interés = base × (tasa/30) × días (tasa según jurisdicción).

### Paso 9 — Consolidar totales
28. `Total a pagar = Σ de resultados ≥ 0` de IVA, IIBB, TEM.
29. Emitir **etiquetas** por impuesto y **resumen final**.

### Paso 10 — Auditoría y cierre
30. Ejecutar **conciliaciones**: ventas vs. Portal IVA (`AUDITOR`), acreditaciones bancarias vs. facturado (`Control de las acred.`).
31. **Versionar** la liquidación (Original/Rectificativa) — ver invariantes `V-003`/`V-004` del repo.
32. **Congelar** el período: guardar saldos de cierre como saldos iniciales del próximo período.

---

## 8. Mapeo de celdas → entidades del sistema

| Hoja/Celda del Excel | Entidad/Concepto en la app | Referencia en el repo |
|---|---|---|
| `Ventas` | Libro IVA ventas (`Voucher` tipo venta) | `packages/accounting-engine` |
| `Compras` | Libro IVA compras (`Voucher` tipo compra) | `packages/accounting-engine` |
| `Base de Datos Compras` | Maestro de proveedores con rubro | `apps/api/prisma/schema.prisma` |
| `Ret perc IVA` | Retenciones/percepciones de IVA | `apps/api/src/tax/` |
| `F.931` | Sueldos / contribuciones | `apps/api/src/tax/` |
| `SCT`, `DJ IVA PA` | Saldo técnico / saldo a favor IVA | `apps/api/src/tax/vat-service.ts` |
| `SIFERE`, `Sirtac`, `Sircar` | Saldos y retenciones IIBB por jurisdicción | `apps/api/src/tax/iibb-*.ts` |
| `IVA-IB-TEM!E66` | Resultado IVA (`settlement.line`) | `apps/api/src/tax/settlement-service.ts` |
| `IVA-IB-TEM!G88/K88/O88` | Resultado IIBB por jurisdicción | `apps/api/src/tax/settlement-service.ts` |
| `IVA-IB-TEM!F113` | Resultado TEM | `apps/api/src/tax/settlement-service.ts` |
| `IVA-IB-TEM!F120` | Total a pagar | `packages/contracts/src/tax.ts` |
| `AUDITOR`, `AUD IVA` | Conciliaciones mensuales | `packages/tax-engine/` |

---

## 9. Glosario del dominio (tal como lo usa el Excel)

| Término | Significado |
|---|---|
| **Débito fiscal (DF)** | IVA de las ventas del período. |
| **Crédito fiscal (CF)** | IVA de las compras del período (computable). |
| **CF LIOBRO** | Crédito fiscal según libro IVA (SIFERE) — columna `O` de `AUD IVA`. |
| **DEC-814** | Crédito por contribuciones de la seguridad social (Dto. 814/2001, hoy Art. 19 Ley 27.541). |
| **STFPA** | Saldo técnico del período anterior. |
| **S.Técnico** | Saldo técnico del período (DF − CF). |
| **SLD PA** | Saldo a favor del período anterior. |
| **SLD** | Saldo (acumulado) |
| **Sdo. a pagar** | Saldo final del mes (resultado). |
| **PERC** | Percepciones. |
| **RET** | Retenciones. |
| **RESTITUCIÓN** | Devolución de percepciones (notas de crédito). |
| **Monto utilizado** | Compensación de saldos a favor. |
| **Saldo 1° párrafo** | Saldo a favor técnico (art. 24, 1° párrafo). |
| **Saldo 2° párrafo** | Saldo a favor de libre disponibilidad (art. 24, 2° párrafo). |
| **SIFERE** | Sistema Federal de Retenciones (IIBB CM). |
| **SIRTAC** | Retenciones de IIBB Santa Fe. |
| **SIRCAR** | Percepciones de IIBB Córdoba. |
| **SIRCREB** | Retenciones bancarias de IIBB Convenio Multilateral. |
| **TEM** | Tributo Especial Municipal / Tasa municipal Tucumán. |
| **Dto. 814** | Decreto 814/2001 — crédito por contribuciones patronales. |

---

## 10. Consideraciones de implementación y riesgos

### 10.1 Decisiones pendientes

1. **Redondeo**: definir si los totales se redondean a 2 decimales por línea o al final (el Excel mezcla ambos; la DDJJ de AFIP exige 2 decimales por total).
2. **Diferencias de libro**: las diferencias `D14/F14`, `D25/F25` y `L112` son **controles manuales**. La app debe decidir si las trata como ajustes (vouchers de ajuste) o solo como reporte.
3. **Fórmula rota TEM**: `F109 = #REF!` debe reimplementarse como retenciones + percepciones TEM.
4. **Saldos "pegados"**: `SCT`, `DJ IVA PA`, `SIFERE` son valores ingresados manualmente. En la app, deben derivarse automáticamente del cierre del período anterior (con posibilidad de ajuste manual auditado).
5. **Valores manuales en Compras**: `J109/L109` ("cargados manualmente") sugieren que los totales de operaciones/NC se concilian contra el Portal IVA. La app debe ofrecer esa conciliación.
6. **Códigos de actividad**: el Excel usa códigos de actividad no estándar en la grilla de IIBB (`904`, `921`, `924` que en realidad son códigos de jurisdicción). Validar contra el padrón de AFIP/ARBA.

### 10.2 Riesgos e inconsistencias detectadas

| Riesgo | Descripción |
|---|---|
| **Redondeo cruzado** | El total del libro (`Ventas!AG`) redondeado a 2 decimales difiere de la suma por alícuota (centavos). |
| **`#REF!` en TEM** | `F109` roto. |
| **Mes en etiquetas** | `B120` dice "AGOSTO 2025" aunque el período es junio 2026 (etiqueta obsoleta). |
| **Coeficientes CM** | 0,3333 redondeado (3 jurisdicciones posibles) pero solo 2 en la grilla; el flag `M73=1` deja a Tucumán con TEM separado. |
| **Saldos históricos mixtos** | El workbook mezcla períodos (2013–2026); los saldos "anteriores" deben tomarse del período inmediato anterior, no de la última fila. |
| **`Mis Retenc` con datos 2015** | La hoja mezcla períodos; al replicar hay que filtrar por período. |
| **VLOOKUP sin #N/A handling** | Si un CUIT no está en `Base de Datos Compras`, la fórmula propaga `#N/A` a toda la cadena de IIBB. |

### 10.3 Invariantes a mantener en la app (alineación con el repo)

- `V-001`: la liquidación concilia con el mayor (diferencias con detalle y origen).
- `V-003`: una liquidación finalizada es inmutable (hash + RLS).
- `V-004`: versionado original/rectificativa.
- El resultado total a pagar solo suma impuestos ≥ 0 (no netea "a favor").
- Los saldos de cierre del período alimentan los saldos iniciales del siguiente.

---

## 11. Apéndice — Valores de referencia del período Junio 2026

(Extraídos del workbook; útiles como **fixtures de validación**.)

| Concepto | Valor | Origen |
|---|---|---|
| Débito fiscal total | 1.250.158,06 | `IVA-IB-TEM!J56` |
| Crédito fiscal total | 2.859.017,81 | `IVA-IB-TEM!J57` |
| Base neta ventas 21% | 5.623.842,92 | `Ventas!N24` |
| IVA ventas 21% | 1.181.007,02 | `Ventas!P24` |
| Ventas Fact B (Consumidor Final) | 876.897,87 (IVA) | `Ventas!T25` |
| Ventas transporte automotor | 252.000 (IVA) | `Ventas!T28` |
| Neto compras 21% | (Σ `Compras!AA`) | `Compras!AA101` |
| Crédito fiscal computable | 2.705.101,97 | `Compras!J117` |
| CF a restituir (NC) | 69.151,04 | `Compras!J118` |
| Compras no gravadas | Σ K101 + L101 | `Compras!K101+L101` |
| Remuneración neta (F.931) | `F.931!R17` | — |
| Crédito Dto. 814 (6,5%) | `E30` | — |
| Percepciones IVA | `Ret perc IVA!J50` | — |
| Retenciones IVA | `Ret perc IVA!J49` | — |
| Saldo técnico anterior | 651.983,11 | `SCT!F38` |
| Saldo a favor 2° párrafo anterior | 500.276,66 | `DJ IVA PA!L34` |
| Compensación aplicada | 181.580,01 | `DJ IVA PA!L37` |
| IIBB Córdoba (impuesto det.) | `IVA-IB-TEM!G81` | — |
| IIBB Santa Fe (impuesto det.) | `IVA-IB-TEM!K81` | — |
| TEM impuesto (1,25% o mínimo) | `IVA-IB-TEM!F108` | — |
| TEM mínimo | 61.446 | `IVA-IB-TEM!F107` |
| Saldo IIBB anterior Córdoba | 1.761.112,83 | `SIFERE!L22` |
| Saldo IIBB anterior Santa Fe | 2.292.123,08 | `SIFERE!L23` |
| Saldo IIBB anterior Tucumán | 7.104.721,89 | `SIFERE!L24` |
| Percepciones TEM | 122.173,32 | `PER TUC!M33` |
| Retenciones TEM | 6.859,36 | `RET TUC!M33` |
| Rec. bancarias TEM | 64.425,94 | `RB TUC!L17` |

---

## 12. Referencias en el repo

- Plan de desarrollo: `PLAN_DESARROLLO_CONTABLE.md`
- Invariantes (V-001, V-003, V-004): `docs/invariantes.md`
- Glosario: `docs/glosario.md`
- Servicio de liquidaciones: `apps/api/src/tax/settlement-service.ts`
- Servicio de IVA: `apps/api/src/tax/vat-service.ts`
- Contratos de tax: `packages/contracts/src/tax.ts`
- Motor impositivo: `packages/tax-engine/`
- Motor contable: `packages/accounting-engine/`
