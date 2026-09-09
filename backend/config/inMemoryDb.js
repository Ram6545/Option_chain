/**
 * In-Memory Database Fallback
 *
 * Provides a lightweight in-memory database that mimics the pg Pool query()
 * interface. Used as a fallback when PostgreSQL is not available, so the
 * application can run without any external database service.
 *
 * Supports the subset of SQL used by this application:
 * - CREATE TABLE IF NOT EXISTS
 * - CREATE INDEX IF NOT EXISTS
 * - INSERT ... VALUES ... [ON CONFLICT ... DO NOTHING] [RETURNING ...]
 * - SELECT ... FROM ... [WHERE ...] [ORDER BY ...] [LIMIT ...] [OFFSET ...]
 * - SELECT COUNT(*) ...
 */

class InMemoryDatabase {
  constructor() {
    this.tables = new Map(); // table name -> array of row objects
    this.counters = new Map(); // table name -> next auto-increment id
    this.schemas = new Map(); // table name -> { columnName: { type, default } }
  }

  /**
   * Get or create a table (array of rows).
   * @param {string} name
   * @returns {Array}
   */
  getTable(name) {
    if (!this.tables.has(name)) {
      this.tables.set(name, []);
      this.counters.set(name, 1);
    }
    return this.tables.get(name);
  }

  /**
   * Get the next auto-increment id for a table.
   * @param {string} name
   * @returns {number}
   */
  nextId(name) {
    const table = this.getTable(name);
    const id = this.counters.get(name);
    this.counters.set(name, id + 1);
    return id;
  }

  /**
   * Parse a CREATE TABLE statement to extract column definitions and defaults.
   * @param {string} sql - The CREATE TABLE SQL
   * @param {string} tableName - Table name
   */
  parseSchema(sql, tableName) {
    const schema = {};
    // Extract the content between parentheses
    const bodyMatch = sql.match(/CREATE TABLE IF NOT EXISTS\s+\w+\s*\((.+)\)/is);
    if (!bodyMatch) return;

    const body = bodyMatch[1];
    // Split by comma, but be careful of nested parentheses
    const columns = [];
    let depth = 0;
    let current = '';
    for (const ch of body) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        columns.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) columns.push(current.trim());

    for (const colDef of columns) {
      // Skip constraint definitions (PRIMARY KEY, FOREIGN KEY, CHECK, UNIQUE, etc.)
      if (/^(PRIMARY|FOREIGN|CHECK|UNIQUE|CONSTRAINT|KEY)/i.test(colDef)) continue;

      const tokens = colDef.split(/\s+/);
      const colName = tokens[0];
      if (!colName) continue;

      const colType = tokens[1] || '';
      let defaultValue = undefined;

      // Extract DEFAULT value
      const defaultMatch = colDef.match(/DEFAULT\s+(.+)/i);
      if (defaultMatch) {
        const defaultExpr = defaultMatch[1].trim();
        if (defaultExpr === 'true') defaultValue = true;
        else if (defaultExpr === 'false') defaultValue = false;
        else if (defaultExpr === 'NULL' || defaultExpr === 'null') defaultValue = null;
        else if (defaultExpr === 'NOW()') defaultValue = new Date();
        else if (defaultExpr.startsWith("'") && defaultExpr.endsWith("'")) {
          defaultValue = defaultExpr.slice(1, -1).replace(/''/g, "'");
        } else if (!isNaN(defaultExpr)) {
          defaultValue = parseFloat(defaultExpr);
        } else {
          defaultValue = defaultExpr;
        }
      }

      schema[colName] = { type: colType, default: defaultValue };
    }

    this.schemas.set(tableName, schema);
  }

  /**
   * Get the schema for a table.
   * @param {string} name
   * @returns {Object}
   */
  getSchema(name) {
    return this.schemas.get(name) || {};
  }

  /**
   * Execute a SQL query against the in-memory store.
   * @param {string} text - SQL query
   * @param {Array} params - Parameter values
   * @returns {Promise<{rows: Array, rowCount: number}>}
   */
  async query(text, params = []) {
    // If multiple statements are in the query string (separated by semicolon)
    const statements = text.split(';').map((s) => s.trim()).filter(Boolean);
    if (statements.length > 1) {
      let lastRes = { rows: [], rowCount: 0 };
      for (const stmt of statements) {
        lastRes = await this.executeSingleQuery(stmt, params);
      }
      return lastRes;
    }
    return this.executeSingleQuery(text, params);
  }

  /**
   * Execute a single SQL statement.
   * @param {string} text
   * @param {Array} params
   * @returns {Promise<{rows: Array, rowCount: number}>}
   */
  async executeSingleQuery(text, params = []) {
    const sql = text.trim().replace(/\s+/g, ' ');

    // CREATE TABLE IF NOT EXISTS
    if (/^CREATE TABLE IF NOT EXISTS/i.test(sql)) {
      const match = sql.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/i);
      if (match) {
        const tableName = match[1];
        this.getTable(tableName);
        this.parseSchema(text, tableName);
      }
      return { rows: [], rowCount: 0 };
    }

    // CREATE INDEX IF NOT EXISTS / ALTER TABLE
    if (/^(CREATE INDEX|ALTER TABLE)/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }

    // INSERT
    if (/^INSERT/i.test(sql)) {
      return this.handleInsert(sql, params);
    }

    // SELECT
    if (/^SELECT/i.test(sql)) {
      return this.handleSelect(sql, params);
    }

    // Default: no-op
    return { rows: [], rowCount: 0 };
  }

  /**
   * Handle INSERT statements.
   * @param {string} sql
   * @param {Array} params
   * @returns {{rows: Array, rowCount: number}}
   */
  handleInsert(sql, params) {
    // Parse table name
    const tableMatch = sql.match(/INSERT INTO\s+(\w+)/i);
    if (!tableMatch) return { rows: [], rowCount: 0 };
    const table = tableMatch[1];

    // Parse column names
    const colsMatch = sql.match(/INSERT INTO\s+\w+\s*\(([^)]+)\)/i);
    const columns = colsMatch
      ? colsMatch[1].split(',').map((c) => c.trim())
      : [];

    // Parse VALUES clause
    const valuesMatch = sql.match(/VALUES\s+(.+?)(?:\s+ON CONFLICT|\s+RETURNING|$)/is);
    if (!valuesMatch) return { rows: [], rowCount: 0 };

    const valuesClause = valuesMatch[1].trim();
    const rows = this.parseValues(valuesClause, params, columns);

    // Check for ON CONFLICT
    const hasDoNothing = /ON CONFLICT\s*\([^)]+\)\s*DO NOTHING/i.test(sql);
    const hasDoUpdate = /ON CONFLICT\s*\([^)]+\)\s*DO UPDATE/i.test(sql);
    const conflictColMatch = sql.match(/ON CONFLICT\s*\(([^)]+)\)/i);
    const conflictColumn = conflictColMatch ? conflictColMatch[1].trim() : null;

    // Check for RETURNING clause
    const returningMatch = sql.match(/RETURNING\s+(.+?)(?:;|$)/i);
    const returningCols = returningMatch
      ? returningMatch[1].split(',').map((c) => c.trim())
      : null;

    const tableRows = this.getTable(table);
    const schema = this.getSchema(table);
    const insertedRows = [];

    for (const row of rows) {
      // Add auto-increment id if the table has an id column (SERIAL)
      if (schema.id && !row.id) {
        row.id = this.nextId(table);
      }

      // Apply DEFAULT values for columns not in the INSERT
      for (const [colName, colDef] of Object.entries(schema)) {
        if (!(colName in row) && colDef.default !== undefined) {
          row[colName] = colDef.default;
        }
      }

      // Handle ON CONFLICT DO NOTHING / DO UPDATE
      if (conflictColumn && (hasDoNothing || hasDoUpdate)) {
        const existingIdx = tableRows.findIndex((r) => String(r[conflictColumn]).toUpperCase() === String(row[conflictColumn]).toUpperCase());
        if (existingIdx !== -1) {
          if (hasDoUpdate) {
            tableRows[existingIdx] = { ...tableRows[existingIdx], ...row, id: tableRows[existingIdx].id };
            if (returningCols) {
              const returned = {};
              for (const col of returningCols) {
                returned[col] = tableRows[existingIdx][col];
              }
              insertedRows.push(returned);
            }
          }
          continue;
        }
      }

      tableRows.push(row);

      if (returningCols) {
        const returned = {};
        for (const col of returningCols) {
          returned[col] = row[col];
        }
        insertedRows.push(returned);
      }
    }

    if (returningCols) {
      return { rows: insertedRows, rowCount: insertedRows.length };
    }
    return { rows: [], rowCount: rows.length };
  }

  /**
   * Parse a VALUES clause into an array of row objects.
   * @param {string} valuesClause - e.g. "($1, $2, 'CE', $4), ($13, $14, 'PE', $16)"
   * @param {Array} params - parameter values
   * @param {Array} columns - column names
   * @returns {Array<Object>}
   */
  parseValues(valuesClause, params, columns) {
    const rows = [];
    // Match each (...) group
    const groupRegex = /\(([^)]+)\)/g;
    let match;
    while ((match = groupRegex.exec(valuesClause)) !== null) {
      const values = match[1].split(',').map((v) => v.trim());
      const row = {};
      for (let i = 0; i < columns.length && i < values.length; i++) {
        row[columns[i]] = this.parseValue(values[i], params);
      }
      rows.push(row);
    }
    return rows;
  }

  /**
   * Parse a single value token, resolving $N placeholders.
   * @param {string} token
   * @param {Array} params
   * @returns {*}
   */
  parseValue(token, params) {
    token = token.trim();
    if (token === 'NULL' || token === 'null') return null;
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token.startsWith("'") && token.endsWith("'")) {
      return token.slice(1, -1).replace(/''/g, "'");
    }
    // Check for $N placeholder
    const paramMatch = token.match(/^\$(\d+)$/);
    if (paramMatch) {
      const idx = parseInt(paramMatch[1], 10) - 1;
      return params[idx];
    }
    // Numeric literal
    if (!isNaN(token)) {
      return parseFloat(token);
    }
    return token;
  }

  /**
   * Handle SELECT statements.
   * @param {string} sql
   * @param {Array} params
   * @returns {{rows: Array, rowCount: number}}
   */
  handleSelect(sql, params) {
    // Parse table name
    const fromMatch = sql.match(/FROM\s+(\w+)/i);
    if (!fromMatch) return { rows: [], rowCount: 0 };
    const table = fromMatch[1];
    const tableRows = this.getTable(table);

    // Parse SELECT columns
    const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
    const selectPart = selectMatch ? selectMatch[1].trim() : '*';
    const isCount = /COUNT\s*\(\*\)/i.test(selectPart);

    // Parse WHERE clause
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER BY|\s+LIMIT|\s+OFFSET|$)/i);
    let filtered = tableRows;
    if (whereMatch) {
      filtered = this.applyWhere(tableRows, whereMatch[1].trim(), params);
    }

    // Parse ORDER BY
    const orderByMatch = sql.match(/ORDER BY\s+(.+?)(?:\s+LIMIT|\s+OFFSET|$)/i);
    if (orderByMatch) {
      filtered = this.applyOrderBy(filtered, orderByMatch[1].trim());
    }

    // Parse OFFSET
    const offsetMatch = sql.match(/OFFSET\s+(\S+)/i);
    let offset = 0;
    if (offsetMatch) {
      const offsetVal = offsetMatch[1];
      const paramMatch = offsetVal.match(/^\$(\d+)$/);
      offset = paramMatch ? parseInt(params[parseInt(paramMatch[1], 10) - 1], 10) : parseInt(offsetVal, 10);
      if (isNaN(offset)) offset = 0;
    }

    // Parse LIMIT
    const limitMatch = sql.match(/LIMIT\s+(\S+)/i);
    let limit = null;
    if (limitMatch) {
      const limitVal = limitMatch[1];
      const paramMatch = limitVal.match(/^\$(\d+)$/);
      limit = paramMatch ? parseInt(params[parseInt(paramMatch[1], 10) - 1], 10) : parseInt(limitVal, 10);
      if (isNaN(limit)) limit = null;
    }

    if (offset > 0) {
      filtered = filtered.slice(offset);
    }
    if (limit !== null && limit >= 0) {
      filtered = filtered.slice(0, limit);
    }

    if (isCount) {
      return { rows: [{ count: String(filtered.length) }], rowCount: 1 };
    }

    // Project columns
    const result = filtered.map((row) => this.projectRow(row, selectPart));
    return { rows: result, rowCount: result.length };
  }

  /**
   * Apply WHERE clause filtering.
   * @param {Array} rows
   * @param {string} whereClause
   * @param {Array} params
   * @returns {Array}
   */
  applyWhere(rows, whereClause, params) {
    // Handle simple conditions: column = value, column = $N, column = true, column = false
    const conditions = whereClause.split(/\s+AND\s+/i);
    return rows.filter((row) => {
      return conditions.every((cond) => {
        const eqMatch = cond.match(/(\w+)\s*=\s*(.+)/i);
        if (eqMatch) {
          const col = eqMatch[1];
          let val = eqMatch[2].trim();
          // Resolve $N placeholder
          const paramMatch = val.match(/^\$(\d+)$/);
          if (paramMatch) {
            val = params[parseInt(paramMatch[1], 10) - 1];
          } else if (val === 'true') {
            val = true;
          } else if (val === 'false') {
            val = false;
          } else if (val === 'NULL' || val === 'null') {
            val = null;
          } else if (val.startsWith("'") && val.endsWith("'")) {
            val = val.slice(1, -1).replace(/''/g, "'");
          } else if (!isNaN(val)) {
            val = parseFloat(val);
          }
          const rowVal = row[col];
          if (val === null) return rowVal === null || rowVal === undefined;
          if (typeof val === 'boolean') return rowVal === val;
          if (typeof val === 'number') return Number(rowVal) === val;
          return String(rowVal) === String(val);
        }
        return true;
      });
    });
  }

  /**
   * Apply ORDER BY clause.
   * @param {Array} rows
   * @param {string} orderByClause
   * @returns {Array}
   */
  applyOrderBy(rows, orderByClause) {
    const parts = orderByClause.split(',').map((p) => p.trim());
    const sortFns = parts.map((part) => {
      const tokens = part.split(/\s+/);
      const col = tokens[0];
      const dir = tokens[1] ? tokens[1].toUpperCase() : 'ASC';
      return (a, b) => {
        let aVal = a[col];
        let bVal = b[col];
        // Handle Date objects
        if (aVal instanceof Date) aVal = aVal.getTime();
        if (bVal instanceof Date) bVal = bVal.getTime();
        
        if (typeof aVal === 'string' && !isNaN(Date.parse(aVal)) && isNaN(Number(aVal))) {
          aVal = new Date(aVal).getTime();
        }
        if (typeof bVal === 'string' && !isNaN(Date.parse(bVal)) && isNaN(Number(bVal))) {
          bVal = new Date(bVal).getTime();
        }

        if (aVal === null || aVal === undefined) aVal = '';
        if (bVal === null || bVal === undefined) bVal = '';

        if (typeof aVal === 'number' && typeof bVal === 'number') {
          if (aVal < bVal) return dir === 'ASC' ? -1 : 1;
          if (aVal > bVal) return dir === 'ASC' ? 1 : -1;
          return 0;
        }

        if (!isNaN(Number(aVal)) && !isNaN(Number(bVal)) && aVal !== '' && bVal !== '') {
          const numA = Number(aVal);
          const numB = Number(bVal);
          if (numA < numB) return dir === 'ASC' ? -1 : 1;
          if (numA > numB) return dir === 'ASC' ? 1 : -1;
          return 0;
        }

        const cmp = String(aVal).localeCompare(String(bVal));
        return dir === 'ASC' ? cmp : -cmp;
      };
    });
    return [...rows].sort((a, b) => {
      for (const fn of sortFns) {
        const result = fn(a, b);
        if (result !== 0) return result;
      }
      return 0;
    });
  }

  /**
   * Project only the requested columns from a row.
   * @param {Object} row
   * @param {string} selectPart
   * @returns {Object}
   */
  projectRow(row, selectPart) {
    if (selectPart === '*') return { ...row };
    const cols = selectPart.split(',').map((c) => c.trim());
    const result = {};
    for (const col of cols) {
      // Handle "COUNT(*) as count"
      if (/COUNT\s*\(\*\)/i.test(col)) {
        const aliasMatch = col.match(/AS\s+(\w+)/i);
        const alias = aliasMatch ? aliasMatch[1] : 'count';
        result[alias] = row.count || 0;
      } else {
        result[col] = row[col];
      }
    }
    return result;
  }

  /**
   * Close the database connection (no-op for in-memory).
   */
  async end() {
    // No-op
  }
}

// Singleton instance
const db = new InMemoryDatabase();

module.exports = {
  pool: {
    query: (text, params) => db.query(text, params),
    connect: () => ({ release: () => {} }),
    on: () => {},
    end: () => db.end(),
  },
  query: (text, params) => db.query(text, params),
  db,
};
