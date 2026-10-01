// xivapi/ffxiv-datamining の CSV を読む小さなローダー（依存なし）

import fs from "node:fs";
import path from "node:path";

/** 1 行ぶんのレコード。キーは CSV のヘッダー名。行 ID は `_id`（サブ行は "12.3" 形式） */
export type Row = Record<string, string> & { _id: string };

export type Sheet = {
  list: Row[];
  /** 行 ID（数値でも文字列でも可）から行を引く */
  get: (id: string | number) => Row | undefined;
};

/** CSV 本文を行・セルに分解する（引用符、ダブルクォートのエスケープ、CRLF 対応） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** `<datamining>/csv/ja/<name>.csv` を読み込む */
export function loadSheet(datamining: string, name: string): Sheet {
  const text = fs.readFileSync(path.join(datamining, "csv", "ja", `${name}.csv`), "utf8").replace(/^﻿/, "");
  const [header, ...body] = parseCsv(text);
  const list: Row[] = [];
  const byId = new Map<string, Row>();
  for (const cells of body) {
    if (cells.length < header.length) continue;
    const rec: Record<string, string> = {};
    header.forEach((h, i) => (rec[h] = cells[i]));
    const row = { ...rec, _id: rec["#"] } as Row;
    list.push(row);
    byId.set(row._id, row);
  }
  return { list, get: (id) => byId.get(String(id)) };
}
