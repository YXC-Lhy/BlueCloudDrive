/**
 * 本地 D1 模拟（基于 node:sqlite），供自测与本地预览服务器使用。
 * 仅实现 _worker.js 用到的 D1 API 子集。
 */
import { DatabaseSync } from 'node:sqlite';

class Stmt {
  constructor(raw, sql, params = []) {
    this.raw = raw;
    this.sql = sql;
    this.params = params;
  }
  bind(...args) {
    return new Stmt(this.raw, this.sql, args);
  }
  async all() {
    const rows = this.raw.prepare(this.sql).all(...this.params);
    return { results: rows.map((r) => ({ ...r })), success: true, meta: {} };
  }
  async first() {
    const rows = this.raw.prepare(this.sql).all(...this.params);
    return rows.length ? { ...rows[0] } : null;
  }
  async run() {
    const info = this.raw.prepare(this.sql).run(...this.params);
    return { success: true, meta: { last_row_id: Number(info.lastInsertRowid || 0), changes: Number(info.changes || 0) } };
  }
}

export class D1 {
  constructor(file = ':memory:') {
    this.raw = new DatabaseSync(file);
  }
  prepare(sql) {
    return new Stmt(this.raw, sql, []);
  }
  async batch(stmts) {
    const out = [];
    for (const s of stmts) {
      if (/^\s*(select|pragma|with)/i.test(s.sql)) out.push(await s.all());
      else out.push(await s.run());
    }
    return out;
  }
  async exec(sql) {
    this.raw.exec(sql);
    return { count: 0, duration: 0 };
  }
}
