/**
 * Cache Layer - In-memory cache dengan auto-refresh
 * Elak hammer sumber asal; refresh data secara berkala di background
 */

export class DataCache {
  constructor() {
    this.store = new Map();   // key -> { data, fetchedAt, error }
    this.timers = new Map();  // key -> interval timer
  }

  /**
   * Daftar sumber data dengan auto-refresh
   * @param {string} key       - nama cache (cth: 'disasters')
   * @param {Function} fetcher - async function yang pulangkan data
   * @param {number} ttlMs     - refresh interval dalam ms
   */
  register(key, fetcher, ttlMs = 5 * 60 * 1000, onPersist = null) {
    const refresh = async () => {
      try {
        const data = await fetcher();
        this.store.set(key, { data, fetchedAt: new Date().toISOString(), error: null });
        console.log(`🔄 [cache] "${key}" refreshed (${new Date().toLocaleTimeString()})`);
        // Simpan ke storage jika ada callback
        if (onPersist) {
          try { onPersist(key, data); } catch (e) { console.error(`💾 [storage] "${key}" save failed: ${e.message}`); }
        }
      } catch (err) {
        const existing = this.store.get(key);
        this.store.set(key, {
          data: existing?.data || null,
          fetchedAt: existing?.fetchedAt || null,
          error: err.message,
        });
        console.error(`⚠️  [cache] "${key}" refresh failed: ${err.message.split('\n')[0]}`);
      }
    };

    // Fetch awal + jadualkan refresh berkala
    refresh();
    const timer = setInterval(refresh, ttlMs);
    this.timers.set(key, timer);
  }

  /** Dapatkan data dari cache */
  get(key) {
    return this.store.get(key) || { data: null, fetchedAt: null, error: 'not registered' };
  }

  /** Force refresh satu key sekarang */
  async forceRefresh(key, fetcher) {
    try {
      const data = await fetcher();
      this.store.set(key, { data, fetchedAt: new Date().toISOString(), error: null });
      return this.store.get(key);
    } catch (err) {
      const existing = this.store.get(key);
      this.store.set(key, { data: existing?.data || null, fetchedAt: existing?.fetchedAt || null, error: err.message });
      return this.store.get(key);
    }
  }

  /** Status semua cache */
  status() {
    const out = {};
    for (const [key, val] of this.store.entries()) {
      out[key] = {
        has_data: !!val.data,
        fetched_at: val.fetchedAt,
        error: val.error,
      };
    }
    return out;
  }

  /** Stop semua timers (untuk shutdown bersih) */
  stopAll() {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
  }
}
