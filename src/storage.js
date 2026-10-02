/**
 * Storage Layer - JSON file-based (tiada native binding, portable)
 * Simpan snapshot setiap refresh supaya ada sejarah/history data bencana.
 *
 * Struktur:
 *   data/
 *     snapshots/<source>/<timestamp>.json   ← setiap snapshot
 *     latest/<source>.json                  ← snapshot terkini
 *     index.json                            ← metadata semua snapshot
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = './data';
const SNAP_DIR = path.join(DATA_DIR, 'snapshots');
const LATEST_DIR = path.join(DATA_DIR, 'latest');
const INDEX_PATH = path.join(DATA_DIR, 'index.json');

export class Storage {
  constructor() {
    fs.mkdirSync(SNAP_DIR, { recursive: true });
    fs.mkdirSync(LATEST_DIR, { recursive: true });
    this.index = this._loadIndex();
  }

  _loadIndex() {
    try {
      return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    } catch (_) {
      return {}; // { source: [ {id, fetched_at, file, bytes} ] }
    }
  }

  _saveIndex() {
    fs.writeFileSync(INDEX_PATH, JSON.stringify(this.index, null, 2));
  }

  /** Simpan snapshot satu sumber. Skip jika fetched_at sama dengan yang terakhir. */
  saveSnapshot(source, data) {
    if (!data) return;
    const fetchedAt = data.fetched_at || data.generated_at || new Date().toISOString();

    this.index[source] = this.index[source] || [];
    const list = this.index[source];

    // Elak duplicate: skip jika snapshot terakhir ada fetched_at sama
    if (list.length && list[list.length - 1].fetched_at === fetchedAt) return;

    const safeTs = fetchedAt.replace(/[:.]/g, '-');
    const dir = path.join(SNAP_DIR, source);
    fs.mkdirSync(dir, { recursive: true });

    const file = path.join(dir, `${safeTs}.json`);
    const payload = JSON.stringify(data, null, 2);
    fs.writeFileSync(file, payload);

    // Kemaskini "latest"
    fs.writeFileSync(path.join(LATEST_DIR, `${source}.json`), payload);

    // Kemaskini index
    const id = (list.length ? list[list.length - 1].id : 0) + 1;
    list.push({ id, fetched_at: fetchedAt, file, bytes: payload.length, created_at: new Date().toISOString() });

    // Had simpanan: kekalkan 500 snapshot terkini per sumber
    if (list.length > 500) {
      const removed = list.shift();
      try { fs.unlinkSync(removed.file); } catch (_) {}
    }

    this._saveIndex();
  }

  /** Snapshot terkini bagi satu sumber */
  latest(source) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(LATEST_DIR, `${source}.json`), 'utf8'));
      return { data };
    } catch (_) {
      return null;
    }
  }

  /** Sejarah snapshot (metadata sahaja) */
  history(source, limit = 50) {
    const list = this.index[source] || [];
    return list.slice(-limit).reverse().map(({ id, fetched_at, bytes, created_at }) =>
      ({ id, fetched_at, bytes, created_at }));
  }

  /** Ambil satu snapshot ikut id */
  getSnapshot(source, id) {
    const list = this.index[source] || [];
    const entry = list.find(e => e.id === Number(id));
    if (!entry) return null;
    try {
      return { source, fetched_at: entry.fetched_at, data: JSON.parse(fs.readFileSync(entry.file, 'utf8')) };
    } catch (_) {
      return null;
    }
  }

  /** Trend bencana: jumlah mangsa/pps dari snapshot disasters yang disimpan */
  disasterTrend(limit = 30) {
    const list = this.index['disasters'] || [];
    const recent = list.slice(-limit).reverse();
    const trend = [];
    for (const entry of recent) {
      try {
        const snap = JSON.parse(fs.readFileSync(entry.file, 'utf8'));
        const bencana = snap.bencana || [];
        trend.push({
          fetched_at: entry.fetched_at,
          kejadian: bencana.length,
          total_pps: sum(bencana, 'bilangan_pps'),
          total_keluarga: sum(bencana, 'bilangan_keluarga'),
          total_mangsa: sum(bencana, 'bilangan_mangsa'),
        });
      } catch (_) {}
    }
    return trend;
  }

  /** Statistik ringkas keseluruhan */
  stats() {
    const sumber = Object.entries(this.index).map(([source, list]) => ({
      source,
      snapshots: list.length,
      first: list[0]?.fetched_at || null,
      last: list[list.length - 1]?.fetched_at || null,
    }));
    return { sumber, storage_type: 'json-file', data_dir: DATA_DIR };
  }

  close() { /* no-op untuk JSON storage */ }
}

function sum(arr, key) {
  return arr.reduce((acc, x) => acc + (Number(x[key]) || 0), 0);
}
