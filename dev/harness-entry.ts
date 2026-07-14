// Bundle entry for the visual harness (dev/harness.html). Exposes the REAL
// format + table-editing modules on window so the harness exercises the same
// code the app ships — no duplicated logic to drift.
import * as format from '../src/lib/format';
import * as tableEditing from '../src/lib/tableEditing';

(window as any).VXFormat = format;
(window as any).VXTable = tableEditing;
