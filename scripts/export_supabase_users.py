#!/usr/bin/env python3
"""Export Supabase Auth users to a private Excel artifact; never export passwords or tokens."""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo


def request_users(base_url: str, service_key: str, page: int, per_page: int = 500) -> dict:
    query = urllib.parse.urlencode({"page": page, "per_page": per_page})
    url = f"{base_url.rstrip('/')}/auth/v1/admin/users?{query}"
    req = urllib.request.Request(
        url,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Accept": "application/json",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # Do not print request headers or secrets.
        print(f"Supabase ha risposto con errore HTTP {exc.code}. Verifica URL e secret.", file=sys.stderr)
        raise SystemExit(1) from None
    except urllib.error.URLError as exc:
        print(f"Connessione a Supabase non riuscita: {exc.reason}", file=sys.stderr)
        raise SystemExit(1) from None


def ensure_private_bucket(base_url: str, service_key: str) -> None:
    url = f"{base_url.rstrip('/')}/storage/v1/bucket"
    body = json.dumps({"id": "admin-exports", "name": "admin-exports", "public": False}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30):
            pass
    except urllib.error.HTTPError as exc:
        # Supabase may report an existing bucket as either 409 or legacy HTTP 400.
        # In both cases, confirm the bucket exists and is private before continuing.
        if exc.code not in (400, 409):
            print(f"Creazione del contenitore privato Supabase fallita (HTTP {exc.code}).", file=sys.stderr)
            raise SystemExit(1) from None
        check = urllib.request.Request(
            f"{base_url.rstrip('/')}/storage/v1/bucket/admin-exports",
            headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
            method="GET",
        )
        try:
            with urllib.request.urlopen(check, timeout=30) as response:
                existing = json.loads(response.read().decode("utf-8"))
        except Exception:
            print("Impossibile verificare la privacy del bucket Supabase esistente; esportazione interrotta.", file=sys.stderr)
            raise SystemExit(1) from None
        if existing.get("public") is not False:
            print("Il bucket admin-exports non risulta privato. Esportazione interrotta per sicurezza.", file=sys.stderr)
            raise SystemExit(1)


def upload_private_excel(base_url: str, service_key: str, file_path: Path) -> None:
    url = f"{base_url.rstrip('/')}/storage/v1/object/admin-exports/tasca-iscrizioni.xlsx"
    data = file_path.read_bytes()
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "x-upsert": "true",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60):
            pass
    except urllib.error.HTTPError as exc:
        print(f"Caricamento dell'Excel nell'archivio privato fallito (HTTP {exc.code}).", file=sys.stderr)
        raise SystemExit(1) from None
    except urllib.error.URLError as exc:
        print(f"Connessione all'archivio privato non riuscita: {exc.reason}", file=sys.stderr)
        raise SystemExit(1) from None


def main() -> None:
    base_url = os.environ.get("SUPABASE_URL", "").strip()
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not base_url or not service_key:
        raise SystemExit(
            "Mancano i GitHub Actions secrets SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY."
        )

    users = []
    page = 1
    per_page = 500
    while True:
        payload = request_users(base_url, service_key, page, per_page)
        batch = payload.get("users", []) if isinstance(payload, dict) else []
        users.extend(batch)
        if len(batch) < per_page:
            break
        page += 1

    rows = []
    for user in users:
        metadata = user.get("user_metadata") or {}
        rows.append([
            user.get("id", ""),
            metadata.get("first_name", ""),
            metadata.get("last_name", ""),
            user.get("email", ""),
            "Sì" if user.get("email_confirmed_at") else "No",
            metadata.get("date_of_birth", ""),
            user.get("created_at", ""),
            "Sì" if metadata.get("onboarding_completed") is True else "No",
        ])

    rows.sort(key=lambda row: str(row[6]), reverse=True)
    wb = Workbook()
    ws = wb.active
    ws.title = "Iscrizioni"
    headers = [
        "ID utente",
        "Nome",
        "Cognome",
        "Email",
        "Email verificata",
        "Data di nascita",
        "Registrato il (UTC)",
        "Tutorial completato",
    ]
    ws.append(headers)
    for row in rows:
        ws.append(row)

    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="173D32")
        cell.alignment = Alignment(vertical="center")
    widths = [38, 20, 22, 34, 20, 18, 25, 23]
    for index, width in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(index)].width = width
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(vertical="top")
        # Keep IDs and emails as text; do not transform them into formulas.
        for index in (1, 4):
            row[index - 1].number_format = "@"

    if ws.max_row > 1:
        table = Table(displayName="RegistroIscrizioni", ref=ws.dimensions)
        table.tableStyleInfo = TableStyleInfo(
            name="TableStyleMedium4",
            showFirstColumn=False,
            showLastColumn=False,
            showRowStripes=True,
            showColumnStripes=False,
        )
        ws.add_table(table)

    info = wb.create_sheet("Info")
    info.append(["Generato il (UTC)", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")])
    info.append(["Utenti esportati", len(users)])
    info.append(["Fonte", "Supabase Auth"])
    info.append(["Nota", "Non sono esportate password, token o chiavi segrete."])
    info.column_dimensions["A"].width = 28
    info.column_dimensions["B"].width = 78
    info["A1"].font = Font(bold=True)
    output = Path("artifacts")
    output.mkdir(exist_ok=True)
    file_path = output / "tasca-iscrizioni.xlsx"
    wb.save(file_path)
    ensure_private_bucket(base_url, service_key)
    upload_private_excel(base_url, service_key, file_path)
    print(f"Esportazione completata: {len(users)} utenti. Excel aggiornato nel bucket privato Supabase; nessun dato personale riportato nei log.")


if __name__ == "__main__":
    main()
